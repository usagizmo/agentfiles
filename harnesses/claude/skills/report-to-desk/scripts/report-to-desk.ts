// デスク宛の報告メールを Gmail API で 1 通送る。
//
//   bun report-to-desk.ts auth                      初回の OAuth 認可（browser が開く）
//   bun report-to-desk.ts send <件名> <本文ファイル>
//
// 送信元・宛先・OAuth client は CONFIG_PATH が SSOT。引数でも環境変数でも変えられない。
// この repo は public なので、アドレスと client は tracked ファイルに置かない。
// refresh token は macOS の Keychain（service = KEYCHAIN_SERVICE、account = 送信元）に置く。
//
// 終了コード: 0 = 成功 / 1 = 失敗 / 2 = 引数の誤り

import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".config", "report-to-desk", "config.json");
const KEYCHAIN_SERVICE = "report-to-desk";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
// gmail.send は送信だけで、受信箱は読めない。openid email は認可した account の照合に使う
const SCOPES = "https://www.googleapis.com/auth/gmail.send openid email";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export type Config = {
  readonly from: string;
  readonly to: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

export type TokenStore = {
  readonly read: (account: string) => Promise<string | undefined>;
  readonly write: (account: string, token: string) => Promise<void>;
};

export type Deps = {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly tokens: TokenStore;
};

export class ReportError extends Error {}

const CONFIG_KEYS = ["from", "to", "clientId", "clientSecret"] as const;
// 1 件だけを通す。区切り（, ; 空白）と表示名（<>）を拒み、宛先の追加を型の手前で止める
const ADDRESS_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ReportError(`config が JSON として読めない: ${CONFIG_PATH}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ReportError(`config は object にする: ${CONFIG_PATH}`);
  }
  const record = raw as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => !CONFIG_KEYS.some((known) => known === key));
  if (extra.length > 0) throw new ReportError(`config に未知の key: ${extra.join(", ")}`);
  const field = (key: (typeof CONFIG_KEYS)[number]): string => {
    const value = record[key];
    if (typeof value !== "string" || value === "") {
      throw new ReportError(`config の ${key} が無いか文字列でない`);
    }
    return value;
  };
  const config: Config = {
    from: field("from"),
    to: field("to"),
    clientId: field("clientId"),
    clientSecret: field("clientSecret"),
  };
  for (const key of ["from", "to"] as const) {
    if (!ADDRESS_RE.test(config[key])) {
      throw new ReportError(`config の ${key} はアドレス 1 件だけにする`);
    }
  }
  return config;
}

const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

// RFC 2047 の encoded-word は 1 語 75 文字まで。文字の途中で切らない
function encodeHeader(text: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (Buffer.byteLength(chunk + char, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(word)}?=`).join("\r\n ");
}

export function buildMessage(config: Config, subject: string, body: string): string {
  if (subject.trim() === "") throw new ReportError("件名が空");
  if (/[\r\n]/.test(subject)) throw new ReportError("件名に改行を入れない");
  if (body.trim() === "") throw new ReportError("本文が空");
  const encodedBody = base64(body).replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${config.from}`,
    `To: ${config.to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
}

async function postForm(
  deps: Deps,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok || typeof json !== "object" || json === null) {
    const reason =
      typeof json === "object" && json !== null && "error" in json ? String(json.error) : "";
    throw new ReportError(`token endpoint が ${response.status} ${reason}`.trim());
  }
  return json as Record<string, unknown>;
}

