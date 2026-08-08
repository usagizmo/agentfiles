// 強調 `**` が壊れている箇所を出す。audit-skills.sh の emphasis check の実体。
//
// 入力 (stdin): 1 行 1 件 `<display>\t<physical>`
// 出力 (stdout): 1 行 1 件 `<display>\t<行>\t<抜粋>`
// exit: 0=壊れなし / 1=壊れあり（出力あり） / 2=marked が入っていない
//
// **正規表現では判定できない。**CommonMark の flanking は開き / 閉じの対応まで
// 見ないと結論が出ず、右 flanking は成立するのに相手が無くてリテラルへ落ちる
// `**` を取り逃す。描画して `**` が残るかを見るのが唯一確実な判定。
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
const broken = (text) =>
  marked
    .parseInline(text)
    .replace(/<code>[\s\S]*?<\/code>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .includes("**");

// 強調が閉じられる範囲の先頭。**空行だけで切ると足りない** — 別々のリスト項目や
// 表の行にある未対応の `**` どうしが 1 つの塊に見え、対応したことになって見逃す。
const BLOCK_HEAD = /^ {0,3}(?:[-*+]|\d+[.)])\s|^ {0,3}#{1,6}\s|^ {0,3}>|^ {0,3}\|/;
// 見出しと表の行は 1 行で閉じる。リスト項目と引用は継続行を持つので閉じない
const ONE_LINE = /^ {0,3}#{1,6}\s|^ {0,3}\|/;
const INDENT_CODE = /^(?: {4}|\t)/;

/** 強調が閉じられる範囲（inline container）ごとに `{ no, text }[]` を返す。 */
function containers(src) {
  const out = [];
  let cur = null;
  let fence = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  src.split("\n").forEach((text, i) => {
    // fence は開いた記号と同じ文字・同じ長さ以上でしか閉じない
    const f = text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) {
      const ch = f[1][0];
      if (fence === null) fence = { ch, len: f[1].length };
      else if (fence.ch === ch && f[1].length >= fence.len) fence = null;
      flush();
      return;
    }
    if (fence !== null) return;
    if (text.trim() === "") return flush();
    // 段落の外側にある字下げはコードブロック（段落の途中なら継続行なので残す）
    if (!cur && INDENT_CODE.test(text)) return;
    if (BLOCK_HEAD.test(text)) flush();
    if (!cur) cur = [];
    cur.push({ no: i + 1, text });
    if (ONE_LINE.test(text)) flush();
  });
  flush();
  return out;
}

/** 壊れている行を `{ no, text }` で返す。判定の入口はここ 1 つ（test もこれを見る）。 */
export function brokenLines(src) {
  const out = [];
  for (const c of containers(src)) {
    if (!broken(c.map((l) => l.text).join("\n"))) continue;
    // 範囲が壊れている。原因の行まで絞る。行をまたぐ 1 組なら両端とも残る。
    const lines = c.filter((l) => broken(l.text));
    out.push(...(lines.length ? lines : [c[0]]));
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
