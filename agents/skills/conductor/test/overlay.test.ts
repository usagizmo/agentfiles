// 旧 overlay JSON は journal が空のときだけ取り込む。二度目は読まない。

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadJournal, openNotes } from "../src/journal.ts";
import { importOverlay, overlayFromJournal } from "../src/overlay.ts";

const DIR = join(tmpdir(), "conductor-overlay-");
const tmp = (name: string) => {
  const dir = `${DIR}${name}`;
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe("importOverlay", () => {
  test("journal が空なら overlay を note として取り込む", () => {
    const dir = tmp("import");
    const journal = join(dir, "j.ndjson");
    const overlay = join(dir, "o.json");
    writeFileSync(
      overlay,
      JSON.stringify({
        humanTodo: [
          {
            id: "kept",
            title: "pane が拒否した",
            detail: "agent_not_ready",
            unblocks: "idle",
            issues: [],
            kind: "env",
          },
        ],
      }),
    );
    const events = importOverlay(journal, overlay, "t");
    expect(openNotes(events)).toEqual([
      {
        id: "kept",
        title: "pane が拒否した",
        detail: "agent_not_ready",
        unblocks: "idle",
        issues: [],
        kind: "env",
      },
    ]);
  });

  test("journal に note があれば overlay を読まない", () => {
    const dir = tmp("skip");
    const journal = join(dir, "j.ndjson");
    const overlay = join(dir, "o.json");
    writeFileSync(
      journal,
      `${JSON.stringify({
        kind: "note",
        at: "t0",
        id: "a",
        title: "先にある",
        detail: "d",
        unblocks: "u",
        issues: [],
        noteKind: "intake",
      })}\n`,
    );
    writeFileSync(
      overlay,
      JSON.stringify({
        humanTodo: [
          {
            title: "後から足した",
            detail: "x",
            unblocks: "y",
            issues: [],
            kind: "env",
          },
        ],
      }),
    );
    const events = importOverlay(journal, overlay, "t");
    expect(openNotes(events).map((n) => n.title)).toEqual(["先にある"]);
    expect(loadJournal(journal)).toHaveLength(1);
  });
});

describe("overlayFromJournal", () => {
  test("clear された行は出さない", () => {
    const overlay = overlayFromJournal([
      {
        kind: "note",
        at: "t",
        id: "a",
        title: "one",
        detail: "d",
        unblocks: "u",
        issues: [1],
        noteKind: "env",
      },
      { kind: "clear", at: "t2", id: "a" },
    ]);
    expect(overlay.humanTodo).toEqual([]);
  });
});
