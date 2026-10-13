// report-to-desk の送信元・宛先の固定と、送信前の拒否条件。gate は bun test。
// 実際の送信と OAuth 認可は外部 service なので、fetch と token store を差し替える。

import { expect, test } from "bun:test";
import {
  type Config,
  type Deps,
  ReportError,
  acceptGrant,
  buildMessage,
  parseConfig,
  send,
} from "../harnesses/claude/skills/report-to-desk/scripts/report-to-desk.ts";

const CONFIG: Config = {
  from: "sender@example.com",
  to: "desk@example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
};

const idToken = (email: string): string =>
  `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

test("parseConfig は宛先を 1 件に限る", () => {
  expect(parseConfig(JSON.stringify(CONFIG))).toEqual(CONFIG);
  for (const to of [
    "a@example.com,b@example.com",
    "a@example.com b@example.com",
    "A <a@example.com>",
    "",
  ]) {
    expect(() => parseConfig(JSON.stringify({ ...CONFIG, to }))).toThrow(ReportError);
  }
  expect(() => parseConfig(JSON.stringify({ ...CONFIG, cc: "x@example.com" }))).toThrow(
    ReportError,
  );
});

test("buildMessage は config の宛先だけを header に持ち、UTF-8 を往復できる", () => {
  const subject =
    "【完了報告】example-repo 長い件名でも encoded-word を文字の途中で切らないことを確かめる";
  const body = "■ やったこと\n- テスト\n";
  const [head = "", encodedBody = ""] = buildMessage(CONFIG, subject, body).split("\r\n\r\n");
  const headers = head.replace(/\r\n /g, " ").split("\r\n");
  expect(headers.filter((line) => /^(To|Cc|Bcc):/i.test(line))).toEqual(["To: desk@example.com"]);
  expect(headers).toContain("From: sender@example.com");
  const subjectLine = headers.find((line) => line.startsWith("Subject: ")) ?? "";
  const decoded = [...subjectLine.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
    .map((match) => Buffer.from(match[1] ?? "", "base64").toString("utf8"))
    .join("");
  expect(decoded).toBe(subject);
  expect(Buffer.from(encodedBody, "base64").toString("utf8")).toBe(body);
});

test("buildMessage は header を足せる件名と空の入力を拒む", () => {
  expect(() => buildMessage(CONFIG, "x\r\nBcc: evil@example.com", "body")).toThrow(ReportError);
  expect(() => buildMessage(CONFIG, " ", "body")).toThrow(ReportError);
  expect(() => buildMessage(CONFIG, "subject", "\n")).toThrow(ReportError);
});

test("send は refresh token で access token を得て、config の宛先へ 1 通だけ送る", async () => {
  const calls: { url: string; body: string; auth: string | null }[] = [];
  const deps: Deps = {
    tokens: { read: async () => "refresh", write: async () => {} },
    fetch: async (url, init) => {
      calls.push({
        url,
        body: String(init.body),
        auth: new Headers(init.headers).get("Authorization"),
      });
      return Response.json(url.includes("oauth2") ? { access_token: "access" } : { id: "msg-1" });
    },
  };
  expect(await send(CONFIG, deps, "件名", "本文")).toBe("msg-1");
  expect(calls.map((call) => call.url)).toEqual([
    "https://oauth2.googleapis.com/token",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  ]);
  expect(calls[1]?.auth).toBe("Bearer access");
  const raw = (JSON.parse(calls[1]?.body ?? "{}") as { raw: string }).raw;
  expect(Buffer.from(raw, "base64url").toString("utf8")).toContain("To: desk@example.com\r\n");
});

test("send は未認可と API の拒否を成功にしない", async () => {
  let fetched = 0;
  const none: Deps = {
    tokens: { read: async () => undefined, write: async () => {} },
    fetch: async () => {
      fetched += 1;
      return Response.json({});
    },
  };
  await expect(send(CONFIG, none, "件名", "本文")).rejects.toThrow(ReportError);
  expect(fetched).toBe(0);
  const denied: Deps = {
    tokens: { read: async () => "refresh", write: async () => {} },
    fetch: async (url) =>
      url.includes("oauth2")
        ? Response.json({ access_token: "access" })
        : Response.json({ error: {} }, { status: 403 }),
  };
  await expect(send(CONFIG, denied, "件名", "本文")).rejects.toThrow(ReportError);
});

test("acceptGrant は送信元と違う account の認可を保存させない", () => {
  expect(acceptGrant(CONFIG, { id_token: idToken(CONFIG.from), refresh_token: "r" })).toBe("r");
  expect(() =>
    acceptGrant(CONFIG, { id_token: idToken("other@example.com"), refresh_token: "r" }),
  ).toThrow(ReportError);
  expect(() => acceptGrant(CONFIG, { id_token: idToken(CONFIG.from) })).toThrow(ReportError);
});
