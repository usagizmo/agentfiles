// rabi-design/scripts/gen-tokens.ts を bun test から回す。
//
// **通ることは何も証明しない**ので、値を壊した複製で落ちることまで実測する。

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { declarations } from "../agents/skills/rabi-design/scripts/gen-tokens.ts";

const SKILL = join(import.meta.dir, "../agents/skills/rabi-design");

const run = async (root: string, ...flags: string[]) => {
  const p = Bun.spawn(["bun", join(root, "scripts/gen-tokens.ts"), ...flags], {
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

/** skill ごと temp へ複製する。script は自分の位置から `../assets` を引く。 */
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

const asset = (dir: string, name: string) => join(dir, "assets", name);
const designPath = (dir: string) => join(dir, "references/DESIGN.md");

const DESIGN_MD = readFileSync(designPath(SKILL), "utf8");
const EVAL_MD = readFileSync(join(SKILL, "references/EVAL.md"), "utf8");

/**
 * 見出しの列名で表を選び、行を返す。
 *
 * 行は見出しの**直後から連続する分だけ**。`|` の行を拾い集めると、
 * 表が終わったあとの別の表が同じ表の続きとして混ざる。
 *
 * 列名が重複する表は掴め**ない**。先頭を黙って取ると、別の表を正として読む。
 */
function table(doc: string, header: readonly string[]): string[][] {
  const lines = doc.split("\n");
  const cells = (line: string): string[] | undefined => {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|")) return undefined;
    return t
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
  };
  const heads = lines.flatMap((line, i) => {
    const c = cells(line);
    const hit = c !== undefined && c.length === header.length && header.every((h, j) => c[j] === h);
    return hit ? [i] : [];
  });
  const label = header.join(" / ");
  if (heads.length === 0) throw new Error(`${label} の表が無い`);
  if (heads.length > 1) throw new Error(`${label} の表が ${heads.length} つある`);
  const rows: string[][] = [];
  for (let i = (heads[0] as number) + 2; i < lines.length; i += 1) {
    const c = cells(lines[i] as string);
    if (c === undefined || c.length !== header.length) break;
    rows.push(c);
  }
  return rows;
}

/** 「Layout」の丈の対応表。丈から決まる 3 つはこの 1 本の行から導く。 */
const HEIGHT_ROWS = table(DESIGN_MD, ["丈", "文字", "左右の余白", "図"]).map((row) =>
  row.map((cell) => cell.replaceAll("`", "")),
);

/** DESIGN.md の front matter だけを返す。本文の例は写しでは**ない**ので検査に混ぜない。 */
function frontMatter(design: string): string {
  const m = design.match(/^---\n([\s\S]*?\n)---\n/);
  if (!m?.[1]) throw new Error("DESIGN.md に front matter が無い");
  return m[1];
}

const DESIGN_DIR = join(import.meta.dir, "../design");

/** `design/` の面は全部見る。1 枚だけ見ると 2 枚目が無検査で入る。 */
const surfaces = readdirSync(DESIGN_DIR).filter((name) => name.endsWith(".html"));

/** 面から切り出した実体。面と同じ規則で検査する。 */
const surfaceScripts = readdirSync(DESIGN_DIR).filter((name) => name.endsWith(".js"));

/** 面から切り出した style。`<style>` の gate をここへ逃がせないよう、面と同じ規則で検査する。 */
const surfaceStyles = readdirSync(DESIGN_DIR).filter((name) => name.endsWith(".css"));

const surfaceAssets = [...surfaceScripts, ...surfaceStyles];

/** `assets/` の js / css も展開されて面になる。design/ だけ見ると asset が無検査で入る。 */
const assets = readdirSync(join(SKILL, "assets")).filter((name) => /\.(html|js|css)$/.test(name));

/** 値の SSOT。ここだけが 16 進値と `--rabi-*` の宣言を持てる。 */
const TOKEN_SSOT = new Set(["rabi.css", "rabi-role.css"]);

const ROLE_CSS = join(SKILL, "assets/rabi-role.css");

/** 値の SSOT を除いた asset。写しを持ってはいけない側。 */
const derivedAssets = assets.filter((name) => !TOKEN_SSOT.has(name));

/**
 * どこにも宣言が無い `var(--rabi-…)` を返す。
 *
 * 引ける先はブランド層の `rabi.css`、情報層を読んだ面では `rabi-role.css`、
 * そのファイルが自分で宣言した部品のローカル変数（`DESIGN.md`「Components」）。
 */
function undeclaredTokens(path: string): string[] {
  const source = readFileSync(path, "utf8");
  const declared = declarations(readFileSync(join(SKILL, "assets/rabi.css"), "utf8"));
  if (path.endsWith("rabi-role.css") || source.includes("rabi-role.css")) {
    for (const [name, value] of declarations(readFileSync(ROLE_CSS, "utf8"))) {
      declared.set(name, value);
    }
  }
  const local = new Set(
    [...source.matchAll(/(?:^|[;{\s])--rabi-([a-z0-9_-]+)\s*:/g)].map((m) => m[1] as string),
  );
  const referenced = [...source.matchAll(/var\(--rabi-([a-z0-9_-]+)\)/g)].map(
    (m) => m[1] as string,
  );
  return [...new Set(referenced.filter((n) => !declared.has(n) && !local.has(n)))];
}

test.each([...surfaces, ...surfaceAssets])("%s が引くトークンは値の SSOT に在る", (name) => {
  expect(undeclaredTokens(join(DESIGN_DIR, name))).toEqual([]);
});

test.each(assets)("assets/%s が引くトークンは値の SSOT に在る", (name) => {
  expect(undeclaredTokens(join(SKILL, "assets", name))).toEqual([]);
});

// 拡張子ごとに数える。まとめて数えると、片方が 0 枚でも通って無検査で入る
test.each([
  [".css", 3],
  [".js", 1],
])("assets/ の %s が %i 枚以上ある", (ext, least) => {
  expect(assets.filter((name) => name.endsWith(ext)).length).toBeGreaterThanOrEqual(least);
});

// DESIGN.md「Colors」の「16 進値を写さず、常にトークンを参照する」を asset 自身にも効かせる
test.each(derivedAssets)("assets/%s は 16 進値を写していない", (name) => {
  const html = readFileSync(join(SKILL, "assets", name), "utf8");
  expect(html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
});

/**
 * `:root` で宣言された `--rabi-<name>` を返す。
 *
 * 値のトークンは `:root` に立つ。部品クラスのスコープで宣言するローカル変数は、
 * その部品の中でしか効かないので値の SSOT を割ら**ない**。
 */
function declaredTokens(source: string): string[] {
  return [...source.matchAll(/:root[^{}]*\{([^{}]*)\}/g)].flatMap((block) =>
    [...(block[1] as string).matchAll(/(?:^|[;\s])(--rabi-[a-z0-9_-]+)\s*:/g)].map(
      (m) => m[1] as string,
    ),
  );
}

// 値のトークンを宣言してよいのは値の SSOT だけ。他が宣言すると値が 2 か所になる
test.each(derivedAssets)("assets/%s は --rabi-* を宣言しない", (name) => {
  expect(declaredTokens(readFileSync(join(SKILL, "assets", name), "utf8"))).toEqual([]);
});

test.each([...surfaces, ...surfaceAssets])("%s は --rabi-* を宣言しない", (name) => {
  expect(declaredTokens(readFileSync(join(DESIGN_DIR, name), "utf8"))).toEqual([]);
});

// **通ることは何も証明しない** —— 値のトークンとローカル変数の線を実測する
test("`:root` の宣言は値のトークンとして落ちる", () => {
  expect(declaredTokens(":root {\n  --rabi-nope: 1px;\n}")).toEqual(["--rabi-nope"]);
});

test("部品クラスの中の宣言はローカル変数として通る", () => {
  expect(declaredTokens(".rabi-btn {\n  --rabi-btn-h: 32px;\n}")).toEqual([]);
});

/**
 * asset が宣言する `.rabi-*` のクラス名。
 *
 * 複合セレクタ（`.rabi-cell.rabi-cell-row`）の 2 つ目以降も拾う。
 * コメントは先に落とす —— 説明文の中のクラス名は宣言では**ない**。
 */
const classesIn = (rel: string): string[] =>
  [
    ...readFileSync(join(SKILL, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/\.(rabi-[a-z0-9-]+)/g),
  ].map((m) => m[1] as string);

/** 丈から決まら**ない**文字の段（`DESIGN.md`「Layout」）。 */
const HEADING_STEPS = new Set(["display", "heading", "subheading"]);

/**
 * 丈の表に載ら**ない**セレクタ。
 *
 * 表が縛るのは**文字を内包する操作枠**だけ（`DESIGN.md`「Layout」）。
 * 帯は丈を面の都合で決めるので、字の段が丈から従属し**ない**。
 */
const NOT_ON_HEIGHT_STEP = new Set([".rabi-statusbar", ".rabi-panel-section-head"]);

const uiClasses = classesIn("assets/rabi-components.css");
const componentClasses = new Set([
  ...uiClasses,
  ...classesIn("assets/rabi.css"),
  ...classesIn("assets/rabi-role.css"),
]);

// 合成集合で見ると、UI 部品が空でも文書部品だけで通る
test("rabi-components.css が部品クラスを宣言している", () => {
  expect(uiClasses.length).toBeGreaterThan(0);
});

/**
 * `font-size` を宣言していて、`font-weight` か `line-height` を持たないセレクタ。
 *
 * 段は size / weight / lineHeight の 3 つで 1 組（`DESIGN.md`「Typography」）。
 * 1 つでも欠けると、展開先の既定や UA の値が混ざって front matter とずれる。
 */
function incompleteSteps(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+?)\s*\{([^{}]*)\}/g)]
    .filter(
      (m) =>
        (m[2] as string).includes("font-size") &&
        (!(m[2] as string).includes("font-weight") || !(m[2] as string).includes("line-height")),
    )
    .map((m) => (m[1] as string).trim().replace(/\s+/g, " "));
}

test.each(["assets/rabi-components.css", "assets/rabi.css", "assets/rabi-role.css"])(
  "%s は字の段を size / weight / line-height で揃える",
  (rel) => {
    expect(incompleteSteps(readFileSync(join(SKILL, rel), "utf8"))).toEqual([]);
  },
);

/** 丈から決まる文字の段。 */
const TYPE_FOR_HEIGHT: Record<string, string> = Object.fromEntries(
  HEIGHT_ROWS.map((row) => [row[0] as string, row[1] as string]),
);

test("丈と文字の対応表を DESIGN.md から引けている", () => {
  expect(TYPE_FOR_HEIGHT).toEqual({
    "control-lg": "body",
    control: "body",
    "control-sm": "body-doc",
    "control-xs": "label",
  });
});

/**
 * 丈と文字の段が対応表からずれているセレクタを返す。
 *
 * 等幅と見出しの段、そして帯は丈に依ら**ない**（`DESIGN.md`「Layout」）ので見に行かない。
 */
function heightTypeMismatch(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+?)\s*\{([^{}]*)\}/g)]
    .filter((m) => {
      const body = m[2] as string;
      if (NOT_ON_HEIGHT_STEP.has((m[1] as string).trim().replace(/\s+/g, " "))) return false;
      if (/font-family: var\(--rabi-mono\)/.test(body)) return false;
      const height = /height: var\(--rabi-(control[a-z-]*)\)/.exec(body)?.[1];
      const step = /font-size: var\(--rabi-t-([a-z-]+)\)/.exec(body)?.[1];
      if (height === undefined || step === undefined) return false;
      if (HEADING_STEPS.has(step)) return false;
      const want = TYPE_FOR_HEIGHT[height];
      return want !== undefined && want !== step;
    })
    .map((m) => (m[1] as string).trim().replace(/\s+/g, " "));
}

