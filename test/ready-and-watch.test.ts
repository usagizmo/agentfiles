// ready-and-watch.sh: Ready 時刻以降の新しい pull_request run を watch してから PR checks を見る。

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SCRIPT = `${ROOT}agents/skills/pr/scripts/ready-and-watch.sh`;

const FAKE_GH = `#!/bin/sh
dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
log=$dir/gh-log
printf '%s\\n' "$*" >>"$log"
jq=
prev=
for arg in "$@"; do
	if [ "$prev" = --jq ]; then jq=$arg; fi
	prev=$arg
done
if [ "$1" = pr ] && [ "$2" = view ]; then
	draft=$(cat "$dir/is-draft")
	case "$jq" in
	".headRefOid, .isDraft, .headRefName" | .headRefOid,.isDraft,.headRefName)
		printf 'abc123\\n%s\\nfeature\\n' "$draft"
		;;
	*) exit 1 ;;
	esac
	exit 0
fi
if [ "$1" = repo ] && [ "$2" = view ]; then
	printf 'owner/repo\\n'
	exit 0
fi
if [ "$1" = api ]; then
	mode=$(cat "$dir/api-mode")
	case "$*" in
	*timeline*)
		[ "$mode" = api-fail-timeline ] && exit 1
		[ "$mode" = never-ready ] && exit 0
		printf '2026-09-16T10:00:00Z\\n'
		exit 0
		;;
	esac
	exit 1
fi
if [ "$1" = run ] && [ "$2" = list ]; then
	mode=$(cat "$dir/api-mode")
	[ "$mode" = api-fail-runs ] && exit 1
	case "$*" in
	*createdAt* | *event*)
		n=0
		[ -f "$dir/api-n" ] && n=$(cat "$dir/api-n")
		n=$((n + 1))
		printf '%s\\n' "$n" >"$dir/api-n"
		python3 - "$jq" "$mode" "$n" <<'PY'
import re, sys
jq, mode, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
queued = {"databaseId": 1, "event": "pull_request", "headSha": "abc123", "createdAt": "2026-09-16T09:00:00Z"}
fresh = {"databaseId": 3, "event": "pull_request", "headSha": "abc123", "createdAt": "2026-09-16T10:00:01Z"}
same = {"databaseId": 7, "event": "pull_request", "headSha": "abc123", "createdAt": "2026-09-16T10:00:00Z"}
runs = []
if mode == "never":
    runs = []
elif mode == "queued-pr":
    runs = [queued]
elif mode in ("new-on-2", "run-fail"):
    runs = [queued]
    if n >= 2:
        runs.append(fresh)
elif mode == "after-ready":
    runs = [fresh]
elif mode == "re-run":
    runs = [queued]
    if n >= 2:
        runs.append(fresh)
elif mode == "same-second":
    runs = [same]
out = []
for r in runs:
    if '.event=="pull_request"' in jq.replace(" ", "") and r["event"] != "pull_request":
        continue
    m = re.search(r'headSha=="([^"]+)"', jq.replace(" ", ""))
    if m and r["headSha"] != m.group(1):
        continue
    compact = jq.replace(" ", "")
    if "createdAt>=" in compact:
        m = re.search(r'createdAt>="([^"]+)"', compact)
        if m and r["createdAt"] < m.group(1):
            continue
    elif "createdAt>" in compact:
        m = re.search(r'createdAt>"([^"]+)"', compact)
        if m and r["createdAt"] <= m.group(1):
            continue
    out.append(str(r["databaseId"]))
print("\\n".join(out))
PY
		exit 0
		;;
	esac
	python3 - "$jq" "$mode" <<'PY'
import re, sys
jq, mode = sys.argv[1], sys.argv[2]
runs = []
if mode in ("new-on-2", "queued-pr", "run-fail"):
    runs = [{"databaseId": 1, "headSha": "abc123"}]
elif mode == "same-second":
    runs = [{"databaseId": 7, "headSha": "abc123"}]
out = []
for r in runs:
    m = re.search(r'headSha=="([^"]+)"', jq.replace(" ", ""))
    if m and r["headSha"] != m.group(1):
        continue
    out.append(str(r["databaseId"]))
print("\\n".join(out))
PY
	exit 0
fi
if [ "$1" = run ] && [ "$2" = watch ]; then
	printf '%s\\n' "$3" >>"$dir/run-watch-ids"
	mode=$(cat "$dir/api-mode")
	[ "$mode" = run-fail ] && exit 1
	exit 0
fi
if [ "$1" = pr ] && [ "$2" = ready ]; then
	printf 'ready\\n' >>"$dir/ready-called"
	exit 0
fi
if [ "$1" = pr ] && [ "$2" = checks ]; then
	printf 'watch\\n' >>"$dir/watch-called"
	exit 0
fi
exit 1
`;

const FAKE_DATE = `#!/bin/sh
dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
n=0
[ -f "$dir/date-n" ] && n=$(cat "$dir/date-n")
n=$((n + 1))
printf '%s\\n' "$n" >"$dir/date-n"
if [ -f "$dir/advance-date" ] && [ "$n" -ge 2 ]; then
	printf '1180\\n'
else
	printf '1000\\n'
fi
`;

const FAKE_SLEEP = `#!/bin/sh
exit 0
`;

