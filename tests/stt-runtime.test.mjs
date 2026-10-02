import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { LocalWhisperProvider } from '../../Snowball_Control/host/dist/audio/local-whisper.js';

test('STT Runtime: ensure_stt_runtime.py check outputs valid JSON status', async () => {
  const script = path.resolve('scripts/ensure_stt_runtime.py');
  const res = spawnSync('python', [script, '--check'], { encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 0, `Script failed: ${res.stderr}`);
  
  const status = JSON.parse(res.stdout);
  assert.ok(status.python_version);
  assert.equal(typeof status.faster_whisper, 'boolean');
  assert.equal(typeof status.nvidia_gpu, 'boolean');
  assert.equal(typeof status.cublas_ready, 'boolean');
  assert.ok(['cuda', 'cpu'].includes(status.optimal_backend));
});

test('STT Runtime: LocalWhisperProvider.ensureDependencies runs and returns status', async () => {
  const result = await LocalWhisperProvider.ensureDependencies();
  assert.equal(result.ok, true);
  assert.ok(result.status);
});

test('STT Runtime: assess_stt_backend verifies cuBLAS when CUDA is detected', async () => {
  const script = path.resolve('scripts/assess_stt_backend.py');
  const res = spawnSync('python', [script, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 0, `assess_stt_backend failed: ${res.stderr}`);
  
  const assess = JSON.parse(res.stdout.trim());
  assert.ok(assess.selected_backend);
  if (assess.selected_backend === 'cuda') {
    assert.ok(assess.fallback_path.includes('cuda_pass'));
    assert.equal(assess.selected_model, 'large-v3-turbo');
  }
});

test('STT Fallback: simulated CUDA failure falls back to CPU universal plan', async () => {
  const script = path.resolve('scripts/assess_stt_backend.py');
  const res = spawnSync('python', [script, '--simulate', 'cuda_fail', '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 0);
  const assess = JSON.parse(res.stdout.trim());
  assert.equal(assess.selected_backend, 'cpu');
  assert.ok(assess.fallback_path.includes('cuda_fail'));
  assert.ok(assess.optimal_threads > 0);
});

test('STT Fallback: simulated Vulkan failure falls back to CPU universal plan', async () => {
  const script = path.resolve('scripts/assess_stt_backend.py');
  const res = spawnSync('python', [script, '--simulate', 'vulkan_fail', '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 0);
  const assess = JSON.parse(res.stdout.trim());
  assert.equal(assess.selected_backend, 'cpu');
  assert.ok(assess.fallback_path.includes('vulkan_fail'));
});

test('STT Fallback: simulated Apple Silicon Metal failure falls back to CPU', async () => {
  const script = path.resolve('scripts/assess_stt_backend.py');
  const res = spawnSync('python', [script, '--simulate', 'metal_fail', '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(res.status, 0);
  const assess = JSON.parse(res.stdout.trim());
  assert.equal(assess.selected_backend, 'cpu');
  assert.ok(assess.fallback_path.includes('metal_fail'));
});

