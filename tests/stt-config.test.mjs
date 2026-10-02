import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {
  loadSttConfig,
  resolveSttModel,
  resolveModelsDir,
  normalizeSttModelName,
  DEFAULT_STT_CONFIG,
} from '../packages/core/dist/index.js';

test('STT Config: loads default configuration with floor small, ceiling large-v3-turbo, and medium excluded', () => {
  const cfg = loadSttConfig();
  assert.equal(cfg.min_model, 'small');
  assert.equal(cfg.max_model, 'large-v3-turbo');
  assert.deepEqual(cfg.exclude, ['medium']);
  assert.equal(cfg.quantization, 'int8');
});

test('STT Model Selection: low-spec CPU machine (4 cores, 1.7GB RAM) enforces minimum floor small (never tiny/base)', () => {
  const cfg = {
    min_model: 'small',
    max_model: 'large-v3-turbo',
    exclude: ['medium'],
  };

  const lowSpec = { cores: 4, availRamGb: 1.7 };
  const res = resolveSttModel('cpu', lowSpec, cfg);

  assert.equal(res.selectedModel, 'small');
  assert.equal(res.clampedByMin, true);
  assert.ok(res.note.includes("Floor 'small' enforced"));
});

test('STT Model Selection: mid-spec CPU machine (6 cores, 8GB RAM) excludes medium and falls back to small', () => {
  const cfg = {
    min_model: 'small',
    max_model: 'large-v3-turbo',
    exclude: ['medium'],
  };

  const midSpec = { cores: 6, availRamGb: 8.0 };
  const res = resolveSttModel('cpu', midSpec, cfg);

  assert.equal(res.rawChoice, 'medium');
  assert.equal(res.selectedModel, 'small');
  assert.equal(res.excludedApplied, true);
  assert.ok(res.note.includes("Excluded model bypassed in favor of 'small'"));
});

test('STT Model Selection: hardware GPU accelerator (CUDA / Metal / Vulkan) selects large-v3-turbo', () => {
  const cfg = {
    min_model: 'small',
    max_model: 'large-v3-turbo',
    exclude: ['medium'],
  };

  for (const backend of ['cuda', 'metal', 'vulkan']) {
    const res = resolveSttModel(backend, { cores: 4, availRamGb: 4.0 }, cfg);
    assert.equal(res.selectedModel, 'large-v3-turbo');
    assert.equal(res.clampedByMin, false);
    assert.equal(res.excludedApplied, false);
  }
});

test('STT Model Selection: handles small-cpu suffix alias cleanly', () => {
  assert.equal(normalizeSttModelName('small-cpu'), 'small');
  assert.equal(normalizeSttModelName('large-v3-turbo'), 'large-v3-turbo');

  const cfg = {
    min_model: normalizeSttModelName('small-cpu'),
    max_model: 'large-v3-turbo',
    exclude: ['medium'],
  };
  const res = resolveSttModel('cpu', { cores: 2, availRamGb: 1.0 }, cfg);
  assert.equal(res.selectedModel, 'small');
});

test('STT Models Directory: defaults to userDataDir/models for clean zero-residue uninstallation', () => {
  const customUserData = path.join(os.tmpdir(), 'snowball-custom-test-dir');
  const modelsDir = resolveModelsDir(DEFAULT_STT_CONFIG, customUserData);
  assert.equal(modelsDir, path.join(customUserData, 'models'));
});
