// 幅で折った散文の継続行を出す。gate は bun test。
//
// 規則の SSOT は agents/AGENTS.md「文章の書き方」。見るのは同一 prose block の継続行だけ。
// fence / frontmatter / 表 / HTML ブロックの中は見ない。文末で終わる行は通す。

import { marked } from "marked";
import type { Token, Tokens } from "marked";

const SENTENCE_END = /(?:[。．.！!？?…]|……)[」』）)】〉》"'”’]*$/u;
const COLON_END = /[：:]$/u;
const NESTED_LIST = /^[ \t]+(?:[-*+]|\d+\.)[ \t]/u;
const FENCE_LINE = /^[ \t]*(?:```|~~~)/u;

export function isSentenceEnd(line: string): boolean {
  const trimmed = line
    .replace(/^[ \t]*>[ \t]?/u, "")
    .replace(/[ \t]+$/u, "")
    .replace(/\\$/u, "");
  if (trimmed.trim() === "") return true;
  return SENTENCE_END.test(trimmed) || COLON_END.test(trimmed);
}

function contentLines(raw: string): string[] {
  const lines = raw.replace(/(?:\r?\n)+$/u, "").split("\n");
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return lines;
}

function listItemLeadingRaw(item: Tokens.ListItem): string {
  const lines = item.raw.split("\n");
  const out = [lines[0] ?? ""];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (NESTED_LIST.test(line) || FENCE_LINE.test(line)) break;
    if (line.trim() === "") {
      const next = lines[i + 1] ?? "";
      if (NESTED_LIST.test(next) || FENCE_LINE.test(next)) break;
    }
    out.push(line);
  }
  return out.join("\n");
}

function visitProse(tokens: Token[], visit: (raw: string) => void): void {
  for (const token of tokens) {
    switch (token.type) {
      case "list":
        for (const item of token.items) {
          visit(listItemLeadingRaw(item));
          visitProse(
            (item.tokens ?? []).filter((child: Token) => child.type === "list"),
            visit,
          );
        }
        break;
      case "blockquote":
        visit(token.raw);
        break;
      case "paragraph":
      case "heading":
      case "text":
        visit(token.raw);
        break;
      default:
        break;
    }
  }
}

export type HardWrapLine = { no: number; text: string };

export function hardWrapLines(src: string): HardWrapLine[] {
  const out: HardWrapLine[] = [];
  let cursor = 0;
  visitProse(marked.lexer(src), (raw: string) => {
    let at = src.indexOf(raw, cursor);
    if (at < 0) at = src.indexOf(raw);
    if (at >= 0) cursor = at + raw.length;
    const lines = contentLines(raw);
    if (lines.length < 2) return;
    const base = src.slice(0, Math.max(at, 0)).split("\n").length;
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i] ?? "";
      if (!isSentenceEnd(line)) out.push({ no: base + i, text: line });
    }
  });
  return out;
}

const KIND = "hard-wrap";

const FIXTURES: { name: string; source: string; expect: string[] }[] = [
  { name: "幅で折った段落", source: "これは文の途中で\n折り返している。", expect: [KIND] },
  { name: "文末で改行した段落", source: "これは文末。\n次の文。", expect: [] },
  {
    name: "表の中は見ない",
    source: "| a | b |\n| --- | --- |\n| 途中で\n折れた | x |",
    expect: [],
  },
  { name: "fence の中は見ない", source: "```\n途中で\n折り返した例。\n```", expect: [] },
  {
    name: "入れ子 fence の中は見ない",
    source: "````markdown\n```\n途中で\n折り返した例。\n```\n````",
    expect: [],
  },
  {
    name: "frontmatter のあとの本文は見る",
    source: "---\ndescription: fixture\n---\n\nこれは文の途中で\n折り返している。",
    expect: [KIND],
  },
  {
    name: "HTML ブロックの中は見ない",
    source: "<div>\n途中で\n折り返した例。\n</div>",
    expect: [],
  },
];

function stripFrontmatter(src: string): string {
  return src.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?(?:\r?\n)?---[ \t]*(?:\r?\n|$)/, "");
}

export function validateHardWrapFixtures(): string[] {
  const problems: string[] = [];
  if (FIXTURES.length === 0) problems.push("FIXTURES が空です");
  const expectations = FIXTURES.map((f) => f.expect);
  if (!expectations.some((kinds) => kinds.length === 0)) {
    problems.push("正しい fixture が 1 件もありません");
  }
  if (!expectations.some((kinds) => kinds.includes(KIND))) {
    problems.push(`${KIND} を期待する fixture が 1 件もありません`);
  }
  for (const { name, source, expect } of FIXTURES) {
    const detected = hardWrapLines(stripFrontmatter(source)).length > 0 ? [KIND] : [];
    if (detected.join() !== [...expect].sort().join()) {
      problems.push(`fixture「${name}」: 期待 [${expect}] / 実測 [${detected}]`);
    }
  }
  return problems;
}
