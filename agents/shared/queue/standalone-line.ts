// 固定 marker の単独行。
//
// 記録は行全体が `<!-- name -->` のときだけ。散文・code span・見出しの字面は拾わない。
// 行末の空白と `\r` は無視する。先頭の空白は無視しない。

export type LineSpan = { readonly start: number; readonly end: number };

/** 行末の `\r` と空白を除いた行。先頭は触らない。 */
const bareStandaloneLine = (line: string): string => {
  const withoutCr = line.endsWith("\r") ? line.slice(0, -1) : line;
  return withoutCr.replace(/[ \t]+$/, "");
};

export const standaloneLineSpans = (body: string, tag: string): LineSpan[] => {
  const found: LineSpan[] = [];
  let offset = 0;
  for (const line of body.split("\n")) {
    if (bareStandaloneLine(line) === tag) {
      found.push({ start: offset, end: offset + line.length });
    }
    offset += line.length + 1;
  }
  return found;
};

export const hasStandaloneLine = (body: string, tag: string): boolean =>
  standaloneLineSpans(body, tag).length > 0;

/** 開き marker の形。名前は列挙しない。 */
const OPEN = /^<!-- ([a-z][a-z-]*) -->$/;
const CLOSE = /^<!-- \/[a-z][a-z-]* -->$/;

export const standaloneOpenMarkerNames = (body: string): string[] => {
  const names: string[] = [];
  for (const line of body.split("\n")) {
    const name = OPEN.exec(bareStandaloneLine(line))?.[1];
    if (name !== undefined) names.push(name);
  }
  return names;
};

export const hasStandaloneMarkerShape = (body: string): boolean => {
  for (const line of body.split("\n")) {
    const bare = bareStandaloneLine(line);
    if (OPEN.test(bare) || CLOSE.test(bare)) return true;
  }
  return false;
};

export type ExtractedYaml =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "present"; readonly yaml: string };

export const extractStandaloneYaml = (body: string, name: string): ExtractedYaml => {
  const opens = standaloneLineSpans(body, `<!-- ${name} -->`);
  const open = opens[0];
  if (open === undefined) return { kind: "absent" };
  if (opens.length >= 2) return { kind: "invalid", reason: `marker ${name} が 2 つある` };
  const close = standaloneLineSpans(body, `<!-- /${name} -->`).find((c) => c.start >= open.end);
  if (close === undefined) return { kind: "invalid", reason: `marker ${name} が閉じていない` };
  const inner = body.slice(open.end, close.start);
  const fence = /```(?:yaml)?\r?\n([\s\S]*?)```/.exec(inner);
  if (fence === null) return { kind: "invalid", reason: `marker ${name} に yaml ブロックが無い` };
  return { kind: "present", yaml: fence[1] ?? "" };
};