// 丈が決まれば文字の段も決まる（`DESIGN.md`「Layout」）
test("rabi-components.css の丈と文字の段が対応表と揃っている", () => {
  expect(
    heightTypeMismatch(readFileSync(join(SKILL, "assets/rabi-components.css"), "utf8")),
  ).toEqual([]);
});

// **通ることは何も証明しない** —— ずれたら落ちることを実測する
test("丈と文字の段がずれると落ちる", () => {
  const css = ".x {\n  height: var(--rabi-control);\n  font-size: var(--rabi-t-label);\n}";
  expect(heightTypeMismatch(css)).toEqual([".x"]);
});

test.each([
  ["見出しの段", ".x { height: var(--rabi-control); font-size: var(--rabi-t-subheading); }"],
  [
    "等幅",
    ".x { height: var(--rabi-control); font-family: var(--rabi-mono); font-size: var(--rabi-t-label-sm); }",
  ],
])("%s は丈の表の対象外", (_label, css) => {
  expect(heightTypeMismatch(css)).toEqual([]);
});

/** 丈から決まる左右の余白。 */
const PADDING_FOR_HEIGHT: Record<string, string> = Object.fromEntries(
  HEIGHT_ROWS.map((row) => [row[0] as string, `gap-${(row[2] as string).replace(".", "_")}`]),
);

test("丈と余白の対応表を DESIGN.md から引けている", () => {
  expect(Object.keys(PADDING_FOR_HEIGHT).sort()).toEqual([
    "control",
    "control-lg",
    "control-sm",
    "control-xs",
  ]);
});

