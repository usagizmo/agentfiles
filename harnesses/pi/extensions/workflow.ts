/**
 * Pi workflow extension
 *
 * 役割の決め打ち:
 * - オーケストレーター: grok（settings.json の defaultModel）が考え、実装する
 * - /consult /review-loop: claude / codex に外部 CLI で諮問（skill 側の手順）
 * - /finish: tidy / docs / commit を fresh な CLI one-shot（tidy/docs: claude、commit: pi）で逐次実行
 *   （会話コンテキストを渡さず、working tree だけを見せてバイアスを断つ。モデルは各 CLI のデフォルトに追従）
 * - lg の in-session ステップ: review-loop のあと project の .pi/finish.json（lg.afterReview: string[]）を
 *   1 件ずつ実行し、各ステップ後は必ず GO 確認を挟んでから次へ進む
 * - dirty 検知: 未コミット差分を footer に出し、session 切替時に確認
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Size = "sm" | "md" | "lg";

type DirtyInfo = {
	count: number;
	paths: string[];
};

const SIZES: Size[] = ["sm", "md", "lg"];

/**
 * 仕上げステップの起動 CLI。モデルは決め打ちせず各 CLI のデフォルト設定に追従する
 * （claude: ~/.claude/settings.json の model / pi: settings.json の defaultProvider+defaultModel）
 */
type Runner = "claude" | "pi";

type Step = {
	name: "tidy" | "docs" | "commit";
	runner: Runner;
	prompt: string;
};

const STEPS: Record<Step["name"], Step> = {
	tidy: {
		name: "tidy",
		runner: "claude",
		prompt: [
			"`tidy` skill を read して完走する。",
			"対象は git の未コミット差分（git status / git diff で把握する）。",
			"互換 shim / dead code / 周辺不整合を掃除し、改善した箇所を最後に列挙する。",
		].join("\n"),
	},
	docs: {
		name: "docs",
		runner: "claude",
		prompt: [
			"`docs` skill を read して完走する。",
			"対象は git の未コミット差分（git status / git diff で把握する）。",
			"agent-facing（AGENTS / rules / skills / prompts / references 等）と project docs の更新要否を判定して適用する。",
			"対象が無ければ何も変更せず、最後に NO-OP とだけ報告する。",
		].join("\n"),
	},
	commit: {
		name: "commit",
		runner: "pi",
		prompt: [
			"`commit` skill を read して完走する。",
			"git の未コミット差分を確認し、規約に沿った gitmoji 付きメッセージでコミットする。",
		].join("\n"),
	},
};

function finishSteps(size: Size): Step[] {
	switch (size) {
		case "sm":
			return [STEPS.docs, STEPS.commit];
		case "md":
		case "lg": // lg は事前に in-session の review-loop + .pi/finish.json の afterReview を挟む（下記 pendingFinish）
			return [STEPS.tidy, STEPS.docs, STEPS.commit];
	}
}

function parseArgs(raw: string): { size: Size | null; rest: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { size: null, rest: "" };

	const parts = trimmed.split(/\s+/);
	const head = parts[0]?.toLowerCase() ?? "";
	const size = SIZES.find((s) => s === head) ?? null;
	if (!size) return { size: null, rest: trimmed };
	return { size, rest: parts.slice(1).join(" ").trim() };
}

/** null = git が使えない（repo 外等）。クリーンは count 0 で返す */
async function getDirty(pi: ExtensionAPI): Promise<DirtyInfo | null> {
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"], { timeout: 5000 });
	if (code !== 0) return null;

	const lines = stdout
		.split("\n")
		.map((l) => l.trimEnd())
		.filter(Boolean);
	const paths = lines.map((line) => line.slice(3).trim()).filter(Boolean);
	return { count: lines.length, paths };
}

function isDirty(info: DirtyInfo | null): info is DirtyInfo {
	return info !== null && info.count > 0;
}

function formatDirty(info: DirtyInfo): string {
	const sample = info.paths.slice(0, 3).join(", ");
	const more = info.count > 3 ? ` +${info.count - 3}` : "";
	return `finish? ${info.count} file(s): ${sample}${more}`;
}

/** 手順は skill 本文が SSOT。/finish への接続だけが pi 固有なのでここで足す */
function buildConsultPrompt(topic: string): string {
	const topicBlock = topic || "会話上の現在の判断・プランを対象にする";
	return `/skill:consult ${topicBlock}。実装まで進んだ場合、完了時は /finish で規模に応じた仕上げを完走する`;
}

