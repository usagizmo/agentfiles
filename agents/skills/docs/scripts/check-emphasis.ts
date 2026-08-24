// 強調 `**` が壊れている箇所を出す。audit-skills.sh の emphasis check の実体。
//
// 入力 (stdin): 1 行 1 件 `<display>\t<physical>`
// 出力 (stdout): 1 行 1 件 `<display>\t<行>\t<抜粋>`
// exit: 0=壊れなし / 1=壊れあり（出力あり） / 2=marked が入っていない
//
// **判定は描画結果そのもの。**知りたいのは「GitHub で `**` が記号のまま出るか」で、
// flanking 規則を自前で解くと開き / 閉じの対応まで見ないと結論が出ないうえ、
// block の切り方が CommonMark とずれた分だけ誤検知と見逃しが残る。
//
// **block の分割は lexer に任せる。**強調が閉じられる範囲は block 構造で決まるので、
// 空行やマーカーで自前に切ると引用・setext 見出し・fence の境界で必ずずれる。
// トップレベル token なら `raw` の積算がソース位置と一致するので、行番号も正確に出る。
//
// marked は GFM。GitHub でどう出るかが知りたいことなので、素の CommonMark より合う。

type Marked = typeof import("marked").marked;

// 依存が入っていないことと、違反が在ることを exit code で区別する（未インストールは 2）。
// 混ぜると「入っていないから落ちた」が「検査して黒だった」に見える。
let marked: Marked | null = null;
try {
  ({ marked } = await import("marked"));
} catch (e) {
  // **未導入だけを 2 に落とす。**壊れた依存も初期化例外もまとめて畳むと、
  // 「入っていない」と「壊れている」が同じ SKIP になって検査が黙って消える
  if ((e as { code?: string } | null)?.code !== "ERR_MODULE_NOT_FOUND") throw e;
  // CLI は import.meta.main 側で exit 2。import した側には markdown() が throw させる
}

/** marked が無いまま判定へ入ったら止める。未導入を「違反なし」に化けさせない。 */
function markdown(): Marked {
  if (!marked) throw new Error("marked が入っていない（./init.sh）");
  return marked;
}

// **描画結果からタグとコードを取り除いてから探す。**残すとテキスト以外の `**` を数える —
// 規約を逐語で説明する `` `**` ``、HTML コメント、属性値。いずれも表示上は強調ではない。
const stripped = (html: string) =>
  html.replace(/<code[^>]*>[\s\S]*?<\/code>/g, "").replace(/<!--[\s\S]*?-->/g, "");

/**
 * 同種の強調の入れ子は delimiter に依らず落とす。`<strong>` の正規表現 1 本だと
 * `<em>` の入れ子が軸ごと抜ける。描画結果のタグスタックで見る。
 * 隣り合う 2 つの強調と、種類の違う入れ子（太字の中の斜体）は通す。
 */
function violationKinds(html: string): Set<string> {
  const kinds = new Set<string>();
  const text = stripped(html);
  if (text.replace(/<[^>]*>/g, "").includes("**")) kinds.add("literal-asterisks");
  const open: string[] = [];
  for (const match of text.matchAll(/<(\/?)(strong|em)\b[^>]*>/g)) {
    // 正規表現の捕獲は strong / em だけ。既知の 2 つ以外はスタックへ積まない
    const tag = match[2];
    if (tag !== "strong" && tag !== "em") continue;
    if (match[1] === "/") {
      const at = open.lastIndexOf(tag);
      if (at >= 0) open.splice(at, 1);
      continue;
    }
    if (open.includes(tag)) kinds.add("nested-emphasis");
    open.push(tag);
  }
  return kinds;
}

const broken = (html: string) => violationKinds(html).size > 0;

export type BrokenLine = { no: number; text: string };

/** 壊れている行を `{ no, text }` で返す。判定の入口はここ 1 つ（test もこれを見る）。 */
export function brokenLines(src: string): BrokenLine[] {
  const out: BrokenLine[] = [];
  let offset = 0;
  for (const token of markdown().lexer(src)) {
    const start = offset;
    offset += token.raw.length;
    // コードブロックは本文ではない（規約そのものを逐語で載せたブロックがある）
    if (token.type === "space" || token.type === "code") continue;
    if (!broken(markdown().parser([token]))) continue;
    // この block が壊れている。原因は中の `**` を持つ行。
    const base = src.slice(0, start).split("\n").length;
    token.raw.split("\n").forEach((text, i) => {
      // コードスパンの中の記号は原因ではない。斜体の入れ子は `*` 1 個なので `*` を見る。
      if (text.replace(/`+[^`]*`+/g, "").includes("*")) out.push({ no: base + i, text });
    });
  }
  return out;
}

const REQUIRED_KINDS = ["literal-asterisks", "nested-emphasis"];

const FIXTURES: { name: string; source: string; expect: string[] }[] = [
  { name: "閉じ側", source: "**これは。**続く文", expect: ["literal-asterisks"] },
  { name: "誤ペア strong", source: "これは**前。**続き**後**です", expect: ["nested-emphasis"] },
  { name: "誤ペア em", source: "これは*前。*続き*後*です", expect: ["nested-emphasis"] },
  { name: "隣り合う強調", source: "**規則**。**別の規則**。", expect: [] },
  { name: "太字の中の斜体", source: "これは**太字に *斜体* を含む**文", expect: [] },
];

/**
 * 軸の集合と正例・負例の存在を corpus 走査の前に確かめる。
 * 件数閾値で代用しない。判定 file からこの関数が消えたら import 側が赤くなる。
 */
export function validateEmphasisFixtures(): string[] {
  const problems: string[] = [];
  if (FIXTURES.length === 0) problems.push("FIXTURES が空です");
  const expectations = FIXTURES.map((f) => f.expect);
  if (!expectations.some((kinds) => kinds.length === 0)) {
    problems.push("正しい fixture が 1 件もありません");
  }
  for (const kind of REQUIRED_KINDS) {
    if (!expectations.some((kinds) => kinds.includes(kind))) {
      problems.push(`${kind} を期待する fixture が 1 件もありません`);
    }
  }
  for (const { name, source, expect } of FIXTURES) {
    const detected = [
      ...new Set(
        markdown()
          .lexer(source)
          .flatMap((token) =>
            token.type === "space" || token.type === "code"
              ? []
              : [...violationKinds(markdown().parser([token]))],
          ),
      ),
    ].sort();
    if (detected.join() !== [...expect].sort().join()) {
      problems.push(`fixture「${name}」: 期待 [${expect}] / 実測 [${detected}]`);
    }
  }
  return problems;
}

if (import.meta.main) {
  if (!marked) process.exit(2);
  let found = 0;
  for (const row of (await Bun.stdin.text()).split("\n")) {
    const [display, physical] = row.split("\t");
    if (!physical) continue;
    const file = Bun.file(physical);
    if (!(await file.exists())) continue;
    for (const l of brokenLines(await file.text())) {
      console.log(`${display}\t${l.no}\t${l.text.trim().slice(0, 80)}`);
      found++;
    }
  }
  process.exit(found > 0 ? 1 : 0);
}
