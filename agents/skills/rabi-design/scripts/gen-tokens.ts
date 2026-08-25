#!/usr/bin/env bun
/**
 * `rabi.css` のライト値から `DESIGN.md` の front matter を書き戻す。
 *
 * front matter は写しで、手で直さない。`--check` は書き戻しても差分が出ないことだけを見る。
 *
 * 実行: bun <skills root>/rabi-design/scripts/gen-tokens.ts [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMap, isScalar, type Node, parseDocument, type YAMLMap } from "yaml";

const SKILL = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(SKILL, "../assets");
const DESIGN = join(SKILL, "../references/DESIGN.md");

/** `light-dark(a, b)` の a。引数は `rgb(…)` のように自分のカンマを持つので括弧を数える。 */
function lightArgument(value: string): string {
  const inner = value.slice("light-dark(".length, -1);
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  if (args.length !== 2 || args.some((a) => a === "")) {
    throw new Error(`light-dark() の引数が 2 つない: ${value}`);
  }
  return args[0] as string;
}

/**
 * `--rabi-*` の宣言を 1 度だけ読む。front matter はライト値のみ持つ。
 *
 * 同名の再宣言は throw する。ブラウザは後勝ちで、先頭を採ると写しがずれる。
 */
export function declarations(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name = "", raw = ""] of css.matchAll(/--rabi-([a-z0-9_-]+):\s*([^;]+);/g)) {
    if (map.has(name)) throw new Error(`--rabi-${name} が 2 回宣言されている`);
    const value = raw.replace(/\s+/g, " ").trim();
    map.set(
      name,
      value.startsWith("light-dark(") && value.endsWith(")") ? lightArgument(value) : value,
    );
  }
  return map;
}

/**
 * `var(--rabi-…)` の参照を宣言値へ展開しきる。front matter は literal しか持て**ない**。
 *
 * 多段の参照も辿る。同じ名前へ戻ったら循環として throw する。
 * fallback 付き（`var(--x, y)`）も throw する。宣言が在れば fallback は死に値で、
 * 無ければ写しが CSS と別の値になる。どちらも SSOT が 2 つになる。
 */
function expand(
  css: Map<string, string>,
  value: string,
  seen: ReadonlySet<string> = new Set(),
): string {
  const expanded = value.replace(/var\(\s*--rabi-([a-z0-9_-]+)\s*[,)]/g, (whole, name: string) => {
    if (whole.endsWith(",")) throw new Error(`--rabi-${name} の参照が fallback を持っている`);
    if (seen.has(name)) throw new Error(`--rabi-${name} の参照が循環している`);
    const declared = css.get(name);
    if (declared === undefined) throw new Error(`--rabi-${name} が rabi.css に無い`);
    return expand(css, declared, new Set([...seen, name]));
  });
  if (expanded.includes("var(")) throw new Error(`展開しきれない参照が残った: ${expanded}`);
  return expanded;
}

/**
 * front matter だけが持つ path。CSS に対応する変数を持た**ない**。
 *
 * ここに載らない path は必ず CSS から引く。載せ忘れると `--check` が落ちる。
 */
function ownedByFrontMatter(path: readonly string[]): boolean {
  const [group, , property] = path;
  if (group === undefined) return false;
  if (["version", "name", "description"].includes(group)) return true;
  if (group === "components") return true;
  if (DERIVED.has(path.join("."))) return true;
  return group === "typography" && ["fontWeight", "letterSpacing"].includes(property ?? "");
}

/**
 * front matter の token path → `--rabi-<name>`。
 *
 * **名前が揃っていない軸だけを表に持つ。**`colors` は同名なので持たない。
 */
const SPACING_VARS: Record<string, string> = {
  "control-xs": "control-xs",
  "control-sm": "control-sm",
  control: "control",
  "control-lg": "control-lg",
};

const ROUNDED_VARS: Record<string, string> = {
  none: "r-none",
  sm: "r-sm",
  md: "r-md",
  lg: "r-lg",
  full: "r-full",
};

function cssVarName(path: readonly string[]): string | undefined {
  const [group, key, property] = path;
  if (!group || !key) return undefined;
  if (group === "colors") return property === undefined ? key : undefined;
  if (group === "spacing") {
    // 段の名は 4px を 1 とする倍数。`.` は CSS の ident に置けないので `_` にする
    return (
      SPACING_VARS[key] ?? (/^\d+(\.5)?$/.test(key) ? `gap-${key.replace(".", "_")}` : undefined)
    );
  }
  if (group === "rounded") return ROUNDED_VARS[key];
  if (group === "typography") {
    if (property === "fontSize") return `t-${key}`;
    if (property === "lineHeight") return `lh-${key}`;
    if (property === "fontFamily") return key === "mono" ? "mono" : "font";
  }
  return undefined;
}

