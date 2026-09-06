#!/usr/bin/env bun
// DESIGN.md の front matter から assets/ を生成する。`--check` は差分を見つけたら非ゼロで終わる。
//
// **CSS の関数を front matter に置かない理由。**light-dark() は 1 トークン 1 色という
// トークンの型に合わず、@google/design.md の linter も落とす。color-mix() はその Color parser が
// oklab を読めない。どちらもここで組み立てる。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const SKILL = dirname(import.meta.dir);
const DESIGN = join(SKILL, "references/DESIGN.md");
const TOKENS_CSS = join(SKILL, "assets/rabi-tokens.css");
const HEAD_HTML = join(SKILL, "assets/rabi-head.html");

type Typography = {
  fontFamily: string;
  fontSize: string;
  fontWeight?: number;
  lineHeight?: string | number;
  letterSpacing?: string;
};
type Shadow = { offset: string; light?: string; dark?: string; color?: string; inset?: boolean };
type Family = { family: string; weight: string };
/** component が持てるプロパティ。@google/design.md spec が定める。 */
type Component = {
  backgroundColor?: string;
  textColor?: string;
  typography?: string;
  rounded?: string;
  padding?: string;
  size?: string;
  height?: string;
  width?: string;
};
type Design = {
  colors: Record<string, string>;
  typography: Record<string, Typography>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
  components: Record<string, Component>;
  extensions: {
    dark: Record<string, string>;
    fonts: {
      webfont: { origin: string; assets: string; display: string; families: Family[] };
      stack: Record<"font" | "mono", string[]>;
    };
    /** focus の輪郭。部品側に書かず、`:focus-visible` の 1 規則が引く */
    focus: { color: string; width: string; offset: string };
    elevation: Record<string, Shadow>;
    motion: Record<string, string>;
    /** 混ぜて作る色。2 色から一意に決まるので、色トークンにはしない */
    derive: Record<string, { from: string; to: string; keep: number }>;
    layout: { narrow: string };
  };
};

const REF = /^\{([\w-]+)\.([\w.-]+)\}$/;

/** front matter を取り出す。本文の `---` を終端と誤らないよう先頭からしか読まない。 */
function frontMatter(md: string): Design {
  const body = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md)?.[1];
  if (body === undefined) throw new Error(`${DESIGN}: front matter が無い`);
  return parse(body) as Design;
}

/** `{group.name}` を解決する。参照先が更に参照でも辿る。 */
function resolve(d: Design, value: string, seen: string[] = []): string {
  const m = REF.exec(value);
  if (!m) return value;
  const [, group, name] = m;
  if (group === undefined || name === undefined) return value;
  const table = (d as unknown as Record<string, Record<string, unknown>>)[group];
  const next = table?.[name];
  if (typeof next !== "string") throw new Error(`未解決の参照: ${value}`);
  if (seen.includes(value)) throw new Error(`参照が循環している: ${[...seen, value].join(" -> ")}`);
  return resolve(d, next, [...seen, value]);
}

/** 引用せずに書けるのは CSS の識別子だけ。空白・記号・数字始まりは引用する。 */
const quoteFamily = (name: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : `'${name}'`);

const cssStack = (names: string[]) => names.map(quoteFamily).join(", ");

function webfontHref(f: Design["extensions"]["fonts"]): string {
  const { origin, display, families } = f.webfont;
  const q = families.map((x) => `family=${x.family.replace(/ /g, "+")}:wght@${x.weight}`);
  return `${origin}/css2?${q.join("&")}&display=${display}`;
}

/** 組み立てた URL を parse し直し、front matter と一致することを確かめる。 */
function verifyHref(f: Design["extensions"]["fonts"], href: string): void {
  const url = new URL(href);
  const got: Family[] = url.searchParams.getAll("family").map((v) => {
    const [family, spec] = v.split(":");
    return {
      family: (family ?? "").replace(/\+/g, " "),
      weight: spec?.replace(/^wght@/, "") ?? "",
    };
  });
  const want = f.webfont.families;
  const same =
    got.length === want.length &&
    got.every((g, i) => g.family === want[i]?.family && g.weight === want[i]?.weight);
  if (!same) throw new Error(`webfont の URL が families と一致しない: ${href}`);
  if (url.searchParams.get("display") !== f.webfont.display) {
    throw new Error(`webfont の URL の display が一致しない: ${href}`);
  }
}

