import { expect, test } from "bun:test";
import { parseJsonc } from "../agents/shared/jsonc.ts";

test("閉じていないブロックコメントは止まる", () => {
  expect(() => parseJsonc("[] /*")).toThrow(SyntaxError);
  expect(() => parseJsonc("{ /*")).toThrow(SyntaxError);
});

test("コメントは token を連結しない", () => {
  expect(() => parseJsonc("[1/*c*/2]")).toThrow();
  expect(() => parseJsonc("[tru/*c*/e]")).toThrow();
});

test("閉じたブロックコメントは値を残す", () => {
  expect(parseJsonc("[1, /* skip */ 2]")).toEqual([1, 2]);
});
