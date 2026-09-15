// アドバイザーの選出・完走判定・pane 状態判定。roster の解釈は roster.ts。
//
//   bun advisors.ts select --roster <file>
//   bun advisors.ts launch-argv --roster <file> --kind <kind>
//   bun advisors.ts complete --output <file> --marker <token>
//   bun advisors.ts verdict --output <file> --marker <token>
//   bun advisors.ts extract --raw <file> [--prev <marker>]
//   bun advisors.ts pane-state [--screen <file>]   （既定は stdin）
//   bun advisors.ts input-line [--screen <file>]   （既定は stdin。入力欄の行。無ければ空行）
//   bun advisors.ts trust-key [--screen <file>]    （既定は stdin）
//
// stdout はどれも行で返す（sh がそのまま読める形。JSON を挟まない）。
// 選出は候補表の先頭 1 枠。自己 kind は見ない（書き手と別 session であれば足りる）。
// TUI 画面の読み方はこのファイルだけが持つ。

import { RosterError, type Slot, directLaunchArgv, flag, parseRoster } from "./roster.ts";

export type Selection = {
  readonly chosen: readonly Slot[];
};

export type CompleteReason = "出力なし" | "マーカー無し";

export type CompleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CompleteReason };

const BOX = /[\u2500-\u257F\u2580-\u259F╭╮╯╰❯]/u;
const BOX_STRIP = /[\u2500-\u257F\u2580-\u259F╭╮╯╰❯·]/gu;

/**
 * 行頭の字下げと箇条書きの点、行末の幅埋め・カーソル・右端の時刻を落とす。
 *
 * TUI は応答を字下げして描き、実行器によっては段落へ点を打ち、行の右端へ時刻を
 * 添える。落とさないと marker と文字列比較できない。時刻は 2 つ以上の空白で
 * 隔てられたものだけを取る —— 本文が時刻で終わることがある。
 */
const normalizeSnapshotLine = (line: string): string =>
  line
    .replace(/\s*█?\s*$/u, "")
    .replace(/\s{2,}\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/iu, "")
    .trim()
    .replace(/^[•·]\s+/u, "");

/**
 * 入力欄の行。枠の中に描く実行器と、地に描く実行器がある。
 *
 * 地に置く `>` は取らない —— 引用行と見分けが付かず、応答の中の引用より後ろを
 * 落としてしまう。枠の中の `>` だけを取る。
 */
const INPUT_CARET = /^(?:[│|]\s*[›❯>]|[›❯])(?:\s|$)/u;

/** caret の後ろが番号なら選択肢（`❯ 1. Yes`）。入力欄ではない。 */
const CHOICE_CARET = /^(?:[│|]\s*)?[›❯>]\s*\d+[.)]/u;

const isInputLine = (lines: readonly string[], index: number): boolean => {
  const line = lines[index] ?? "";
  if (CHOICE_CARET.test(line)) return false;
  if (INPUT_CARET.test(line)) return true;
  // 横罫線に囲まれた入力欄だけを取る。本文の矢印行は残す。
  return (
    /^→(?:\s|$)/u.test(line) &&
    /^▄{3,}$/u.test(lines[index - 1] ?? "") &&
    /^▀{3,}$/u.test(lines[index + 1] ?? "")
  );
};

export const isChromeLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("Shift+Tab:")) return true;
  const stripped = trimmed.replace(BOX_STRIP, "").trim();
  if (stripped === "") return true;
  // 経過時間の脚注。応答の後ろに出るので、落とさないと marker が最後の行にならない
  if (stripped.startsWith("Worked for ")) return true;
  if (
    /^[✻✽✶✳✢✷] [\w\p{L}\p{M}]+ for (?:\d+[hms]\s*)+· done \d{1,2}:\d{2}(?:\s*[AP]M)?$/u.test(
      trimmed,
    )
  ) {
    return true;
  }
  return BOX.test(line) && /always-approve|shortcuts/.test(line);
};

