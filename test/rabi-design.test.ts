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

/** DESIGN.md の front matter だけを返す。本文の例は写しでは**ない**ので検査に混ぜない。 */
function frontMatter(design: string): string {
  const m = design.match(/^---\n([\s\S]*?\n)---\n/);
  if (!m?.[1]) throw new Error("DESIGN.md に front matter が無い");
  return m[1];
}

const DESIGN_DIR = join(import.meta.dir, "../design");

/** `design/` の面は全部見る。1 枚だけ見ると 2 枚目が無検査で入る。 */
const surfaces = readdirSync(DESIGN_DIR).filter((name) => name.endsWith(".html"));

/** `assets/` の html も展開されて面になる。design/ だけ見ると asset が無検査で入る。 */
const assets = readdirSync(join(SKILL, "assets")).filter((name) => /\.(html|js)$/.test(name));

/** rabi.css が宣言していない `var(--rabi-…)` を返す。 */
function undeclaredTokens(path: string): string[] {
  const declared = declarations(readFileSync(join(SKILL, "assets/rabi.css"), "utf8"));
  const referenced = [...readFileSync(path, "utf8").matchAll(/var\(--rabi-([a-z0-9_-]+)\)/g)].map(
    (m) => m[1] as string,
  );
  return [...new Set(referenced.filter((n) => !declared.has(n)))];
}

test.each(surfaces)("%s が引くトークンは rabi.css に在る", (name) => {
  expect(undeclaredTokens(join(DESIGN_DIR, name))).toEqual([]);
});

test.each(assets)("assets/%s が引くトークンは rabi.css に在る", (name) => {
  expect(undeclaredTokens(join(SKILL, "assets", name))).toEqual([]);
});

test("assets/ に展開する html が 1 枚以上ある", () => {
  expect(assets.length).toBeGreaterThan(0);
});

// DESIGN.md「Colors」の「16 進値を写さず、常にトークンを参照する」を asset 自身にも効かせる
test.each(assets)("assets/%s は 16 進値を写していない", (name) => {
  const html = readFileSync(join(SKILL, "assets", name), "utf8");
  expect(html.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
});

test("design/ に面が 1 枚以上ある", () => {
  expect(surfaces.length).toBeGreaterThan(0);
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
  ["edge", 3],
];

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

test("components の外で token 参照へ変えると落ちる", async () => {
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

test("components の token 参照が実在しないと落ちる", async () => {
  await withSandbox(async (dir) => {
    const design = designPath(dir);
    const original = readFileSync(design, "utf8");
    writeFileSync(
      design,
      original.replace('backgroundColor: "{colors.accent}"', 'backgroundColor: "{colors.crimson}"'),
    );

    const { code, output } = await run(dir, "--check");
    expect(output).toContain("colors.crimson");
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

test("light は ground と paper が同値、dark は違う", () => {
  const css = CSS();
  expect(themes(css, "ground")[0]).toBe(themes(css, "paper")[0]);
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
