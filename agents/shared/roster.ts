// roster.toml の読み込み。トップレベルのキーはここだけが知る。
// 表の中身の検証は読む側（advisors.ts が advisors、conductor の config.ts が executors）。

import { TOML } from "bun";

export type Roster = {
  readonly advisors: unknown;
  readonly executors: unknown;
};

export class RosterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterFormatError";
  }
}

const TOP_KEYS = new Set(["advisors", "executors"]);

/** TOML を読み、表ごとの生値を返す。壊れた TOML・未知のトップレベルキー・表の欠落は止まる。 */
export const parseRosterToml = (text: string): Roster => {
  let doc: unknown;
  try {
    doc = TOML.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RosterFormatError(`TOML として読めない: ${detail}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new RosterFormatError("roster が table ではない");
  }
  const o = doc as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!TOP_KEYS.has(key)) throw new RosterFormatError(`roster の ${key} は未知`);
  }
  for (const key of TOP_KEYS) {
    if (o[key] === undefined) throw new RosterFormatError(`roster に ${key} が無い`);
  }
  return { advisors: o["advisors"], executors: o["executors"] };
};
