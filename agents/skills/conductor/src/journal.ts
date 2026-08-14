// 観測外の事実と tick の履歴。**判断の入力にしない。**
//
// Decision は cli.ts が既に持っている。エージェントは 1 事実を足す。
// idle は追記しない（watcher の起床で埋まらないようにする）。

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Decision, Outcome } from "./types.ts";

export const JOURNAL_RECENT = 8;

export const RESULT_STATUSES = ["ok", "env", "gap"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export type DecisionRecord = {
  readonly kind: "decision";
  readonly at: string;
  readonly outcome: Exclude<Outcome["kind"], "idle">;
  readonly why: string;
  readonly action?: string;
  readonly target?: number;
  readonly members?: readonly number[];
};

export type ResultRecord = {
  readonly kind: "result";
  readonly at: string;
  readonly status: ResultStatus;
  readonly detail?: string;
};

export type NoteRecord = {
  readonly kind: "note";
  readonly at: string;
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly unblocks: string;
  readonly issues: readonly number[];
  readonly noteKind: string;
};

export type ClearRecord = {
  readonly kind: "clear";
  readonly at: string;
  readonly id: string;
};

export type JournalEvent = DecisionRecord | ResultRecord | NoteRecord | ClearRecord;

export type OpenNote = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly unblocks: string;
  readonly issues: readonly number[];
  readonly kind: string;
};

export type RecentTick = {
  readonly at: string;
  readonly outcome: string;
  readonly why: string;
  readonly action?: string;
  readonly target?: number;
  readonly result?: ResultStatus;
};

export const newNoteId = (): string => crypto.randomUUID().slice(0, 8);

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const isOutcome = (raw: unknown): raw is DecisionRecord["outcome"] =>
  raw === "action" || raw === "settle-record" || raw === "constraint" || raw === "non-action";

const isStatus = (raw: unknown): raw is ResultStatus =>
  raw === "ok" || raw === "env" || raw === "gap";

const asString = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw !== "" ? raw : undefined;

const asInt = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isInteger(raw) ? raw : undefined;

const asIntList = (raw: unknown): readonly number[] | undefined => {
  if (!Array.isArray(raw) || raw.some((n) => typeof n !== "number" || !Number.isInteger(n))) {
    return undefined;
  }
  return raw as number[];
};

export const parseEvent = (line: string): JournalEvent | undefined => {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  const at = asString(raw["at"]);
  if (at === undefined) return undefined;
  switch (raw["kind"]) {
    case "decision": {
      const outcome = raw["outcome"];
      const why = asString(raw["why"]);
      if (!isOutcome(outcome) || why === undefined) return undefined;
      const action = asString(raw["action"]);
      const target = asInt(raw["target"]);
      const members = asIntList(raw["members"]);
      return {
        kind: "decision",
        at,
        outcome,
        why,
        ...(action === undefined ? {} : { action }),
        ...(target === undefined ? {} : { target }),
        ...(members === undefined ? {} : { members }),
      };
    }
    case "result": {
      const status = raw["status"];
      if (!isStatus(status)) return undefined;
      const detail = asString(raw["detail"]);
      return {
        kind: "result",
        at,
        status,
        ...(detail === undefined ? {} : { detail }),
      };
    }
    case "note": {
      const id = asString(raw["id"]);
      const title = asString(raw["title"]);
      const detail = asString(raw["detail"]);
      const unblocks = asString(raw["unblocks"]);
      const noteKind = asString(raw["noteKind"]);
      const issues = asIntList(raw["issues"]);
      if (
        id === undefined ||
        title === undefined ||
        detail === undefined ||
        unblocks === undefined ||
        noteKind === undefined ||
        issues === undefined
      ) {
        return undefined;
      }
      return { kind: "note", at, id, title, detail, unblocks, issues, noteKind };
    }
    case "clear": {
      const id = asString(raw["id"]);
      if (id === undefined) return undefined;
      return { kind: "clear", at, id };
    }
    default:
      return undefined;
  }
};

export const readJournal = (text: string): JournalEvent[] =>
  text.split("\n").flatMap((line) => {
    const event = parseEvent(line);
    return event === undefined ? [] : [event];
  });

export const formatEvent = (event: JournalEvent): string => JSON.stringify(event);

export const recentOf = (events: readonly JournalEvent[], limit = JOURNAL_RECENT): RecentTick[] => {
  const recent: RecentTick[] = [];
  let pending: ResultStatus | undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event === undefined) continue;
    switch (event.kind) {
      case "result":
        pending ??= event.status;
        break;
      case "decision":
        recent.push({
          at: event.at,
          outcome: event.outcome,
          why: event.why,
          ...(event.action === undefined ? {} : { action: event.action }),
          ...(event.target === undefined ? {} : { target: event.target }),
          ...(pending === undefined ? {} : { result: pending }),
        });
        pending = undefined;
        if (recent.length >= limit) return recent.reverse();
        break;
      case "note":
      case "clear":
        break;
      default: {
        const _never: never = event;
        return _never;
      }
    }
  }
  return recent.reverse();
};

export const openNotes = (events: readonly JournalEvent[]): OpenNote[] => {
  const open = new Map<string, OpenNote>();
  for (const event of events) {
    switch (event.kind) {
      case "note":
        open.set(event.id, {
          id: event.id,
          title: event.title,
          detail: event.detail,
          unblocks: event.unblocks,
          issues: event.issues,
          kind: event.noteKind,
        });
        break;
      case "clear":
        open.delete(event.id);
        break;
      case "decision":
      case "result":
        break;
      default: {
        const _never: never = event;
        return _never;
      }
    }
  }
  return [...open.values()];
};

export const decisionEvent = (decision: Decision, at: string): DecisionRecord | undefined => {
  const { outcome } = decision;
  switch (outcome.kind) {
    case "idle":
      return undefined;
    case "action":
      return {
        kind: "decision",
        at,
        outcome: "action",
        why: outcome.evidence.why,
        action: outcome.params.action,
        target: outcome.target.representative,
        members: [...outcome.target.members],
      };
    case "settle-record":
      return {
        kind: "decision",
        at,
        outcome: "settle-record",
        why: outcome.settlement.detail,
        target: outcome.settlement.target.representative,
        members: [...outcome.settlement.target.members],
      };
    case "constraint":
      return { kind: "decision", at, outcome: "constraint", why: outcome.detail };
    case "non-action":
      return { kind: "decision", at, outcome: "non-action", why: outcome.detail };
    default: {
      const _never: never = outcome;
      return _never;
    }
  }
};

export const loadJournal = (path: string): JournalEvent[] => {
  try {
    return readJournal(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};

export const appendJournal = (path: string, event: JournalEvent): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${formatEvent(event)}\n`);
};
