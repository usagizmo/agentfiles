// tick の入口。**観測 → 正規化 → action 選択までを行い、Decision を JSON で返す。**
//
// **実行はしない。**副作用（起こす・渡す・片付ける・記録を書く）は skill 側が
// `references/protocols.md` に従って行う。ここが返すのは「何をするか」だけ。
//
// 使い方:
//   bun run src/cli.ts --config <path> --snapshot-out <path>
//
// 終了コード:
//   0  Decision を返した（内容は stdout の JSON）
//   1  観測に失敗した（**watcher は呼び出し側が直前の snapshot で張る**）
//   2  設定が壊れている（fail-closed。何も選ばずに止まる）

import { ConfigError, parseConfig, resolveSurfaces } from "./config.ts";
import { decide } from "./decide.ts";
import { observe } from "./observe.ts";
import { createPort } from "./port.ts";

const arg = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : Bun.argv[index + 1];
};

/** 繰り返し渡せる option。**最初の 1 つで打ち切らない** —— 面を落とすと観測に出ない。 */
const args = (name: string): string[] =>
  Bun.argv.flatMap((a, i) => (a === `--${name}` ? [Bun.argv[i + 1] ?? ""] : []));

/**
 * `--surface-path <name>=<path>`。**座標表に checkout path を置かない**ので、
 * 端末ごとに違う値はここから入る（`landing-surface.md`）。`=` は最初の 1 つで切る ——
 * path 側に `=` が現れても通す。
 */
const surfacePaths = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const raw of args("surface-path")) {
    const at = raw.indexOf("=");
    if (at <= 0) fail(2, `--surface-path の形が <name>=<path> でない: ${raw}`);
    map.set(raw.slice(0, at), raw.slice(at + 1));
  }
  return map;
};

// **`never` を返す関数で narrow させない** —— const に代入した arrow では制御フロー解析が
// 効かず、`undefined` のまま先へ流れる。呼び出し側で受けて明示的に落とす。
const fail: (code: 1 | 2, message: string) => never = (code, message) => {
  console.error(message);
  process.exit(code);
};

const USAGE = "usage: cli.ts --config <path> --snapshot-out <path> --surface-path <name>=<path>...";
const configPath = arg("config") ?? fail(2, USAGE);
const snapshotOut = arg("snapshot-out") ?? fail(2, USAGE);

const scriptsDir = new URL("../scripts", import.meta.url).pathname;

const config = await (async () => {
  try {
    return parseConfig(await Bun.file(configPath).json());
  } catch (error) {
    return fail(
      2,
      error instanceof ConfigError ? error.message : `設定を読めない: ${String(error)}`,
    );
  }
})();

const surfaces = (() => {
  try {
    return resolveSurfaces(config.surfaces, surfacePaths());
  } catch (error) {
    return fail(2, error instanceof ConfigError ? error.message : String(error));
  }
})();

const port = createPort({ config, surfaces, scriptsDir, snapshotPath: snapshotOut });
const surfaceUsesPr = new Map(config.surfaces.map((s) => [s.name, s.usesPr]));

const observations = await observe(port, config.statusMap, surfaceUsesPr).catch((error: unknown) =>
  // **観測できなかった tick も watcher は張る**（張らないと起こし手が消え、一時的な障害が永久停止に化ける）。
  // 張るのは呼び出し側の仕事なので、ここは失敗を伝えるだけにする。
  fail(1, `観測に失敗した: ${String(error)}`),
);

const decision = decide({ observations, config: config.tick });
console.log(JSON.stringify(decision, null, 2));