/**
 * 応答の最後の行。TUI の枠と、入力欄から後ろを落として読む。
 *
 * 入力欄の後ろには状態行が来る実行器がある。行の形を数え上げても追随できない
 * ので、入力欄を境にする。送った prompt も同じ形で出るが、応答より前なので
 * 最後の 1 つを境に取る。
 */
const contentLines = (text: string): readonly string[] => {
  const lines = text.split(/\r?\n/).map(normalizeSnapshotLine);
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInputLine(lines, i)) {
      end = i;
      break;
    }
  }
  return lines.slice(0, end).filter((line) => !isChromeLine(line));
};

export const lastContentLine = (text: string): string | undefined => contentLines(text).at(-1);

/**
 * 表示中の画面の入力欄の行（正規化済み）。無ければ空。
 *
 * 送信の確認に使う。送信されれば入力欄の中身（貼り付けの placeholder や本文の先頭行）が消える。
 * 画面全体の変化は状態行のスピナーや時計でも起きるので、送信の証拠にならない。
 */
export const inputLine = (screen: string): string => {
  const lines = screen.split(/\r?\n/).map(normalizeSnapshotLine);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInputLine(lines, i)) return lines[i] ?? "";
  }
  return "";
};

/**
 * marker が応答の最後にあるかを見る。
 *
 * 一致ではなく後方一致で取る —— 実行器によっては marker を直前の行の後ろへ
 * 続けて描く。marker より後ろに本文が来ていないことは、これでも見える。
 */
export const advisorComplete = (text: string, marker: string): CompleteResult => {
  const last = lastContentLine(text);
  if (last === undefined) return { ok: false, reason: "出力なし" };
  if (!last.endsWith(marker)) return { ok: false, reason: "マーカー無し" };
  return { ok: true };
};

export const VERDICTS = ["指摘なし", "修正推奨", "再考推奨"] as const;
export type Verdict = (typeof VERDICTS)[number];
/** 完走した応答に判定行が無い（未完走は complete 側で落ちる）。 */
export type VerdictResult = Verdict | "不明";

const VERDICT_LINE = /^判定[:：]\s*(指摘なし|修正推奨|再考推奨)\s*$/u;

/**
 * 応答末尾の判定行。marker の直前の行、または marker を後ろへ続けた行から取る。
 *
 * 読む範囲は完走判定と同じ（最後の入力欄より前）。別の範囲を読むと、入力欄側の
 * 文字列で判定を差し替えられる。履歴には送った prompt も残り、そこには 3 つの
 * 判定語が並ぶので、本文中の語では取らず、marker の手前の 1 行だけを見る。
 */
export const advisorVerdict = (text: string, marker: string): VerdictResult => {
  const lines = contentLines(text);
  const last = lines.at(-1);
  if (last === undefined || !last.endsWith(marker)) return "不明";
  const inline = last.slice(0, -marker.length).trim();
  const candidate = inline === "" ? (lines.at(-2) ?? "") : inline;
  const m = VERDICT_LINE.exec(candidate);
  return m === null ? "不明" : (m[1] as Verdict);
};

/**
 * 実行器が起動時に出す workspace trust 対話。越えるまで prompt は届かない。
 *
 * 問いだけでは取らない —— この仕組み自体をレビューさせると、応答本文に同じ
 * 文も選択肢の行も現れる。番号つきの Yes が揃い、かつ入力欄が無いときだけ
 * 対話とみなす（対話中の実行器は入力欄を描かない）。
 */
const TRUST_QUESTION = /trust this folder|do you trust|without asking for approval/iu;

/**
 * 応答生成中であることを示す行。
 *
 * 実行器ごとに語彙が違うので語では取らない。共通するのは行末の経過時間つき括弧
 * （`(1m 6s · esc to interrupt)`）と、入力欄の右端に出る中断案内。
 *
 * 行全体の形で取る —— この仕組みをレビューさせると、応答本文に表示例がそのまま
 * 現れる。括弧より前に語以外（`:` や `例:` のような前置き）があれば状態行ではない。
 * 誤って working にすると、その agent を二度と終端できなくなる。
 */
