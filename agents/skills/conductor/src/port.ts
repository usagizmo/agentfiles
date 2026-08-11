// `ObservePort` の実装。外部コマンド（`watch.sh` / `gh` / `git` / `cycle-mark.py`）を叩く層。
//
// **失敗を `false` へ倒さない。**コマンドが落ちたら `unobservable` を返す ——
// 倒すと、観測できなかったことが「そうではない」として遷移を通す。

import { createHash } from "node:crypto";
import type { ProjectConfig } from "./config.ts";
import type { ObservePort } from "./observe.ts";
import { planRecord } from "./records.ts";
import { bodyMatchesPlan, planInvalidated } from "./plan.ts";
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
export const digest = (body: string): string =>
  createHash("sha256").update(body, "utf8").digest("hex");

export type PortOptions = {
  readonly config: ProjectConfig;
  /** `scripts/` の絶対 path */
  readonly scriptsDir: string;
  /** `watch.sh --snapshot` の書き出し先。**tick を終えるときに `--baseline` として渡す同じ file** */
  readonly snapshotPath: string;
};

const surfaceOf = (config: ProjectConfig, name: string) =>
  config.surfaces.find((s) => s.name === name);

export const createPort = (options: PortOptions): ObservePort => {
  const { config, scriptsDir, snapshotPath } = options;
  const control = config.surfaces[0];

  const bodies = new Map<number, Observed<string>>();
  const comments = new Map<number, readonly string[]>();
  /** claim の記録が書かれた時刻。**merge の枠の順序キー**なので、固定値へ倒さない */
  const claimTimes = new Map<number, Observed<number>>();

  return {
    snapshot: async () => {
      const args = [
        "sh",
        `${scriptsDir}/watch.sh`,
        "--snapshot",
        snapshotPath,
        "--repo",
        control?.repoPath ?? "",
        "--gh-repo",
        config.ghRepo,
        "--project-org",
        config.projectOrg,
        "--project-number",
        String(config.projectNumber),
        "--status-field",
        config.statusField,
      ];
      const result = await run(args);
      // **観測できなかった tick も watcher は張る**ので、ここは投げて呼び出し側に判断させる。
      if (!result.ok) throw new Error(`snapshot に失敗した: ${result.reason}`);
      return result.stdout;
    },

    issueBodies: async (numbers) => {
      const map = new Map<number, string>();
      await Promise.all(
        numbers.map(async (n) => {
          const body = await json<{ body: string | null }>([
            "gh",
            "api",
            `repos/${config.ghRepo}/issues/${n}`,
          ]);
          bodies.set(
            n,
            body.kind === "present"
              ? present(body.value.body ?? "")
              : unobservable("本文を読めない"),
          );
          if (body.kind === "present") map.set(n, body.value.body ?? "");
        }),
      );
      return map;
    },

    issueComments: async (numbers) => {
      const map = new Map<number, readonly string[]>();
      await Promise.all(
        numbers.map(async (n) => {
          const list = await json<{ body: string | null; created_at: string }[]>([
            "gh",
            "api",
            "--paginate",
            `repos/${config.ghRepo}/issues/${n}/comments`,
          ]);
          if (list.kind !== "present") {
            comments.set(n, []);
            claimTimes.set(n, unobservable("コメントを読めない"));
            return;
          }
          const bodiesOfIssue = list.value.map((c) => c.body ?? "");
          comments.set(n, bodiesOfIssue);
          map.set(n, bodiesOfIssue);
          const claim = list.value.find((c) => (c.body ?? "").includes("<!-- claim -->"));
          claimTimes.set(n, claim === undefined ? absent() : present(Date.parse(claim.created_at)));
        }),
      );
      return map;
    },

    surfaceGit: async (issue, name) => {
      const surface = surfaceOf(config, name);
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
      // **`統合先..branch` で測る** —— branch 上の commit の存在で読むと空 branch が `実装中` に化ける。
      const ahead = await run(
        ["git", "rev-list", "--count", `${surface.integrationRef}..${branch.trim()}`],
        surface.repoPath,
      );
      return {
        ahead: ahead.ok ? present(Number(ahead.stdout.trim()) > 0) : unobservable(ahead.reason),
        head: head.ok ? present(head.stdout.trim()) : unobservable(head.reason),
      };
    },

    cycleMark: async (issue) => {
      const result = await run([
        "python3",
        `${scriptsDir}/cycle-mark.py`,
        "--issue",
        String(issue),
      ]);
      // **指紋を作れない周でも action の選択は続ける**（照合を飛ばすだけ）。
      return result.ok ? present(result.stdout.trim()) : unobservable(result.reason);
    },

    planFacts: async (issue) => {
      const plan = planRecord((comments.get(issue) ?? []).join("\n\n"));
      const body = bodies.get(issue) ?? unobservable("本文をまだ読んでいない");
      const digests = new Map<number, Observed<string>>([
        [
          issue,
          body.kind === "present" ? present(digest(body.value)) : unobservable("本文を読めない"),
        ],
      ]);

      // 面ごとの `base..統合先` で変わった path を集める。
      // **読めなかった面があれば交差扱い**（`planInvalidated` が fail-closed で受ける）。
      let changed: Observed<readonly string[]> = present([]);
      if (plan.kind === "present") {
        const collected: string[] = [];
        for (const surface of config.surfaces) {
          const diff = await run(
            ["git", "diff", "--name-only", `${plan.value.baseSha}...${surface.integrationRef}`],
            surface.repoPath,
          );
          if (!diff.ok) {
            changed = unobservable(diff.reason);
            break;
          }
          collected.push(...diff.stdout.split("\n").filter((p) => p !== ""));
        }
        if (changed.kind === "present") changed = present(collected);
      }

      return {
        bodyMatchesPlan: bodyMatchesPlan(plan, digests),
        planInvalidated: planInvalidated(plan, changed),
        resourceKeys: plan.kind === "present" ? present(plan.value.resourceKeys) : absent(),
      };
    },

    issueFacts: async (issue) => {
      const prs = await json<{ merged_at: string | null; state: string; head: { ref: string } }[]>([
        "gh",
        "api",
        `repos/${config.ghRepo}/pulls?state=all&per_page=100`,
        "--paginate",
      ]);
      // **head の branch 名で自分の PR だけに絞る。**絞らないと、repo 内のどれか 1 本が
      // merged なだけで全課題が `着地済み` 側の証跡を持つ。
      const owned = new RegExp(`^[^/]+/${issue}-`);
      const mine = prs.kind === "present" ? prs.value.filter((p) => owned.test(p.head.ref)) : [];
      const body = bodies.get(issue);

      return {
        // **6 項目は本文の散文なので、機械では充足を判定できない**（`refine` の Issue 契約）。
        // 空の本文だけは確実に不足と言えるので、そこだけ `false`。残りは `unobservable` にして
        // 選出を fail-closed で止める —— **`true` へ倒すと契約の欠けた課題が claim される。**
        // 判定できる形（項目の見出しを機械可読にする）は規約側の課題。
        issueContractComplete:
          body === undefined || body.kind !== "present"
            ? unobservable("本文を読めない")
            : body.value.trim() === ""
              ? present(false)
              : unobservable("Issue 契約に機械可読な形が無い"),
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
        // **置き場は project 差分が定める。**持っていないあいだは宣言が無いものとして扱う。
        blocksEntry: false,
        claimedAt: claimTimes.get(issue) ?? absent(),
      };
    },
  };
};
