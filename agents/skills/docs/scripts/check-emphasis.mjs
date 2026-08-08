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

// 依存が入っていないことと、違反が在ることを exit code で区別する（未インストールは 2）。
// 混ぜると「入っていないから落ちた」が「検査して黒だった」に見える。
let marked = null;
try {
  ({ marked } = await import("marked"));
} catch {
  // CLI は import.meta.main 側で exit 2。import した側には throw させる
}

// **描画結果からタグとコードを取り除いてから探す。**残すとテキスト以外の `**` を数える —
// 規約を逐語で説明する `` `**` ``、HTML コメント、属性値。いずれも表示上は強調ではない。
const broken = (html) =>
  html
    .replace(/<code[^>]*>[\s\S]*?<\/code>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .includes("**");

/** 壊れている行を `{ no, text }` で返す。判定の入口はここ 1 つ（test もこれを見る）。 */
export function brokenLines(src) {
  const out = [];
  let offset = 0;
  for (const token of marked.lexer(src)) {
    const start = offset;
    offset += token.raw.length;
    // コードブロックは本文ではない（規約そのものを逐語で載せたブロックがある）
    if (token.type === "space" || token.type === "code") continue;
    if (!broken(marked.parser([token]))) continue;
    // この block が壊れている。原因は中の `**` を持つ行。
    const base = src.slice(0, start).split("\n").length;
    token.raw.split("\n").forEach((text, i) => {
      if (text.includes("**")) out.push({ no: base + i, text });
    });
  }
  return out;
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
