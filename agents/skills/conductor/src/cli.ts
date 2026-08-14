// tick の入口。**観測 → 正規化 → action 選択までを行い、Decision を JSON で返す。**
//
// **実行はしない。**副作用（起こす・渡す・片付ける・記録を書く）は skill 側が
// `references/protocols.md` に従って行う。ここが返すのは「何をするか」だけ。
//
// 観測外の行と実行結果は、同じ入口の事実コマンド。JSON はここが合成する。
//
// 使い方:
//   bun run src/cli.ts --config <path> --snapshot-out <path>
//   bun run src/cli.ts note --title ... --detail ... --unblocks ... --kind env
//   bun run src/cli.ts clear --id <id>
//   bun run src/cli.ts result --status ok|env|gap
//
// 終了コード:
//   0  Decision を返した / 事実を書いた
//   1  観測に失敗した（**watcher は呼び出し側が直前の snapshot で張る**）
//   2  設定が壊れている / 事実の引数が足りない（fail-closed。何も選ばずに止まる）

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseOverlay, toBoard } from "./board.ts";
import { ConfigError, parseConfig, resolveSurfaces } from "./config.ts";
import { decide } from "./decide.ts";
import {
  RESULT_STATUSES,
  appendJournal,
  decisionEvent,
  newNoteId,
  openNotes,
  recentOf,
  type ResultStatus,
} from "./journal.ts";
import { observeTick } from "./observe.ts";
import { importOverlay, overlayFromJournal } from "./overlay.ts";
import {
  defaultBoardPath,
  defaultJournalPath,
  defaultOverlayPath,
  defaultScorePath,
} from "./paths.ts";
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

const USAGE =
  "usage: cli.ts --config <path> --snapshot-out <path> --surface-path <name>=<path>... [--board-out <path>] [--board-overlay <path>] [--journal <path>] [--tick <n>] [--tick-used <n>]";
const NOTE_USAGE =
  "usage: cli.ts note --title <text> --detail <text> --unblocks <text> --kind <kind> [--issues 1,2] [--journal <path>]";
const CLEAR_USAGE = "usage: cli.ts clear --id <id> [--journal <path>]";
const RESULT_USAGE =
  "usage: cli.ts result --status ok|env|gap [--detail <text>] [--journal <path>]";

const optionalInt = (name: string): number | undefined => {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) fail(2, `--${name} が 0 以上の整数ではない: ${raw}`);
  return n;
};

const parseIssues = (raw: string | undefined): readonly number[] => {
  if (raw === undefined || raw === "") return [];
  const issues = raw.split(",").map((part) => Number(part));
  if (issues.some((n) => !Number.isInteger(n) || n <= 0))
    fail(2, `--issues が番号の列ではない: ${raw}`);
  return issues;
};

const isResultStatus = (raw: string): raw is ResultStatus =>
  (RESULT_STATUSES as readonly string[]).includes(raw);

const FACTS = ["note", "clear", "result", "notes"] as const;
type Fact = (typeof FACTS)[number];
const isFact = (raw: string | undefined): raw is Fact =>
  raw !== undefined && (FACTS as readonly string[]).includes(raw);

