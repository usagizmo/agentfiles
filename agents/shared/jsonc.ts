// JSONC。行コメントとブロックコメント、末尾カンマを許す。文字列の中は触らない。
// コメントは削除せず同幅空白にする。token 連結を禁止し、JSON.parse の位置をずらさない。

export const parseJsonc = (text: string): unknown => JSON.parse(toJson(text));

const toJson = (text: string): string => {
  let out = "";
  let i = 0;
  const n = text.length;
  const skipIdle = (from: number): number => {
    let j = from;
    while (j < n) {
      const ch = text[j];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        j += 1;
        continue;
      }
      if (ch === "/" && text[j + 1] === "/") {
        j += 2;
        while (j < n && text[j] !== "\n") j += 1;
        continue;
      }
      if (ch === "/" && text[j + 1] === "*") {
        j += 2;
        while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
        if (j >= n) throw new SyntaxError("Unterminated block comment");
        j += 2;
        continue;
      }
      break;
    }
    return j;
  };
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      out += c;
      i += 1;
      while (i < n) {
        const s = text[i];
        out += s;
        i += 1;
        if (s === "\\") {
          if (i < n) {
            out += text[i];
            i += 1;
          }
          continue;
        }
        if (s === '"') break;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const start = i;
      i = skipIdle(i);
      out += " ".repeat(i - start);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const start = i;
      i = skipIdle(i);
      out += " ".repeat(i - start);
      continue;
    }
    if (c === ",") {
      const next = skipIdle(i + 1);
      if (text[next] === "}" || text[next] === "]") {
        i += 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
};