const ELAPSED_TAIL = /\((?:\d+\s*[hms]\s*)+[^)]*\)$/u;
// 括弧の前はスピナー記号と状態語だけ。スピナーの字は実行器ごとに違い、frame でも
// 変わるので列挙しない（記号かどうかで見る）。語中のハイフンは許すが（Razzle-dazzling）、
// 行頭のハイフンや前置き（`- ` / `例:`）は状態行ではない
const STATUS_HEAD = /^(?:\p{So}\s*)?(?:[\p{L}\p{N}\u2026·]+(?:-[\p{L}\p{N}\u2026·]+)*\s*){0,6}$/u;

/** 入力欄の右端に出る中断案内（cursor は状態行を持たない）。 */
const INTERRUPT_HINT = /(?:ctrl\+c to stop|(?:esc|escape)(?:\s+\S+)? to interrupt)$/iu;

// grok は括弧を使わず、スピナー + 状態語… + 経過秒 のあと右端に転送量と `[stop]` を描く
const GROK_STATUS = /^\p{So}\s+(?:[\p{L}\p{N}\u2026·]+\s*){1,8}\d+(?:\.\d+)?s\s{2,}.*\[stop\]$/u;

const isStatusLine = (line: string): boolean => {
  if (GROK_STATUS.test(line)) return true;
  const matched = ELAPSED_TAIL.exec(line);
  return matched !== null && STATUS_HEAD.test(line.slice(0, matched.index));
};

/**
 * 実行器がログインを待つ画面。人がログインするまで prompt は届かない。
 *
 * 実画面で確かめた実行器の行の組だけを置き、組の全行が行全体で揃うときだけ取る。
 * trust / working より後に見る —— 生成中の応答本文や対話の画面にも同じ文が現れる。
 */
const LOGIN_SCREENS: readonly (readonly RegExp[])[] = [
  // cursor-agent
  [/^Cursor Agent$/u, /^Press any key to log in\.\.\.$/u],
];

const isLoginScreen = (lines: readonly string[]): boolean =>
  LOGIN_SCREENS.some((screen) => screen.every((row) => lines.some((line) => row.test(line))));

export type PaneState = "login" | "trust" | "working" | "ready" | "unknown";

/**
 * 表示中の 1 画面から実行器の状態を読む。
 *
 * 履歴ではなく現在画面を渡すこと —— 過去の巡のスピナーや、応答本文に現れる
 * 同じ語に当たる。unknown は「読めない」であって「停止」ではない。呼び出し側は
 * unknown で終端しない。
 */
export const paneState = (screen: string): PaneState => {
  const lines = screen.split(/\r?\n/).map(normalizeSnapshotLine);
  let input = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInputLine(lines, i)) {
      input = i;
      break;
    }
  }
  if (input < 0) {
    // 対話は入力欄を出さない。入力欄があるのに問いが見えるのは、応答本文の引用
    if (lines.some((line) => TRUST_QUESTION.test(line)) && trustKey(screen) !== undefined) {
      return "trust";
    }
    if (lines.some(isStatusLine)) return "working";
    return isLoginScreen(lines) ? "login" : "unknown";
  }
  // 入力欄の右端の中断案内と、入力欄まわりの状態行だけを見る（本文は見ない）
  if (INTERRUPT_HINT.test(lines[input] ?? "")) return "working";
  const around = lines.slice(input);
  for (let i = input - 1; i >= 0; i--) {
    if (isChromeLine(lines[i] ?? "")) continue;
    around.push(lines[i] ?? "");
    break;
  }
  return around.some(isStatusLine) ? "working" : "ready";
};

/** trust 対話で Yes を選ぶ選択肢番号。番号が読めなければ undefined。 */
export const trustKey = (screen: string): string | undefined => {
  for (const raw of screen.split(/\r?\n/)) {
    const line = normalizeSnapshotLine(raw).replace(/^[^\p{L}\p{N}]+/u, "");
    const matched = /^(\d)[.)]\s*Yes\b/u.exec(line);
    if (matched?.[1] !== undefined) return matched[1];
  }
  return undefined;
};