/** 丈と左右の余白が対応表からずれているセレクタを返す。 */
function heightPaddingMismatch(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+?)\s*\{([^{}]*)\}/g)]
    .filter((m) => {
      const height = /height: var\(--rabi-(control[a-z-]*)\)/.exec(m[2] as string)?.[1];
      const pad = /padding(?:-inline)?: (?:0 )?var\(--rabi-(gap-[0-9_]+)\)/.exec(
        m[2] as string,
      )?.[1];
      if (height === undefined || pad === undefined) return false;
      const want = PADDING_FOR_HEIGHT[height];
      return want !== undefined && want !== pad;
    })
    .map((m) => (m[1] as string).trim().replace(/\s+/g, " "));
}

// 丈が決まれば左右の余白も決まる（`DESIGN.md`「Layout」）
test("rabi-components.css の丈と左右の余白が対応表と揃っている", () => {
  expect(
    heightPaddingMismatch(readFileSync(join(SKILL, "assets/rabi-components.css"), "utf8")),
  ).toEqual([]);
});

// **通ることは何も証明しない** —— ずれたら落ちることを実測する
test("丈と余白がずれると落ちる", () => {
  const css = ".x {\n  height: var(--rabi-control-sm);\n  padding: 0 var(--rabi-gap-3);\n}";
  expect(heightPaddingMismatch(css)).toEqual([".x"]);
});

// **通ることは何も証明しない** —— 欠けたら落ちることを実測する
test.each([
  ["weight が無い", ".x { font-size: 12px; line-height: 1.4; }"],
  ["line-height が無い", ".x { font-size: 12px; font-weight: 500; }"],
])("字の段で %s と落ちる", (_label, css) => {
  expect(incompleteSteps(css)).toEqual([".x"]);
});

/**
 * 面が部品へ書いては**いけない**プロパティ —— 部品自身の見た目を決めるもの。
 *
 * 面が持てるのは配置（`margin` / `align-self` / `grid-column` …）と、
 * 部品の中身の並べ方（`display` / `grid-template-columns` / `gap` …）だけ。
 * 密度を変えたいなら `-sm` のような variant を部品側に置く（`DESIGN.md`「Components」）。
 */
const COMPONENT_PROPERTIES = [
  /^padding/,
  /^height$/,
  /^min-height$/,
  /^max-height$/,
  /^background/,
  /^color$/,
  /^border/,
  /^font/,
  /^line-height$/,
  /^letter-spacing$/,
  /^text-shadow$/,
  /^text-transform$/,
  /^box-shadow$/,
  /^filter$/,
  /^outline/,
  /^opacity$/,
  /^visibility$/,
  /^all$/,
];

/** 解析の種別。面の `.html` と `.js` は `html`、切り出した `.css` は `css`。 */
type SourceKind = "html" | "css";

/**
 * `<style>` を宣言ブロックへ割る。返すのは [セレクタ, 宣言本文] の組。
 * 面の `.css` は全体が 1 つの `<style>` に当たる。
 *
 * 直前の `}` を**消費しない** —— 消費すると連続するブロックが 1 つおきにしか当たらない。
 * `@media` はセレクタ側が `{` の直後に `}` を持たないので、外側は拾われず中のルールだけが出る。
 */
function rules(source: string, kind: SourceKind): Array<[string, string]> {
  // 種別は呼び出し側が渡す。中身から当てると、`<style` を含む css で分岐が変わって gate を抜けられる
  const blocks =
    kind === "html"
      ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] as string)
      : [source];
  return blocks
    .map((style) => style.replace(/\/\*[\s\S]*?\*\//g, ""))
    .flatMap((style) => [...style.matchAll(/([^{}]+?)\s*\{([^{}]*)\}/g)])
    .filter((m) => !(m[1] as string).trimStart().startsWith("@"))
    .map((m) => [m[1] as string, m[2] as string]);
}

/** セレクタの末尾 compound —— 最後の結合子より後ろ。そこが指す先が対象。 */
function trailingCompound(selector: string): string {
  let depth = 0;
  let last = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i] as string;
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(c)) last = i + 1;
  }
  return selector.slice(last);
}

/**
 * 面の `<style>` が**部品そのものの見た目を書いている**セレクタを返す。
 *
 * 対象は末尾 compound が部品を指すセレクタ **だけ**。`.fcell h3` のように
 * 末尾が部品の中身なら当たら**ない**（中身の組み方は面の裁量）。
 *
 * 併記クラス（HTML で部品クラスと同じ要素に置かれた面のクラス）も部品を指す。
 */
function componentOverrides(
  source: string,
  siblings: ReadonlySet<string>,
  kind: SourceKind,
): string[] {
  const hits: string[] = [];
  for (const [selectorList, body] of rules(source, kind)) {
    const offending = [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)]
      .map((m) => m[1] as string)
      .filter((prop) => COMPONENT_PROPERTIES.some((re) => re.test(prop)));
    if (offending.length === 0) continue;
    for (const selector of selectorList.split(",")) {
      // `:has()` / `:not()` は部品を**条件**に使うだけ。subject では**ない**ので外す。
      // `:is()` / `:where()` は subject そのものなので残す
      const tail = trailingCompound(selector.trim()).replace(/:(?:has|not)\([^()]*\)/g, "");
      const touched = [...tail.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1] as string);
      if (touched.some((cls) => componentClasses.has(cls) || siblings.has(cls))) {
        hits.push(selector.trim());
      }
    }
  }
  return [...new Set(hits)];
}

/**
 * `style` 属性が部品の見た目を書いている要素の class。
 *
 * `<style>` の外なので、セレクタの gate では当たら**ない**。
 */
function inlineOverrides(html: string): string[] {
  const hits: string[] = [];
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const source = tag[0];
    const classes = source.match(/\sclass=["']([^"']+)["']/)?.[1];
    const style = source.match(/\sstyle=["']([^"']*)["']/)?.[1];
    if (classes === undefined || style === undefined) continue;
    if (!classes.split(/\s+/).some((cls) => componentClasses.has(cls))) continue;
    const offending = [...style.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)]
      .map((m) => m[1] as string)
      .filter((prop) => COMPONENT_PROPERTIES.some((re) => re.test(prop)));
    if (offending.length > 0) hits.push(classes);
  }
  return [...new Set(hits)];
}

/** HTML の `class` 属性で部品クラスと同じ要素に併記されている面のクラス。 */
function siblingClasses(html: string): Set<string> {
  const found = new Set<string>();
  for (const m of html.matchAll(/class=["']([^"']+)["']/g)) {
    const classes = (m[1] as string).split(/\s+/).filter(Boolean);
    if (!classes.some((cls) => componentClasses.has(cls))) continue;
    for (const cls of classes) if (!componentClasses.has(cls)) found.add(cls);
  }
  return found;
}

/**
 * 面が使っている `.rabi-*` のうち、部品に実体が無いもの。
 *
 * `<style>` の宣言と、HTML の `class` 属性の**両方**を見る。
 * 宣言だけ見ると、CSS に無いクラスを HTML が名乗る形が素通りする。
 */