export async function send(
  config: Config,
  deps: Deps,
  subject: string,
  body: string,
): Promise<string> {
  const raw = buildMessage(config, subject, body);
  const refreshToken = await deps.tokens.read(config.from);
  if (refreshToken === undefined) {
    throw new ReportError("未認可。`bun report-to-desk.ts auth` を人が 1 回実行する");
  }
  const token = await postForm(deps, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const accessToken = token["access_token"];
  if (typeof accessToken !== "string") throw new ReportError("access token を得られなかった");
  const response = await deps.fetch(SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
  });
  const json: unknown = await response.json().catch(() => undefined);
  const id = typeof json === "object" && json !== null && "id" in json ? json.id : undefined;
  if (!response.ok || typeof id !== "string") {
    throw new ReportError(`Gmail API が送信を受け付けなかった（HTTP ${response.status}）`);
  }
  return id;
}

/** id token の email が送信元と一致するときだけ refresh token を返す。 */
export function acceptGrant(config: Config, grant: Record<string, unknown>): string {
  const idToken = grant["id_token"];
  const refreshToken = grant["refresh_token"];
  if (typeof idToken !== "string" || typeof refreshToken !== "string") {
    throw new ReportError("認可の応答に id_token / refresh_token が無い");
  }
  const payload: unknown = JSON.parse(
    Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
  );
  const email =
    typeof payload === "object" && payload !== null && "email" in payload
      ? payload.email
      : undefined;
  if (email !== config.from) {
    throw new ReportError(
      "認可した account が config の from と違う。from の account で認可し直す",
    );
  }
  return refreshToken;
}

async function authorize(config: Config, deps: Deps): Promise<void> {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const state = crypto.randomUUID();
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const params = new URL(request.url).searchParams;
      const code = params.get("code");
      if (params.get("state") !== state || code === null) {
        reject(new ReportError(`認可されなかった: ${params.get("error") ?? "state 不一致"}`));
        return new Response("認可できませんでした。terminal を確認してください。");
      }
      resolve(code);
      return new Response("認可しました。この tab は閉じて構いません。");
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}`;
  const timer = setTimeout(() => reject(new ReportError("認可が時間切れ")), AUTH_TIMEOUT_MS);
  try {
    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      login_hint: config.from,
    }).toString()}`;
    console.log(`browser で認可する（開かなければこの URL を開く）:\n${url}`);
    Bun.spawn(["open", url]);
    const grant = await postForm(deps, {
      grant_type: "authorization_code",
      code: await promise,
      code_verifier: verifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
    });
    await deps.tokens.write(config.from, acceptGrant(config, grant));
  } finally {
    clearTimeout(timer);
    await server.stop();
  }
}

const keychain: TokenStore = {
  async read(account) {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", account, "-w"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = (await new Response(proc.stdout).text()).trim();
    return (await proc.exited) === 0 && out !== "" ? out : undefined;
  },
  async write(account, token) {
    const proc = Bun.spawn(
      [
        "security",
        "add-generic-password",
        "-U",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
        token,
      ],
      { stdout: "ignore", stderr: "inherit" },
    );
    if ((await proc.exited) !== 0) throw new ReportError("Keychain へ保存できなかった");
  },
};

async function main(argv: readonly string[]): Promise<number> {
  const [command, subject, bodyFile, ...rest] = argv;
  const isAuth = command === "auth" && subject === undefined;
  const isSend =
    command === "send" && subject !== undefined && bodyFile !== undefined && rest.length === 0;
  if (!isAuth && !isSend) {
    console.error("usage: bun report-to-desk.ts auth | send <件名> <本文ファイル>");
    return 2;
  }
  try {
    const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) throw new ReportError(`config が無い: ${CONFIG_PATH}`);
    const config = parseConfig(await file.text());
    const deps: Deps = { fetch: (url, init) => fetch(url, init), tokens: keychain };
    if (isSend) {
      const body = Bun.file(bodyFile);
      if (!(await body.exists())) throw new ReportError(`本文ファイルが無い: ${bodyFile}`);
      const id = await send(config, deps, subject, await body.text());
      console.log(`sent: ${config.from} -> ${config.to} (id: ${id})`);
    } else {
      await authorize(config, deps);
      console.log(`認可済み: ${config.from}`);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof ReportError)) throw error;
    console.error(error.message);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
