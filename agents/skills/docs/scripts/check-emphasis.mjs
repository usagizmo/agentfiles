// 強調 `**` が壊れている箇所を出す。audit-skills.sh の emphasis check の実体。
//
// 入力 (stdin): 1 行 1 件 `<display>\t<physical>`
// 出力 (stdout): 1 行 1 件 `<display>\t<行>\t<抜粋>`
//
// **正規表現では判定できない。**CommonMark の flanking は開き / 閉じの対応まで
// 見ないと結論が出ず、右 flanking は成立するのに相手が無くてリテラルへ落ちる
// `**` を取り逃す。描画して `**` が残るかを見るのが唯一確実な判定。
//
// **段落単位で描画する。**強調はソフトブレークをまたげるので、行単位だけだと
// 2 行に分かれた 1 組を壊れていると誤判定する。壊れた段落を見つけてから行を絞る。
//
// marked は GFM。GitHub でどう出るかが知りたいことなので、素の CommonMark より合う。

// 依存が入っていないことと、違反が在ることを exit code で区別する。
// 混ぜると「未インストールで落ちた」が「検査して黒だった」に見える。
let marked;
try {
  ({ marked } = await import("marked"));
} catch {
  process.exit(2);
}

// **描画後にコードスパンを除いてから探す。**規約そのものを説明する文には
// `` `**` `` が逐語で出てくる。描画結果に残る `<code>**</code>` を数えると、
// 壊れていない行を壊れていると言う。
const broken = (text) =>
  marked
    .parseInline(text)
    .replace(/<code>[\s\S]*?<\/code>/g, "")
    .includes("**");

// フェンス内は本文ではない（規約そのものを逐語で載せたブロックがある）。
// 空行で段落へ割る。
function paragraphs(src) {
  const out = [];
  let cur = null;
  let fence = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  src.split("\n").forEach((text, i) => {
    const m = text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (m) {
      fence = fence === null ? m[1][0] : fence === m[1][0] ? null : fence;
      flush();
      return;
    }
    if (fence !== null) return;
    if (text.trim() === "") return flush();
    if (!cur) cur = [];
    cur.push({ no: i + 1, text });
  });
  flush();
  return out;
}

let found = 0;

for (const row of (await Bun.stdin.text()).split("\n")) {
  const [display, physical] = row.split("\t");
  if (!physical) continue;
  const file = Bun.file(physical);
  if (!(await file.exists())) continue;

  for (const para of paragraphs(await file.text())) {
    if (!broken(para.map((l) => l.text).join("\n"))) continue;
    // 段落が壊れている。原因の行まで絞る。行をまたぐ 1 組なら両端とも残る。
    const lines = para.filter((l) => broken(l.text));
    for (const l of lines.length ? lines : [para[0]]) {
      console.log(`${display}\t${l.no}\t${l.text.trim().slice(0, 80)}`);
      found++;
    }
  }
}

process.exit(found > 0 ? 1 : 0);