function unknownRabiClasses(source: string, kind: SourceKind): string[] {
  const declared = rules(source, kind).flatMap(([selectorList]) =>
    selectorList
      .split(",")
      .flatMap((sel) => [...sel.matchAll(/\.(rabi-[a-z0-9-]*)/g)].map((m) => m[1] as string)),
  );
  const used = [...source.matchAll(/class=["']([^"']+)["']/g)].flatMap((m) =>
    (m[1] as string).split(/\s+/).filter((cls) => cls.startsWith("rabi-")),
  );
  return [...new Set([...declared, ...used])].filter((cls) => !componentClasses.has(cls));
}

/** 面と、面から切り出した実体。`.css` だけ解析の種別が違う。 */
const surfaceSources: Array<[string, SourceKind]> = [
  ...[...surfaces, ...surfaceScripts].map((name) => [name, "html"] as [string, SourceKind]),
  ...surfaceStyles.map((name) => [name, "css"] as [string, SourceKind]),
];

// `.rabi-` は部品の名前空間。面が名乗ると、部品に無い実体がその名前で増える
test.each(surfaceSources)("%s は部品に無い .rabi-* を使わない", (name, kind) => {
  expect(unknownRabiClasses(readFileSync(join(DESIGN_DIR, name), "utf8"), kind)).toEqual([]);
});

test.each([
  ["style で宣言", "<style>\n.rabi-nope { color: red; }\n</style>", "html"],
  ["class で名乗る", '<div class="rabi-nope"></div>', "html"],
  ["切り出した css で宣言", ".rabi-nope {\n  color: red;\n}\n", "css"],
] as Array<[string, string, SourceKind]>)(
  "面が部品に無い .rabi-* を %s すると落ちる",
  (_label, source, kind) => {
    expect(unknownRabiClasses(source, kind)).toEqual(["rabi-nope"]);
  },
);

/**
 * 部品に実体が在るのに、カタログの `class` 属性に出ないクラス。
 *
 * 上の gate が見るのは逆向き（面が部品に無い `.rabi-*` を名乗る）。こちらが無いと、
 * `rabi-components.css` へ部品を足してカタログへ載せ忘れた形が素通りする。
 */
function uncatalogued(html: string, classes: ReadonlySet<string>): string[] {
  const used = new Set(
    [...html.matchAll(/class=["']([^"']+)["']/g)].flatMap((m) =>
      (m[1] as string).split(/\s+/).filter((cls) => cls.startsWith("rabi-")),
    ),
  );
  return [...classes].filter((cls) => !used.has(cls)).sort();
}

// カタログは部品ひとつを全状態で見る面。載らない部品はどの面からも拾われない
test("components.html が部品を全部並べる", () => {
  const html = readFileSync(join(DESIGN_DIR, "components.html"), "utf8");
  expect(uncatalogued(html, componentClasses)).toEqual([]);
});

test("部品を足してカタログへ載せ忘れると落ちる", () => {
  expect(
    uncatalogued('<div class="rabi-here"></div>', new Set(["rabi-here", "rabi-nope"])),
  ).toEqual(["rabi-nope"]);
});

/** 面の `<style>` と、面から切り出した `.css` に置かれた併記クラス。 */
const surfaceSiblings = new Set(
  surfaces.flatMap((name) => [...siblingClasses(readFileSync(join(DESIGN_DIR, name), "utf8"))]),
);

// 面が部品の見た目を書いたら実装が 2 つになる。面が持てるのは配置と中身の並べ方だけ
test.each(surfaces)("%s は部品の見た目を書かない", (name) => {
  const html = readFileSync(join(DESIGN_DIR, name), "utf8");
  expect(componentOverrides(html, siblingClasses(html), "html")).toEqual([]);
});

// 切り出した `.css` は `<style>` の外なので、面だけ見ると gate をそちらへ逃がせる。
// 併記クラスは面の HTML 側にしか出ないので、全部の面から集めて渡す
test.each(surfaceStyles)("%s は部品の見た目を書かない", (name) => {
  const css = readFileSync(join(DESIGN_DIR, name), "utf8");
  expect(componentOverrides(css, surfaceSiblings, "css")).toEqual([]);
});

// **通ることは何も証明しない** —— `<style>` を持たない実体でも当たることを実測する
test.each([
  ["素の css", ".rabi-btn {\n  height: 40px;\n}\n"],
  // 中身から種別を当てると、この 1 行で解析が空になって gate を抜けられる
  ["`<style` を含むコメント", "/* <style */\n.rabi-btn {\n  height: 40px;\n}\n"],
])("css の %s で部品の見た目を書くと落ちる", (_label, css) => {
  expect(componentOverrides(css, new Set(), "css")).toEqual([".rabi-btn"]);
});

test("css の配置は落ちない", () => {
  expect(componentOverrides(".rabi-btn {\n  margin-top: 4px;\n}\n", new Set(), "css")).toEqual([]);
});

// `style` 属性は `<style>` の外なので、セレクタの gate では当たらない
test.each(surfaces)("%s は style 属性で部品の見た目を書かない", (name) => {
  expect(inlineOverrides(readFileSync(join(DESIGN_DIR, name), "utf8"))).toEqual([]);
});

test("style 属性で部品の見た目を書くと落ちる", () => {
  expect(inlineOverrides('<div class="rabi-cell" style="padding: 40px"></div>')).toEqual([
    "rabi-cell",
  ]);
});

test("style 属性の配置は落ちない", () => {
  expect(inlineOverrides('<div class="rabi-cell" style="margin-top: 4px"></div>')).toEqual([]);
});

// **通ることは何も証明しない** —— 書き方を変えても落ちることを実測する
test.each([
  ["素のクラス", '<div class="rabi-btn"></div>', ".rabi-btn { height: 40px; }"],
  ["要素との複合", '<div class="rabi-btn"></div>', "button.rabi-btn { height: 40px; }"],
  ["擬似クラス", '<div class="rabi-btn"></div>', ".rabi-btn:hover { background: red; }"],
  [":is() の中", '<div class="rabi-btn"></div>', ":is(.rabi-btn) { height: 40px; }"],
  ["文脈セレクタ", '<div class="rabi-btn"></div>', ".plan .rabi-btn { height: 40px; }"],
  ["併記クラス", '<div class="rabi-cell fcell"></div>', ".fcell { padding: 40px; }"],
  ["併記クラスの子孫", '<div class="rabi-cell fcell"></div>', ".x .fcell { font-size: 40px; }"],
  ["字間", '<div class="rabi-cell fcell"></div>', ".fcell { letter-spacing: 0.2em; }"],
  ["一括上書き", '<div class="rabi-cell fcell"></div>', ".fcell { all: unset; }"],
  ["単一引用符の併記", "<div class='rabi-cell fcell'></div>", ".fcell { padding: 40px; }"],
])("面が %s で部品の見た目を書くと落ちる", (_label, markup, rule) => {
  const html = `<style>\n${rule}\n</style>${markup}`;
  expect(componentOverrides(html, siblingClasses(html), "html").length).toBeGreaterThan(0);
});

