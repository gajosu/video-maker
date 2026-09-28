// Cross-process locks (several headless Claude sessions can work on videos at the same time): a lock is a
// directory created atomically with mkdir, holding the owner's pid so a crashed holder doesn't block forever.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** true if taken; clears a lock whose owner died (or that is older than `staleMs`) */
function tryTake(dir: string, staleMs: number): boolean {
	try {
		mkdirSync(dir);
		writeFileSync(join(dir, "pid"), String(process.pid));
		return true;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
	}
	try {
		const pid = Number(readFileSync(join(dir, "pid"), "utf8"));
		const age = Date.now() - statSync(dir).mtimeMs;
		if ((pid && !alive(pid)) || age > staleMs) rmSync(dir, { recursive: true, force: true });
	} catch {
		// the pid file is written right after mkdir; a lock without one this old is abandoned
		try {
			if (Date.now() - statSync(dir).mtimeMs > 5000) rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	return false;
}

/** short critical sections (read-modify-write of a JSON file) */
export function withLockSync<T>(dir: string, fn: () => T, o: { timeoutMs?: number; staleMs?: number } = {}): T {
	const until = Date.now() + (o.timeoutMs ?? 15000);
	while (!tryTake(dir, o.staleMs ?? 60000)) {
		if (Date.now() > until) throw new Error(`timed out waiting for lock ${dir}`);
		sleepSync(25);
	}
	try {
		return fn();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** long jobs that must not overlap (one Google Flow generation at a time); `onWait` fires once if we have to queue */
export async function withLock<T>(dir: string, fn: () => Promise<T>, o: { timeoutMs?: number; staleMs?: number; onWait?: () => void } = {}): Promise<T> {
	const until = Date.now() + (o.timeoutMs ?? 30 * 60_000);
	let waited = false;
	while (!tryTake(dir, o.staleMs ?? 30 * 60_000)) {
		if (!waited) o.onWait?.();
		waited = true;
		if (Date.now() > until) throw new Error(`timed out waiting for lock ${dir}`);
		await new Promise((r) => setTimeout(r, 1000));
	}
	try {
		return await fn();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