function buildReviewLoopPrompt(brief: string): string {
	const lines = [
		"`review-loop` skill を read して完走する — 大規模 diff の網羅レビュー。",
		"指摘が消えるまで レビュー → 精査 → 修正 を繰り返す。",
		"完走したら停止して報告する（tidy / docs / commit は extension が別セッションで実行する）。",
	];
	if (brief) lines.push("", "## 変更の意図", "", brief);
	return lines.join("\n");
}

type FinishConfig = {
	lg?: { afterReview?: string[] };
};

/**
 * project の .pi/finish.json から lg の review-loop 後 in-session ステップを読む。
 * 各要素はそのまま user message として送る（例: "/skill:verify-app"）。
 * 無い・untrusted なら空。壊れた JSON は警告して無視する
 */
function loadAfterReview(ctx: ExtensionContext): string[] {
	if (!ctx.isProjectTrusted()) return [];

	let raw: string;
	try {
		raw = readFileSync(join(ctx.cwd, ".pi", "finish.json"), "utf8");
	} catch {
		return [];
	}

	try {
		const config = JSON.parse(raw) as FinishConfig;
		const steps = config.lg?.afterReview ?? [];
		return steps.filter((s) => typeof s === "string" && s.trim().length > 0);
	} catch {
		if (ctx.hasUI) ctx.ui.notify(".pi/finish.json が不正な JSON のため無視します", "warning");
		return [];
	}
}

function buildStepPrompt(step: Step, brief: string): string {
	const lines = [step.prompt];
	if (brief) lines.push("", "## 変更の意図（オーケストレーターからの brief）", "", brief);
	return lines.join("\n");
}

async function resolveSize(rawSize: Size | null, ctx: ExtensionContext): Promise<Size | null> {
	if (rawSize) return rawSize;
	if (!ctx.hasUI) return null; // headless は明示指定のみ

	const choice = await ctx.ui.select("仕上げの規模", [
		"sm — docs（agent-facing のみ）→ commit",
		"md — tidy → docs → commit",
		"lg — review-loop → tidy → docs → commit",
	]);
	return SIZES.find((s) => choice?.startsWith(s)) ?? null;
}

const STEP_TIMEOUT_MS = 30 * 60 * 1000;

/** tidy / docs / commit を fresh な CLI one-shot（会話コンテキストなし）で逐次実行する */
async function runSteps(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	steps: Step[],
	brief: string,
): Promise<void> {
	const done: string[] = [];
	for (const step of steps) {
		if (ctx.hasUI) ctx.ui.setStatus("workflow-finish", `${step.name} (${step.runner}) 実行中…`);

		const result = await pi.exec(step.runner, ["-p", buildStepPrompt(step, brief)], {
			timeout: STEP_TIMEOUT_MS,
		});

		if (result.code !== 0) {
			if (ctx.hasUI) ctx.ui.setStatus("workflow-finish", undefined);
			const tail = (result.stderr || result.stdout).trim().split("\n").slice(-10).join("\n");
			sendPrompt(
				pi,
				ctx,
				[
					`仕上げの \`${step.name}\` one-shot（${step.runner}）が失敗した（exit ${result.code}）。後続は中断済み。`,
					done.length > 0 ? `完了済み: ${done.join(" → ")}` : "完了済みステップなし",
					"",
					"## 出力末尾",
					"",
					"```",
					tail,
					"```",
					"",
					"原因を調べて対処し、解消したら `/finish` を再実行するようユーザーに提案する。",
				].join("\n"),
			);
			return;
		}
		done.push(step.name);
	}

	if (ctx.hasUI) ctx.ui.setStatus("workflow-finish", undefined);
	sendPrompt(
		pi,
		ctx,
		[
			`仕上げ one-shot が完了した: ${done.join(" → ")}。`,
			"git log / git status で結果を確認し、判定した規模と実行内容をユーザーに短く報告する。",
			"未コミット差分が残っていれば原因を確認する。",
		].join("\n"),
	);
}

function sendPrompt(pi: ExtensionAPI, ctx: ExtensionContext, text: string): void {
	if (ctx.isIdle()) {
		pi.sendUserMessage(text);
		return;
	}
	pi.sendUserMessage(text, { deliverAs: "followUp" });
	if (ctx.hasUI) ctx.ui.notify("Agent busy — queued as follow-up", "info");
}