// 2 つ目の `<style>` へ逃がしても落ちる
test("2 つ目の style で部品の見た目を書いても落ちる", () => {
  const html = `<style>\n.x { color: red; }\n</style><style>\n.rabi-btn { height: 40px; }\n</style>`;
  expect(componentOverrides(html, new Set(), "html")).toEqual([".rabi-btn"]);
});

// 配置と、中身の組み方は当たら**ない**
test.each([
  ["配置", ".plan .rabi-btn { margin-top: auto; align-self: flex-start; }"],
  ["列数", ".rabi-grid { grid-template-columns: repeat(3, 1fr); }"],
  ["中身の要素", ".fcell h3 { font-size: 14px; }"],
  [":has() の条件", ".surface:has(.rabi-btn) { background: red; }"],
])("面の %s は落ちない", (_label, rule) => {
  const html = `<style>\n${rule}\n</style><div class="rabi-cell fcell"></div>`;
  expect(componentOverrides(html, siblingClasses(html), "html")).toEqual([]);
});

// 拡張子ごとに数える。まとめて数えると、片方が 0 枚でも通って無検査で入る。
// ラベルを先頭に置く —— 受け取らない引数は `%s` に載ら**ない**
test.each([
  ["面", surfaces],
  ["script", surfaceScripts],
  ["style", surfaceStyles],
] as const)("design/ に %s が 1 枚以上ある", (_label, names) => {
  expect(names.length).toBeGreaterThan(0);
});

// 面を足しても gate は落ちないが、切替バーには出ない。索引と面を突き合わせる
test("surfaces.js の索引が design/ の面と一致する", () => {
  const js = readFileSync(join(DESIGN_DIR, "surfaces.js"), "utf8");
  const block = js.match(/var SURFACES = \[([\s\S]*?)\];/)?.[1];
  if (block === undefined) throw new Error("surfaces.js に SURFACES が無い");
  const listed = [...block.matchAll(/\["([^"]+\.html)"/g)].map((m) => m[1] as string);
  expect(listed.slice().sort()).toEqual(surfaces.slice().sort());
});

/** sRGB の相対輝度（WCAG 2.x）。 */
function luminance(hex: string): number {
  const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) =>
    channel(parseInt(hex.slice(i, i + 2), 16) / 255),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `--rabi-<name>` の light / dark を取り出す。両テーマ共通の素の hex は同じ値を 2 つ返す。 */
function themes(css: string, name: string): [string, string] {
  const pair = css.match(
    new RegExp(`--rabi-${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`),
  );
  if (pair?.[1] && pair[2]) return [pair[1], pair[2]];
  const flat = css.match(new RegExp(`--rabi-${name}: (#[0-9a-f]{6});`));
  if (flat?.[1]) return [flat[1], flat[1]];
  throw new Error(`--rabi-${name} が light-dark(#…, #…) でも素の hex でもない`);
}

/** 文字と輪郭が載りうる面。下限は**この中で地との差が最小になる面**で測る。 */
const SURFACES = ["ground", "paper", "paper-2", "wash"] as const;

// DESIGN.md「面と段」が定める下限
const FLOORS: ReadonlyArray<readonly [string, number]> = [
  ["ink", 4.5],
  ["soft", 4.5],
  ["faint", 4.5],
  ["accent-text", 4.5],
];

/**
 * 操作の輪郭。**文字の下限（4.5:1）にも図の下限（3:1）にも載せ**ない。
 *
 * 欄がどこかは添えたラベルと地が示すので、輪郭は形を与えるだけ。
 * ただし消えると枠が無いのと同じなので、下は 2:1 で止める。
 */
test("edge は面のどれに載せても 2:1 を割らない", () => {
  const css = readFileSync(join(SKILL, "assets/rabi.css"), "utf8");
  for (const theme of [0, 1] as const) {
    for (const bg of SURFACES) {
      expect(contrast(themes(css, "edge")[theme], themes(css, bg)[theme])).toBeGreaterThanOrEqual(
        2,
      );
    }
  }
});

// 上へ振れると操作だけが画面から浮く。図の下限（3:1）へ戻さ**ない**
test("edge は 3:1 へ戻らない", () => {
  const css = readFileSync(join(SKILL, "assets/rabi.css"), "utf8");
  for (const theme of [0, 1] as const) {
    expect(contrast(themes(css, "edge")[theme], themes(css, "paper")[theme])).toBeLessThan(3);
  }
});

test.each(FLOORS)("%s は面のどれに載せても %f:1 を割らない", (fg, floor) => {
  const css = readFileSync(join(SKILL, "assets/rabi.css"), "utf8");
  for (const theme of [0, 1] as const) {
    for (const bg of SURFACES) {
      expect(contrast(themes(css, fg)[theme], themes(css, bg)[theme])).toBeGreaterThanOrEqual(
        floor,
      );
    }
  }
});

// 赤ベタの上に載る唯一の文字。両テーマ共通の素の hex どうしで測る
// 吹き出しは地が ink の唯一の面。そこだけ divider が文字になる（`DESIGN.md`「Components」）
test("divider は ink の上で 4.5:1 を割らない", () => {
  const css = readFileSync(join(SKILL, "assets/rabi.css"), "utf8");
  const [fgLight, fgDark] = themes(css, "divider");
  const [bgLight, bgDark] = themes(css, "ink");
  expect(contrast(fgLight, bgLight)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(fgDark, bgDark)).toBeGreaterThanOrEqual(4.5);
});

test("on-accent は accent の上で 4.5:1 を割らない", () => {
  const css = readFileSync(join(SKILL, "assets/rabi.css"), "utf8");
  expect(contrast(themes(css, "on-accent")[0], themes(css, "accent")[0])).toBeGreaterThanOrEqual(
    4.5,
  );
});

test("DESIGN.md の front matter が rabi.css と揃っている", async () => {
  const { code, output } = await run(SKILL, "--check");
  expect(code === 0 ? "" : output).toBe("");
});

test("rabi.css を動かすと --check が落ち、書き戻しで追随する", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    expect(original).toContain("--rabi-gap-3: 12px");
    writeFileSync(css, original.replace("--rabi-gap-3: 12px", "--rabi-gap-3: 14px"));

    expect((await run(dir, "--check")).code).not.toBe(0);

    expect((await run(dir)).code).toBe(0);
    expect(readFileSync(designPath(dir), "utf8")).toContain('"3": 14px');
    expect((await run(dir, "--check")).code).toBe(0);
  });
});

