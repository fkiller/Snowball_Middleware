import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface SpeechTranscriptionResult {
  text: string;
  engine: "openai-cloud" | "local-whisper" | "windows-sapi" | "fallback";
  durationMs: number;
}

export class SpeechManager {
  private openaiApiKey: string | null = null;

  constructor(apiKey?: string) {
    this.openaiApiKey = apiKey || process.env.OPENAI_API_KEY || null;
  }

  /**
   * Transcribes a WAV audio file as a whole.
   */
  public async transcribeFile(wavPath: string): Promise<SpeechTranscriptionResult> {
    const startTime = Date.now();

    if (!fs.existsSync(wavPath)) {
      return { text: "", engine: "fallback", durationMs: 0 };
    }

    // 1. If OpenAI API key is available, use cloud Whisper for best multi-language accuracy
    if (this.openaiApiKey) {
      try {
        const text = await this.transcribeViaOpenAI(wavPath);
        if (text) {
          return {
            text,
            engine: "openai-cloud",
            durationMs: Date.now() - startTime,
          };
        }
      } catch (err: any) {
        console.warn("[SpeechManager] OpenAI Whisper error, falling back to local:", err.message);
      }
    }

    // 2. Local Whisper.cpp (offline, multilingual incl. Korean, no API key).
    // Drop whisper-cli.exe (+ ggml model) into hardware/mk20/dev-tools/.
    // Beats SAPI DictationGrammar on code identifiers + Korean; keeps
    // discrete utterance -> draft -> explicit Send (no realtime duplex).
    try {
      const text = await this.transcribeViaLocalWhisper(wavPath);
      if (text && text.trim().length > 0) {
        return {
          text: text.trim(),
          engine: "local-whisper",
          durationMs: Date.now() - startTime,
        };
      }
    } catch (err: any) {
      console.warn("[SpeechManager] Local Whisper unavailable:", err.message);
    }

    // 3. Try Windows SAPI (System.Speech)
    if (process.platform === "win32") {
      try {
        const text = await this.transcribeViaWindowsSapi(wavPath);
        if (text && text.trim().length > 0) {
          return {
            text: text.trim(),
            engine: "windows-sapi",
            durationMs: Date.now() - startTime,
          };
        }
      } catch (err: any) {
        console.warn("[SpeechManager] Windows SAPI error:", err.message);
      }
    }

    return {
      text: "",
      engine: "fallback",
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Transcribes audio using local whisper-cli.exe (Whisper.cpp).
   * Looks in hardware/mk20/dev-tools/ for whisper-cli.exe + first ggml*.bin.
   * Runs: whisper-cli.exe -m <model> -f <wav> --output-txt --output-file <tmp>
   * Throws when binaries are absent so caller falls through to SAPI.
   */
  private async transcribeViaLocalWhisper(wavPath: string): Promise<string> {
    const here = path.dirname(new URL(import.meta.url).pathname);
    // dist/audio -> repo root: ../../..
    const repoRoot = path.resolve(here, "..", "..", "..");
    const devTools = path.join(repoRoot, "hardware", "mk20", "dev-tools");
    const cliNames = ["whisper-cli.exe", "whisper.exe", "main.exe"];
    const cli = cliNames.map((n) => path.join(devTools, n)).find((p) => fs.existsSync(p));
    if (!cli) throw new Error("whisper-cli.exe not in hardware/mk20/dev-tools/");
    const models = fs.readdirSync(devTools).filter((f) => /^ggml.*\.bin$/i.test(f)).sort();
    if (models.length === 0) throw new Error("no ggml model in hardware/mk20/dev-tools/");
    const model = path.join(devTools, models[0]);
    const outBase = path.join(os.tmpdir(), `snowball_whisper_${Date.now()}`);
    return new Promise((resolve, reject) => {
      cp.execFile(cli, ["-m", model, "-f", wavPath, "--output-txt", "--output-file", outBase], { timeout: 60000 }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        const txtFile = `${outBase}.txt`;
        if (!fs.existsSync(txtFile)) return reject(new Error("whisper produced no transcript"));
        try {
          const text = fs.readFileSync(txtFile, "utf8").trim();
          fs.rmSync(txtFile, { force: true });
          resolve(text);
        } catch (e: any) {
          reject(e);
        }
      });
    });
  }

  /**
   * Transcribes audio using Windows System.Speech.Recognition.
   */
  private async transcribeViaWindowsSapi(wavPath: string): Promise<string> {
    return new Promise((resolve) => {
      const psScript = `
Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$rec.SetInputToWaveFile('${wavPath.replace(/'/g, "''")}')
$res = $rec.Recognize([TimeSpan]::FromSeconds(30))
if ($res) { Write-Output $res.Text }
$rec.Dispose()
`;
      const cleanCmd = psScript.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0).join("; ");
      cp.exec(
        `powershell -NoProfile -Command "${cleanCmd}"`,
        { timeout: 15000 },
        (err, stdout, stderr) => {
          if (err) {
            console.warn("[SpeechManager] Windows SAPI execution failed:", stderr || err.message);
            return resolve("");
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  /**
   * Transcribes audio using OpenAI Cloud Whisper API.
   */
  private async transcribeViaOpenAI(wavPath: string): Promise<string> {
    const fileData = fs.readFileSync(wavPath);
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).slice(2);

    // Build multipart/form-data payload
    const parts: Buffer[] = [];

    // Model field
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));

    // File field
    const fileName = path.basename(wavPath);
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/wav\r\n\r\n`
      )
    );
    parts.push(fileData);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const payload = Buffer.concat(parts);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: payload,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI Whisper API HTTP ${res.status}: ${errBody}`);
    }

    const data: any = await res.json();
    return data.text || "";
  }
}