/** 取り寄せた webfont と typography の family が、スタックへ届いていることを確かめる。 */
function verifyFonts(d: Design): void {
  const f = d.extensions.fonts;
  const stacks = new Set(Object.values(f.stack).flat());
  for (const w of f.webfont.families) {
    if (!stacks.has(w.family)) {
      throw new Error(`webfont の ${w.family} をどのスタックも引いていない`);
    }
  }
  for (const [name, t] of Object.entries(d.typography)) {
    if (!stacks.has(t.fontFamily)) {
      throw new Error(`typography.${name} の ${t.fontFamily} がスタックに無い`);
    }
  }
}

/** 値の形。front matter に CSS の関数を書かせない蓋でもある。 */
const LENGTH = /^\d*\.?\d+(px|em|rem)$/;
/** 負を許すのは字間だけ。大きさ・余白・角丸・切り替え幅に負値は無い。 */
const TRACKING = /^-?\d*\.?\d+(px|em|rem)$/;
const TIME = /^\d*\.?\d+m?s$/;
const HEX = /^#[0-9a-f]{6}$/i;
/** 影の offset。x と y は符号付き、blur と spread は非負。 */
function isOffset(value: string): boolean {
  const parts = value.split(" ");
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((part, i) => {
    if (!/^(0|-?\d*\.?\d+px)$/.test(part)) return false;
    return i < 2 || !part.startsWith("-");
  });
}
const RGB = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*(\d*\.?\d+)\s*)?\)$/;
/** 影の色。空白区切りの rgb() だけ。channel と alpha の範囲まで見る。 */
function isShadowColor(value: string): boolean {
  const m = RGB.exec(value);
  if (!m) return false;
  const channels = [m[1], m[2], m[3]].map(Number);
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return channels.every((c) => c <= 255) && alpha <= 1;
}

/** 重み軸。単一か昇順の範囲。逆順は Google Fonts が返さない。 */
function isWeightAxis(value: string): boolean {
  const m = /^(\d{3})(?:\.\.(\d{3}))?$/.exec(value);
  if (!m) return false;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  return from >= 100 && to <= 1000 && from <= to;
}
const LINE_HEIGHT = /^\d*\.?\d+((px|em|rem))?$/;
const DISPLAY = /^(auto|block|swap|fallback|optional)$/;
/** CSS と URL へそのまま出るので、区切りに使う字を持たせない。 */
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 \-_.]*$/;

/** 生成が読むキーの参照が全て実在することを確かめる。tokensCss は参照を素通しで var() へ写す。 */
function verifyRefs(d: Design): void {
  const groups: Record<string, Record<string, unknown>> = {
    colors: d.colors,
    rounded: d.rounded,
    spacing: d.spacing,
    typography: d.typography,
  };
  const check = (where: string, value: unknown): void => {
    if (typeof value !== "string") return;
    const m = REF.exec(value);
    const group = m?.[1];
    const key = m?.[2];
    if (group === undefined || key === undefined) return;
    if (groups[group]?.[key] === undefined) throw new Error(`未解決の参照: ${value} (${where})`);
  };
  // 参照を持てるのは値が文字列の群だけ。循環は resolve が見る
  for (const [name, value] of Object.entries(d.colors)) {
    check(`colors.${name}`, value);
    if (REF.test(value)) resolve(d, value, [`{seed.${name}}`]);
  }
  for (const [name, value] of Object.entries(d.spacing)) {
    check(`spacing.${name}`, value);
    if (REF.test(value)) resolve(d, value, [`{seed.${name}}`]);
  }
  for (const [name, value] of Object.entries(d.rounded)) check(`rounded.${name}`, value);
  for (const [name, value] of Object.entries(d.extensions.motion)) check(`motion.${name}`, value);
  for (const [name, props] of Object.entries(d.components)) {
    for (const [prop, value] of Object.entries(props)) check(`components.${name}.${prop}`, value);
  }
}

