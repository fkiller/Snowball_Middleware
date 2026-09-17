import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('whisper-worker: stdio JSON-RPC protocol ping, status, transcribe, and error resilience', async () => {
  const venvPy = path.resolve(__dirname, '../.venv-whisper/Scripts/python.exe');
  const pyExec = fs.existsSync(venvPy) ? venvPy : 'python';
  const workerPy = path.resolve(__dirname, '../dist/audio/whisper_worker.py');

  assert.ok(fs.existsSync(workerPy), 'whisper_worker.py must exist in dist/audio/');

  const child = spawn(pyExec, [workerPy, '--worker', '--model', 'base'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });

  const rl = createInterface({ input: child.stdout });
  const responses = new Map();
  let onReady;
  const readyPromise = new Promise((resolve) => { onReady = resolve; });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      if (msg.event === 'ready') {
        onReady(msg);
      } else if (typeof msg.id === 'number') {
        const waiting = responses.get(msg.id);
        if (waiting) {
          responses.delete(msg.id);
          waiting(msg);
        }
      }
    } catch {}
  });

  function sendReq(id, method, params = {}) {
    return new Promise((resolve) => {
      responses.set(id, resolve);
      child.stdin.write(JSON.stringify({ id, method, ...params }) + '\n');
    });
  }

  try {
    // 1. Wait for ready event (model loaded into RAM)
    const readyEvent = await readyPromise;
    assert.equal(readyEvent.event, 'ready');
    assert.equal(readyEvent.model, 'base');
    assert.ok(readyEvent.rss_mb > 50, 'Worker RSS should be reported');

    // 2. Test ping
    const pingRes = await sendReq(1, 'ping');
    assert.equal(pingRes.id, 1);
    assert.equal(pingRes.text, 'pong');

    // 3. Test status
    const statusRes = await sendReq(2, 'status');
    assert.equal(statusRes.id, 2);
    assert.equal(statusRes.model, 'base');
    assert.equal(statusRes.ready, true);
    assert.ok(statusRes.rss_mb > 50);

    // 4. Test missing file error resilience
    const errRes = await sendReq(3, 'transcribe', { wavPath: 'C:\\non_existent_file_12345.wav' });
    assert.equal(errRes.id, 3);
    assert.ok(errRes.error, 'Should return error property for missing file');
    assert.ok(errRes.error.includes('not found'));

    // 5. Test transcribe on fixture if available
    const fixturePath = path.join(os.tmpdir(), 'snowball_fixture_en.wav');
    if (fs.existsSync(fixturePath)) {
      const transRes = await sendReq(4, 'transcribe', { wavPath: fixturePath });
      assert.equal(transRes.id, 4);
      assert.ok(transRes.text.length > 0, 'Should return non-empty transcription');
      assert.equal(transRes.language, 'en');
      assert.ok(transRes.durationMs > 0);
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
});
