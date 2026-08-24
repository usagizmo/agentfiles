// tick の入口の終了コード契約を固定する。
//
// **2（設定が壊れている）と 1（観測に失敗した）を混ぜない。**呼び出し側は 2 では再起動せず、
// 1 では直前に成功した snapshot を渡して watcher を張り直す。ここが混ざると、形状バグを
// 直さないまま起こし直して枠を焼くか、一時的な障害を永久停止として扱うかのどちらかになる。
//
// **exit 0 の経路はここでは見ない。**Decision を返すには実際の Project と gh が要るので、
// 観測から先は実プロジェクトで 1 周させるまで未検証のまま残る。ここが守るのは、
// そこへ到達する前に落ちる形すべて。
//
// `cli.ts` はトップレベルで実行して `process.exit` するので、import では試せない。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

const CLI = join(import.meta.dir, "../src/cli.ts");
const TMP = mkdtempSync(join(tmpdir(), "conductor-cli-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const VALID = {
  ghRepo: "acme/control",
  projectOrg: "acme",
  projectNumber: 1,
  statusField: "Status",
  statusMap: {
    Backlog: "未計画",
    Ready: "計画済み",
    "In progress": "進行中",
    Done: "完了",
    Shelved: "退避先",
  },
  surfaces: [
    { name: "acme/control", usesPr: true, countsCapacity: true, integrationRef: "origin/main" },
  ],
  sessionsCmd: "echo conductor present",
  workspacesCmd: "echo ws -",
};

const WIRING = {
  refine: { kind: "claude", args: [] as string[] },
  resolve: { kind: "claude", args: [] as string[] },
};

/** 設定を dir に書き、隣へ配線を置く。`over` を undefined にした key は落とす。 */
const configFile = (
  name: string,
  over: Record<string, unknown> = {},
  wiring: unknown | null = WIRING,
): string => {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const merged: Record<string, unknown> = { ...VALID, ...over };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete merged[k];
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(merged));
  if (wiring !== null) writeFileSync(join(dir, "config.local.json"), JSON.stringify(wiring));
  return path;
};

/** 座標に checkout path を束ねる option。全 case で同じ面を渡す。 */
const SURFACE = ["--surface-path", `acme/control=${TMP}`];

const run = async (args: string[]) => {
  const p = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, out, err };
};

