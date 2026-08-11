// `scripts/watch.sh --snapshot` の出力を型付きの節へ写す境界。
//
// **`observe` は `watch.sh` を再実装しない。**あちらが観測の SSOT で、tick が読んだ観測を
// そのまま baseline に渡すという不変条件を持っている。別経路で同じ情報を取り直すと、
// 「前回」が時点になって窓ができる。ここがやるのは decode だけ。
//
// **fail-closed。**節が欠けている・版数が違う・行の形が違うときは投げる ——
// 「値が無い」と読むと、その観測だけで進む遷移が永久に起きない。

/** `watch.sh` が先頭に書く版数。**節を足す・消す・名前を変えたら両方を上げる。** */
export const SNAPSHOT_SCHEMA = 1;

/** 節の名前。`--- <name> (補足) ---` の `(` より前だけを見る。 */
export const SECTIONS = [
  "schema",
  "default",
  "landing tips",
  "landing local branches",
  "live checkout",
  "remote branches",
  "worktrees",
  "sessions",
  "workspaces",
  "project status",
  "issues",
  "recent issue comments",
  "PRs",
] as const;
export type SectionName = (typeof SECTIONS)[number];

export class SnapshotDecodeError extends Error {}

export type Snapshot = {
  readonly sections: ReadonlyMap<SectionName, readonly string[]>;
};

const HEADER = /^--- (.+?)(?: \(.*\))? ---$/;

/**
 * 節へ切り分ける。**未知の節はエラー**にする ——
 * 黙って捨てると、`watch.sh` が足した観測を読む側が持たないまま正常に見える。
 */
export const parseSnapshot = (text: string): Snapshot => {
  const known = new Set<string>(SECTIONS);
  const sections = new Map<SectionName, string[]>();
  let current: SectionName | undefined;

  for (const line of text.split("\n")) {
    const header = HEADER.exec(line);
    if (header !== null) {
      const name = header[1];
      if (name === undefined || !known.has(name)) {
        throw new SnapshotDecodeError(`未知の節: ${line}`);
      }
      current = name as SectionName;
      if (sections.has(current)) throw new SnapshotDecodeError(`節が重複している: ${current}`);
      sections.set(current, []);
      continue;
    }
    if (current === undefined) {
      if (line.trim() === "") continue;
      throw new SnapshotDecodeError(`節の外に行がある: ${line}`);
    }
    if (line.trim() === "") continue;
    sections.get(current)?.push(line);
  }

  const missing = SECTIONS.filter((name) => !sections.has(name));
  if (missing.length > 0) throw new SnapshotDecodeError(`節が欠けている: ${missing.join(", ")}`);

  const schema = sections.get("schema")?.[0];
  if (schema !== String(SNAPSHOT_SCHEMA)) {
    throw new SnapshotDecodeError(
      `snapshot の版数が違う: 期待 ${SNAPSHOT_SCHEMA} / 実際 ${schema ?? "無し"}`,
    );
  }
  return { sections };
};

const rows = (s: Snapshot, name: SectionName): readonly string[] => s.sections.get(name) ?? [];

/** **`-`（読めなかった）を空文字や `0` へ畳まない。**呼ぶ側が 3 値のまま受け取る。 */
export type Tri = boolean | "unreadable";

const tri = (raw: string, field: string): Tri => {
  if (raw === "0") return false;
  if (raw === "1") return true;
  if (raw === "-") return "unreadable";
  throw new SnapshotDecodeError(`${field} が 0 / 1 / - のどれでもない: ${raw}`);
};

const fields = (line: string, count: number, section: SectionName): string[] => {
  const parts = line.split(" ").filter((p) => p !== "");
  if (parts.length < count) {
    throw new SnapshotDecodeError(`${section} の列が足りない（${count} 列を期待）: ${line}`);
  }
  return parts;
};

/** `--- worktrees (面 dirty(0/1/-) head path) ---` */
export type WorktreeRow = {
  readonly surface: string;
  readonly dirty: Tri;
  readonly head: string;
  readonly path: string;
};

