// 固定 marker の読み取り。**「無い」と「壊れている」を分ける**ことだけを見る ——
// 畳むと、fail-closed の述語（意図の確認・人待ち・claim）が黙って通る。

import { describe, expect, test } from "bun:test";
import {
  claimRecord,
  cycleRecord,
  extractMarker,
  intentRecord,
  integrationRecord,
  readyRecord,
  reportRecord,
  retryRecord,
  waitRecord,
} from "../src/records.ts";

const wrap = (marker: string, yaml: string) =>
  `本文\n\n<!-- ${marker} -->\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n<!-- /${marker} -->\n`;

describe("marker の取り出し", () => {
  test("無い marker は absent", () => {
    expect(extractMarker("ただの本文", "claim").kind).toBe("absent");
  });

  test("同じ marker が 2 つあれば invalid（どちらを拾うか決まらない）", () => {
    const body = wrap("claim", "representative: 1") + wrap("claim", "representative: 2");
    expect(extractMarker(body, "claim").kind).toBe("invalid");
  });

  test("閉じていない marker は invalid", () => {
    expect(extractMarker("<!-- claim -->\n```yaml\nx: 1\n```\n", "claim").kind).toBe("invalid");
  });

  test("yaml ブロックが無い marker は invalid", () => {
    expect(extractMarker("<!-- claim -->\nただの文\n<!-- /claim -->", "claim").kind).toBe(
      "invalid",
    );
  });
});

describe("claim の記録", () => {
  test("landing が空でも読み取れる（Conflict の判定は正規化の側）", () => {
    const r = claimRecord(wrap("claim", "representative: 12\nmembers: [12, 13]\nlanding: []"));
    expect(r).toEqual({
      kind: "present",
      value: { representative: 12, members: [12, 13], landing: [] },
    });
  });

  test("必須の欄が欠けていれば invalid（既定へ丸めない）", () => {
    expect(claimRecord(wrap("claim", "members: [12]")).kind).toBe("invalid");
  });
});

describe("人待ちの記録", () => {
  test("質問の本文があれば valid", () => {
    const r = waitRecord(
      wrap("wait", "state: waiting\nissues: [1]\nreason: 仕様を決めてほしい"),
      false,
    );
    expect(r).toEqual({ kind: "waiting", validity: { kind: "valid" } });
  });

  test("本文が無く、休止の記録があれば失効（実行資源待ちを人待ちとして書いた）", () => {
    const r = waitRecord(wrap("wait", "state: waiting\nissues: [1]"), true);
    expect(r).toEqual({ kind: "waiting", validity: { kind: "resource-wait-mislabeled" } });
  });

  test("本文も実行資源待ちの証跡も無ければ判定不能（本文の欠落だけで解除しない）", () => {
    const r = waitRecord(wrap("wait", "state: waiting\nissues: [1]"), false);
    expect(r).toEqual({ kind: "waiting", validity: { kind: "undecidable" } });
  });

  test("cleared はそのまま", () => {
    expect(waitRecord(wrap("wait", "state: cleared\nissues: [1]"), false).kind).toBe("cleared");
  });

  test("state が 2 値のどちらでもなければ broken", () => {
    expect(waitRecord(wrap("wait", "state: done"), false).kind).toBe("broken");
  });
});

describe("意図の確認", () => {
  test("3 値をそのまま返す", () => {
    expect(intentRecord(wrap("intent", "state: confirmed\nissues: [1]")).kind).toBe("confirmed");
    expect(
      intentRecord(wrap("intent", "state: not-required\nissues: [1]\nreason: UI 変更なし")).kind,
    ).toBe("not-required");
    expect(intentRecord(wrap("intent", "state: pending\nissues: [1]")).kind).toBe("pending");
  });

  test("記録が無いのを not-required と推測しない", () => {
    expect(intentRecord("本文だけ").kind).toBe("absent");
  });

  test("壊れていれば broken（absent へ畳まない）", () => {
    expect(intentRecord(wrap("intent", "state: ok")).kind).toBe("broken");
  });
});

describe("数える記録", () => {
  test("retry は lastAction が無くても読める", () => {
    expect(retryRecord(wrap("retry", "count: 2")).kind).toBe("present");
  });

  test("cycle の mark が無ければ null（照合は飛ばす）", () => {
    const r = cycleRecord(wrap("cycle", "count: 1"));
    expect(r).toEqual({ kind: "present", value: { count: 1, mark: null } });
  });

  test("count が数値でなければ invalid", () => {
    expect(cycleRecord(wrap("cycle", "count: たくさん")).kind).toBe("invalid");
  });
});

describe("提出と在庫と枠", () => {
  test("report は heads と bases の両方が要る", () => {
    const ok = wrap("report", "heads:\n  o/r: aaa\nbases:\n  o/r: bbb");
    expect(reportRecord(ok).kind).toBe("present");
    expect(reportRecord(wrap("report", "heads:\n  o/r: aaa")).kind).toBe("invalid");
  });

  test("ready の invalidationScope は空にできない", () => {
    const empty = wrap("ready", "readySha: aaa\nissueDigest: bbb\ninvalidationScope: []");
    expect(readyRecord(empty).kind).toBe("invalid");
  });

  test("integration は pr が無くても読める（PR を使う面が無い課題）", () => {
    const r = integrationRecord(wrap("integration", "issues: [1]"));
    expect(r).toEqual({ kind: "present", value: { issues: [1], pr: null } });
  });
});
