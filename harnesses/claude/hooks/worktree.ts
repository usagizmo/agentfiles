// Claude Code の WorktreeCreate / WorktreeRemove / SubagentStop hook。
// 置き場所の規則は agents/skills/resolve/SKILL.md step 2。
//
// 使い方: bun worktree.ts <create|remove|subagent-stop>（hook 入力 JSON を stdin で受ける）
//
// hook が作った worktree は 1 件 1 ファイルで記録する。ファイル名は worktree 絶対 path の hash。
// repo 横断・path キーにするのは、別 repo の同名 name で記録が上書きされないため。
// 記録の無い worktree には remove でも触らない。記録は add と記録の書き込みが揃って成功したときだけ残る。

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

type Record = { name: string; path: string; commonDir: string; baseSha: string };
type Git = { code: number; stdout: string };
type Entry = { path: string; branch: string | null; prunable: boolean };

const BRANCH_PREFIX = "worktree-";
const FETCH_TRIES = 3;

// hook を起動した git 操作の GIT_DIR 等が残ると、別 repo を操作してしまう。
const gitEnv = (): { [key: string]: string } => {
  const env: { [key: string]: string } = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  }
  return env;
};

// stdout は捕獲し、stderr は hook の stderr へ流す。hook の stdout には path だけを出す。
const git = (cwd: string, args: string[], streamStdout = false): Git => {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], {
    env: gitEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = p.stdout.toString();
  if (streamStdout) process.stderr.write(stdout);
  return { code: p.exitCode, stdout };
};

