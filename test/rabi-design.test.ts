// rabi-design の SSOT（DESIGN.md の front matter）と、そこから作る写しを bun test から検査する。
//
// **通ることは何も証明しない**ので、front matter と写しを壊した複製で落ちることまで実測する。

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { parse } from "yaml";

import { lint } from "@google/design.md/linter";

const SKILL = join(import.meta.dir, "../agents/skills/rabi-design");
const DESIGN_MD = readFileSync(join(SKILL, "references/DESIGN.md"), "utf8");

type Shadow = { offset: string; light?: string; dark?: string; color?: string };
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
  typography: Record<string, { fontFamily: string; fontSize: string }>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
  components: Record<string, Component>;
  extensions: {
    dark: Record<string, string>;
    fonts: {
      webfont: { origin: string; families: { family: string; weight: string }[] };
      stack: Record<string, string[]>;
    };
    focus: { color: string; width: string; offset: string };
    elevation: Record<string, Shadow>;
    motion: Record<string, string>;
    derive: Record<string, { from: string; to: string; keep: number }>;
    layout: Record<string, string>;
  };
};

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** front matter の中身。本文の `---` を終端と誤らないよう先頭からしか読まない。 */
function fmText(md: string): string {
  const body = FRONT_MATTER.exec(md)?.[1];
  if (body === undefined) throw new Error("front matter が無い");
  return body;
}

const frontMatter = (md: string): Design => parse(fmText(md)) as Design;

const design = frontMatter(DESIGN_MD);

