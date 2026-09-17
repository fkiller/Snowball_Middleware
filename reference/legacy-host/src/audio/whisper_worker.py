"""
Headless CPU Speech Transcription Worker for Snowball Control.
Supports both standalone file transcription and resident stdio JSON-RPC daemon.
Zero GUI, zero hotkey injection, zero external cloud dependency.
"""

import argparse
import json
import os
import sys
import time

# Ensure UTF-8 streams on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

def get_rss_mb() -> float:
    try:
        import psutil
        return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except Exception:
        return 0.0

def run_cli(model_size: str, wav_path: str):
    from faster_whisper import WhisperModel
    sys.stderr.write(f"[WhisperWorker] Loading model {model_size} (CPU, int8)...\n")
    t0 = time.time()
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    load_sec = time.time() - t0
    sys.stderr.write(f"[WhisperWorker] Loaded in {load_sec:.2f}s (RSS: {get_rss_mb():.1f} MB)\n")

    t1 = time.time()
    segments, info = model.transcribe(wav_path, beam_size=1)
    text = " ".join(s.text for s in segments).strip()
    trans_sec = time.time() - t1

    result = {
        "text": text,
        "language": info.language,
        "language_prob": round(info.language_probability, 3),
        "duration_sec": round(trans_sec, 3),
        "rss_mb": round(get_rss_mb(), 1)
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

def run_worker(model_size: str):
    from faster_whisper import WhisperModel
    sys.stderr.write(f"[WhisperWorker] Initializing resident worker with model={model_size} (CPU, int8)...\n")
    t0 = time.time()
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    load_sec = time.time() - t0
    sys.stderr.write(f"[WhisperWorker] Ready in {load_sec:.2f}s (RSS: {get_rss_mb():.1f} MB)\n")

    # Initial ready notification to parent
    ready_msg = {
        "event": "ready",
        "model": model_size,
        "rss_mb": round(get_rss_mb(), 1),
        "load_sec": round(load_sec, 2)
    }
    print(json.dumps(ready_msg, ensure_ascii=False), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            sys.stderr.write(f"[WhisperWorker] Failed to parse JSON: {e}\n")
            continue

        req_id = req.get("id")
        method = req.get("method", "")

        try:
            if method == "transcribe":
                wav_path = req.get("wavPath")
                if not wav_path or not os.path.exists(wav_path):
                    resp = {"id": req_id, "error": f"WAV file not found: {wav_path}"}
                else:
                    t_start = time.time()
                    segments, info = model.transcribe(wav_path, beam_size=1)
                    text = " ".join(s.text for s in segments).strip()
                    elapsed_ms = int((time.time() - t_start) * 1000)
                    resp = {
                        "id": req_id,
                        "text": text,
                        "language": info.language,
                        "durationMs": elapsed_ms,
                        "rss_mb": round(get_rss_mb(), 1)
                    }
            elif method == "status":
                resp = {
                    "id": req_id,
                    "model": model_size,
                    "ready": True,
                    "rss_mb": round(get_rss_mb(), 1)
                }
            elif method == "ping":
                resp = {"id": req_id, "text": "pong"}
            else:
                resp = {"id": req_id, "error": f"Unknown method: {method}"}
        except Exception as err:
            sys.stderr.write(f"[WhisperWorker] Error handling method {method}: {err}\n")
            resp = {"id": req_id, "error": str(err)}

        print(json.dumps(resp, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Snowball Headless Whisper Worker")
    parser.add_argument("--model", default=os.environ.get("SNOWBALL_WHISPER_MODEL", "base"), choices=["base", "small", "tiny", "medium"])
    parser.add_argument("--file", help="Transcribe a single audio file and exit")
    parser.add_argument("--worker", action="store_true", help="Run in stdio JSON-RPC worker mode")
    args = parser.parse_args()

    if args.file:
        run_cli(args.model, args.file)
    else:
        run_worker(args.model)
