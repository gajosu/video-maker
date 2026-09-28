// Chat log + message queue of a headless Claude session (a video job, a project chat). Both live in the
// session's directory: log.jsonl (what the chat shows) and inbox.jsonl (messages sent while it works).
// The web, the CLI (`bun vk batch msg`) and the hook (cli/hooks/studio-inbox.ts) all use these helpers, under a
// lock, so a message is delivered once, or deleted before it goes out, never both.
//
// Delivery: queued messages wait as one pending group and reach Claude together when it finishes its current
// step (the Stop hook turns them into its next turn). "Enviar ahora" in the web interrupts the running step and
// resumes the session with the group (studio-runner.ts sendNow → session.ts); the terminal's `bun vk batch msg`
// flags the group (sendQueuedNow) so the hook hands it over after Claude's next tool call, without interrupting.
// Until delivery the user can delete any of them.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withLockSync } from "./lock.ts";

/** "unqueued": a pending message the user deleted (x = its id) · "now": the user asked to deliver the group now ·
 * "note": a line from the studio itself (e.g. the current step was interrupted) */
export type LogKind = "you" | "say" | "tool" | "done" | "error" | "media" | "seen" | "unqueued" | "now" | "note";
export type LogEvent = {
	t: number;
	k: LogKind;
	x: string;
	/** "you": id of a message queued while the session was working ("seen" / "unqueued" carry it in x) */
	mid?: string;
};
export type Queued = { id: string; t: number; text: string; refs?: string[] };

const logFile = (dir: string) => join(dir, "log.jsonl");
const inboxFile = (dir: string) => join(dir, "inbox.jsonl");
const nowFlag = (dir: string) => join(dir, "inbox.now");
const locked = <T>(dir: string, fn: () => T): T => {
	mkdirSync(dir, { recursive: true });
	return withLockSync(join(dir, ".inbox.lock"), fn, { timeoutMs: 10000 });
};

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

function readQueue(dir: string): Queued[] {
	if (!existsSync(inboxFile(dir))) return [];
	return readFileSync(inboxFile(dir), "utf8")
		.split("\n")
		.flatMap((l) => {
			try {
				return l.trim() ? [JSON.parse(l) as Queued] : [];
			} catch {
				return [];
			}
		});
}
function writeQueue(dir: string, q: Queued[]) {
	if (!q.length) rmSync(inboxFile(dir), { force: true });
	else writeFileSync(inboxFile(dir), q.map((m) => `${JSON.stringify(m)}\n`).join(""));
}

/** log the message in the chat and add it to the pending group; `now` delivers the group at Claude's next step */
export function queueMessage(dir: string, text: string, refs: string[] = [], o: { now?: boolean } = {}): string {
	const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	locked(dir, () => {
		logTo(dir, "you", text || "(archivo adjunto)", id);
		appendFileSync(inboxFile(dir), `${JSON.stringify({ id, t: Date.now(), text, refs } satisfies Queued)}\n`);
		if (o.now) writeFileSync(nowFlag(dir), "1");
	});
	return id;
}

/** delete a pending message; false if Claude already got it */
export function unqueueMessage(dir: string, id: string): boolean {
	return locked(dir, () => {
		const q = readQueue(dir);
		if (!q.some((m) => m.id === id)) return false;
		const rest = q.filter((m) => m.id !== id);
		writeQueue(dir, rest);
		if (!rest.length) rmSync(nowFlag(dir), { force: true });
		logTo(dir, "unqueued", id);
		return true;
	});
}

/** deliver the whole pending group at Claude's next step instead of when it finishes the current one */
export function sendQueuedNow(dir: string): number {
	return locked(dir, () => {
		const n = readQueue(dir).length;
		if (n) {
			writeFileSync(nowFlag(dir), "1");
			logTo(dir, "now", String(n));
		}
		return n;
	});
}

export const deliverNow = (dir: string) => existsSync(nowFlag(dir));

export function hasInbox(dir: string): boolean {
	try {
		return statSync(inboxFile(dir)).size > 0;
	} catch {
		return false;
	}
}

/** take the whole pending group and mark every message delivered ("seen" in the log) */
export function drainInbox(dir: string): Queued[] {
	if (!existsSync(inboxFile(dir))) return [];
	return locked(dir, () => {
		const msgs = readQueue(dir);
		writeQueue(dir, []);
		rmSync(nowFlag(dir), { force: true });
		for (const m of msgs) logTo(dir, "seen", m.id);
		return msgs;
	});
}

/** the pending group as prompt text; attachments live in projects/<p>/assets/refs/ */
export function inboxText(project: string, msgs: Queued[]): string {
	return msgs
		.map(
			(m, i) =>
				`${msgs.length > 1 ? `${i + 1}. ` : ""}«${m.text}»${m.refs?.length ? ` (adjuntó: ${m.refs.map((r) => `projects/${project}/assets/refs/${r}`).join(", ")}; léelos con Read)` : ""}`,
		)
		.join("\n");
}