const gitOk = (cwd: string, args: string[]): string => {
  const r = git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} が rc=${r.code} で失敗`);
  return r.stdout.trim();
};

// macOS の /var と /private/var のような別名を潰す。無い path は親で解く。
const canonical = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(canonical(parent), basename(p));
  }
};

const stateDir = () =>
  join(
    process.env["XDG_STATE_HOME"] || join(process.env["HOME"] ?? "", ".local/state"),
    "agentfiles/claude-worktrees",
  );

const recordFile = (path: string) =>
  join(stateDir(), `${createHash("sha256").update(path).digest("hex")}.json`);

const isRecord = (v: unknown): v is Record => {
  if (typeof v !== "object" || v === null) return false;
  const o: { [key: string]: unknown } = { ...v };
  return ["name", "path", "commonDir", "baseSha"].every((k) => typeof o[k] === "string");
};

const readRecord = async (file: string): Promise<Record | null> => {
  try {
    const v: unknown = await Bun.file(file).json();
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
};

const writeRecord = (r: Record) => {
  mkdirSync(stateDir(), { recursive: true });
  const file = recordFile(r.path);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r));
  renameSync(tmp, file);
};

const worktrees = (commonDir: string): Entry[] => {
  const out = gitOk(commonDir, ["worktree", "list", "--porcelain"]);
  return out
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length) ?? "";
      const branch = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null;
      const prunable = lines.some((l) => l === "prunable" || l.startsWith("prunable "));
      return { path: canonical(path), branch, prunable };
    });
};

const findWorktree = (commonDir: string, path: string) =>
  worktrees(commonDir).find((e) => e.path === path);

const branchOf = (name: string) => `${BRANCH_PREFIX}${name}`;

const remotes = (cwd: string) =>
  gitOk(cwd, ["remote"])
    .split("\n")
    .filter((r) => r !== "");

// origin の既定 branch を解決して fetch し、追跡 ref を返す。失敗は throw（HEAD に黙って倒さない）。
// 並行する fetch は ref lock で落ちうるので数回試す。
const fetchDefault = (cwd: string): string => {
  if (!remotes(cwd).includes("origin")) throw new Error("remote はあるが origin が無い");
  const out = gitOk(cwd, ["ls-remote", "--symref", "origin", "HEAD"]);
  const m = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(out);
  if (!m?.[1]) throw new Error("origin の既定 branch を解決できない");
  const branch = m[1];
  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
  for (let i = 1; ; i++) {
    const r = git(cwd, ["fetch", "origin", refspec], true);
    if (r.code === 0) return `origin/${branch}`;
    if (i >= FETCH_TRIES) throw new Error(`origin/${branch} の fetch が rc=${r.code} で失敗`);
  }
};

const readInput = async (): Promise<{ [key: string]: unknown }> => {
  const v: unknown = JSON.parse(await Bun.stdin.text());
  if (typeof v !== "object" || v === null) throw new Error("hook 入力が object でない");
  return { ...v };
};

const str = (input: { [key: string]: unknown }, key: string): string => {
  const v = input[key];
  if (typeof v !== "string" || v === "") throw new Error(`hook 入力に ${key} が無い`);
  return v;
};

// main checkout は worktree list の先頭。submodule や --separate-git-dir では common dir の親にならない。
const mainCheckout = (cwd: string): string => {
  const block = gitOk(cwd, ["worktree", "list", "--porcelain"]).split("\n\n")[0] ?? "";
  if (block.split("\n").includes("bare")) throw new Error("bare repo には worktree を作らない");
  const line = block.split("\n").find((l) => l.startsWith("worktree "));
  if (!line) throw new Error("main checkout を解決できない");
  return canonical(line.slice("worktree ".length));
};

// 同名の予約は path の mkdir（非 recursive）で取る。並行する create は lock を持たずに互いを排除する。
const create = async (input: { [key: string]: unknown }) => {
  const name = str(input, "name");
  if (name !== basename(name) || name === "." || name === "..") {
    throw new Error(`name が 1 段の dir 名でない: ${name}`);
  }
  const cwd = str(input, "cwd");
  const commonDir = canonical(
    gitOk(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const root = canonical(join(process.env["HOME"] ?? "", "claude-worktrees"));
  const path = join(root, basename(mainCheckout(cwd)), name);
  const branch = branchOf(name);

  // 再利用は記録どおりの hook 作成分だけでなく人が切った worktree も許すが、記録は書かない（remove で消さない）。
  const existing = findWorktree(commonDir, path);
  if (existing?.prunable) {
    // 他人の entry にも触れるので prune は hook が走らせない。
    throw new Error(
      `${path} の dir が消えた登録が残っている。git worktree prune で掃除してから作り直す`,
    );
  }
  if (existing) {
    console.error(`${path} は登録済みなので再利用する`);
    process.stdout.write(`${path}\n`);
    return;
  }
  // 既存 branch は巻き戻しで消してしまうので、add の前に拒否する。
  if (git(commonDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0) {
    throw new Error(`branch ${branch} が既に存在する`);
  }
  mkdirSync(dirname(path), { recursive: true });
  try {
    mkdirSync(path);
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "EEXIST") {
      throw new Error(`${path} が存在するが worktree として登録されていない`);
    }
    throw e;
  }
  try {
    const base = remotes(commonDir).length > 0 ? fetchDefault(commonDir) : "HEAD";
    const baseSha = gitOk(commonDir, ["rev-parse", "--verify", `${base}^{commit}`]);
    const r = git(commonDir, ["worktree", "add", "-b", branch, path, baseSha], true);
    // post-checkout が非 0 でも worktree は作成済みで残る。
    if (r.code !== 0) throw new Error(`git worktree add が rc=${r.code} で失敗`);
    writeRecord({ name, path, commonDir, baseSha });
  } catch (e) {
    // 予約した path も branch もこの呼び出しが作ったものなので、巻き戻してから失敗を返す。
    if (findWorktree(commonDir, path)) {
      git(commonDir, ["worktree", "remove", "--force", path], true);
    }
    rmSync(path, { recursive: true, force: true });
    git(commonDir, ["branch", "-D", branch], true);
    rmSync(recordFile(path), { force: true });
    throw e;
  }
  process.stdout.write(`${path}\n`);
};

// 登録済みかつ branch が記録どおりのときだけ触る。同じ path に別の worktree が作り直されていれば触らない。
const matches = (r: Record) => {
  const e = findWorktree(r.commonDir, r.path);
  return e !== undefined && e.branch === `refs/heads/${branchOf(r.name)}`;
};

const mergedIntoOrigin = (commonDir: string, branch: string): boolean => {
  if (remotes(commonDir).length === 0) return false;
  try {
    const target = fetchDefault(commonDir);
    return git(commonDir, ["merge-base", "--is-ancestor", branch, target]).code === 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return false;
  }
};

const unchangedSince = (cwd: string, baseSha: string, rev: string) =>
  gitOk(cwd, ["rev-list", "--count", `${baseSha}..${rev}`]) === "0";

const deleteBranchIf = (commonDir: string, branch: string, ok: boolean) => {
  if (ok) git(commonDir, ["branch", "-D", branch], true);
  else console.error(`${branch} は origin に merge されていないので残す`);
};

const remove = async (input: { [key: string]: unknown }) => {
  const path = canonical(str(input, "worktree_path"));
  const file = recordFile(path);
  const r = await readRecord(file);
  if (r) {
    if (!matches(r)) {
      console.error(`${path} は記録と一致しないので worktree に触らず記録だけ消す`);
      rmSync(file, { force: true });
      return;
    }
    const branch = branchOf(r.name);
    gitOk(r.commonDir, ["worktree", "remove", "--force", path]);
    deleteBranchIf(
      r.commonDir,
      branch,
      unchangedSince(r.commonDir, r.baseSha, branch) || mergedIntoOrigin(r.commonDir, branch),
    );
    rmSync(file, { force: true });
    return;
  }
  console.error(`${path} は hook が作った記録が無いので触らない`);
};

// 全 subagent の停止で走るので、対象が無い・入力が想定外でも exit 0。cwd は cd で変わるので使わない。
const subagentStop = async (input: { [key: string]: unknown }) => {
  const agentId = input["agent_id"];
  if (typeof agentId !== "string" || agentId === "") {
    console.error("hook 入力に agent_id が無いので何もしない");
    return;
  }
  const name = `agent-${agentId}`;
  let files: string[] = [];
  try {
    files = readdirSync(stateDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }
  for (const f of files) {
    const file = join(stateDir(), f);
    const r = await readRecord(file);
    if (r?.name !== name) continue;
    if (!matches(r)) {
      console.error(`${r.path} は記録と一致しないので残す`);
      continue;
    }
    const clean = gitOk(r.path, ["status", "--porcelain"]) === "";
    if (!clean || !unchangedSince(r.path, r.baseSha, "HEAD")) {
      console.error(`${r.path} に変更があるので残す`);
      continue;
    }
    gitOk(r.commonDir, ["worktree", "remove", "--force", r.path]);
    git(r.commonDir, ["branch", "-D", branchOf(r.name)], true);
    rmSync(file, { force: true });
  }
};

const main = async () => {
  const sub = process.argv[2];
  try {
    const input = await readInput();
    if (sub === "create") await create(input);
    else if (sub === "remove") await remove(input);
    else if (sub === "subagent-stop") await subagentStop(input);
    else throw new Error(`未知のサブコマンド: ${sub ?? ""}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(sub === "subagent-stop" ? 0 : 1);
  }
};

await main();
