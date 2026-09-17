import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { NativeVoiceProvider } from "./provider.js";
import { AudioTransport } from "./transport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class LocalWhisperProvider implements NativeVoiceProvider {
  private child?: ChildProcessWithoutNullStreams;
  private seq = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private audioTransport: AudioTransport;
  private currentCaptureId?: string;
  private activeRecording = false;

  constructor(
    private model = process.env.SNOWBALL_WHISPER_MODEL || "base",
    private deviceAdb = process.env.SNOWBALL_DEVICE_ADB || "192.168.1.248:5555"
  ) {
    this.audioTransport = new AudioTransport(this.deviceAdb);
  }

  private resolvePython(): { exec: string; args: string[] } {
    // 1. Check local virtual environment in host/.venv-whisper
    const venvPyWin = path.resolve(__dirname, "../../.venv-whisper/Scripts/python.exe");
    const venvPyUnix = path.resolve(__dirname, "../../.venv-whisper/bin/python");
    const candidates = [
      path.resolve(__dirname, "whisper_worker.py"),
      path.resolve(__dirname, "../../src/audio/whisper_worker.py"),
      path.resolve(process.cwd(), "host/src/audio/whisper_worker.py"),
      path.resolve(process.cwd(), "src/audio/whisper_worker.py"),
    ];
    const workerPy = candidates.find((c) => fs.existsSync(c)) || candidates[0];

    if (process.platform === "win32" && fs.existsSync(venvPyWin)) {
      return { exec: venvPyWin, args: [workerPy, "--worker", "--model", this.model] };
    }
    if (fs.existsSync(venvPyUnix)) {
      return { exec: venvPyUnix, args: [workerPy, "--worker", "--model", this.model] };
    }

    // 2. Fallback to uv run or global python
    return { exec: "python", args: [workerPy, "--worker", "--model", this.model] };
  }

  private ensureWorkerStarted(): Promise<void> {
    if (this.child && !this.child.killed) {
      return Promise.resolve();
    }

    const { exec, args } = this.resolvePython();
    console.log(`[LocalWhisper] Spawning resident worker: ${exec} ${args.join(" ")}`);

    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      const child = spawn(exec, args, {
        stdio: "pipe",
        windowsHide: true,
      });

      this.child = child;
      child.stderr.on("data", (data) => {
        process.stderr.write(data);
      });

      const startupTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn("[LocalWhisper] Worker startup timed out waiting for ready signal; proceeding.");
          resolve();
        }
      }, 30000);

      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        line = line.trim();
        if (!line) return;

        try {
          const msg = JSON.parse(line);
          if (msg.event === "ready") {
            console.log(`[LocalWhisper] Worker ready (model=${msg.model}, RSS=${msg.rss_mb} MB)`);
            if (!resolved) {
              resolved = true;
              clearTimeout(startupTimer);
              resolve();
            }
            return;
          }

          if (typeof msg.id === "number") {
            const waiting = this.pending.get(msg.id);
            if (!waiting) return;
            clearTimeout(waiting.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              waiting.reject(new Error(msg.error));
            } else {
              waiting.resolve(msg);
            }
          }
        } catch {
          // Ignore non-JSON lines
        }
      });

      const onExit = (code: number | null, signal: string | null) => {
        console.warn(`[LocalWhisper] Worker exited with code=${code} signal=${signal}`);
        if (this.child === child) {
          this.child = undefined;
        }
        for (const req of this.pending.values()) {
          clearTimeout(req.timer);
          req.reject(new Error("Local Whisper worker terminated unexpectedly."));
        }
        this.pending.clear();
        if (!resolved) {
          resolved = true;
          clearTimeout(startupTimer);
          reject(new Error(`Worker failed to start (exit code ${code})`));
        }
      };

      child.on("error", (err) => {
        console.error("[LocalWhisper] Worker process error:", err);
        onExit(null, null);
      });
      child.on("exit", onExit);
    });
  }

  private async request(method: string, params: Record<string, any> = {}): Promise<any> {
    await this.ensureWorkerStarted();
    const id = ++this.seq;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Local Whisper request timed out for method: ${method}`));
      }, 60000);

      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ id, method, ...params }) + "\n";
      this.child!.stdin.write(payload, "utf-8", (err) => {
        if (err && this.pending.delete(id)) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /**
   * Starts hardware recording on MK20.
   */
  public async start(captureId: string): Promise<void> {
    this.currentCaptureId = captureId;
    this.activeRecording = true;

    // Ensure worker is pre-warmed concurrently while MK20 begins capturing
    const warmWorker = this.ensureWorkerStarted().catch((e) =>
      console.warn("[LocalWhisper] Pre-warm warning:", e.message)
    );

    if (process.env.SNOWBALL_MOCK_CAPTURE === "1") {
      console.log(`[LocalWhisper] Mock capture started for ${captureId}`);
      await warmWorker;
      return;
    }

    console.log(`[LocalWhisper] Starting MK20 microphone capture for ${captureId}...`);
    await this.audioTransport.startDeviceRecording();
    await warmWorker;
  }

  /**
   * Stops recording on MK20, pulls and extracts Channel 3 mono WAV,
   * transcribes locally using resident Whisper model, and returns text.
   */
  public async finish(captureId: string): Promise<string> {
    if (!this.activeRecording || this.currentCaptureId !== captureId) {
      throw new Error("Capture was not active for this capture ID.");
    }
    this.activeRecording = false;

    let wavPath: string;
    if (process.env.SNOWBALL_MOCK_CAPTURE === "1") {
      console.log(`[LocalWhisper] Mock capture finishing for ${captureId}`);
      const mockFixture = process.env.SNOWBALL_MOCK_FIXTURE;
      if (mockFixture && fs.existsSync(mockFixture)) {
        wavPath = path.join(os.tmpdir(), `mock_test_${Date.now()}.wav`);
        fs.copyFileSync(mockFixture, wavPath);
      } else {
        // Synthesize clean 1-second 16kHz mono WAV (silence)
        const raw3ch = Buffer.alloc(16000 * 6);
        wavPath = path.join(os.tmpdir(), `mock_synth_${Date.now()}.wav`);
        fs.writeFileSync(wavPath, AudioTransport.pcm3chToMonoWav(raw3ch));
      }
    } else {
      console.log(`[LocalWhisper] Stopping MK20 recording for ${captureId}...`);
      await this.audioTransport.stopDeviceRecording();

      console.log("[LocalWhisper] Pulling MK20 audio & extracting Channel 3 mono WAV...");
      wavPath = await this.audioTransport.pullDeviceWav();
    }

    try {
      console.log(`[LocalWhisper] Transcribing ${wavPath} with resident Whisper model...`);
      const resp = await this.request("transcribe", { wavPath });
      const text = typeof resp.text === "string" ? resp.text.trim() : "";
      console.log(`[LocalWhisper] Transcription result (${resp.durationMs}ms, lang=${resp.language}): "${text}"`);
      return text;
    } finally {
      try {
        fs.rmSync(wavPath, { force: true });
      } catch {}
      this.currentCaptureId = undefined;
    }
  }

  /**
   * Cancels in-flight recording and cleans up temporary resources.
   */
  public async cancel(captureId: string): Promise<void> {
    console.log(`[LocalWhisper] Cancelling capture for ${captureId}...`);
    this.activeRecording = false;
    this.currentCaptureId = undefined;

    if (process.env.SNOWBALL_MOCK_CAPTURE === "1") {
      console.log(`[LocalWhisper] Mock capture cancelled for ${captureId}`);
      return;
    }

    await this.audioTransport.cancelDeviceRecording();
  }

  /**
   * Read-only worker status snapshot.
   */
  public async status(): Promise<string> {
    try {
      const res = await this.request("status");
      return JSON.stringify(res);
    } catch (e: any) {
      return `Worker status unavailable: ${e.message}`;
    }
  }

  /**
   * Releases any stuck capture state.
   */
  public async resetStuck(): Promise<void> {
    this.activeRecording = false;
    this.currentCaptureId = undefined;
    await this.audioTransport.cancelDeviceRecording().catch(() => {});
  }

  public close(): void {
    if (this.child) {
      try {
        this.child.stdin.end();
        this.child.kill();
      } catch {}
      this.child = undefined;
    }
    this.audioTransport.stopDeviceRecording().catch(() => {});
  }
}
