#!/usr/bin/env node
// 状況ボードを書く。**HTML は受け取らない** —— 観測から作った JSON だけを受け取り、
// `assets/board.html` と `assets/rabi.css` を差し込んで 1 ファイルへ出す。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [dataArg, outArg] = process.argv.slice(2);
if (!dataArg || !outArg) {
  console.error("usage: board.mjs <データ.json | -> <出力.html>");
  process.exit(2);
}

const asset = (name) => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
const data = readFileSync(dataArg === "-" ? 0 : dataArg, "utf8");

// 壊れた JSON はここで落とす。盤面を半端に上書きしない
try {
  JSON.parse(data);
} catch (err) {
  console.error(`データが JSON として読めない: ${err.message}`);
  process.exit(1);
}

const html = readFileSync(asset("board.html"), "utf8")
  .replace("/*__RABI_CSS__*/", () => readFileSync(asset("rabi.css"), "utf8"))
  .replace("/*__BOARD_DATA__*/", () => data);

const out = resolve(outArg);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(out);
