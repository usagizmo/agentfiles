// Issue 契約の充足判定。**見出しの字面が契約の実体**（SSOT は
// `references/issue-contract.md`。字面を変えるときはあちらと同時に変える）。
//
// **項目の質は測らない。**見出しが在り、直下に中身があることまで —— そこから先は工程の責任。

import type { Observed } from "./types.ts";
import { present } from "./types.ts";

/** **完全一致で引く。**言い換えると契約が観測できない。 */
export const CONTRACT_HEADINGS = [
  "## 目的",
  "## 受入条件",
  "## 非目標",
  "## 確定済みの製品判断",
  "## リスク",
  "## 依存",
] as const;
export type ContractHeading = (typeof CONTRACT_HEADINGS)[number];

/** 見出しの直下に中身があるか。**空行と次の見出しだけなら不足。** */
const hasContent = (body: string, heading: ContractHeading): boolean => {
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.trimEnd() === heading);
  if (index < 0) return false;
  for (const line of lines.slice(index + 1)) {
    if (line.startsWith("## ")) return false;
    if (line.trim() !== "") return true;
  }
  return false;
};

/** 揃っていない見出しの一覧。**人へ返す不足項目**がそのまま取れる。 */
export const missingContractItems = (body: string): readonly ContractHeading[] =>
  CONTRACT_HEADINGS.filter((heading) => !hasContent(body, heading));

/**
 * 契約が揃っているか。**本文が読めないときは呼ばない**（呼ぶ側が `unobservable` を返す）——
 * ここで `false` に倒すと、観測できなかっただけの課題が差し戻される。
 */
export const issueContractComplete = (body: string): Observed<boolean> =>
  present(missingContractItems(body).length === 0);