/** skill ごと temp へ複製する。script は自分の位置から `../references` と `../assets` を引く。 */
async function withSandbox(body: (dir: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "rabi-design-"));
  const dir = join(root, "rabi-design");
  cpSync(SKILL, dir, { recursive: true });
  try {
    await body(dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const runCheck = async (dir: string) => {
  const p = Bun.spawn(["bun", join(dir, "scripts/gen-css.ts"), "--check"], {
    // cwd を skill の外に置く。path を cwd 相対で書き直したら落ちる
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, output: `${out}${err}` };
};

const edit = (dir: string, replace: (fm: string) => string) => {
  const path = join(dir, "references/DESIGN.md");
  const md = readFileSync(path, "utf8");
  const fm = fmText(md);
  writeFileSync(path, md.replace(fm, replace(fm)));
};

// ============ 公式 linter ============

test("DESIGN.md が design.md spec の error を持たない", () => {
  const report = lint(DESIGN_MD);
  const errors = report.findings.filter((f) => f.severity === "error");
  expect(errors.map((f) => `${f.path}: ${f.message}`)).toEqual([]);
});

test("残す warning は既知の集合だけ。新しい warning が出たら落ちる", () => {
  const report = lint(DESIGN_MD);
  const got = report.findings
    .filter((f) => f.severity === "warning")
    .map((f) => `${f.rule}:${f.path}`)
    .sort();
  // 枠線にしか出ない色は component が引けない（許可プロパティに borderColor が無い）。
  // extensions は spec のスキーマ外で、export に載らないことを承知で置いている。
  expect(got).toEqual([
    // switch の knob は塗りの差で読ませない。形を出すのは枠と内側の影
    "contrast-ratio:components.switch",
    "orphaned-tokens:colors.divider",
    "orphaned-tokens:colors.line",
    "orphaned-tokens:colors.shade",
    "token-like-ignored:extensions",
  ]);
});

test("セクションが spec の順で並ぶ", () => {
  const heads = [...DESIGN_MD.matchAll(/^## (.+)$/gm)].map((m) => (m[1] ?? "").trim());
  expect(heads).toEqual([
    "Overview",
    "Colors",
    "Typography",
    "Layout",
    "Elevation & Depth",
    "Shapes",
    "Components",
    "Do's and Don'ts",
  ]);
});

// ============ front matter が CSS の関数を持たない ============

const cssFunctionLines = (md: string): string[] =>
  fmText(md)
    .split("\n")
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /\b(light-dark|color-mix|clamp|calc|var)\s*\(/.test(line))
    .map(({ line, no }) => `${no}: ${line.trim()}`);

test("front matter に CSS の関数が入っていない", () => {
  expect(cssFunctionLines(DESIGN_MD)).toEqual([]);
});

test("CSS の関数の検査が、front matter に足したら落ちる", () => {
  const broken = DESIGN_MD.replace('accent: "#dc143c"', 'accent: "light-dark(#dc143c, #ff3b5c)"');
  expect(cssFunctionLines(broken)).not.toEqual([]);
});

// ============ 散文が front matter を指したまま古くならない ============

/** 散文の `` `x` `` のうち、トークン名の形をしているのに front matter に無いものを返す。 */
function danglingTokens(md: string): string[] {
  const d = frontMatter(md);
  const known = new Set([
    ...Object.keys(d.colors),
    ...Object.keys(d.typography),
    ...Object.keys(d.rounded),
    ...Object.keys(d.spacing),
    ...Object.keys(d.components),
    ...Object.keys(d.extensions.elevation),
    ...Object.keys(d.extensions.motion),
    ...Object.keys(d.extensions.derive),
  ]);
  const body = md.slice(md.indexOf("\n## Overview"));
  const seen = [...body.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1] ?? "");
  return [...new Set(seen)].filter((n) => !known.has(n)).sort();
}

/**
 * 散文に出る、トークンでは**ない**語。CSS のプロパティ・値・要素名。
 *
 * **固定する。**トークンを消すとここに増えて落ちる。語を足したときも落ちるので、
 * 「トークンのつもりで書いた語が front matter に無い」を見逃さない。
 */
const NON_TOKEN_WORDS = [
  "background",
  "colors",
  "dark",
  "data-theme",
  "focus",
  "focus-offset",
  "focus-width",
  "font-weight",
  "ghost",
  "h2",
  "h3",
  "letter-spacing",
  "light",
  "linear-gradient",
  "lucide-static",
  "mask-image",
  "max",
  "min",
  "multiply",
  "narrow",
  "outline",
  "rect",
  "screen",
  "src",
  "stitch",
  "tabular-nums",
  "transparent",
];

test("散文が指すトークンが front matter に在る", () => {
  expect(danglingTokens(DESIGN_MD)).toEqual(NON_TOKEN_WORDS);
});

test("トークンを消すと、散文の検査が落ちる", () => {
  const broken = DESIGN_MD.replace(/^ {2}prose-h2:\n(?: {4}.+\n)+/m, "");
  expect(danglingTokens(broken)).not.toEqual(NON_TOKEN_WORDS);
  expect(danglingTokens(broken)).toContain("prose-h2");
});

// ============ 写しが SSOT と一致する ============

test("assets が front matter と一致する", async () => {
  expect((await runCheck(SKILL)).code).toBe(0);
});

test("生成 CSS を書き換えると --check が落ちる", async () => {
  await withSandbox(async (dir) => {
    const path = join(dir, "assets/rabi-tokens.css");
    writeFileSync(path, readFileSync(path, "utf8").replace("#dc143c", "#ff0000"));
    const { code, output } = await runCheck(dir);
    expect(code).not.toBe(0);
    expect(output).toContain("rabi-tokens.css");
  });
});

test("生成 HTML を書き換えると --check が落ちる", async () => {
  await withSandbox(async (dir) => {
    const path = join(dir, "assets/rabi-head.html");
    writeFileSync(path, readFileSync(path, "utf8").replace("display=swap", "display=block"));
    const { code, output } = await runCheck(dir);
    expect(code).not.toBe(0);
    expect(output).toContain("rabi-head.html");
  });
});

test("front matter を変えると --check が落ちる", async () => {
  await withSandbox(async (dir) => {
    edit(dir, (fm) => fm.replace('accent: "#dc143c"', 'accent: "#00ff00"'));
    expect((await runCheck(dir)).code).not.toBe(0);
  });
});

// ============ 生成器が front matter の壊れを見つける ============

const breaks: [string, (fm: string) => string, RegExp][] = [
  [
    "dark に colors 外の役",
    (fm) => fm.replace('    ground: "#111111"', '    ground: "#111111"\n    nosuch: "#000000"'),
    /extensions\.dark の nosuch/,
  ],
  [
    "component が無い色を引く",
    (fm) =>
      fm.replace(
        '    backgroundColor: "{colors.accent}"\n    textColor: "{colors.on-accent}"\n    typography: "{typography.body}"',
        '    backgroundColor: "{colors.nosuch}"\n    textColor: "{colors.on-accent}"\n    typography: "{typography.body}"',
      ),
    /components\.button-primary/,
  ],
  [
    "focus が実在しない色を引く",
    (fm) => fm.replace("    color: accent", "    color: nosuch"),
    /extensions\.focus\.color の形が違う/,
  ],
  [
    "focus の幅が Dimension でない",
    (fm) => fm.replace("    width: 2px", "    width: thick"),
    /extensions\.focus\.width の形が違う/,
  ],
  [
    "focus が front matter から消える",
    (fm) => fm.replace(/  focus:\n(    .+\n)+/, ""),
    /生成が読む extensions\.focus が無い/,
  ],
  [
    "webfont がスタックに無い family を読む",
    (fm) => fm.replace("{ family: Inter, weight", "{ family: Nosuch, weight"),
    /webfont の Nosuch/,
  ],
  [
    "typography が未知の family を指す",
    (fm) => fm.replace("    fontFamily: Roboto Mono", "    fontFamily: Nosuch"),
    /Nosuch がスタックに無い/,
  ],
  [
    "spacing の参照が解決しない",
    (fm) => fm.replace('pad-x: "{spacing.gap-12}"', 'pad-x: "{spacing.nosuch}"'),
    /未解決の参照: \{spacing\.nosuch\} \(spacing\.pad-x\)/,
  ],
  [
    "rounded の参照が解決しない",
    (fm) => fm.replace("  r-sm: 6px", '  r-sm: "{spacing.nosuch}"'),
    /未解決の参照: \{spacing\.nosuch\} \(rounded\.r-sm\)/,
  ],
  [
    "生成が読む spacing のキーが消える",
    (fm) => fm.replace('  pad-x-narrow: "{spacing.gap-6}"\n', ""),
    /生成が読む spacing\.pad-x-narrow が無い/,
  ],
  [
    "生成が読む色が消える",
    (fm) => fm.replace('  shade: "#000000"\n', ""),
    /生成が読む colors\.shade が無い/,
  ],
  [
    "色が hex でない",
    (fm) => fm.replace('  ground: "#f1f1f1"', '  ground: "light-dark(#f1f1f1, #111111)"'),
    /colors\.ground の形が違う/,
  ],
  [
    "余白が Dimension でない",
    (fm) => fm.replace("  gap-4: 16px", "  gap-4: 1vw"),
    /spacing\.gap-4 の形が違う/,
  ],
  [
    "motion が時間でない",
    (fm) => fm.replace("    motion: 0.1s", "    motion: fast"),
    /motion\.motion の形が違う/,
  ],
  [
    "内側の影の印が true でない",
    (fm) => fm.replace("      inset: true", "      inset: maybe"),
    /elevation\.e-inset\.inset の形が違う/,
  ],
  [
    "影の light と dark が片欠けする",
    (fm) => fm.replace("      dark: rgb(0 0 0 / 0.49)\n", ""),
    /elevation\.e1 は color か light \+ dark/,
  ],
  [
    "影が color と light を両方持つ",
    (fm) =>
      fm.replace(
        "      light: rgb(34 34 34 / 0.07)",
        "      color: rgb(0 0 0 / 0.1)\n      light: rgb(34 34 34 / 0.07)",
      ),
    /elevation\.e1 は color か light \+ dark/,
  ],
  [
    "別名の色に dark を持たせる",
    (fm) => fm.replace('    ground: "#111111"', '    primary: "#ff0000"\n    ground: "#111111"'),
    /extensions\.dark の primary は別名/,
  ],
  [
    "webfont の origin が path を持つ",
    (fm) =>
      fm.replace(
        "      origin: https://fonts.googleapis.com",
        "      origin: https://fonts.googleapis.com/css2",
      ),
    /extensions\.fonts\.webfont\.origin の形が違う/,
  ],
  [
    "rounded が参照でも var() へ写る",
    (fm) => fm.replace("  r-md: 16px", '  r-md: "{spacing.gap-4}"'),
    /stale:/,
  ],
  [
    "font stack が空",
    (fm) => fm.replace(/      mono:\n(        - .+\n)+/, "      mono: []\n"),
    /extensions\.fonts\.stack\.mono が空/,
  ],
  [
    "family に区切りの字が混ざる",
    (fm) => fm.replace("        - Menlo", "        - Menlo; }"),
    /extensions\.fonts\.stack\.mono の形が違う/,
  ],
  [
    "stack が配列でない",
    (fm) => fm.replace(/      mono:\n(        - .+\n)+/, "      mono: Menlo\n"),
    /extensions\.fonts\.stack\.mono の形が違う/,
  ],
  [
    "角丸が色を参照する",
    (fm) => fm.replace("  r-sm: 6px", '  r-sm: "{colors.accent}"'),
    /rounded\.r-sm の形が違う/,
  ],
  [
    "群をまたいで名前が衝突する",
    (fm) => fm.replace("  gap-1: 4px", "  accent: 4px\n  gap-1: 4px"),
    /名前が衝突している: --rabi-accent/,
  ],
  [
    "webfont の family を別名の local() でしか引かない",
    (fm) => fm.replace("        - Roboto Mono\n", ""),
    /webfont の Roboto Mono をどのスタックも引いていない/,
  ],
  [
    "variant が基底と同じ値を写す",
    (fm) =>
      fm.replace(
        '  chip-selected:\n    textColor: "{colors.accent-text}"',
        '  chip-selected:\n    backgroundColor: "{colors.paper}"\n    textColor: "{colors.accent-text}"',
      ),
    /components\.chip-selected が基底と同じ値を写している: backgroundColor/,
  ],
  [
    "variant に差分が無い",
    (fm) =>
      fm.replace(
        '  chip-selected:\n    textColor: "{colors.accent-text}"',
        '  chip-selected:\n    backgroundColor: "{colors.paper}"',
      ),
    /components\.chip-selected が基底と同じで、差分が無い/,
  ],
  [
    "書体が変わると写しが古くなる",
    (fm) => fm.replace("  meta:\n    fontFamily: Roboto Mono", "  meta:\n    fontFamily: Inter"),
    /stale:/,
  ],
  [
    "状態の variant に基底が無い",
    (fm) => fm.replace("  chip-selected:", "  chip-nosuch-selected:"),
    /components\.chip-nosuch-selected の基底 chip-nosuch が無い/,
  ],
  [
    "component の角丸が色を引く",
    (fm) =>
      fm.replace(
        '    rounded: "{rounded.r-sm}"\n    size: 16px',
        '    rounded: "{colors.accent}"\n    size: 16px',
      ),
    /components\.checkbox\.rounded が rounded でない/,
  ],
  [
    "component が spec に無いプロパティを持つ",
    (fm) =>
      fm.replace(
        "  card:\n    backgroundColor",
        '  card:\n    borderColor: "{colors.divider}"\n    backgroundColor',
      ),
    /components\.card の borderColor は spec に無い/,
  ],
  [
    "群が配列になる",
    (fm) => fm.replace(/  derive:\n(    .+\n)+/, "  derive: [88, 76]\n"),
    /生成が読む extensions\.derive が無い/,
  ],
  [
    "群が空になる",
    (fm) => fm.replace(/  motion:\n(    .+\n)+/, "  motion: {}\n"),
    /生成が読む extensions\.motion が空/,
  ],
  [
    "トークン名に区切りの字が混ざる",
    (fm) => fm.replace("  gap-1: 4px", "  gap-1;color:red: 4px"),
    /spacing のキーが名前になっていない/,
  ],
  [
    "派生が実在しない色を混ぜる",
    (fm) =>
      fm.replace(
        "    accent-hover: { from: accent, to: shade, keep: 88 }",
        "    accent-hover: { from: nosuch, to: shade, keep: 88 }",
      ),
    /extensions\.derive\.accent-hover の形が違う: nosuch/,
  ],
  [
    "派生の割合が数でない",
    (fm) =>
      fm.replace(
        "    accent-hover: { from: accent, to: shade, keep: 88 }",
        '    accent-hover: { from: accent, to: shade, keep: "oops" }',
      ),
    /extensions\.derive\.accent-hover の形が違う/,
  ],
  [
    "派生の割合が範囲外",
    (fm) =>
      fm.replace(
        "    accent-hover: { from: accent, to: shade, keep: 88 }",
        "    accent-hover: { from: accent, to: shade, keep: 120 }",
      ),
    /extensions\.derive\.accent-hover の形が違う/,
  ],
  [
    "派生の割合が front matter から消える",
    (fm) => fm.replace(/  derive:\n(    .+\n)+/, ""),
    /生成が読む extensions\.derive が無い/,
  ],
  [
    "影の blur が負",
    (fm) => fm.replace("      offset: 0 1px 3px", "      offset: 0 1px -3px"),
    /elevation\.e1\.offset の形が違う/,
  ],
  ["余白が負", (fm) => fm.replace("  gap-2: 8px", "  gap-2: -8px"), /spacing\.gap-2 の形が違う/],
  [
    "重み軸が逆順",
    (fm) =>
      fm.replace(
        'weight: "400..700" }\n        - { family: Roboto',
        'weight: "700..400" }\n        - { family: Roboto',
      ),
    /extensions\.fonts\.webfont\.families の形が違う/,
  ],
  [
    "影の色の channel が範囲外",
    (fm) => fm.replace("      dark: rgb(0 0 0 / 0.49)", "      dark: rgb(300 0 0 / 0.49)"),
    /elevation\.e1\.dark の形が違う/,
  ],
  [
    "影の色の alpha が範囲外",
    (fm) => fm.replace("      color: rgb(88 6 22 / 0.18)", "      color: rgb(88 6 22 / 1.8)"),
    /elevation\.e1-accent\.color の形が違う/,
  ],
  [
    "webfont の display が CSS の値でない",
    (fm) => fm.replace("      display: swap", "      display: nosuch"),
    /extensions\.fonts\.webfont\.display の形が違う/,
  ],
  [
    "webfont の重み軸が壊れる",
    (fm) =>
      fm.replace(
        'weight: "400..700" }\n        - { family: Roboto',
        'weight: "bold" }\n        - { family: Roboto',
      ),
    /extensions\.fonts\.webfont\.families の形が違う/,
  ],
  [
    "fontWeight が数でない",
    (fm) =>
      fm.replace(
        "    fontWeight: 600\n    lineHeight: 1.4\n  prose:",
        "    fontWeight: 6000\n    lineHeight: 1.4\n  prose:",
      ),
    /typography\.subheading\.fontWeight の形が違う/,
  ],
  [
    "lineHeight が数でも Dimension でもない",
    (fm) => fm.replace("    lineHeight: 1.5\n", "    lineHeight: normal\n"),
    /typography\.body\.lineHeight の形が違う/,
  ],
  [
    "webfont の assets が https でない",
    (fm) =>
      fm.replace(
        "      assets: https://fonts.gstatic.com",
        "      assets: http://fonts.gstatic.com",
      ),
    /extensions\.fonts\.webfont\.assets の形が違う/,
  ],
];

for (const [name, mutate, expected] of breaks) {
  test(`生成器が落ちる: ${name}`, async () => {
    await withSandbox(async (dir) => {
      edit(dir, mutate);
      const { code, output } = await runCheck(dir);
      expect(code).not.toBe(0);
      expect(output).toMatch(expected);
    });
  });
}

// ============ 両テーマのコントラスト ============

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const body = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (body === undefined) throw new Error(`hex ではない: ${hex}`);
  const ch = (i: number) => channel(parseInt(body.slice(i, i + 2), 16) / 255);
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

const ratio = (a: string, b: string) => {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const COLOR_REF = /^\{colors\.([\w-]+)\}$/;

/** テーマごとの実値。dark に無い役はテーマ不変。 */
function value(d: Design, name: string, theme: "light" | "dark"): string {
  const key = COLOR_REF.exec(name)?.[1] ?? name;
  const light = d.colors[key];
  if (light === undefined) throw new Error(`未知の色: ${name}`);
  const alias = COLOR_REF.exec(light)?.[1];
  if (alias !== undefined) return value(d, alias, theme);
  return theme === "dark" ? (d.extensions.dark[key] ?? light) : light;
}

/**
 * component の顔ぶれ。
 *
 * **静かに減らせないよう固定する。**フィルタだけだと、消えた component が黙って検査から外れる。
 */
const COMPONENTS = [
  "badge-accent",
  "badge-ink",
  "badge-on-accent",
  "badge-outline",
  "board",
  "button-ghost",
  "button-ghost-hover",
  "button-on-accent",
  "button-outline",
  "button-primary",
  "caption",
  "card",
  "checkbox",
  "checkbox-checked",
  "chip",
  "chip-selected",
  "code-bar",
  "code-block",
  "cta-band",
  "field-label",
  "footer",
  "input",
  "menu",
  "menu-item",
  "menu-item-hover",
  "note-box",
  "page-title",
  "prose-body",
  "radio",
  "radio-checked",
  "range",
  "range-thumb",
  "range-track",
  "select",
  "sticky",
  "switch",
  "switch-checked",
  "table-cell",
  "table-header",
  "textarea",
  "tooltip",
] as const;

/**
 * 文字ではない要素と、その隣に来る地。WCAG は 3:1 まで（1.4.11）。
 *
 * 印の色は component から取る。何の上に載るかだけは component が持てないので、ここで宣言する。
 * `prop` は印を表すプロパティ。
 */
const NON_TEXT: { name: string; prop: "backgroundColor" | "textColor"; on: string }[] = [
  // 選択後の地が紙から立つか
  { name: "checkbox-checked", prop: "backgroundColor", on: "paper" },
  { name: "switch-checked", prop: "backgroundColor", on: "paper" },
  { name: "range-thumb", prop: "backgroundColor", on: "paper" },
  // 印そのものが、その部品の地から立つか。地は component から取る
  { name: "checkbox-checked", prop: "textColor", on: "self" },
  { name: "switch-checked", prop: "textColor", on: "self" },
  { name: "radio-checked", prop: "textColor", on: "self" },
];

/**
 * `textColor` が文字では**なく**形を指す component。文字の 4.5:1 も、印の 3:1 も当てない。
 *
 * `switch` の knob は塗りの差で読ませ**ない**。形を出すのは枠と内側の影。
 */
const SHAPE_ONLY = new Set(["switch"]);

/** 地を持たない component と、その下に来る面。 */
const ON_SURFACE: Record<string, string> = { "button-outline": "accent" };

const STATES = ["hover", "active", "selected", "checked"] as const;

/** variant は差分だけを持つので、基底に重ねてから見る。 */
function composed(d: Design, name: string): Component {
  const self = d.components[name] ?? {};
  const state = STATES.find((s) => name.endsWith(`-${s}`));
  if (state === undefined) return self;
  return { ...d.components[name.slice(0, -(state.length + 1))], ...self };
}

/** 文字を載せる component の対。非文字の印は 3:1 の側（NON_TEXT）で見る。 */
const withColors = (d: Design) =>
  Object.keys(d.components).flatMap((name) => {
    if (SHAPE_ONLY.has(name) || NON_TEXT.some((x) => x.name === name)) return [];
    const c = composed(d, name);
    if (c.textColor === undefined) return [];
    // 塗らない部品は、載る面の色で見る
    const bg = c.backgroundColor === "transparent" ? ON_SURFACE[name] : c.backgroundColor;
    return bg === undefined ? [] : [{ name, bg, fg: c.textColor }];
  });

/** WCAG AA（通常の文字 4.5:1）を割る対を返す。 */
const contrastFailures = (d: Design, theme: "light" | "dark"): string[] =>
  withColors(d)
    .map(({ name, bg, fg }) => ({ name, r: ratio(value(d, bg, theme), value(d, fg, theme)) }))
    .filter(({ r }) => r < 4.5)
    .map(({ name, r }) => `${name}: ${r.toFixed(2)}:1`);

test("component の顔ぶれが変わったら落ちる", () => {
  expect(Object.keys(design.components).sort()).toEqual([...COMPONENTS].sort());
});

test("非文字として扱う component が実在する", () => {
  expect(NON_TEXT.filter((x) => design.components[x.name] === undefined)).toEqual([]);
});

/** 非文字要素が地から 3:1 で立つか。印の色は合成した component から取る。 */
function markFailures(d: Design, theme: "light" | "dark"): string[] {
  return NON_TEXT.map(({ name, prop, on }) => {
    const self = composed(d, name);
    const mark = self[prop];
    if (mark === undefined) throw new Error(`${name} が ${prop} を持たない`);
    // `self` は部品の中。印が自分の地から立つかを見る
    const ground = on === "self" ? self.backgroundColor : on;
    if (ground === undefined) throw new Error(`${name} が地を持たない`);
    return {
      label: `${name}.${prop} on ${on}`,
      r: ratio(value(d, mark, theme), value(d, ground, theme)),
    };
  })
    .filter(({ r }) => r < 3)
    .map(({ label, r }) => `${label}: ${r.toFixed(2)}:1`);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} の components が WCAG AA を満たす`, () => {
    expect(contrastFailures(design, theme)).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} の非文字要素が地から 3:1 で立つ`, () => {
    expect(markFailures(design, theme)).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} の非文字の検査が、部品の地を印へ寄せたら落ちる`, () => {
    // 部品の中の地は component から取る。固定値で比べていたら、ここは通ってしまう
    const broken = frontMatter(
      DESIGN_MD.replace(
        '  checkbox-checked:\n    backgroundColor: "{colors.accent}"',
        '  checkbox-checked:\n    backgroundColor: "{colors.on-accent}"',
      ),
    );
    expect(markFailures(broken, theme)).toContain("checkbox-checked.textColor on self: 1.00:1");
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} の非文字の検査が、印と地を寄せたら落ちる`, () => {
    // 印と地を同じ色にする。テーマごとに紙の値が違うので両方を寄せる
    const broken = frontMatter(
      DESIGN_MD.replace('  paper: "#ffffff"', '  paper: "#dc143c"').replace(
        '    paper: "#181818"',
        '    paper: "#dc143c"',
      ),
    );
    expect(markFailures(broken, theme)).not.toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} のコントラスト検査が、字と地を寄せたら落ちる`, () => {
    const broken = frontMatter(
      DESIGN_MD.replace('  soft: "#575757"', '  soft: "#f2f2f2"').replace(
        '    soft: "#aaaaaa"',
        '    soft: "#1a1a1a"',
      ),
    );
    expect(contrastFailures(broken, theme)).not.toEqual([]);
  });
}

// ============ 導出した状態のコントラスト ============
//
// hover / active は front matter に持たない（accent から一意に決まる）ので、
// component の対では見えない。CSS が出す色をここで組み立てて測る。

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const channels = (h: string): number[] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function toOklab(rgb: number[]): number[] {
  const [R, G, B] = rgb.map((c) => lin(c ?? 0));
  const l = Math.cbrt(0.4122214708 * (R ?? 0) + 0.5363325363 * (G ?? 0) + 0.0514459929 * (B ?? 0));
  const m = Math.cbrt(0.2119034982 * (R ?? 0) + 0.6806995451 * (G ?? 0) + 0.1073969566 * (B ?? 0));
  const s = Math.cbrt(0.0883024619 * (R ?? 0) + 0.2817188376 * (G ?? 0) + 0.6299787005 * (B ?? 0));
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(lab: number[]): number[] {
  const [L, a, b] = [lab[0] ?? 0, lab[1] ?? 0, lab[2] ?? 0];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** CSS の `color-mix(in oklab, a p%, b)` と同じ手順。 */
function mix(a: string, b: string, keep: number): number[] {
  const [x, y] = [toOklab(channels(a)), toOklab(channels(b))];
  const p = keep / 100;
  return fromOklab(x.map((v, i) => v * p + (y[i] ?? 0) * (1 - p)));
}

const luminanceOf = (rgb: number[]) =>
  0.2126 * lin(rgb[0] ?? 0) + 0.7152 * lin(rgb[1] ?? 0) + 0.0722 * lin(rgb[2] ?? 0);

const ratioOf = (a: number[], b: number[]) => {
  const [la, lb] = [luminanceOf(a), luminanceOf(b)];
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** 不透明な地の上に alpha を重ねた結果。CSS の `color-mix(..., transparent)` はこちら。 */
const over = (fg: number[], surface: number[], alpha: number) =>
  fg.map((v, i) => alpha * v + (1 - alpha) * (surface[i] ?? 0));

/** 導出色の実際の見え方。混ぜる 2 色も割合も front matter の `extensions.derive` から取る。 */
function derivedColor(theme: "light" | "dark", name: string): number[] {
  const mix2 = design.extensions.derive[name];
  if (mix2 === undefined) throw new Error(`extensions.derive に ${name} が無い`);
  const from = value(design, mix2.from, theme);
  if (mix2.to !== "transparent") return mix(from, value(design, mix2.to, theme), mix2.keep);
  const surface = ON_SURFACE_DERIVED[name];
  if (surface === undefined) throw new Error(`${name} が載る面が宣言されていない`);
  return over(channels(from), channels(value(design, surface, theme)), mix2.keep / 100);
}

/** `transparent` と混ぜた色が載る面。front matter は持てない。 */
const ON_SURFACE_DERIVED: Record<string, string> = {
  "outline-hover": "accent",
  "outline-edge": "accent",
};

const derived = (theme: "light" | "dark") => {
  const onAccent = channels(value(design, "on-accent", theme));
  const accent = channels(value(design, "accent", theme));
  return {
    "button-primary": ratioOf(accent, onAccent),
    "button-primary-hover": ratioOf(derivedColor(theme, "accent-hover"), onAccent),
    "button-primary-active": ratioOf(derivedColor(theme, "accent-active"), onAccent),
    "button-on-accent-hover": ratioOf(derivedColor(theme, "on-accent-hover"), accent),
    "button-outline-hover": ratioOf(derivedColor(theme, "outline-hover"), onAccent),
  };
};

test("accent を沈める状態は AA を満たす", () => {
  for (const theme of ["light", "dark"] as const) {
    const d = derived(theme);
    const fails = (["button-primary", "button-primary-hover", "button-primary-active"] as const)
      .filter((n) => d[n] < 4.5)
      .map((n) => `${theme} ${n}: ${d[n].toFixed(2)}:1`);
    expect(fails).toEqual([]);
  }
});

test("accent へ寄せる状態も AA を満たす", () => {
  for (const theme of ["light", "dark"] as const) {
    const d = derived(theme);
    const fails = (["button-on-accent-hover", "button-outline-hover"] as const)
      .filter((n) => d[n] < 4.5)
      .map((n) => `${theme} ${n}: ${d[n].toFixed(2)}:1`);
    expect(fails).toEqual([]);
  }
});

test("outline の枠が accent 地から 3:1 で立つ", () => {
  const fails = (["light", "dark"] as const)
    .map((theme) => ({
      theme,
      r: ratioOf(derivedColor(theme, "outline-edge"), channels(value(design, "accent", theme))),
    }))
    .filter(({ r }) => r < 3)
    .map(({ theme, r }) => `${theme}: ${r.toFixed(2)}:1`);
  expect(fails).toEqual([]);
});

/** 操作の縁は、載り得る面すべてから 3:1 で立つ（WCAG 1.4.11）。 */
test("`edge` が紙・沈んだ紙・地から 3:1 で立つ", () => {
  const fails = (["light", "dark"] as const).flatMap((theme) =>
    ["paper", "paper-2", "ground"]
      .map((on) => ({
        on,
        theme,
        r: ratio(value(design, "edge", theme), value(design, on, theme)),
      }))
      .filter(({ r }) => r < 3)
      .map(({ on, theme, r }) => `${theme} edge on ${on}: ${r.toFixed(2)}:1`),
  );
  expect(fails).toEqual([]);
});

/**
 * range の進捗（accent）と未進捗（`edge`）は互いに 3:1 を持た**ない**。
 *
 * 値を示すのはつまみで、線の色差は補助。1.4.11 が要るのは「状態を示すのに必要な部分」なので、
 * つまみと線がそれぞれ**周りの面から** 3:1 で立っていれば足りる。それを検査する。
 */
test("range のつまみと線が周りの面から 3:1 で立つ", () => {
  const fails = (["light", "dark"] as const).flatMap((theme) =>
    [
      { what: "つまみ", color: "accent" },
      { what: "線", color: "edge" },
    ]
      .map(({ what, color }) => ({
        what,
        theme,
        r: ratio(value(design, color, theme), value(design, "paper", theme)),
      }))
      .filter(({ r }) => r < 3)
      .map(({ what, theme, r }) => `${theme} ${what}: ${r.toFixed(2)}:1`),
  );
  expect(fails).toEqual([]);
});

test("混色が oklab の手順どおりである", () => {
  // accent を黒へ 12% 寄せた値。CSS の color-mix(in oklab, #dc143c 88%, #000000) と同じ
  const got = mix("#dc143c", "#000000", 88).map((v) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255),
  );
  expect(got).toEqual([185, 15, 49]);
});