test("front matter を手で動かすと --check が落ちる", async () => {
  await withSandbox(async (dir) => {
    const design = designPath(dir);
    const original = readFileSync(design, "utf8");
    expect(original).toContain('accent: "#dc143c"');
    writeFileSync(design, original.replace('accent: "#dc143c"', 'accent: "#ff0000"'));

    expect((await run(dir, "--check")).code).not.toBe(0);
  });
});

test("文字の段を動かすと --check が落ち、書き戻しで追随する", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    expect(original).toContain("--rabi-t-body: 14px");
    writeFileSync(css, original.replace("--rabi-t-body: 14px", "--rabi-t-body: 15px"));

    expect((await run(dir, "--check")).code).not.toBe(0);

    expect((await run(dir)).code).toBe(0);
    expect(readFileSync(designPath(dir), "utf8")).toContain("fontSize: 15px");
  });
});

test("CSS 変数を改名すると読み飛ばさずに落ちる", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    writeFileSync(css, original.replace("--rabi-gap-10:", "--rabi-gap-chapter:"));

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("--rabi-gap-10");
    expect(code).not.toBe(0);
  });
});

test("表に無い key を front matter へ足すと落ちる", async () => {
  await withSandbox(async (dir) => {
    const design = designPath(dir);
    const original = readFileSync(design, "utf8");
    writeFileSync(design, original.replace("spacing:\n", "spacing:\n  inset: 4px\n"));

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("spacing.inset");
    expect(code).not.toBe(0);
  });
});

test("派生の宣言の外で token 参照へ変えると落ちる", async () => {
  await withSandbox(async (dir) => {
    const design = designPath(dir);
    const original = readFileSync(design, "utf8");
    writeFileSync(design, original.replace('ink: "#222222"', 'ink: "{colors.accent}"'));

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("colors.ink");
    expect(code).not.toBe(0);
  });
});

test("CSS 変数を足して front matter へ写さないと落ちる", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    writeFileSync(
      css,
      original.replace("--rabi-gap-3: 12px", "--rabi-gap-huge: 80px;\n  --rabi-gap-3: 12px"),
    );

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("gap-huge");
    expect(code).not.toBe(0);
  });
});

test("多段の var 参照を展開しきる", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    // wash を accent 経由の参照にする。1 段しか展開しないと var() が残る
    writeFileSync(
      css,
      original.replace(
        "--rabi-wash: light-dark(#fdeff2, #2a1219);",
        "--rabi-wash: color-mix(in oklab, var(--rabi-accent-hover) 8%, #ffffff);",
      ),
    );

    expect((await run(dir)).code).toBe(0);
    const front = frontMatter(readFileSync(designPath(dir), "utf8"));
    expect(front).toContain("#dc143c 88%");
    expect(front).not.toContain("var(--rabi-");
  });
});

test("var 参照が循環すると落ちる", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    writeFileSync(
      css,
      original.replace(
        "--rabi-wash: light-dark(#fdeff2, #2a1219);",
        "--rabi-wash: var(--rabi-wash);",
      ),
    );

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("循環");
    expect(code).not.toBe(0);
  });
});

test("CSS 変数を 2 回宣言すると落ちる", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    writeFileSync(css, `${original}\n:root {\n  --rabi-gap-3: 12px;\n}\n`);

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("2 回宣言");
    expect(code).not.toBe(0);
  });
});

test("fallback 付きの var 参照は落ちる", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    const original = readFileSync(css, "utf8");
    writeFileSync(
      css,
      original.replace(
        "--rabi-wash: light-dark(#fdeff2, #2a1219);",
        "--rabi-wash: var(--rabi-paper, #ffffff);",
      ),
    );

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("fallback");
    expect(code).not.toBe(0);
  });
});

test("colors.primary に literal を置くと落ちる", async () => {
  await withSandbox(async (dir) => {
    const design = designPath(dir);
    const original = readFileSync(design, "utf8");
    writeFileSync(design, original.replace('primary: "{colors.ink}"', 'primary: "#222222"'));

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("colors.primary");
    expect(code).not.toBe(0);
  });
});

test("色を引用しても書き戻しが YAML を壊さない", async () => {
  await withSandbox(async (dir) => {
    const design = designPath(dir);
    writeFileSync(design, readFileSync(design, "utf8").replace('ink: "#222222"', "ink: '#222222'"));

    expect((await run(dir)).code).toBe(0);
    expect(readFileSync(design, "utf8")).toContain('ink: "#222222"');
    expect((await run(dir, "--check")).code).toBe(0);
  });
});

const CSS = () => readFileSync(join(SKILL, "assets/rabi.css"), "utf8");

/** `--rabi-gap-<名>` の段。`_` は `.` の CSS 表記。 */
function gaps(css: string): Array<[number, number]> {
  return [...declarations(css)]
    .filter(([name]) => name.startsWith("gap-"))
    .map(([name, value]) => [Number(name.slice(4).replace("_", ".")), Number.parseInt(value, 10)]);
}

test("余白の段は 4px を 1 とする倍数", () => {
  for (const [step, px] of gaps(CSS())) expect(px).toBe(step * 4);
});

test("余白の刻みは 5 までが 2px、6 から先が 8px", () => {
  const steps = gaps(CSS())
    .map(([step]) => step)
    .sort((a, b) => a - b);
  // 2 系列の内側だけを見る。境目の 5 → 6 はどちらの刻みでもない
  const series = [steps.filter((s) => s <= 5), steps.filter((s) => s >= 6)] as const;
  for (const [i, group] of series.entries()) {
    expect(group.length).toBeGreaterThan(1);
    for (const [j, step] of group.entries()) {
      const next = group[j + 1];
      if (next === undefined) continue;
      expect(next - step).toBe(i === 0 ? 0.5 : 2);
    }
  }
});

test("操作部品の丈は 4px 刻みの 4 段", () => {
  const heights = [...declarations(CSS())]
    .filter(([name]) => name === "control" || name.startsWith("control-"))
    .map(([, value]) => Number.parseInt(value, 10))
    .sort((a, b) => a - b);
  expect(heights).toHaveLength(4);
  for (const [i, px] of heights.entries()) expect(px).toBe((heights[0] as number) + i * 4);
});

// 印刷は常にライト値。トグルへ勝つには同じ詳細度で後に置くしかない
test("@media print は :root[data-theme] より後に在る", () => {
  const css = CSS();
  expect(css.indexOf("@media print")).toBeGreaterThan(css.indexOf(':root[data-theme="dark"]'));
  expect(css.slice(css.indexOf("@media print"))).toContain(':root[data-theme="dark"]');
});

