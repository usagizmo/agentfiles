// アドバイザーの選出と完走判定。roster の解釈は roster.ts。
//
//   bun advisors.ts select --roster <file> --self <kind>
//   bun advisors.ts launch-argv --slot <file>
//   bun advisors.ts complete --output <file> --marker <token>
//
// select の stdout は選出した枠の JSON。表に無い self は先頭 2 枠 + stderr へ警告。
// launch-argv の stdout は tmux / 直接 CLI 起動の argv JSON。

import {
  RosterError,
  type Slot,
  directLaunchArgv,
  flag,
  parseRoster,
  parseSlot,
} from "./roster.ts";

export const MAX_ADVISORS = 2;

export type Selection = {
  readonly chosen: readonly Slot[];
  readonly warning: boolean;
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

const isInputLine = (lines: readonly string[], index: number): boolean => {
  const line = lines[index] ?? "";
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
export const lastContentLine = (text: string): string | undefined => {
  const lines = text.split(/\r?\n/).map(normalizeSnapshotLine);
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInputLine(lines, i)) {
      end = i;
      break;
    }
  }
  for (let i = end - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!isChromeLine(line)) return line;
  }
  return undefined;
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

export const selectAdvisors = (slots: readonly Slot[], selfKind: string): Selection => {
  const matched = slots.find((s) => s.members.includes(selfKind));
  const remaining = matched === undefined ? slots : slots.filter((s) => s !== matched);
  const chosen = remaining.slice(0, MAX_ADVISORS);
  if (chosen.length === 0) throw new RosterError("選出できる枠が無い");
  return { chosen, warning: matched === undefined };
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  try {
    if (cmd === "select") {
      const rosterPath = flag(argv, "--roster");
      const selfKind = flag(argv, "--self");
      if (rosterPath === undefined) throw new RosterError("--roster が無い");
      if (selfKind === undefined || selfKind === "") throw new RosterError("--self が無い");
      const { advisors } = parseRoster(await Bun.file(rosterPath).text());
      const { chosen, warning } = selectAdvisors(advisors, selfKind);
      if (warning) {
        console.error(`WARN\t自己 kind が候補表に無い: ${selfKind}`);
      }
      process.stdout.write(`${JSON.stringify(chosen)}\n`);
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
    if (cmd === "launch-argv") {
      const slotPath = flag(argv, "--slot");
      if (slotPath === undefined) throw new RosterError("--slot が必要");
      const raw: unknown = JSON.parse(await Bun.file(slotPath).text());
      const slot = parseSlot(raw);
      process.stdout.write(`${JSON.stringify(directLaunchArgv(slot))}\n`);
      return;
    }
    throw new RosterError("使い方: advisors.ts select | launch-argv | complete");
  } catch (error) {
    const message = error instanceof RosterError ? error.message : String(error);
    console.error(`FATAL\t${message}`);
    process.exit(2);
  }
};

if (import.meta.main) await main();
