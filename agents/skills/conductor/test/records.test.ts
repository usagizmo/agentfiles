// 固定 marker の読み取り。**「無い」と「壊れている」を分ける**ことだけを見る ——
// 畳むと、fail-closed の述語（意図の確認・人待ち・claim）が黙って通る。

import { describe, expect, test } from "bun:test";
import {
  claimRecord,
  planRecord,
  cycleRecord,
  extractMarker,
  intentRecord,
  integrationRecord,
  integrationRecordCount,
  readyRecord,
  reportRecord,
  retryRecord,
  waitQuestionText,
  waitRecord,
  yieldRecord,
} from "../src/records.ts";
import { present } from "../src/types.ts";

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

  test("散文の中で字面に言及した行を marker として拾わない", () => {
    // 記録の説明をする文（再計画の報告・経緯のまとめ・移行の告知）は運用で必ず出る。
    // **拾うと、正しい記録がある課題が「壊れている」に化けて**ラダー最上段に固定される。
    const prose = [
      "製品判断は確定済み（`<!-- wait -->` は `cleared`）で、前提が動かなかったため、",
      "1. **種別違い** — 実際に待っていたのは write lease で、`<!-- yield -->` の役目だった",
      "| `<!-- claim -->` / `<!-- plan -->` | **どれも無し** |",
      "### ゲートの結果（`<!-- report -->` の要求）",
    ].join("\n");
    for (const marker of ["wait", "yield", "claim", "plan", "report"] as const) {
      expect(extractMarker(prose, marker).kind).toBe("absent");
    }
  });

  test("散文の言及があっても、単独行で立っている記録へ到達する", () => {
    const body = `前置き（\`<!-- wait -->\` は \`cleared\`）と書いた行\n\n${wrap("wait", "asked: x")}`;
    expect(extractMarker(body, "wait").kind).toBe("present");
  });

  test("閉じの字面が中身の散文に出ても、そこで打ち切らない", () => {
    const body = [
      "<!-- wait -->",
      "",
      "この記録は `<!-- /wait -->` で閉じる、と説明する行",
      "",
      "```yaml",
      "asked: x",
      "```",
      "",
      "<!-- /wait -->",
    ].join("\n");
    expect(extractMarker(body, "wait").kind).toBe("present");
  });

  test("散文の言及は「2 つある」にも数えない", () => {
    const body = `${wrap("claim", "representative: 1")}\n表の中の \`<!-- claim -->\` という言及\n`;
    expect(extractMarker(body, "claim").kind).toBe("present");
  });

  test("CRLF の本文でも読める（実データに混在する）", () => {
    const body = wrap("claim", "representative: 1\nmembers: [1]\nlanding: [control]").replace(
      /\n/g,
      "\r\n",
    );
    expect(claimRecord(body).kind).toBe("present");
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

  test("盤面の問いは「いま待っている問い」を優先し、無ければ reason", () => {
    const withSection = `${wrap("wait", "state: waiting\nissues: [1]\nreason: 短い")}\n## いま待っている問い\n\n戻し先はどれか\n\n## 決着した問答\n`;
    expect(waitQuestionText(withSection)).toBe("戻し先はどれか");
    expect(waitQuestionText(wrap("wait", "state: waiting\nissues: [1]\nreason: 短い"))).toBe(
      "短い",
    );
    expect(waitQuestionText(wrap("wait", "state: waiting\nissues: [1]"))).toBeUndefined();
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

  test("integration の件数は 2 つを 0 に畳まない", () => {
    const one = wrap("integration", "issues: [1]");
    expect(integrationRecordCount("")).toEqual(present(0));
    expect(integrationRecordCount(one)).toEqual(present(1));
    expect(integrationRecordCount(one + one)).toEqual(present(2));
    expect(
      integrationRecordCount("<!-- integration -->\nただの文\n<!-- /integration -->").kind,
    ).toBe("invalid");
  });
});

describe("休止の記録", () => {
  test("to と keys を残す", () => {
    expect(yieldRecord(wrap("yield", "issues: [2]\nto: 1\nkeys: [skills]"))).toEqual({
      kind: "present",
      value: { issues: [2], to: 1, keys: ["skills"] },
    });
  });

  test("必須の欄が欠けていれば invalid（既定へ丸めない）", () => {
    expect(yieldRecord(wrap("yield", "issues: [2]\nto: 1")).kind).toBe("invalid");
  });
});

describe("面の接頭辞を持つ記録", () => {
  // **yaml では `- key: value` は文字列ではなく 1 要素の map。**`landing-surface.md` と
  // `ready-record.md` が定める `<owner>/<repo>: <path>` はその形なので、文字列の配列だけを
  // 受けると**面をまたぐ課題の記録が必ず invalid** になる（在庫は計画した瞬間に陳腐化扱い）。
  const readyBody = (scope: string) =>
    wrap("ready", `readySha: aaa\nissueDigest: d1\ninvalidationScope:\n${scope}`);

  test("`- <面>: <path>` を面つきの項目として読む", () => {
    const r = readyRecord(readyBody("  - acme/skills: agents/x\n  - plain/path.ts"));
    expect(r.kind === "present" ? r.value.invalidationScope : r.kind).toEqual([
      "acme/skills: agents/x",
      "plain/path.ts",
    ]);
  });

  test("plan の invalidationScope と expectedWrites も同じ形で読む", () => {
    const r = planRecord(
      wrap(
        "plan",
        [
          "baseSha: aaa",
          'issueDigests:\n  "12": d12',
          "invalidationScope:\n  - acme/skills: agents/x",
          "expectedWrites:\n  - acme/skills: agents/y",
          "resourceKeys: []",
        ].join("\n"),
      ),
    );
    expect(r.kind === "present" ? r.value.invalidationScope : r.kind).toEqual([
      "acme/skills: agents/x",
    ]);
  });

  test("2 つ以上のキーを持つ map は読めない（どちらが面か決まらない）", () => {
    expect(readyRecord(readyBody("  - {a: 1, b: 2}")).kind).toBe("invalid");
  });
});
