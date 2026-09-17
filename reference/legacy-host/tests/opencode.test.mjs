import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { OpenCodeAdapter } from '../dist/harness/opencode.js';

test('OpenCodeAdapter: HTTP endpoints, SSE streaming, and permission responses', async () => {
  let sseClientRes = null;
  let lastPromptBody = null;
  let lastAbortCalled = false;
  let lastPermReply = null;

  const mockServer = http.createServer((req, res) => {
    if (req.url === '/global/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.18.30' }));
      return;
    }

    if (req.url === '/project') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 'proj-1', name: 'SnowballBridge', path: '/code/snowball' },
        { id: 'proj-2', name: 'CoreEngine', path: '/code/core' },
      ]));
      return;
    }

    if (req.url.startsWith('/session') && !req.url.includes('prompt_async') && !req.url.includes('abort')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 'sess-1', title: 'Refactor audio pipeline', updated_at: 1789000000 },
        { id: 'sess-2', title: 'Fix knob jitter', updated_at: 1789005000 },
      ]));
      return;
    }

    if (req.url === '/session/sess-1/prompt_async' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastPromptBody = JSON.parse(body);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted' }));
      });
      return;
    }

    if (req.url === '/session/sess-1/abort' && req.method === 'POST') {
      lastAbortCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'aborted' }));
      return;
    }

    if (req.url === '/permissions/perm-99/reply' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastPermReply = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'replied' }));
      });
      return;
    }

    if (req.url === '/global/event') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      sseClientRes = res;
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const testPort = 4199;
  await new Promise((resolve) => mockServer.listen(testPort, '127.0.0.1', resolve));

  const adapter = new OpenCodeAdapter({
    baseUrl: `http://127.0.0.1:${testPort}`,
    autoSpawn: false,
  });

  try {
    // 1. Availability check
    const isAvail = await adapter.isAvailable();
    assert.equal(isAvail, true);

    // 2. Start adapter & SSE connection
    await adapter.start();

    // 3. List projects
    const projects = await adapter.listProjects();
    assert.equal(projects.length, 2);
    assert.equal(projects[0].name, 'SnowballBridge');
    assert.equal(projects[1].id, 'proj-2');

    // 4. List sessions
    const sessions = await adapter.listSessions('proj-1');
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, 'sess-1');
    assert.equal(sessions[0].title, 'Refactor audio pipeline');

    // 5. Send Prompt
    await adapter.sendPrompt('sess-1', 'Test prompt for OpenCode', { model: 'claude-3-7' });
    assert.ok(lastPromptBody);
    assert.equal(lastPromptBody.parts[0].text, 'Test prompt for OpenCode');

    // 6. Interrupt / Abort
    await adapter.interrupt('sess-1');
    assert.equal(lastAbortCalled, true);

    // 7. Test SSE delta streaming
    assert.ok(sseClientRes, 'SSE client should be connected to /global/event');
    const deltasReceived = [];
    adapter.on('delta', (d) => deltasReceived.push(d));

    const sseEvent = JSON.stringify({
      type: 'message.part.delta',
      properties: {
        sessionID: 'sess-1',
        delta: 'Chunk from OpenCode AI model',
      },
    });
    sseClientRes.write(`data: ${sseEvent}\n\n`);

    // Give node event loop a moment to dispatch SSE
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(deltasReceived.length, 1);
    assert.equal(deltasReceived[0].sessionId, 'sess-1');
    assert.equal(deltasReceived[0].content, 'Chunk from OpenCode AI model');

    // 8. Test SSE Permission request
    const approvalsReceived = [];
    adapter.on('approval_request', (a) => approvalsReceived.push(a));

    const ssePerm = JSON.stringify({
      type: 'permission.request',
      properties: {
        id: 'perm-99',
        sessionID: 'sess-1',
        description: 'Run npm test in terminal',
      },
    });
    sseClientRes.write(`data: ${ssePerm}\n\n`);
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(approvalsReceived.length, 1);
    assert.equal(approvalsReceived[0].id, 'perm-99');
    assert.equal(approvalsReceived[0].prompt, 'Run npm test in terminal');

    // 9. Respond to Permission
    await adapter.respondApproval('perm-99', 'allow');
    assert.ok(lastPermReply);
    assert.equal(lastPermReply.decision, 'allow');
  } finally {
    await adapter.stop();
    await new Promise((resolve) => mockServer.close(resolve));
  }
});