const setup = async (draft: boolean, apiMode: string, advanceDate = false) => {
  const dir = await mkdtemp(join(tmpdir(), "ready-and-watch-"));
  await Bun.write(join(dir, "gh"), FAKE_GH);
  await chmod(join(dir, "gh"), 0o755);
  await Bun.write(join(dir, "date"), FAKE_DATE);
  await chmod(join(dir, "date"), 0o755);
  await Bun.write(join(dir, "sleep"), FAKE_SLEEP);
  await chmod(join(dir, "sleep"), 0o755);
  await Bun.write(join(dir, "is-draft"), draft ? "true\n" : "false\n");
  await Bun.write(join(dir, "api-mode"), `${apiMode}\n`);
  if (advanceDate) await Bun.write(join(dir, "advance-date"), "");
  return dir;
};

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["bash", SCRIPT, ...argv], {
    env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
};

test("Draft → ready → Ready 以降の pull_request run が現れたら run watch してから PR checks する", async () => {
  const dir = await setup(true, "new-on-2");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).toBe(0);
    const log = await readFile(join(dir, "gh-log"), "utf8");
    expect(log).toContain("--paginate");
    expect(log).toContain("issues/12/timeline");
    expect(log).toContain("pr ready 12");
    expect(log).toContain("run list");
    expect(log).toMatch(/event=="pull_request"/);
    expect(log).toContain("run watch 3 --exit-status");
    expect(log).toContain("pr checks 12 --watch");
    expect(await readFile(join(dir, "run-watch-ids"), "utf8")).toBe("3\n");
    expect(await Bun.file(join(dir, "ready-called")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Ready 以降の pull_request run が 180 秒無ければ rc≠0", async () => {
  const dir = await setup(true, "never", true);
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("Ready で CI が起動していない");
    expect(`${r.stdout}${r.stderr}`).toContain("ready_for_review");
    expect(await Bun.file(join(dir, "run-watch-ids")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("最初から非 Draft（Ready 遷移無し）は待たずに watch する", async () => {
  const dir = await setup(false, "never-ready");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).toBe(0);
    const log = await readFile(join(dir, "gh-log"), "utf8");
    expect(log).toContain("--paginate");
    expect(log).not.toContain("pr ready");
    expect(log).not.toContain("run list");
    expect(log).not.toContain("run watch");
    expect(log).toContain("pr checks 12 --watch");
    expect(await Bun.file(join(dir, "ready-called")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("再実行（既に非 Draft だが Ready 遷移あり）でも新 run を要求する", async () => {
  const dir = await setup(false, "re-run");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).toBe(0);
    const log = await readFile(join(dir, "gh-log"), "utf8");
    expect(log).not.toContain("pr ready");
    expect(log.match(/^run list /gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(log).toContain("run watch 3 --exit-status");
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Draft 中に作られた pull_request run（createdAt < Ready）は数えない", async () => {
  const dir = await setup(true, "queued-pr", true);
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("Ready で CI が起動していない");
    expect(await Bun.file(join(dir, "run-watch-ids")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("新 run は queued でも run watch し、旧成功の PR checks だけで終わらない", async () => {
  const dir = await setup(true, "new-on-2");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).toBe(0);
    const log = await readFile(join(dir, "gh-log"), "utf8");
    const watchAt = log.indexOf("run watch 3 --exit-status");
    const checksAt = log.indexOf("pr checks 12 --watch");
    expect(watchAt).toBeGreaterThanOrEqual(0);
    expect(checksAt).toBeGreaterThan(watchAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run watch が失敗したら rc≠0 で PR checks に進まない", async () => {
  const dir = await setup(true, "run-fail");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).not.toBe(0);
    const log = await readFile(join(dir, "gh-log"), "utf8");
    expect(log).toContain("run watch 3 --exit-status");
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Draft 中に同じ秒で作られた旧 run は控えにより除外される", async () => {
  const dir = await setup(true, "same-second", true);
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("Ready で CI が起動していない");
    const log = await readFile(join(dir, "gh-log"), "utf8");
    expect(log).toContain("pr ready 12");
    expect(log).not.toContain("run watch 7");
    expect(await Bun.file(join(dir, "run-watch-ids")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("同秒の旧 run は控えでも控え無しの再実行でも採らず timeout する", async () => {
  const dir = await setup(true, "same-second", true);
  try {
    const first = await run(dir, ["12"]);
    expect(first.exitCode).not.toBe(0);
    expect(`${first.stdout}${first.stderr}`).toContain("Ready で CI が起動していない");
    expect(await Bun.file(join(dir, "run-watch-ids")).exists()).toBe(false);

    await Bun.write(join(dir, "is-draft"), "false\n");
    await Bun.write(join(dir, "date-n"), "0\n");
    const second = await run(dir, ["12"]);
    expect(second.exitCode).not.toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain("Ready で CI が起動していない");
    const log = await readFile(join(dir, "gh-log"), "utf8");
    expect(log).not.toContain("run watch 7");
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("timeline の api 失敗は握らず止まる", async () => {
  const dir = await setup(true, "api-fail-timeline");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).not.toBe(0);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run list の api 失敗は握らず止まる", async () => {
  const dir = await setup(true, "api-fail-runs");
  try {
    const r = await run(dir, ["12"]);
    expect(r.exitCode).not.toBe(0);
    expect(await Bun.file(join(dir, "watch-called")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
