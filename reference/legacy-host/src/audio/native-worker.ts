import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NativeVoiceProvider } from "./provider.js";

export class NativeWorker implements NativeVoiceProvider {
  private child?: ChildProcessWithoutNullStreams;
  private seq = 0;
  private starts = new Map<string, Promise<void>>();
  private lastCaptureId?: string;
  private pending = new Map<number, { resolve(value: string): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private executable = process.env.SNOWBALL_VOICE_WORKER || fileURLToPath(new URL("../../poc/native-dictation/artifacts/middleware/Snowball.Dictation.Poc.exe", import.meta.url))) {}
  private ensureStarted() {
    if (this.child) return;
    if (process.platform !== "win32" && !process.env.SNOWBALL_VOICE_WORKER)
      throw new Error("Native voice adapter is not installed for this platform. No fallback was selected.");
    if (!existsSync(this.executable)) throw new Error("Build/install the native voice worker first.");
    const child = spawn(this.executable, ["--worker"], { stdio: "pipe", windowsHide: false });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", line => {
      if (line.length > 131072) return;
      try {
        const message = JSON.parse(line);
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        clearTimeout(waiting.timer); this.pending.delete(message.id);
        if (typeof message.error === "string") waiting.reject(new Error(message.error));
        else waiting.resolve(typeof message.text === "string" ? message.text : "");
      } catch { /* Never treat arbitrary stdout as a transcript. */ }
    });
    child.stderr.resume();
    const lost = () => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Native voice worker disconnected.")); }
      this.pending.clear();
    };
    child.on("error", lost); child.on("exit", lost);
  }
  private request(method: string, captureId: string): Promise<string> {
    this.ensureStarted();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Native voice response delayed; check the native app before retrying.")); }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, method, captureId }) + "\n", error => {
        if (error && this.pending.delete(id)) { clearTimeout(timer); reject(error); }
      });
    });
  }
  start(captureId: string) {
    const started = Promise.resolve().then(() => this.request("start", captureId)).then(() => {});
    this.starts.set(captureId, started);
    this.lastCaptureId = captureId;
    return started;
  }
  async finish(captureId: string) {
    const started = this.starts.get(captureId);
    if (!started) throw new Error("Capture was not started by this worker.");
    await started; // A quick hardware Finish must not overtake native startup.
    try { return await this.request("finish", captureId); }
    finally { this.starts.delete(captureId); }
  }
  async cancel(captureId: string) {
    const started = this.starts.get(captureId);
    // Forward even without a tracked start: after a middleware-side timeout
    // the worker may still hold an orphaned capture that only it can release.
    // The worker validates the ID itself and rejects unknown captures safely.
    if (!started && captureId !== this.lastCaptureId) return;
    try { await started; if (this.child) await this.request("cancel", captureId); }
    finally { this.starts.delete(captureId); }
  }
  /** Read-only worker snapshot for diagnostics; never treated as transcript. */
  status(): Promise<string> {
    return this.request("status", "00000000-0000-0000-0000-000000000000");
  }
  /** Release a worker-side orphaned capture, then allow a fresh start. */
  async resetStuck(): Promise<void> {
    if (!this.child || !this.lastCaptureId) return;
    try { await this.request("cancel", this.lastCaptureId); }
    catch { /* Worker already idle or gone; a fresh start will prove it. */ }
    finally { this.starts.delete(this.lastCaptureId); }
  }
  close() { this.child?.stdin.end(); }
}