const runFact = (command: Fact): void => {
  const journalPath = arg("journal") ?? defaultJournalPath();
  const overlayPath = defaultOverlayPath();
  const at = new Date().toISOString();
  switch (command) {
    case "note": {
      const title = arg("title") ?? fail(2, NOTE_USAGE);
      const detail = arg("detail") ?? fail(2, NOTE_USAGE);
      const unblocks = arg("unblocks") ?? fail(2, NOTE_USAGE);
      const kind = arg("kind") ?? fail(2, NOTE_USAGE);
      const issues = parseIssues(arg("issues"));
      try {
        importOverlay(journalPath, overlayPath, at);
      } catch (error) {
        fail(2, `journal を読めない: ${String(error)}`);
      }
      const id = newNoteId();
      try {
        appendJournal(journalPath, {
          kind: "note",
          at,
          id,
          title,
          detail,
          unblocks,
          issues,
          noteKind: kind,
        });
      } catch (error) {
        fail(2, `journal を書けない: ${String(error)}`);
      }
      console.log(id);
      return;
    }
    case "clear": {
      const id = arg("id") ?? fail(2, CLEAR_USAGE);
      let events;
      try {
        events = importOverlay(journalPath, overlayPath, at);
      } catch (error) {
        fail(2, `journal を読めない: ${String(error)}`);
      }
      if (!openNotes(events).some((n) => n.id === id)) fail(2, `journal に ${id} が無い`);
      try {
        appendJournal(journalPath, { kind: "clear", at, id });
      } catch (error) {
        fail(2, `journal を書けない: ${String(error)}`);
      }
      return;
    }
    case "notes": {
      let events;
      try {
        events = importOverlay(journalPath, overlayPath, at);
      } catch (error) {
        fail(2, `journal を読めない: ${String(error)}`);
      }
      for (const row of openNotes(events)) {
        console.log(`${row.id}\t${row.title}`);
      }
      return;
    }
    case "result": {
      const status = arg("status") ?? fail(2, RESULT_USAGE);
      if (!isResultStatus(status)) fail(2, RESULT_USAGE);
      const detail = arg("detail");
      try {
        appendJournal(journalPath, {
          kind: "result",
          at: new Date().toISOString(),
          status,
          ...(detail === undefined || detail === "" ? {} : { detail }),
        });
      } catch (error) {
        fail(2, `journal を書けない: ${String(error)}`);
      }
      return;
    }
    default: {
      const _never: never = command;
      return _never;
    }
  }
};

const renderBoard = async (
  dataPath: string,
  htmlPath: string,
  scriptsDir: string,
): Promise<void> => {
  const script = `${scriptsDir}/board.mjs`;
  const proc = Bun.spawn(["bun", script, dataPath, htmlPath], { stdout: "pipe", stderr: "pipe" });
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) console.error(`譜面を書けない: ${err || `board.mjs exit ${code}`}`);
};

const runTick = async (): Promise<void> => {
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

  const { observations, view } = await observeTick(port, config.statusMap, surfaceUsesPr).catch(
    (error: unknown) =>
      // **観測できなかった tick も watcher は張る**（張らないと起こし手が消え、一時的な障害が永久停止に化ける）。
      // 張るのは呼び出し側の仕事なので、ここは失敗を伝えるだけにする。
      fail(1, `観測に失敗した: ${String(error)}`),
  );

  const decision = decide({ observations, config: config.tick });
  const observedAt = new Date().toISOString();

  const journalPath = arg("journal") ?? defaultJournalPath();
  let events;
  try {
    events = importOverlay(journalPath, defaultOverlayPath(), observedAt);
  } catch (error) {
    fail(2, `journal を読めない: ${String(error)}`);
  }
  const overlayArg = arg("board-overlay");
  let overlay = overlayFromJournal(events);
  if (overlayArg !== undefined) {
    try {
      overlay = parseOverlay(await Bun.file(overlayArg).json());
    } catch (error) {
      fail(2, `overlay を読めない: ${String(error)}`);
    }
  }
  const recent = recentOf(events);

  const boardArg = arg("board-out");
  const boardOut = resolve(boardArg ?? defaultBoardPath());
  const tick = optionalInt("tick");
  const used = optionalInt("tick-used");
  const board = toBoard({
    observations,
    decision,
    config,
    view,
    overlay,
    recent,
    observedAt,
    ...(tick === undefined ? {} : { tick }),
    ...(used === undefined ? {} : { actionsUsed: used }),
  });
  try {
    mkdirSync(dirname(boardOut), { recursive: true });
    writeFileSync(boardOut, `${JSON.stringify(board, null, 2)}\n`);
  } catch (error) {
    // **盤面は指紋に入らない。**書けなくても Decision は返す。
    console.error(`盤面を書けない: ${String(error)}`);
  }

  if (boardArg === undefined || arg("score") !== undefined) {
    await renderBoard(boardOut, resolve(arg("score") ?? defaultScorePath()), scriptsDir);
  }

  const event = decisionEvent(decision, observedAt);
  if (event !== undefined) {
    try {
      appendJournal(journalPath, event);
    } catch (error) {
      console.error(`journal を書けない: ${String(error)}`);
    }
  }

  console.log(JSON.stringify(decision, null, 2));
};

const command = Bun.argv[2];
if (isFact(command)) runFact(command);
else await runTick();
