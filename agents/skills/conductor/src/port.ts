// `ObservePort` の実装。外部コマンド（`watch.sh` / `gh` / `git` / `cycle-mark.py`）を叩く層。
//
// **失敗を `false` へ倒さない。**コマンドが落ちたら `unobservable` を返す ——
// 倒すと、観測できなかったことが「そうではない」として遷移を通す。

import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ProjectConfig, ResolvedSurface } from "./config.ts";
import type { ObservePort } from "./observe.ts";
import {
  carriesReportOrHalt,
  entryBlockRecord,
  hasStandaloneLine,
  liveOwnedPrs,
  keysOfPlan,
  planRecord,
  readyRecord,
} from "./records.ts";
import { bodyMatchesPlan, planBases, planInvalidated, readyBases, readyStale } from "./plan.ts";
import type { ChangedPath, PlanBase } from "./plan.ts";
import { issueContractComplete } from "./contract.ts";
import type { Observed } from "./types.ts";
import { absent, present, unobservable } from "./types.ts";

type RunResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

const run = async (cmd: readonly string[], cwd?: string): Promise<RunResult> => {
  const proc = Bun.spawn([...cmd], {
    ...(cwd === undefined ? {} : { cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    return { ok: false, reason: `${cmd[0]} が ${code} で終了: ${stderr.trim().slice(0, 200)}` };
  return { ok: true, stdout };
};

const json = async <T>(cmd: readonly string[], cwd?: string): Promise<Observed<T>> => {
  const result = await run(cmd, cwd);
  if (!result.ok) return unobservable(result.reason);
  try {
    return present(JSON.parse(result.stdout) as T);
  } catch (error) {
    return unobservable(`JSON として読めない: ${String(error)}`);
  }
};

/** **本文はそのまま UTF-8 で SHA-256。正規化しない**（`body-digest.md`）。 */
const digest = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex");

export type PortOptions = {
  readonly config: ProjectConfig;
  /** 座標に checkout path を束ねたもの（`resolveSurfaces` の結果）。**順序は座標のまま** */
  readonly surfaces: readonly ResolvedSurface[];
  /** `scripts/` の絶対 path */
  readonly scriptsDir: string;
  /** `watch.sh --snapshot` の書き出し先。**tick を終えるときに `--baseline` として渡す同じ file** */
  readonly snapshotPath: string;
};

const surfaceOf = (surfaces: readonly ResolvedSurface[], name: string) =>
  surfaces.find((s) => s.name === name);

/** spawn の第 1 引数。shebang は使われない。`watch.sh` は bash。 */
export const WATCH_SHELL = "bash";

/**
 * `watch.sh --snapshot` の引数。**純関数にしてあるのは、渡し漏れが観測の穴になるから** ——
 * 面を 1 つ落とすとそこで書き進んでいる課題が成果ゼロの周として数えられ、
 * `--sessions-cmd` / `--workspaces-cmd` を落とすと usage error で 1 度も観測できない。
 *
 * **制御面（先頭）は `--repo` で渡すので `--landing` に重ねない。**
 */
export const snapshotArgs = (
  config: ProjectConfig,
  surfaces: readonly ResolvedSurface[],
  scriptsDir: string,
  snapshotPath: string,
): string[] => {
  const control = surfaces[0];
  const origin = control?.integrationRef ?? "";
  const defaultBranch = origin.startsWith("origin/") ? origin.slice("origin/".length) : "";
  return [
    WATCH_SHELL,
    `${scriptsDir}/watch.sh`,
    "--snapshot",
    snapshotPath,
    "--repo",
    control?.repoPath ?? "",
    "--gh-repo",
    config.ghRepo,
    ...surfaces
      .slice(1)
      .flatMap((s) => ["--landing", `${s.name}:${s.integrationRef}:${s.repoPath}`]),
    "--project-org",
    config.projectOrg,
    "--project-number",
    String(config.projectNumber),
    "--status-field",
    config.statusField,
    "--sessions-cmd",
    config.sessionsCmd,
    "--workspaces-cmd",
    config.workspacesCmd,
    ...(defaultBranch !== "" ? ["--default-branch", defaultBranch] : []),
  ];
};

export const createPort = (options: PortOptions): ObservePort => {
  const { config, surfaces, scriptsDir, snapshotPath } = options;
  // **制御面は座標の先頭**（`snapshotArgs` と同じ規則）。接頭辞の無い scope 項目はこの面の path。
  const control = surfaces[0]?.name ?? "";

  /**
   * repo の全 PR。**tick に 1 回しか取らない。**`issueFacts` は Issue ごとに呼ばれるので、
   * 都度 `--paginate` しない。
   */
  let prsOnce:
    | Promise<
        Observed<
          { number: number; merged_at: string | null; state: string; head: { ref: string } }[]
        >
      >
    | undefined;
  const allPrs = () =>
    (prsOnce ??= json<
      { number: number; merged_at: string | null; state: string; head: { ref: string } }[]
    >(["gh", "api", `repos/${config.ghRepo}/pulls?state=all&per_page=100`, "--paginate"]));

  const bodies = new Map<number, Observed<string>>();
  const comments = new Map<number, readonly string[]>();
  /** claim の記録が書かれた時刻。**merge の枠の順序キー**なので、固定値へ倒さない */
  const claimTimes = new Map<number, Observed<number>>();
  /** 人待ちコメントの `createdAt`。**`updatedAt` で代用しない** */
  const waitTimes = new Map<number, Observed<number>>();

  /**
   * 面ごとの `base..統合先` で変わった path。**`plan` と `ready` で同じ手順を 2 度書かない** ——
   * 片方だけ直すと、失効と鮮度の判定が割れる。
   */
  const changedSince = async (
    bases: readonly PlanBase[],
  ): Promise<Observed<readonly ChangedPath[]>> => {
    const collected: ChangedPath[] = [];
    for (const { surface: name, base } of bases) {
      const surface = surfaceOf(surfaces, name);
      if (surface === undefined) return unobservable(`座標表に無い面: ${name}`);
      if (base === undefined) return unobservable(`記録に面 ${name} の base が無い`);
      const diff = await run(
        ["git", "diff", "--name-only", `${base}...${surface.integrationRef}`],
        surface.repoPath,
      );
      if (!diff.ok) return unobservable(diff.reason);
      for (const path of diff.stdout.split("\n")) {
        if (path !== "") collected.push({ surface: name, path });
      }
    }
    return present(collected);
  };

  return {
    snapshot: async () => {
      const result = await run(snapshotArgs(config, surfaces, scriptsDir, snapshotPath));
      // **観測できなかった tick も watcher は張る**ので、ここは投げて呼び出し側に判断させる。
      if (!result.ok) throw new Error(`snapshot に失敗した: ${result.reason}`);
      return result.stdout;
    },

    // **Issue ごとに引かない。**repo 単位の bulk 1 系統にする。
    //
    // **打ち切りは fail-closed。**`--paginate` が途中で落ちたら、欠けた分を「無い」と
    // 読むことになる —— 記録が無い課題として claim や差し戻しが走る。
    issueBodies: async (numbers) => {
      const all = await json<{ number: number; body: string | null }[]>([
        "gh",
        "api",
        "--paginate",
        `repos/${config.ghRepo}/issues?state=all&per_page=100`,
      ]);
      const map = new Map<number, Observed<string>>();
      if (all.kind !== "present") {
        for (const n of numbers) {
          const miss: Observed<string> = unobservable("Issue 一覧を読めない");
          bodies.set(n, miss);
          map.set(n, miss);
        }
        return map;
      }
      const byNumber = new Map(all.value.map((i) => [i.number, i]));
      for (const n of numbers) {
        // **board に居るのに一覧に無い**のは欠落。既定へ倒さない。
        const found = byNumber.get(n);
        const observed: Observed<string> =
          found === undefined ? unobservable("Issue 一覧に居ない") : present(found.body ?? "");
        bodies.set(n, observed);
        map.set(n, observed);
      }
      return map;
    },

    // **`sort=updated` の窓で切らない。**claim と plan は書いた後に更新されないので、
    // 窓で切ると「計画はあるのに planCommentExists=false」が再発する。marker を持つ限り全ページ辿る。
    issueComments: async (numbers) => {
      const all = await json<
        {
          issue_url: string;
          body: string | null;
          created_at: string;
          id: number;
        }[]
      >(["gh", "api", "--paginate", `repos/${config.ghRepo}/issues/comments?per_page=100`]);
      const map = new Map<number, Observed<readonly string[]>>();
      if (all.kind !== "present") {
        for (const n of numbers) {
          const miss: Observed<readonly string[]> = unobservable("コメント一覧を読めない");
          comments.set(n, []);
          claimTimes.set(n, unobservable("コメントを読めない"));
          waitTimes.set(n, unobservable("コメントを読めない"));
          map.set(n, miss);
        }
        return map;
      }
      // **marker を持つものだけ残す。**種類は列挙しない（形だけで拾う）。
      const marked = all.value.filter((c) => /<!--\s*[a-z][a-z-]*\s*-->/.test(c.body ?? ""));
      const byIssue = new Map<number, typeof marked>();
      for (const c of marked) {
        const n = Number(c.issue_url.split("/").pop());
        if (!Number.isInteger(n)) continue;
        const list = byIssue.get(n) ?? [];
        list.push(c);
        byIssue.set(n, list);
      }
      const sorted = (raw: typeof marked) =>
        [...raw].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
      // **PR 番号のコメントも残す。**提出のまとめは制御面 PR へ書くので、Issue 番号だけ
      // 残すと親の提出証跡から落ちる。返す map は渡された番号のまま（他 marker を混ぜない）。
      for (const [n, raw] of byIssue) {
        comments.set(
          n,
          sorted(raw).map((c) => c.body ?? ""),
        );
      }
      for (const n of numbers) {
        // **Issue ごとに作成順で整列する。**repo 全体の endpoint は Issue をまたいで並ぶので、
        // そのまま連ねると `claimedAt`（merge の枠の順序キー）が別の意味になる。
        const list = sorted(byIssue.get(n) ?? []);
        const bodiesOfIssue = comments.get(n) ?? list.map((c) => c.body ?? "");
        map.set(n, present(bodiesOfIssue));
        const claim = list.find((c) => hasStandaloneLine(c.body ?? "", "<!-- claim -->"));
        claimTimes.set(n, claim === undefined ? absent() : present(Date.parse(claim.created_at)));
        const wait = list.find((c) => hasStandaloneLine(c.body ?? "", "<!-- wait -->"));
        waitTimes.set(n, wait === undefined ? absent() : present(Date.parse(wait.created_at)));
      }
      return map;
    },

    surfaceGit: async (issue, name) => {
      const surface = surfaceOf(surfaces, name);
      if (surface === undefined) {
        return { ahead: unobservable("座標表に無い面"), head: unobservable("座標表に無い面") };
      }
      // **branch 名は `{prefix}/{番号}-{slug}`。**prefix の集合は project が変えてよいので
      // allowlist を焼き込まず、番号で引く。
      const branches = await run(
        ["git", "branch", "--list", "--format=%(refname:short)"],
        surface.repoPath,
      );
      if (!branches.ok)
        return { ahead: unobservable(branches.reason), head: unobservable(branches.reason) };
      const branch = branches.stdout
        .split("\n")
        .find((b) => new RegExp(`^[^/]+/${issue}-`).test(b.trim()));
      if (branch === undefined) return { ahead: present(false), head: absent() };

      const head = await run(["git", "rev-parse", branch.trim()], surface.repoPath);
      const ahead = await run(
        ["git", "rev-list", "--count", `${surface.integrationRef}..${branch.trim()}`],
        surface.repoPath,
      );
      const aheadCount = ahead.ok ? Number(ahead.stdout.trim()) : Number.NaN;
      return {
        ahead: ahead.ok ? present(aheadCount > 0) : unobservable(ahead.reason),
        head: head.ok ? present(head.stdout.trim()) : unobservable(head.reason),
      };
    },

    isAncestor: async (name, ancestor, descendant) => {
      if (ancestor === descendant) return present(true);
      const surface = surfaceOf(surfaces, name);
      if (surface === undefined) return unobservable(`座標表に無い面: ${name}`);
      const proc = Bun.spawn(["git", "merge-base", "--is-ancestor", ancestor, descendant], {
        cwd: surface.repoPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code === 0) return present(true);
      if (code === 1 || code === 128) return present(false);
      return unobservable(
        `git merge-base が ${String(code)} で終了: ${stderr.trim().slice(0, 200)}`,
      );
    },

    // **引数表は `references/protocols.md` が SSOT。**「無い」も明示して渡す ——
    // 省略は usage error で、取得に失敗した周と本当に無い周を同じ指紋にしないための形。
    cycleMark: async (input) => {
      const args = ["python3", `${scriptsDir}/cycle-mark.py`, "--ledger", input.ledger];
      const files: string[] = [];
      const fileArg = async (flag: string, body: string | null, absentFlag: string) => {
        if (body === null) {
          args.push(absentFlag);
          return;
        }
        const path = `${tmpdir()}/conductor-${input.issue}-${flag.replace(/^--/, "")}-${randomUUID()}`;
        // bytes は `protocols.md` の「file の bytes」。
        await Bun.write(path, body);
        files.push(path);
        args.push(flag, path);
      };

      if (input.ledger === "未計画") {
        for (const b of input.issueBodies) {
          const path = `${tmpdir()}/conductor-body-${b.issue}-${randomUUID()}`;
          // bytes は `protocols.md` の「file の bytes」。
          await Bun.write(path, b.body);
          files.push(path);
          args.push("--issue-body", `${b.issue}:${path}`);
        }
      } else {
        args.push("--progress", input.progress);
        const host = await run(
          ["git", "remote", "get-url", "origin"],
          surfaces[0]?.repoPath ?? ".",
        );
        // **host は制御面の origin から取る**（全着地面の remote が在るべき host）。
        const url = host.ok ? host.stdout.trim() : "";
        const parsed = /^(?:git@|https?:\/\/)([^:/]+)/.exec(url)?.[1];
        if (parsed === undefined) return unobservable("制御面の origin から host を引けない");
        args.push("--host", parsed);
        for (const s of input.surfaces) {
          const surface = surfaceOf(surfaces, s.name);
          if (surface === undefined) return unobservable(`座標表に無い面: ${s.name}`);
          args.push("--landing", `${s.name}:${surface.repoPath}`);
          const branches = await run(
            ["git", "branch", "--list", "--format=%(refname:short)"],
            surface.repoPath,
          );
          if (!branches.ok) return unobservable(branches.reason);
          const branch = branches.stdout
            .split("\n")
            .find((b) => new RegExp(`^[^/]+/${input.issue}-`).test(b.trim()));
          if (branch === undefined) args.push("--no-branch", s.name);
          else args.push("--branch", `${s.name}:${branch.trim()}`);
          if (s.worktree === null) args.push("--no-worktree", s.name);
          else args.push("--worktree", `${s.name}:${s.worktree}`);
        }
        await fileArg("--plan-comment", input.planComment, "--no-plan-comment");
        if (input.occupied.length === 0) args.push("--no-occupied");
        else {
          for (const row of input.occupied) {
            args.push("--occupied", `${row.name}:${row.cwd}`);
          }
        }
      }
      await fileArg("--wait-record", input.waitRecord, "--no-wait-record");

      const result = await run(args);
      await Promise.all(files.map((f) => rm(f, { force: true })));
      // **指紋を作れない周でも action の選択は続ける**（照合を飛ばすだけ）。
      return result.ok ? present(result.stdout.trim()) : unobservable(result.reason);
    },

    planFacts: async (issue, landing) => {
      const plan = planRecord((comments.get(issue) ?? []).join("\n\n"));
      const body = bodies.get(issue) ?? unobservable("本文をまだ読んでいない");
      const digests = new Map<number, Observed<string>>([
        [
          issue,
          body.kind === "present" ? present(digest(body.value)) : unobservable("本文を読めない"),
        ],
      ]);

      // **その課題の着地面だけを、面ごとの base から測る**（`plan.ts` の `planBases`）。
      // **読めなかった面があれば交差扱い**（`planInvalidated` が fail-closed で受ける）。
      const changed =
        plan.kind === "present"
          ? await changedSince(planBases(plan.value, landing, control))
          : present([]);

      return {
        bodyMatchesPlan: bodyMatchesPlan(plan, digests),
        planInvalidated: planInvalidated(plan, changed, control),
        resourceKeys: keysOfPlan(plan),
      };
    },

    readyFacts: async (issue, landing) => {
      const record = readyRecord((comments.get(issue) ?? []).join("\n\n"));
      const body = bodies.get(issue) ?? unobservable("本文をまだ読んでいない");
      const changed =
        record.kind === "present"
          ? await changedSince(readyBases(record.value, landing, control))
          : present([]);
      return readyStale(
        record,
        changed,
        body.kind === "present" ? present(digest(body.value)) : unobservable("本文を読めない"),
        control,
      );
    },

    issueFacts: async (issue) => {
      const prs = await allPrs();
      // **head の branch 名で自分の PR だけに絞る。**絞らないと、repo 内のどれか 1 本が
      // merged なだけで全課題が `着地済み` 側の証跡を持つ。
      const owned = new RegExp(`^[^/]+/${issue}-`);
      const mine = prs.kind === "present" ? prs.value.filter((p) => owned.test(p.head.ref)) : [];
      const body = bodies.get(issue);
      const commentText = (comments.get(issue) ?? []).join("\n\n");

      return {
        // **見出しの字面で判定する**（SSOT は `references/issue-contract.md`）。
        // **本文を読めないときは `false` に倒さない** —— 倒すと、観測できなかっただけの課題が
        // 差し戻され、実装のある課題では `Conflict` になる。
        issueContractComplete:
          body === undefined || body.kind !== "present"
            ? unobservable("本文を読めない")
            : issueContractComplete(body.value),
        prMerged:
          prs.kind === "present"
            ? present(mine.some((p) => p.merged_at !== null))
            : unobservable("PR 一覧を読めない"),
        latestPrClosedUnmerged:
          prs.kind === "present"
            ? present(
                mine.length > 0 && mine.every((p) => p.state === "closed" && p.merged_at === null),
              )
            : unobservable("PR 一覧を読めない"),
        // **壊れている宣言を「無い」と読まない** —— 読むと、止めているつもりの横で claim が進む。
        blocksEntry: entryBlockRecord(commentText).kind !== "absent",
        claimedAt: claimTimes.get(issue) ?? absent(),
        waitRecordCreatedAt: waitTimes.get(issue) ?? absent(),
        linkedPrReportComments:
          prs.kind !== "present"
            ? unobservable("PR 一覧を読めない")
            : present(
                liveOwnedPrs(
                  issue,
                  prs.value.map((p) => ({
                    number: p.number,
                    state: p.state,
                    mergedAt: p.merged_at,
                    headRef: p.head.ref,
                  })),
                ).flatMap((p) => (comments.get(p.number) ?? []).filter(carriesReportOrHalt)),
              ),
      };
    },
  };
};