export const worktrees = (s: Snapshot): WorktreeRow[] =>
  rows(s, "worktrees")
    // 面ごとの空は `-` 1 列で来る。**その面を落とさず、読めなかったこととして残す。**
    .map((line) => fields(line, 2, "worktrees"))
    .filter((p) => p.length >= 4)
    .map((p) => ({
      surface: p[0] ?? "",
      dirty: tri(p[1] ?? "", "worktrees.dirty"),
      head: p[2] ?? "",
      path: p.slice(3).join(" "),
    }));

/** `--- live checkout (面 branch dirty(0/1/-) ahead behind) ---` */
export type LiveCheckoutRow = {
  readonly surface: string;
  readonly branch: string;
  readonly dirty: Tri;
  readonly ahead: number;
  readonly behind: number;
};

export const liveCheckouts = (s: Snapshot): LiveCheckoutRow[] =>
  rows(s, "live checkout")
    .map((line) => fields(line, 2, "live checkout"))
    .filter((p) => p.length >= 5)
    .map((p) => ({
      surface: p[0] ?? "",
      branch: p[1] ?? "",
      dirty: tri(p[2] ?? "", "live checkout.dirty"),
      ahead: Number(p[3]),
      behind: Number(p[4]),
    }));

/** `--- project status (board order) ---` は `nl` が振った index 付きで来る。 */
export type ProjectStatusRow = {
  readonly boardOrder: number;
  readonly issue: number;
  /** project の Status 名。**対応表に無い値をここで既定へ倒さない** */
  readonly status: string;
};

export const projectStatus = (s: Snapshot): ProjectStatusRow[] =>
  rows(s, "project status").map((line) => {
    const p = fields(line, 3, "project status");
    return { boardOrder: Number(p[0]), issue: Number(p[1]), status: p[2] ?? "-" };
  });

/** `--- issues ---` は `番号 state updated_at assignees` */
export type IssueRow = {
  readonly issue: number;
  readonly open: boolean;
  readonly updatedAt: string;
  readonly assignees: readonly string[];
};

export const issues = (s: Snapshot): IssueRow[] =>
  rows(s, "issues").map((line) => {
    const p = fields(line, 3, "issues");
    const state = p[1];
    if (state !== "open" && state !== "closed") {
      throw new SnapshotDecodeError(`issue の state が open / closed でない: ${line}`);
    }
    return {
      issue: Number(p[0]),
      open: state === "open",
      updatedAt: p[2] ?? "",
      assignees: (p[3] ?? "").split(",").filter((a) => a !== ""),
    };
  });

/** `--- PRs ---` は `番号 headRefName state draft=... checks=...` */
export type PullRequestRow = {
  readonly number: number;
  readonly headRef: string;
  readonly draft: boolean;
  /** **`untracked` を「checks が無い」と読まない** —— 追跡していないことは値の 1 つ */
  readonly checks: readonly string[] | "untracked";
};

export const pullRequests = (s: Snapshot): PullRequestRow[] =>
  rows(s, "PRs").map((line) => {
    const p = fields(line, 5, "PRs");
    const checksRaw = (p[4] ?? "").replace(/^checks=/, "");
    return {
      number: Number(p[0]),
      headRef: p[1] ?? "",
      draft: (p[3] ?? "") === "draft=true",
      checks:
        checksRaw === "untracked" ? "untracked" : checksRaw.split(",").filter((c) => c !== ""),
    };
  });

export const remoteBranches = (s: Snapshot): readonly string[] => rows(s, "remote branches");
export const sessions = (s: Snapshot): readonly string[] => rows(s, "sessions");
export const workspaces = (s: Snapshot): readonly string[] => rows(s, "workspaces");

/** `--- landing tips ---` は `面 SHA`。統合先の tip。 */
export const landingTips = (s: Snapshot): ReadonlyMap<string, string> =>
  new Map(
    rows(s, "landing tips")
      .map((line) => fields(line, 2, "landing tips"))
      .map((p) => [p[0] ?? "", p[1] ?? ""]),
  );