/**
 * 前巡の marker より後ろ。巡ごとの応答だけを切り出す。
 *
 * 履歴には過去の巡も残る。marker は巡ごとに一意なので、最後の出現を境にする。
 */
export const responseAfter = (raw: string, prev: string): string => {
  if (prev === "") return raw.replace(/^\n+/u, "");
  const at = raw.lastIndexOf(prev);
  const rest = at < 0 ? raw : raw.slice(at + prev.length);
  return rest.replace(/^\n+/u, "");
};

export const selectAdvisors = (slots: readonly Slot[]): Selection => {
  const first = slots[0];
  if (first === undefined) throw new RosterError("選出できる枠が無い");
  return { chosen: [first] };
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  try {
    if (cmd === "select") {
      const rosterPath = flag(argv, "--roster");
      if (rosterPath === undefined) throw new RosterError("--roster が無い");
      const { advisors } = parseRoster(await Bun.file(rosterPath).text());
      const { chosen } = selectAdvisors(advisors);
      process.stdout.write(chosen.map((slot) => `${slot.kind}\n`).join(""));
      return;
    }
    if (cmd === "complete") {
      const outputPath = flag(argv, "--output");
      const marker = flag(argv, "--marker");
      if (outputPath === undefined || marker === undefined || marker === "") {
        throw new RosterError("--output / --marker が必要");
      }
      const file = Bun.file(outputPath);
      const text = (await file.exists()) ? await file.text() : "";
      const result = advisorComplete(text, marker);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.ok ? 0 : 1);
      return;
    }
    if (cmd === "verdict") {
      const outputPath = flag(argv, "--output");
      const marker = flag(argv, "--marker");
      if (outputPath === undefined || marker === undefined || marker === "") {
        throw new RosterError("--output / --marker が必要");
      }
      const file = Bun.file(outputPath);
      const text = (await file.exists()) ? await file.text() : "";
      process.stdout.write(`${advisorVerdict(text, marker)}\n`);
      return;
    }
    if (cmd === "pane-state" || cmd === "trust-key" || cmd === "input-line") {
      const screenPath = flag(argv, "--screen");
      const text =
        screenPath === undefined || screenPath === "-"
          ? await Bun.stdin.text()
          : await Bun.file(screenPath).text();
      if (cmd === "pane-state") {
        process.stdout.write(`${paneState(text)}\n`);
        return;
      }
      if (cmd === "input-line") {
        process.stdout.write(`${inputLine(text)}\n`);
        return;
      }
      const key = trustKey(text);
      if (key === undefined) process.exit(1);
      process.stdout.write(`${key}\n`);
      return;
    }
    if (cmd === "launch-argv") {
      const rosterPath = flag(argv, "--roster");
      const kind = flag(argv, "--kind");
      if (rosterPath === undefined) throw new RosterError("--roster が必要");
      if (kind === undefined || kind === "") throw new RosterError("--kind が必要");
      const { advisors } = parseRoster(await Bun.file(rosterPath).text());
      const slot = advisors.find((s) => s.kind === kind);
      if (slot === undefined) throw new RosterError(`候補表に無い kind: ${kind}`);
      process.stdout.write(
        directLaunchArgv(slot)
          .map((arg) => `${arg}\n`)
          .join(""),
      );
      return;
    }
    if (cmd === "extract") {
      const rawPath = flag(argv, "--raw");
      if (rawPath === undefined) throw new RosterError("--raw が必要");
      const prev = flag(argv, "--prev") ?? "";
      const text = await Bun.file(rawPath).text();
      process.stdout.write(responseAfter(text, prev));
      return;
    }
    throw new RosterError(
      "使い方: advisors.ts select | launch-argv | complete | verdict | extract | pane-state | trust-key | input-line",
    );
  } catch (error) {
    const message = error instanceof RosterError ? error.message : String(error);
    console.error(`FATAL\t${message}`);
    process.exit(2);
  }
};

if (import.meta.main) await main();
