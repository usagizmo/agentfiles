// tracked な非 Markdown ファイルのコメント。規則は agents/AGENTS.md の「文章の書き方」。
//
// コメントはどの表示面でも markdown として描かれないので、強調は記号がそのまま残るだけになる。
// 検査を置かないと、markdown を書き慣れた手が同じ記法を持ち込んで静かに増える。
//
// 行頭がコメント記号の行だけを見る。行末コメントとブロック本文は見落とすが、
// 見落としは書き手を止めない。止めてはいけないのは誤検知の側なので、そちらを狭く取る。
//
// 複数行文字列の中の markdown 見出しはコメントと見分けが付かない。誤検知したときだけ、
// その入力を test/fixtures/ へ移す。

import { join } from "node:path";
import { expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..");

// 捕獲した TUI の pane。書いた文章ではないので、整形して合わせる対象にしない。
const CAPTURED = "test/fixtures/";

const trackedFiles = async () => {
  const p = Bun.spawn(["git", "ls-files", "-z"], { cwd: ROOT, stdout: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  expect(code).toBe(0);
  return out.split("\0").filter((f) => f !== "" && !f.endsWith(".md") && !f.startsWith(CAPTURED));
};

const isComment = (line: string) => /^\s*(#|\/\/|\*|\/\*)/.test(line);

// 強調は開いて閉じる対。単独で出る記号は冪乗演算子と glob と JSDoc の区切りなので、対でだけ拾う。
// 対の内側に `*` を挟む強調は落ちる。glob を含む path と見分ける手がかりが行内に無い。
const emphasized = (line: string) => /\*\*[^\s*][^*]*\*\*/.test(line);

test("コメントに markdown の強調を書かない", async () => {
  const hits: string[] = [];
  for (const file of await trackedFiles()) {
    const text = await Bun.file(join(ROOT, file)).text();
    text.split("\n").forEach((line, i) => {
      if (isComment(line) && emphasized(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  expect(hits).toEqual([]);
});