test("値が $& を含んでも front matter が壊れない", async () => {
  await withSandbox(async (dir) => {
    const css = asset(dir, "rabi.css");
    // 置換文字列として解釈されると、front matter 全体がここへ展開されて YAML が壊れる
    const probe = () => '"$&", -apple-system,';
    writeFileSync(css, readFileSync(css, "utf8").replace("-apple-system,", probe));

    expect((await run(dir)).code).toBe(0);
    const design = readFileSync(designPath(dir), "utf8");
    expect(design).toContain("$&");
    expect(design).not.toContain("version: alpha\nversion: alpha");
    expect((await run(dir, "--check")).code).toBe(0);
  });
});

// 地に置く面は面の明暗だけで分ける。ground と paper が同値だと、その差が消える
test("ground と paper は light でも dark でも違う", () => {
  const css = CSS();
  expect(themes(css, "ground")[0]).not.toBe(themes(css, "paper")[0]);
  expect(themes(css, "ground")[1]).not.toBe(themes(css, "paper")[1]);
});

test("文字色は強い順に ink > soft > faint", () => {
  const css = CSS();
  for (const theme of [0, 1] as const) {
    const [ink, soft, faint] = (["ink", "soft", "faint"] as const).map((n) =>
      contrast(themes(css, n)[theme], themes(css, "paper")[theme]),
    ) as [number, number, number];
    expect(ink).toBeGreaterThan(soft);
    expect(soft).toBeGreaterThan(faint);
  }
});

test("罫は濃い順に edge > divider > line", () => {
  const css = CSS();
  for (const theme of [0, 1] as const) {
    const [edge, divider, line] = (["edge", "divider", "line"] as const).map((n) =>
      contrast(themes(css, n)[theme], themes(css, "paper")[theme]),
    ) as [number, number, number];
    expect(edge).toBeGreaterThan(divider);
    expect(divider).toBeGreaterThan(line);
  }
});

test("accent は両テーマで同値", () => {
  const [light, dark] = themes(CSS(), "accent");
  expect(light).toBe(dark);
});

const ROLE_CSS_TEXT = () => readFileSync(ROLE_CSS, "utf8");

const ROLE_NAMES = ["info", "success", "attention"] as const;

/** チェックの形の SSOT。印・checklist・丸の中・ドロップダウンで共有する */
const CHECK_PATH = "d='M2.6 8.6l4.4 4.4 7.5-8'";

test("情報層のトークン SSOT が 3 ロールの fill / line / text を持つ", () => {
  const names = [...declarations(ROLE_CSS_TEXT()).keys()];
  expect(names.filter((n) => n.startsWith("role-")).sort()).toEqual(
    ROLE_NAMES.flatMap((role) => [`role-${role}`, `role-${role}-line`, `role-${role}-text`]).sort(),
  );
});

test("ブランド層は情報層のトークンを持たない", () => {
  expect(CSS()).not.toContain("--rabi-role-");
});

test("情報層は危険ロールを持たない", () => {
  expect(ROLE_CSS_TEXT()).not.toMatch(/--rabi-role-(danger|error|warning|critical)/);
});

test("rabi-components.css は情報層のトークンを引かない", () => {
  expect(readFileSync(join(SKILL, "assets/rabi-components.css"), "utf8")).not.toContain(
    "--rabi-role-",
  );
});

test("docs.html は情報層を読まない", () => {
  expect(readFileSync(join(DESIGN_DIR, "docs.html"), "utf8")).not.toContain("rabi-role");
});

test("components.html は情報層を読み 3 ロールを並べる", () => {
  const html = readFileSync(join(DESIGN_DIR, "components.html"), "utf8");
  expect(html).toContain("rabi-role.css");
  expect(html).toContain("rabi-note-info");
  expect(html).toContain("rabi-note-success");
  expect(html).toContain("rabi-note-attention");
});

test("rabi-role.css が触るのは 3 ロールと、その中の見出しだけ", () => {
  expect(new Set(classesIn("assets/rabi-role.css"))).toEqual(
    new Set(["rabi-note-info", "rabi-note-success", "rabi-note-attention", "rabi-note-title"]),
  );
});

// チェックは 4 か所に出る。形が割れたら読み分けられない印が増える
test.each([
  ["assets/rabi-components.css", 2],
  ["assets/rabi-role.css", 1],
] as const)("%s のチェックは共通のパス %i 回", (path, count) => {
  const css = readFileSync(join(SKILL, path), "utf8");
  expect(css.split(CHECK_PATH).length - 1).toBe(count);
});

