import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AntigravityAdapter } from '../dist/harness/antigravity.js';

test('AntigravityAdapter: Brain directory session discovery and transcript delta parsing', async () => {
  // Create temporary mock brain environment
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-test-'));
  const brainDir = path.join(tempDir, 'brain');
  const convId = 'mock-conv-1234-abcd';
  const convDir = path.join(brainDir, convId);
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const transcriptFile = path.join(logsDir, 'transcript.jsonl');
  const initialSteps = [
    {
      step_index: 0,
      type: 'USER_INPUT',
      content: 'Fix HUD font rendering and multi-machine mesh',
      created_at: new Date().toISOString(),
    },
    {
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      content: 'I will analyze the codebase and implement the fixes.',
      created_at: new Date().toISOString(),
    },
  ];

  fs.writeFileSync(
    transcriptFile,
    initialSteps.map((s) => JSON.stringify(s)).join('\n') + '\n',
    'utf8'
  );

  const adapter = new AntigravityAdapter({
    appDataDir: tempDir,
  });

  try {
    const isAvail = await adapter.isAvailable();
    assert.equal(isAvail, true, 'Adapter should detect local appDataDir brain');

    await adapter.start();

    // 1. Discover projects
    const projects = await adapter.listProjects();
    assert.ok(projects.length >= 1);
    assert.ok(projects.some((p) => p.path === path.resolve(process.cwd())));

    // 2. Discover sessions from brain directory
    const sessions = await adapter.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, convId);
    assert.equal(sessions[0].preview, 'Fix HUD font rendering and multi-machine mesh');

    // 3. Test live transcript delta streaming
    const deltas = [];
    adapter.on('delta', (d) => deltas.push(d));

    // Watch session transcript
    await adapter.watchSessionTranscript(convId);

    // Append new step
    const newStep = {
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      content: 'Streaming response delta chunk from Antigravity agent',
      created_at: new Date().toISOString(),
    };
    fs.appendFileSync(transcriptFile, JSON.stringify(newStep) + '\n', 'utf8');

    // Wait for fs watcher
    await new Promise((r) => setTimeout(r, 200));

    assert.ok(deltas.length >= 1, 'Should receive delta from transcript file watcher');
    assert.equal(deltas[0].sessionId, convId);
    assert.ok(deltas[0].content.includes('Streaming response delta chunk'));
  } finally {
    await adapter.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
