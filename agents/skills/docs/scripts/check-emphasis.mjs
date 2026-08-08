// 強調 `**` が壊れている箇所を出す。audit-skills.sh の emphasis check の実体。
//
// 入力 (stdin): 1 行 1 件 `<display>\t<physical>`
// 出力 (stdout): 1 行 1 件 `<display>\t<行>\t<抜粋>`
//
// **正規表現では判定できない。**CommonMark の flanking は開き / 閉じの対応まで
// 見ないと結論が出ない。`**` 単体の左右判定だと、右 flanking は成立するのに
// 対応する開きが無くてリテラルへ落ちる `**` を取り逃す（実測でこの形の実バグを
// 1 件見落とした）。だから delimiter の対応をここで解く。
//
// **段落単位で見る。**強調はソフトブレークをまたげるので、行単位だと
// 2 行に分かれた 1 組を両方とも未対応と誤判定する。
//
// 外部依存を持たない。commit gate から呼ばれるので、レンダラを引いてくると
// ネットワークとインストール状態が gate の成否に混ざる。

// CommonMark の flanking 判定が使う「punctuation」は Unicode の P と S。
// 日本語の `。、「」（）` はすべて P に入る。
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;

// 文字列の端は whitespace 扱い（CommonMark の規定）。undefined がそれ。
const isSpace = (c) => c === undefined || SPACE.test(c);
const isPunct = (c) => c !== undefined && PUNCT.test(c);

function canOpen(prev, next) {
  if (isSpace(next)) return false;
  if (!isPunct(next)) return true;
  return isSpace(prev) || isPunct(prev);
}

function canClose(prev, next) {
  if (isSpace(prev)) return false;
  if (!isPunct(prev)) return true;
  return isSpace(next) || isPunct(next);
}

// コードスパンは強調を解釈しない。中の `**` を数えると誤検知になるので伏せる。
// **バッククォート自体は残す。**flanking は生テキストの前後 1 文字で決まり、
// `` ` `` は punctuation。ここまで伏せると `。**`code`` の閉じが punctuation を
// 失って右 flanking が崩れ、壊れていない行を壊れていると言う。
// 長さを保つのは、伏せたあとも元のオフセットで行番号を引くため。
function maskCodeSpans(text) {
  return text.replace(
    /(`+)([^`]|[^`][\s\S]*?)\1/g,
    (_m, ticks, body) => ticks + "x".repeat(body.length) + ticks,
  );
}

// フェンス内は本文ではない（規約そのものを逐語で載せたブロックがある）。
// 空行で段落へ割る。
function paragraphs(src) {
  const lines = src.split("\n");
  const out = [];
  let cur = null;
  let fence = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (m) {
      const ch = m[1][0];
      if (fence === null) fence = ch;
      else if (fence === ch) fence = null;
      flush();
      continue;
    }
    if (fence !== null) continue;
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (!cur) cur = { start: i + 1, text: "" };
    cur.text += (cur.text ? "\n" : "") + line;
  }
  flush();
  return out;
}

function brokenRuns(para) {
  const t = maskCodeSpans(para.text);
  const runs = [];
  for (let i = 0; i < t.length;) {
    if (t[i] !== "*") {
      i++;
      continue;
    }
    let j = i;
    while (t[j] === "*") j++;
    // `*` 単体（イタリック）や `***` が混じる段落は、対応の解き方が
    // `**` だけのときと変わる。誤検知を出すより判定を降りる。
    if (j - i !== 2) return [];
    runs.push({ at: i, prev: t[i - 1], next: t[j] });
    i = j;
  }
  const open = [];
  const broken = [];
  for (const r of runs) {
    if (canClose(r.prev, r.next) && open.length) {
      open.pop();
      continue;
    }
    if (canOpen(r.prev, r.next)) {
      open.push(r);
      continue;
    }
    broken.push(r); // 開きにも閉じにもなれない
  }
  return broken.concat(open); // 開いたまま閉じられなかったものも壊れている
}

const input = await new Response(process.stdin).text();
let found = 0;

for (const row of input.split("\n")) {
  if (!row.trim()) continue;
  const [display, physical] = row.split("\t");
  if (!physical) continue;
  let src;
  try {
    src = await (await import("node:fs/promises")).readFile(physical, "utf8");
  } catch {
    continue;
  }
  for (const para of paragraphs(src)) {
    for (const r of brokenRuns(para)) {
      const before = para.text.slice(0, r.at);
      const line = para.start + (before.match(/\n/g) || []).length;
      const col = before.length - (before.lastIndexOf("\n") + 1);
      const text = para.text.split("\n")[(before.match(/\n/g) || []).length];
      const from = Math.max(0, col - 20);
      process.stdout.write(`${display}\t${line}\t${text.slice(from, from + 60).trim()}\n`);
      found++;
    }
  }
}

process.exit(found > 0 ? 1 : 0);