test("components.html のドロップダウンのチェックも共通のパス", () => {
  const html = readFileSync(join(DESIGN_DIR, "components.html"), "utf8");
  expect(html.split(CHECK_PATH.replace(/'/g, '"')).length - 1).toBe(1);
});

test.each([...ROLE_NAMES])("%s の text は自分の fill の上で 4.5:1 を割らない", (role) => {
  const css = ROLE_CSS_TEXT();
  for (const theme of [0, 1] as const) {
    expect(
      contrast(themes(css, `role-${role}-text`)[theme], themes(css, `role-${role}`)[theme]),
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test.each([...ROLE_NAMES])("%s の line は隣接面のどれに対しても 3:1 を割らない", (role) => {
  const css = ROLE_CSS_TEXT();
  const brand = CSS();
  for (const theme of [0, 1] as const) {
    for (const bg of SURFACES) {
      expect(
        contrast(themes(css, `role-${role}-line`)[theme], themes(brand, bg)[theme]),
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

/**
 * `::-webkit-` と `::-moz-` を 1 つの並びに混ぜているセレクタ。
 *
 * 相手の擬似要素を知らない engine は、並びごと**規則を捨てる**。
 * 片方だけ効かなくなるのではなく、両方で UA 既定に戻る。
 */
function mixedVendorSelectors(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+?)\s*\{[^{}]*\}/g)]
    .map((m) => (m[1] as string).trim().replace(/\s+/g, " "))
    .filter((sel) => sel.includes("::-webkit-") && sel.includes("::-moz-"));
}

test.each(["assets/rabi-components.css", "assets/rabi.css", "assets/rabi-role.css"])(
  "%s は engine ごとの擬似要素を 1 つの並びに混ぜない",
  (rel) => {
    expect(mixedVendorSelectors(readFileSync(join(SKILL, rel), "utf8"))).toEqual([]);
  },
);

// **通ることは何も証明しない** —— 混ぜたら落ちることを実測する
test("engine ごとの擬似要素を混ぜると落ちる", () => {
  expect(
    mixedVendorSelectors(
      ".x::-webkit-progress-value,\n.x::-moz-progress-bar {\n  background: red;\n}",
    ),
  ).toEqual([".x::-webkit-progress-value, .x::-moz-progress-bar"]);
});

/** 所在が解決する先。`##` と `###` の両方を取る。 */
function headings(design: string): Set<string> {
  return new Set([...design.matchAll(/^#{2,3} (.+)$/gm)].map((m) => (m[1] as string).trim()));
}

/** 失敗パターンの表を (名, 所在) で返す。所在は鉤括弧の中。 */
function failurePatterns(design: string): { name: string; places: string[] }[] {
  return table(design, ["名", "所在"]).map((row) => ({
    name: row[0] as string,
    places: [...(row[1] as string).matchAll(/「([^」]+)」/g)].map((m) => m[1] as string),
  }));
}

/** 解決しない所在。同じ見出しを複数の名が指すので、束ねて返す。 */
const unresolvedPlaces = (design: string): string[] => {
  const known = headings(design);
  const missing = failurePatterns(design).flatMap((p) => p.places.filter((h) => !known.has(h)));
  return [...new Set(missing)].sort();
};

// 索引が指す先が消えても本文は無事なので、突き合わせないと静かにずれる
test("失敗パターンの所在が DESIGN.md の見出しに解決する", () => {
  expect(unresolvedPlaces(DESIGN_MD)).toEqual([]);
});

// **通ることは何も証明しない** —— 見出しを改名したら落ちることを実測する
test("見出しを改名すると落ちる", () => {
  expect(unresolvedPlaces(DESIGN_MD.replace(/^### 面と段$/m, "### 面と階調"))).toEqual(["面と段"]);
});

const singlePlaced = (design: string): string[] =>
  failurePatterns(design)
    .filter((p) => p.places.length < 2)
    .map((p) => p.name);

// 所在が 1 つの禁止はその見出しが索引（`DESIGN.md`「失敗パターン」）
test("失敗パターンの所在が 2 つ以上ある", () => {
  expect(singlePlaced(DESIGN_MD)).toEqual([]);
});

// **通ることは何も証明しない** —— 所在が 1 つの名を足したら落ちることを実測する
test("所在が 1 つの名を足すと落ちる", () => {
  const added = DESIGN_MD.replace(
    /^\| 押せる行を div で組む\s*\|.*$/m,
    (row) => `${row}\n| 半径を大きさと別に選ぶ | 「Shapes」 |`,
  );
  expect(singlePlaced(added)).toEqual(["半径を大きさと別に選ぶ"]);
});

const MEDIA_HEADER = ["媒体", "読むもの", "使える部品"] as const;
const SCENARIO_HEADER = ["お題", "媒体", "渡すもの", "見る軸"] as const;

/** 媒体表の第 1 列。EVAL.md のシナリオはこの文字列そのものを名乗る。 */
const media = (design: string): string[] =>
  table(design, MEDIA_HEADER).map((row) => row[0] as string);

/** シナリオが名乗る媒体。 */
const scenarioMedia = (evalMd: string): string[] =>
  table(evalMd, SCENARIO_HEADER).map((row) => row[1] as string);

test("媒体表を DESIGN.md から引けている", () => {
  expect(media(DESIGN_MD)).toEqual([
    "UI。意味ロールが 2 つ以上並ぶ面",
    "UI。それ以外",
    "文書（見積・譜面・PDF）",
    "CSS を持たない（docx・スライド）",
  ]);
});

const uncovered = (design: string, evalMd: string): string[] => {
  const named = scenarioMedia(evalMd);
  return media(design).filter((m) => !named.includes(m));
};

// 媒体を足してシナリオを足さないと、その媒体は一度も生成されずに入る
test("シナリオが媒体表の全行を覆う", () => {
  expect(uncovered(DESIGN_MD, EVAL_MD)).toEqual([]);
});

// **通ることは何も証明しない** —— 覆い漏れが落ちることを実測する
test("媒体を足してシナリオを足さないと落ちる", () => {
  const added = DESIGN_MD.replace(
    /^\| CSS を持たない（docx・スライド）.*$/m,
    (row) => `${row}\n| 紙。刷って配る面 | \`rabi.css\` だけ | 表のみ |`,
  );
  expect(uncovered(added, EVAL_MD)).toEqual(["紙。刷って配る面"]);
});

const unknownMedia = (design: string, evalMd: string): string[] => {
  const known = media(design);
  return scenarioMedia(evalMd).filter((m) => !known.includes(m));
};

// 媒体表に無い媒体を名乗ると、読むものも使える部品も決まらない
test("シナリオが媒体表に無い媒体を名乗らない", () => {
  expect(unknownMedia(DESIGN_MD, EVAL_MD)).toEqual([]);
});

// **通ることは何も証明しない** —— 言い換えたら落ちることを実測する
test("媒体を言い換えると落ちる", () => {
  const reworded = EVAL_MD.replace(/^(\| 読み物\s*\|)[^|]*/m, "$1 UI（その他） ");
  expect(unknownMedia(DESIGN_MD, reworded)).toEqual(["UI（その他）"]);
});

/** シナリオが挙げる見る軸。名は `DESIGN.md`「失敗パターン」のもの。 */
const scenarioAxes = (evalMd: string): string[] =>
  table(evalMd, SCENARIO_HEADER).flatMap((row) =>
    (row[3] as string).split("/").map((axis) => axis.trim()),
  );

const unknownAxes = (design: string, evalMd: string): string[] => {
  const known = new Set(failurePatterns(design).map((p) => p.name));
  return [...new Set(scenarioAxes(evalMd).filter((axis) => !known.has(axis)))].sort();
};

// 名を改名しても EVAL.md は落ちないので、突き合わせないと死んだ名を指し続ける
test("見る軸が失敗パターンの名に解決する", () => {
  expect(unknownAxes(DESIGN_MD, EVAL_MD)).toEqual([]);
});

// **通ることは何も証明しない** —— 改名したら落ちることを実測する
test("失敗パターンを改名すると落ちる", () => {
  expect(
    unknownAxes(DESIGN_MD.replace(/^\| 影で階層を作る /m, "| 影で層を作る "), EVAL_MD),
  ).toEqual(["影で階層を作る"]);
});

const unusedPatterns = (design: string, evalMd: string): string[] => {
  const axes = new Set(scenarioAxes(evalMd));
  return failurePatterns(design)
    .map((p) => p.name)
    .filter((name) => !axes.has(name));
};

// 見る軸に出ない名は、どのシナリオでも当たりを取られない
test("失敗パターンの名を見る軸が全部使う", () => {
  expect(unusedPatterns(DESIGN_MD, EVAL_MD)).toEqual([]);
});

// **通ることは何も証明しない** —— 使い漏れが落ちることを実測する
test("失敗パターンを足してシナリオへ足さないと落ちる", () => {
  const added = DESIGN_MD.replace(
    /^\| 押せる行を div で組む\s*\|.*$/m,
    (row) => `${row}\n| 半径を大きさと別に選ぶ | 「Shapes」「Components」 |`,
  );
  expect(unusedPatterns(added, EVAL_MD)).toEqual(["半径を大きさと別に選ぶ"]);
});