/** component のプロパティごとに、引ける群と literal の形を決める。 */
const COMPONENT_PROPS: Record<string, { group: string; literal: RegExp }> = {
  backgroundColor: { group: "colors", literal: /^(#[0-9a-f]{6}|transparent)$/i },
  textColor: { group: "colors", literal: /^#[0-9a-f]{6}$/i },
  typography: { group: "typography", literal: /^$/ },
  rounded: { group: "rounded", literal: /^\d*\.?\d+(px|em|rem)$/ },
  padding: {
    group: "spacing",
    literal: /^(0|\d*\.?\d+(px|em|rem))( (0|\d*\.?\d+(px|em|rem))){0,3}$/,
  },
  size: { group: "spacing", literal: /^\d*\.?\d+(px|em|rem)$/ },
  height: { group: "spacing", literal: /^\d*\.?\d+(px|em|rem)$/ },
  width: { group: "spacing", literal: /^\d*\.?\d+(px|em|rem)$/ },
};

/** 状態の接尾。基底との差分だけを持ち、この 4 つ以外は作らない。 */
const STATES = ["hover", "active", "selected", "checked"] as const;

/** 差分だけの variant が、基底の無いところに浮いていないことを確かめる。 */
function verifyVariants(d: Design): void {
  for (const name of Object.keys(d.components)) {
    const state = STATES.find((s) => name.endsWith(`-${s}`));
    if (state === undefined) continue;
    const baseName = name.slice(0, -(state.length + 1));
    const base = d.components[baseName];
    if (base === undefined) throw new Error(`components.${name} の基底 ${baseName} が無い`);
    const props = Object.entries(d.components[name] ?? {});
    const diff = props.filter(([prop, value]) => base[prop as keyof Component] !== value);
    if (diff.length === 0) throw new Error(`components.${name} が基底と同じで、差分が無い`);
    if (diff.length !== props.length) {
      const same = props.filter(([prop, value]) => base[prop as keyof Component] === value);
      throw new Error(
        `components.${name} が基底と同じ値を写している: ${same.map(([p]) => p).join(", ")}`,
      );
    }
  }
}

/** component が別の群を引いたら落とす。角丸に色を入れても公式 linter は通る。 */
function verifyComponents(d: Design): void {
  for (const [name, props] of Object.entries(d.components)) {
    for (const [prop, value] of Object.entries(props)) {
      if (value === undefined) continue;
      const rule = COMPONENT_PROPS[prop];
      if (rule === undefined) throw new Error(`components.${name} の ${prop} は spec に無い`);
      const group = REF.exec(value)?.[1];
      const ok = group === undefined ? rule.literal.test(value) : group === rule.group;
      if (!ok) throw new Error(`components.${name}.${prop} が ${rule.group} でない: ${value}`);
    }
  }
}

/** トークン名は `--rabi-<キー>` としてそのまま CSS へ出る。区切りの字を持たせない。 */
const TOKEN_NAME = /^[a-z][a-z0-9_-]*$/;

function verifyNames(d: Design): void {
  const groups: Record<string, object> = {
    colors: d.colors,
    rounded: d.rounded,
    spacing: d.spacing,
    typography: d.typography,
    "extensions.dark": d.extensions.dark,
    "extensions.elevation": d.extensions.elevation,
    "extensions.motion": d.extensions.motion,
    "extensions.derive": d.extensions.derive,
    components: d.components,
  };
  for (const [group, table] of Object.entries(groups)) {
    for (const name of Object.keys(table)) {
      if (!TOKEN_NAME.test(name)) throw new Error(`${group} のキーが名前になっていない: ${name}`);
    }
  }
}

/** 生成が名指しで読むキーが在ることを確かめる。欠けると undefined を CSS へ書く。 */
function verifyRequired(d: Design): void {
  // 群そのものが欠けると、以降の検査が読む前に TypeError で落ちる
  const groups: [string, unknown][] = [
    ["colors", d.colors],
    ["typography", d.typography],
    ["rounded", d.rounded],
    ["spacing", d.spacing],
    ["components", d.components],
    ["extensions", d.extensions],
  ];
  // 配列だとキーが 0 / 1 になり、空だとトークンが黙って消える
  const record = (path: string, table: unknown): void => {
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      throw new Error(`生成が読む ${path} が無い`);
    }
    if (Object.keys(table).length === 0) throw new Error(`生成が読む ${path} が空`);
  };
  for (const [path, table] of groups) record(path, table);
  const ext: [string, unknown][] = [
    ["extensions.dark", d.extensions.dark],
    ["extensions.fonts", d.extensions.fonts],
    ["extensions.elevation", d.extensions.elevation],
    ["extensions.motion", d.extensions.motion],
    ["extensions.focus", d.extensions.focus],
    ["extensions.derive", d.extensions.derive],
    ["extensions.layout", d.extensions.layout],
  ];
  for (const [path, table] of ext) record(path, table);
  const required: [string, unknown][] = [
    ["colors.accent", d.colors["accent"]],
    ["colors.shade", d.colors["shade"]],
    ["spacing.pad-x", d.spacing["pad-x"]],
    ["spacing.pad-x-narrow", d.spacing["pad-x-narrow"]],
    ["extensions.layout.narrow", d.extensions.layout.narrow],
    ["extensions.fonts.stack.font", d.extensions.fonts.stack.font],
    ["extensions.fonts.stack.mono", d.extensions.fonts.stack.mono],
  ];
  for (const [path, value] of required) {
    if (value === undefined) throw new Error(`生成が読む ${path} が無い`);
  }
}

/** 値の形を見る。CSS へ出す前に落とす。 */
function verifyShapes(d: Design): void {
  const bad = (path: string, value: unknown) => new Error(`${path} の形が違う: ${String(value)}`);
  // 文字列も iterable なので、配列であることを先に見る。でないと 1 文字ずつ回る
  const list = (path: string, value: unknown): unknown[] => {
    if (!Array.isArray(value)) throw bad(path, value);
    return value;
  };
  // 参照は解決してから形を見る。解決先が別の型でも通ってしまう
  for (const [name, value] of Object.entries(d.colors)) {
    if (!HEX.test(resolve(d, value))) throw bad(`colors.${name}`, value);
  }
  for (const [name, value] of Object.entries(d.extensions.dark)) {
    if (!HEX.test(value)) throw bad(`extensions.dark.${name}`, value);
  }
  for (const [name, value] of Object.entries(d.rounded)) {
    if (!LENGTH.test(resolve(d, value))) throw bad(`rounded.${name}`, value);
  }
  for (const [name, value] of Object.entries(d.spacing)) {
    if (!LENGTH.test(resolve(d, value))) throw bad(`spacing.${name}`, value);
  }
  for (const [name, value] of Object.entries(d.extensions.motion)) {
    if (!TIME.test(value)) throw bad(`motion.${name}`, value);
  }
  // color-mix の 2 色と割合。0 と 100 は混ぜる意味が無いので端を含めない
  for (const [name, mix] of Object.entries(d.extensions.derive)) {
    const path = `extensions.derive.${name}`;
    if (mix === null || typeof mix !== "object") throw bad(path, mix);
    if (typeof mix.keep !== "number" || !(mix.keep > 0 && mix.keep < 100))
      throw bad(path, mix.keep);
    for (const key of ["from", "to"] as const) {
      const color = mix[key];
      // transparent だけは色トークンで**ない**。重ねる先の面が地を決める
      if (color !== "transparent" && d.colors[color] === undefined) throw bad(path, color);
    }
  }
  if (!LENGTH.test(d.extensions.layout.narrow)) {
    throw bad("extensions.layout.narrow", d.extensions.layout.narrow);
  }
  // https の origin だけ。path も query も持たせない（href の組み立てが壊れる）
  for (const key of ["origin", "assets"] as const) {
    const value = d.extensions.fonts.webfont[key];
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw bad(`extensions.fonts.webfont.${key}`, value);
    }
    if (url.protocol !== "https:" || url.origin !== value) {
      throw bad(`extensions.fonts.webfont.${key}`, value);
    }
  }
  for (const [name, t] of Object.entries(d.typography)) {
    if (!LENGTH.test(t.fontSize)) throw bad(`typography.${name}.fontSize`, t.fontSize);
    if (t.letterSpacing !== undefined && !TRACKING.test(t.letterSpacing)) {
      throw bad(`typography.${name}.letterSpacing`, t.letterSpacing);
    }
    if (
      t.fontWeight !== undefined &&
      !(Number.isInteger(t.fontWeight) && t.fontWeight >= 1 && t.fontWeight <= 1000)
    ) {
      throw bad(`typography.${name}.fontWeight`, t.fontWeight);
    }
    if (t.lineHeight !== undefined && !LINE_HEIGHT.test(String(t.lineHeight))) {
      throw bad(`typography.${name}.lineHeight`, t.lineHeight);
    }
    if (!FAMILY.test(t.fontFamily)) throw bad(`typography.${name}.fontFamily`, t.fontFamily);
  }
  const focus = d.extensions.focus;
  if (d.colors[focus.color] === undefined) throw bad("extensions.focus.color", focus.color);
  for (const key of ["width", "offset"] as const) {
    if (!LENGTH.test(focus[key])) throw bad(`extensions.focus.${key}`, focus[key]);
  }
  const f = d.extensions.fonts;
  for (const [key, names] of Object.entries(f.stack)) {
    const path = `extensions.fonts.stack.${key}`;
    const items = list(path, names);
    if (items.length === 0) throw new Error(`${path} が空`);
    for (const name of items) {
      if (typeof name !== "string" || !FAMILY.test(name)) throw bad(path, name);
    }
  }
  const families = list("extensions.fonts.webfont.families", f.webfont.families);
  if (families.length === 0) throw new Error("extensions.fonts.webfont.families が空");
  for (const w of f.webfont.families) {
    if (typeof w?.family !== "string" || !FAMILY.test(w.family)) {
      throw bad("extensions.fonts.webfont.families", w?.family);
    }
    if (typeof w.weight !== "string" || !isWeightAxis(w.weight)) {
      throw bad("extensions.fonts.webfont.families", w.weight);
    }
  }
  if (!DISPLAY.test(f.webfont.display)) {
    throw bad("extensions.fonts.webfont.display", f.webfont.display);
  }
  for (const [name, sh] of Object.entries(d.extensions.elevation)) {
    if (typeof sh.offset !== "string" || !isOffset(sh.offset)) {
      throw bad(`elevation.${name}.offset`, sh.offset);
    }
    const invariant = sh.color !== undefined;
    const paired = sh.light !== undefined && sh.dark !== undefined;
    // color（テーマ不変）か light + dark の片方だけ。両方でも片欠けでも light-dark() が壊れる
    if (invariant === paired) {
      throw new Error(`elevation.${name} は color か light + dark のどちらか一方を持つ`);
    }
    if (sh.inset !== undefined && sh.inset !== true) throw bad(`elevation.${name}.inset`, sh.inset);
    for (const [key, v] of Object.entries({ color: sh.color, light: sh.light, dark: sh.dark })) {
      if (v !== undefined && !isShadowColor(v)) throw bad(`elevation.${name}.${key}`, v);
    }
  }
}

/** dark が colors に無い役を持っていたら、light-dark() の片割れが浮く。 */
function verifyDark(d: Design): void {
  for (const name of Object.keys(d.extensions.dark)) {
    const light = d.colors[name];
    if (light === undefined) throw new Error(`extensions.dark の ${name} が colors に無い`);
    // 別名は CSS に出ないので、dark を付けても届かない
    if (REF.test(light)) throw new Error(`extensions.dark の ${name} は別名で、CSS に出ない`);
  }
}

function tokensCss(d: Design): string {
  const { dark, fonts, elevation, motion, layout, focus } = d.extensions;
  const out: string[] = [];
  const push = (s: string) => out.push(s);

  push("/* Rabi design tokens。../references/DESIGN.md から生成する。手で直さない。 */");
  push("");
  push(":root {");
  push("  color-scheme: light dark;");

  for (const [name, value] of Object.entries(d.colors)) {
    if (REF.test(value)) continue; // 別名は CSS に出さない
    const d2 = dark[name];
    push(`  --rabi-${name}: ${d2 ? `light-dark(${value}, ${d2})` : value};`);
  }
  for (const [name, { from, to, keep }] of Object.entries(d.extensions.derive)) {
    const target = to === "transparent" ? "transparent" : `var(--rabi-${to})`;
    push(`  --rabi-${name}: color-mix(in oklab, var(--rabi-${from}) ${keep}%, ${target});`);
  }

  push(`  --rabi-focus: var(--rabi-${focus.color});`);
  push(`  --rabi-focus-width: ${focus.width};`);
  push(`  --rabi-focus-offset: ${focus.offset};`);

  for (const [name, s] of Object.entries(elevation)) {
    const color = s.color ?? `light-dark(${s.light}, ${s.dark})`;
    push(`  --rabi-${name}: ${s.inset === true ? "inset " : ""}${s.offset} ${color};`);
  }

  // 参照は var() へ写す。値を畳むと、参照した先を変えても写しが古いままになる
  const dimension = (value: string) => {
    const key = REF.exec(value)?.[2];
    return key === undefined ? value : `var(--rabi-${key})`;
  };
  for (const [name, value] of Object.entries(d.rounded)) {
    push(`  --rabi-${name}: ${dimension(value)};`);
  }
  for (const [name, value] of Object.entries(d.spacing)) {
    push(`  --rabi-${name}: ${dimension(value)};`);
  }

  // どのスタックがその family を持つかで書体が決まる。fontFamily を生成物へ届かせる
  const stackOf = (family: string): string => {
    const key = Object.entries(fonts.stack).find(([, names]) => names.includes(family))?.[0];
    if (key === undefined) throw new Error(`${family} をどのスタックも直に持っていない`);
    return key === "font" ? "--rabi-font" : `--rabi-${key}`;
  };
  for (const [name, t] of Object.entries(d.typography)) {
    push(`  --rabi-ff-${name}: var(${stackOf(t.fontFamily)});`);
    push(`  --rabi-t-${name}: ${t.fontSize};`);
    if (t.fontWeight !== undefined) push(`  --rabi-fw-${name}: ${t.fontWeight};`);
    if (t.lineHeight !== undefined) push(`  --rabi-lh-${name}: ${t.lineHeight};`);
    if (t.letterSpacing !== undefined) push(`  --rabi-ls-${name}: ${t.letterSpacing};`);
  }

  for (const [name, value] of Object.entries(motion)) push(`  --rabi-${name}: ${value};`);

  push(`  --rabi-font: ${cssStack(fonts.stack.font)};`);
  push(`  --rabi-mono: ${cssStack(fonts.stack.mono)};`);
  push("}");
  // 群をまたいで同じ --rabi-* を出すと、後勝ちで静かに上書きされる
  const emitted = out.flatMap((line) => /^ {2}(--rabi-[\w-]+):/.exec(line)?.[1] ?? []);
  const dup = emitted.filter((name, i) => emitted.indexOf(name) !== i);
  if (dup.length > 0) throw new Error(`名前が衝突している: ${[...new Set(dup)].join(", ")}`);
  push("");
  push("/* 明示の切り替え。既定は OS に従う。 */");
  push(":root[data-theme='light'] {");
  push("  color-scheme: light;");
  push("}");
  push(":root[data-theme='dark'] {");
  push("  color-scheme: dark;");
  push("}");
  push("");
  push("/* @media は変数を取らないので、切り替え幅はここに出る。 */");
  push(`@media (max-width: ${layout["narrow"]}) {`);
  push("  :root {");
  push("    --rabi-pad-x: var(--rabi-pad-x-narrow);");
  push("  }");
  push("}");
  return `${out.join("\n")}\n`;
}

function headHtml(d: Design, href: string): string {
  const { origin, assets } = d.extensions.fonts.webfont;
  return [
    "<!-- Rabi のフォント読み込み。../references/DESIGN.md から生成する。手で直さない。 -->",
    `<link rel="preconnect" href="${origin}" />`,
    `<link rel="preconnect" href="${assets}" crossorigin />`,
    `<link rel="stylesheet" href="${href}" />`,
    "",
  ].join("\n");
}

export function generate(root = SKILL): { path: string; content: string }[] {
  const design = join(root, "references/DESIGN.md");
  const d = frontMatter(readFileSync(design, "utf8"));
  verifyRequired(d);
  verifyNames(d);
  verifyRefs(d);
  verifyShapes(d);
  verifyComponents(d);
  verifyVariants(d);
  verifyDark(d);
  verifyFonts(d);
  const href = webfontHref(d.extensions.fonts);
  verifyHref(d.extensions.fonts, href);
  return [
    { path: join(root, "assets/rabi-tokens.css"), content: tokensCss(d) },
    { path: join(root, "assets/rabi-head.html"), content: headHtml(d, href) },
  ];
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const root = SKILL;
  let stale = 0;
  for (const { path, content } of generate(root)) {
    if (!check) {
      writeFileSync(path, content);
      continue;
    }
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== content) {
      console.error(`stale: ${path}`);
      stale += 1;
    }
  }
  if (check && stale > 0) {
    console.error(`${stale} 件が DESIGN.md と食い違う。bun ${import.meta.path} で作り直す。`);
    process.exit(1);
  }
}

export { DESIGN, HEAD_HTML, TOKENS_CSS };
