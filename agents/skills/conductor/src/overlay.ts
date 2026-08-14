// 旧 overlay JSON を journal へ一度だけ取り込む。**取り込み後は読まない。**

import { readFileSync } from "node:fs";
import { parseOverlay, type BoardOverlay } from "./board.ts";
import {
  appendJournal,
  loadJournal,
  newNoteId,
  openNotes,
  type JournalEvent,
  type NoteRecord,
} from "./journal.ts";

export const overlayFromJournal = (events: readonly JournalEvent[]): BoardOverlay => ({
  humanTodo: openNotes(events).map((n) => ({
    id: n.id,
    title: n.title,
    detail: n.detail,
    unblocks: n.unblocks,
    issues: n.issues,
    kind: n.kind,
  })),
});

const loadOverlayFile = (path: string): BoardOverlay => {
  try {
    return parseOverlay(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
};

const alreadyHasNotes = (events: readonly JournalEvent[]): boolean =>
  events.some((e) => e.kind === "note" || e.kind === "clear");

const toNote = (todo: NonNullable<BoardOverlay["humanTodo"]>[number], at: string): NoteRecord => ({
  kind: "note",
  at,
  id: todo.id ?? newNoteId(),
  title: todo.title,
  detail: todo.detail,
  unblocks: todo.unblocks,
  issues: todo.issues,
  noteKind: todo.kind,
});

export const importOverlay = (
  journalPath: string,
  overlayPath: string,
  at: string,
): JournalEvent[] => {
  const events = loadJournal(journalPath);
  if (alreadyHasNotes(events)) return events;
  const todos = loadOverlayFile(overlayPath).humanTodo ?? [];
  if (todos.length === 0) return events;
  for (const todo of todos) appendJournal(journalPath, toNote(todo, at));
  return loadJournal(journalPath);
};