describe("引数", () => {
  test("--config が無ければ 2 で止まる", async () => {
    const { code, err } = await run(["--snapshot-out", join(TMP, "s"), ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("usage");
  });

  test("--snapshot-out が無ければ 2 で止まる", async () => {
    const { code, err } = await run(["--config", configFile("a"), ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("usage");
  });

  test("--config の値が欠けたら 2 で止まる", async () => {
    const { code } = await run(["--snapshot-out", join(TMP, "s"), ...SURFACE, "--config"]);
    expect(code).toBe(2);
  });
});

describe("設定の fail-closed", () => {
  test("設定 file が無ければ 2 で止まる", async () => {
    const { code } = await run([
      "--config",
      join(TMP, "nope.json"),
      "--snapshot-out",
      "/dev/null",
      ...SURFACE,
    ]);
    expect(code).toBe(2);
  });

  test("JSON として壊れていれば 2 で止まる", async () => {
    const path = join(TMP, "broken.json");
    writeFileSync(path, "{ not json");
    const { code } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
  });

  // **欠けた key ごとに 2 を返すこと**が要点。既定へ倒すと、対応表に無い Status を持つ
  // Issue が黙って `未計画` として計画される。
  for (const key of [
    "ghRepo",
    "projectOrg",
    "projectNumber",
    "statusField",
    "statusMap",
    "surfaces",
  ]) {
    test(`${key} が欠けたら 2 で止まる`, async () => {
      const path = configFile(`no-${key}`, { [key]: undefined });
      const { code, err } = await run([
        "--config",
        path,
        "--snapshot-out",
        "/dev/null",
        ...SURFACE,
      ]);
      expect(code).toBe(2);
      expect(err).toContain(key);
    });
  }

  test("statusMap に 5 値のどれかが写らなければ 2 で止まる", async () => {
    const path = configFile("partial-status", {
      statusMap: { Backlog: "未計画", Ready: "計画済み" },
    });
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("statusMap");
  });

  test("surfaces が空なら 2 で止まる", async () => {
    const path = configFile("no-surface", { surfaces: [] });
    const { code } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
  });

  test("19q: tick.readyStockLimit が残っていれば 2 で止まる", async () => {
    const path = configFile("old-stock", { tick: { readyStockLimit: 5 } });
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("readyStockLimit");
  });

  test("19s: countsCapacity が無ければ 2 で止まる", async () => {
    const path = configFile("no-counts", {
      surfaces: [{ name: "acme/control", usesPr: true, integrationRef: "origin/main" }],
    });
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("countsCapacity");
  });

  test("配線 file が無ければ 2 で止まる", async () => {
    const path = configFile("no-wiring", {}, null);
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain(join(TMP, "no-wiring", "config.local.json"));
    expect(err).toContain("必要なキー");
    expect(err).toContain("refine");
    expect(err).toContain("resolve");
  });

  test("配線 file が壊れていれば 2 で止まる", async () => {
    const path = configFile("broken-wiring");
    writeFileSync(join(TMP, "broken-wiring", "config.local.json"), "{ not json");
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain(join(TMP, "broken-wiring", "config.local.json"));
    expect(err).toContain("必要なキー");
  });

  test("tracked に executors があれば 2 で止まる", async () => {
    const path = configFile("tracked-executors", {
      executors: { refine: "claude", resolve: "claude" },
    });
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain(join(TMP, "tracked-executors", "config.json"));
    expect(err).toContain("executors");
  });

  test("配線に座標キーがあれば 2 で止まる", async () => {
    const path = configFile("wiring-coord", {}, { ...WIRING, ghRepo: "acme/control" });
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain(join(TMP, "wiring-coord", "config.local.json"));
    expect(err).toContain("ghRepo");
  });

  test("工程が欠けたら 2 で止まる", async () => {
    const path = configFile("no-resolve", {}, { refine: WIRING.refine });
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("resolve");
    expect(err).toContain("必要なキー");
  });

  test("kind が空なら 2 で止まる", async () => {
    const path = configFile(
      "empty-kind",
      {},
      { refine: WIRING.refine, resolve: { kind: "", args: [] } },
    );
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("kind");
  });

  test("args の空要素なら 2 で止まる", async () => {
    const path = configFile(
      "empty-arg",
      {},
      { refine: WIRING.refine, resolve: { kind: "claude", args: [""] } },
    );
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain("args");
  });

  test("配線の JSONC は通る", async () => {
    const path = configFile("jsonc-wiring");
    writeFileSync(
      join(TMP, "jsonc-wiring", "config.local.json"),
      `{
        // refine / resolve
        "refine": { "kind": "claude", "args": [] },
        "resolve": { "kind": "claude", "args": [] },
      }`,
    );
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(1);
    expect(err).toContain("観測に失敗した");
  });

  test("座標の JSONC は通さない", async () => {
    const path = configFile("jsonc-tracked");
    writeFileSync(path, `{\n  // no\n  "ghRepo": "acme/control"\n}`);
    const { code, err } = await run(["--config", path, "--snapshot-out", "/dev/null", ...SURFACE]);
    expect(code).toBe(2);
    expect(err).toContain(path);
  });
});

describe("checkout path", () => {
  test("--surface-path が無ければ 2 で止まる", async () => {
    const { code, err } = await run([
      "--config",
      configFile("no-path"),
      "--snapshot-out",
      "/dev/null",
    ]);
    expect(code).toBe(2);
    expect(err).toContain("acme/control");
  });

  test("<name>=<path> の形でなければ 2 で止まる", async () => {
    const { code } = await run([
      "--config",
      configFile("bad-path"),
      "--snapshot-out",
      "/dev/null",
      "--surface-path",
      "acme/control",
    ]);
    expect(code).toBe(2);
  });
});

describe("規約の穴", () => {
  const gap = (extra: string[]) =>
    run([
      "--config",
      configFile(`gap-${extra.join("-").slice(0, 40)}`),
      "--snapshot-out",
      "/dev/null",
      ...SURFACE,
      ...extra,
    ]);

  test("USAGE に渡し口がある", async () => {
    const { err } = await run(["--snapshot-out", join(TMP, "s"), ...SURFACE]);
    expect(err).toContain("--spec-gap-issue");
    expect(err).toContain("--spec-gap-fact");
  });

  test("片方だけ渡すと 2 で止まる", async () => {
    const onlyIssue = await gap(["--spec-gap-issue", "12"]);
    expect(onlyIssue.code).toBe(2);
    const onlyFact = await gap(["--spec-gap-fact", "片付けの述語が 2 箇所に在る"]);
    expect(onlyFact.code).toBe(2);
    const flagOnly = await gap(["--spec-gap-issue"]);
    expect(flagOnly.code).toBe(2);
  });

  test("番号が読めなければ 2 で止まる", async () => {
    const { code } = await gap(["--spec-gap-issue", "x", "--spec-gap-fact", "事実"]);
    expect(code).toBe(2);
  });

  test("値が空なら 2 で止まる", async () => {
    const emptyIssue = await gap(["--spec-gap-issue", "", "--spec-gap-fact", "事実"]);
    expect(emptyIssue.code).toBe(2);
    const emptyFact = await gap(["--spec-gap-issue", "12", "--spec-gap-fact", ""]);
    expect(emptyFact.code).toBe(2);
  });

  test("両方揃えば観測まで進む", async () => {
    const { code, err } = await gap(["--spec-gap-issue", "12", "--spec-gap-fact", "事実"]);
    expect(code).toBe(1);
    expect(err).toContain("観測に失敗した");
  });
});

describe("観測の失敗", () => {
  // **設定は通るが観測が落ちる形は 1。**2 で返すと呼び出し側が再起動せず、
  // 一時的な API 障害が永久停止に化ける。
  test("設定は正しく観測だけ落ちたら 1 で止まる", async () => {
    const { code, err } = await run([
      "--config",
      configFile("valid"),
      "--snapshot-out",
      join(TMP, "snap.txt"),
      ...SURFACE,
    ]);
    expect(code).toBe(1);
    expect(err).toContain("観測に失敗した");
  });

  test("観測に失敗しても Decision を stdout へ出さない", async () => {
    const { out } = await run([
      "--config",
      configFile("valid2"),
      "--snapshot-out",
      join(TMP, "snap2.txt"),
      ...SURFACE,
    ]);
    expect(out.trim()).toBe("");
  });
});