/** `{colors.ink}` の形。`components` とここ以外では許さ**ない**。 */
const isTokenRef = (value: unknown): boolean => typeof value === "string" && value.startsWith("{");

/** 他 token の参照としてだけ持てる path。literal を置くと落ちる。 */
const DERIVED = new Set(["colors.primary"]);

/**
 * front matter の該当スカラーを CSS の値で置き、引いた CSS 変数名を返す。
 *
 * 引けない path は throw する。
 */
function rewrite(front: YAMLMap, css: Map<string, string>): Set<string> {
  const used = new Set<string>();
  const walk = (map: YAMLMap, prefix: readonly string[]): void => {
    for (const pair of map.items) {
      if (!isScalar(pair.key)) continue;
      const path = [...prefix, String(pair.key.value)];
      const label = path.join(".");
      const value = pair.value as Node | null;

      if (ownedByFrontMatter(path)) {
        if (DERIVED.has(label) && !(isScalar(value) && isTokenRef(value.value))) {
          throw new Error(`${label} は他 token の参照でなければならない`);
        }
        continue;
      }
      if (isMap(value)) {
        walk(value, path);
        continue;
      }
      if (!isScalar(value)) throw new Error(`${label} が scalar でも map でもない`);
      if (isTokenRef(value.value)) throw new Error(`${label} は派生として許可されていない`);

      const name = cssVarName(path);
      if (name === undefined) {
        throw new Error(`${label} に対応する CSS 変数が gen-tokens.ts の表に無い`);
      }
      const declared = css.get(name);
      if (declared === undefined) {
        throw new Error(`${label} に対応する --rabi-${name} が rabi.css に無い`);
      }
      const expanded = expand(css, declared);
      // 単位を持たない値（行送り）は数値のまま保つ。文字列にすると読む側が型で分岐する
      value.value = /^-?\d+(\.\d+)?$/.test(expanded) ? Number(expanded) : expanded;
      delete value.type; // 引用の要否は値から決め直させる
      used.add(name);
    }
  };
  walk(front, []);
  return used;
}

/** `components` の `{group.key}` が front matter の実在する path を指すことを見る。 */
function checkTokenRefs(front: YAMLMap): void {
  const walk = (map: YAMLMap): void => {
    for (const pair of map.items) {
      const value = pair.value as Node | null;
      if (isMap(value)) {
        walk(value);
        continue;
      }
      if (!isScalar(value) || !isTokenRef(value.value)) continue;
      // 段の名に `.` を含むので、最初の `.` だけで group と key に割る
      const ref = String(value.value).slice(1, -1);
      const dot = ref.indexOf(".");
      if (front.getIn([ref.slice(0, dot), ref.slice(dot + 1)], true) === undefined) {
        throw new Error(`{${ref}} が front matter に無い`);
      }
    }
  };
  walk(front);
}

/**
 * front matter へ写されない CSS 変数。ここに載らない `--rabi-*` は必ず写す。
 *
 * 影と速さは spec に token group が無く、`shade` は混色の入力で単体では使わない。
 */
const CSS_ONLY = new Set(["shade", "e1", "e2", "e3", "e2-accent", "e3-accent", "motion"]);

/** CSS 側に足した変数が front matter から漏れていないことを見る。 */
function checkCssCoverage(css: Map<string, string>, used: Set<string>): void {
  const missing = [...css.keys()].filter((name) => !used.has(name) && !CSS_ONLY.has(name));
  if (missing.length > 0) {
    throw new Error(`front matter へ写されていない CSS 変数: ${missing.join(", ")}`);
  }
}

if (import.meta.main) {
  const css = declarations(readFileSync(join(ASSETS, "rabi.css"), "utf8"));
  const design = readFileSync(DESIGN, "utf8");

  const block = design.match(/^---\n([\s\S]*?\n)---\n/);
  if (!block?.[1]) throw new Error("DESIGN.md に front matter が無い");

  const doc = parseDocument(block[1]);
  if (!isMap(doc.contents)) throw new Error("front matter が map ではない");
  checkTokenRefs(doc.contents);
  checkCssCoverage(css, rewrite(doc.contents, css));
  // 折り返さない。front matter は 1 key 1 行で読む。
  // 置換は関数で渡す —— 文字列だと値の `$&` が展開される
  const front = doc.toString({ lineWidth: 0 });
  const generated = design.replace(block[1], () => front);

  if (process.argv.includes("--check")) {
    if (generated !== design) {
      console.error("DESIGN.md の front matter が rabi.css と揃っていません。");
      console.error("bun <skills root>/rabi-design/scripts/gen-tokens.ts で書き戻してください。");
      process.exit(1);
    }
    console.log("DESIGN.md ↔ rabi.css: 一致");
  } else {
    writeFileSync(DESIGN, generated);
    console.log(generated === design ? "DESIGN.md: 変更なし" : "DESIGN.md: front matter を更新");
  }
}
