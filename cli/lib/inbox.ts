// Chat log + message queue of a headless Claude session (a video job, a project chat). Both live in the
// session's directory: log.jsonl (what the chat shows) and inbox.jsonl (messages sent while it works).
// The web, the CLI (`bun vk batch msg`) and the hook (cli/hooks/studio-inbox.ts) all use these helpers;
// the queue is taken atomically (rename) so nothing is delivered twice or lost.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogKind = "you" | "say" | "tool" | "done" | "error" | "media" | "seen";
export type LogEvent = {
	t: number;
	k: LogKind;
	x: string;
	/** "you": id of a message queued while the session was working; "seen": that id, once Claude got it */
	mid?: string;
};
export type Queued = { id: string; t: number; text: string; refs?: string[] };

const logFile = (dir: string) => join(dir, "log.jsonl");
const inboxFile = (dir: string) => join(dir, "inbox.jsonl");

export function logTo(dir: string, k: LogKind, x: string, mid?: string) {
	mkdirSync(dir, { recursive: true });
	appendFileSync(logFile(dir), `${JSON.stringify({ t: Date.now(), k, x, ...(mid ? { mid } : {}) })}\n`);
}

export function readLogFrom(dir: string, n = 300): (LogEvent & { id: number })[] {
	if (!existsSync(logFile(dir))) return [];
	const lines = readFileSync(logFile(dir), "utf8").trim().split("\n");
	const from = Math.max(0, lines.length - n);
	return lines.slice(from).flatMap((l, i) => {
		try {
			return [{ ...(JSON.parse(l) as LogEvent), id: from + i }];
		} catch {
			return [];
		}
	});
}

/** log the message in the chat and queue it for the session; returns its id */
export function queueMessage(dir: string, text: string, refs: string[] = []): string {
	const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	logTo(dir, "you", text || "(archivo adjunto)", id);
	appendFileSync(inboxFile(dir), `${JSON.stringify({ id, t: Date.now(), text, refs } satisfies Queued)}\n`);
	return id;
}

export function hasInbox(dir: string): boolean {
	try {
		return statSync(inboxFile(dir)).size > 0;
	} catch {
		return false;
	}
}

/** take the whole queue and mark every message delivered ("seen" in the log) */
export function drainInbox(dir: string): Queued[] {
	if (!existsSync(inboxFile(dir))) return [];
	const taking = join(dir, `inbox.${process.pid}.${Date.now()}.taking`);
	try {
		renameSync(inboxFile(dir), taking);
	} catch {
		return [];
	}
	const msgs = readFileSync(taking, "utf8")
		.split("\n")
		.flatMap((l) => {
			try {
				return l.trim() ? [JSON.parse(l) as Queued] : [];
			} catch {
				return [];
			}
		});
	rmSync(taking, { force: true });
	for (const m of msgs) logTo(dir, "seen", m.id);
	return msgs;
}

/** queued messages as prompt text; attachments live in projects/<p>/assets/refs/ */
export function inboxText(project: string, msgs: Queued[]): string {
	return msgs
		.map((m) => `«${m.text}»${m.refs?.length ? ` (adjuntó: ${m.refs.map((r) => `projects/${project}/assets/refs/${r}`).join(", ")}; léelos con Read)` : ""}`)
		.join("\n");
}