async function refreshDirtyStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<DirtyInfo | null> {
	if (!ctx.hasUI) return null;
	const dirty = await getDirty(pi);
	if (!isDirty(dirty)) {
		ctx.ui.setStatus("workflow-dirty", undefined);
		return null;
	}
	ctx.ui.setStatus("workflow-dirty", formatDirty(dirty));
	return dirty;
}

async function confirmIfDirty(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: string,
): Promise<{ cancel: boolean } | undefined> {
	const dirty = await getDirty(pi);
	if (!isDirty(dirty)) return;

	// headless では確認できないため、未コミット差分がある間は切替を止める
	if (!ctx.hasUI) {
		return { cancel: true };
	}

	const choice = await ctx.ui.select(
		`未コミット ${dirty.count} file(s)。${action} する前に /finish を推奨。どうする？`,
		["中断して仕上げる", "このまま進む"],
	);

	if (choice !== "このまま進む") {
		ctx.ui.notify("/finish で仕上げてから再開", "warning");
		return { cancel: true };
	}
}

export default function (pi: ExtensionAPI) {
	// lg: in-session ステップ（review-loop → afterReview…）を agent_settled ごとに GO 確認して進め、
	// queue が尽きたら one-shot 列（tidy → docs → commit）を流す
	let pendingFinish: { queue: string[]; steps: Step[]; brief: string } | null = null;

	pi.registerCommand("consult", {
		description: "設計・方針を Codex / Claude に確認してから進む",
		handler: async (args, ctx) => {
			sendPrompt(pi, ctx, buildConsultPrompt(args.trim()));
		},
	});

	pi.registerCommand("finish", {
		description: "仕上げを fresh セッションで実行（sm/md/lg。lg は review-loop から）",
		getArgumentCompletions: (prefix) => {
			const lower = prefix.toLowerCase();
			const filtered = SIZES.filter((s) => s.startsWith(lower));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const { size: parsed, rest } = parseArgs(args);
			const size = await resolveSize(parsed, ctx);
			if (!size) {
				if (ctx.hasUI) ctx.ui.notify("finish をキャンセル（sm / md / lg を指定）", "info");
				return;
			}

			const dirty = await getDirty(pi);
			if (dirty?.count === 0 && ctx.hasUI) {
				const ok = await ctx.ui.confirm(
					"差分なし",
					"git に未コミット差分がありません。仕上げを続行しますか？",
				);
				if (!ok) return;
			}

			const steps = finishSteps(size);
			if (size === "lg") {
				pendingFinish = { queue: loadAfterReview(ctx), steps, brief: rest };
				sendPrompt(pi, ctx, buildReviewLoopPrompt(rest));
				return;
			}
			await runSteps(pi, ctx, steps, rest);
		},
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await refreshDirtyStatus(pi, ctx);

		if (!pendingFinish) return;

		const next = pendingFinish.queue[0];
		if (next !== undefined) {
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm("GO？", `次の in-session ステップへ進みますか？\n${next}`);
				if (!ok) {
					pendingFinish = null;
					ctx.ui.notify("中断。再開は /finish lg（review-loop から）or /finish md（仕上げのみ）", "info");
					return;
				}
			}
			pendingFinish.queue = pendingFinish.queue.slice(1);
			sendPrompt(pi, ctx, next);
			return;
		}

		const { steps, brief } = pendingFinish;
		pendingFinish = null;

		if (ctx.hasUI) {
			const ok = await ctx.ui.confirm(
				"GO？",
				"in-session ステップ完了。tidy → docs → commit を fresh セッションで開始しますか？",
			);
			if (!ok) {
				ctx.ui.notify("中断。再開は /finish md", "info");
				return;
			}
		}
		await runSteps(pi, ctx, steps, brief);
	});

	pi.on("session_start", async (_event, ctx) => {
		await refreshDirtyStatus(pi, ctx);
	});

	pi.on("session_before_switch", async (event, ctx) => {
		const action = event.reason === "new" ? "new session" : "switch session";
		return confirmIfDirty(pi, ctx, action);
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		return confirmIfDirty(pi, ctx, "fork");
	});

	pi.on("session_shutdown", async (event, ctx) => {
		if (event.reason !== "quit" || !ctx.hasUI) return;
		const dirty = await getDirty(pi);
		if (!isDirty(dirty)) return;
		ctx.ui.notify(
			`未コミット ${dirty.count} file(s) あり。次回 /finish を検討`,
			"warning",
		);
	});
}
