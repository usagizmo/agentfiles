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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  surfaces: [{ name: "acme/control", usesPr: true, integrationRef: "origin/main" }],
  sessionsCmd: "echo conductor present",
  workspacesCmd: "echo ws -",
};

/** 設定を書き出して path を返す。`over` を undefined にした key は落とす。 */
const configFile = (name: string, over: Record<string, unknown> = {}): string => {
  const merged: Record<string, unknown> = { ...VALID, ...over };
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete merged[k];
  const path = join(TMP, `${name}.json`);
  writeFileSync(path, JSON.stringify(merged));
  return path;
};

/** 座標に checkout path を束ねる option。全 case で同じ面を渡す。 */
const SURFACE = ["--surface-path", `acme/control=${TMP}`];

const run = async (args: string[]) => {
  const p = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
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
    "sessionsCmd",
    "workspacesCmd",
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
