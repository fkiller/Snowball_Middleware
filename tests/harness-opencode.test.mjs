import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpenCodeOwnedAdapter, opencodeManifest } from '../packages/harness-opencode/dist/index.js';
import { formatSessionKey } from '../packages/core/dist/index.js';

const hostId = `host_${'b'.repeat(32)}`;
const instanceId = 'opencode-test';

class MockOpenCodeServer {
  server;
  port = 0;
  sessions = [{ id: 'existing-1', directory: '/home/user/project' }];
  messages = [];
  aborted = [];
  decisions = [];
  sseStreams = new Set();
  requirePassword = false;
  password = 'secret-password';

  async start() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

      // Check auth if password required
      if (this.requirePassword) {
        const auth = req.headers['authorization'];
        if (auth !== `Bearer ${this.password}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      }

      if (url.pathname === '/global/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url.pathname === '/session' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.sessions));
        return;
      }

      if (url.pathname === '/session' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          const newSession = { id: `session-${this.sessions.length + 1}`, directory: parsed.directory || '/test' };
          this.sessions.push(newSession);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(newSession));
        });
        return;
      }

      const matchMsg = /^\/session\/([^/]+)\/message$/.exec(url.pathname);
      if (matchMsg && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          const msg = { sessionId: matchMsg[1], text: parsed.text, messageId: `msg-${Date.now()}` };
          this.messages.push(msg);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messageId: msg.messageId }));
        });
        return;
      }

      const matchAbort = /^\/session\/([^/]+)\/abort$/.exec(url.pathname);
      if (matchAbort && req.method === 'POST') {
        this.aborted.push(matchAbort[1]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const matchDec = /^\/session\/([^/]+)\/decision$/.exec(url.pathname);
      if (matchDec && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          this.decisions.push({ sessionId: matchDec[1], ...parsed });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      const matchRead = /^\/session\/([^/]+)$/.exec(url.pathname);
      if (matchRead && req.method === 'GET') {
        const found = this.sessions.find(s => s.id === matchRead[1]);
        if (found) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(found));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not_found' }));
        }
        return;
      }

      if (url.pathname === '/event' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        this.sseStreams.add(res);
        req.on('close', () => this.sseStreams.delete(res));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise(r => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
  }

  broadcast(event, data) {
    const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseStreams) {
      res.write(text);
    }
  }

  async stop() {
    for (const res of this.sseStreams) res.end();
    this.sseStreams.clear();
    if (this.server?.listening) {
      await new Promise(r => this.server.close(r));
    }
  }
}

test('MW.03.02.01.02: OpenCode manifest publishes observe and control capabilities', async () => {
  const manifest = await opencodeManifest();
  assert.equal(manifest.id, 'snowball.opencode');
  assert.equal(manifest.kind, 'harness');

  const observeOps = manifest.capabilities.filter(c => c.access === 'observe').map(c => c.operation);
  const controlOps = manifest.capabilities.filter(c => c.access === 'control').map(c => c.operation);

  assert.ok(observeOps.includes('harness.status'));
  assert.ok(observeOps.includes('harness.list'));
  assert.ok(observeOps.includes('harness.read'));
  assert.ok(observeOps.includes('harness.refreshAuth'));

  assert.ok(controlOps.includes('harness.connect'));
  assert.ok(controlOps.includes('harness.create'));
  assert.ok(controlOps.includes('harness.execute'));
  assert.ok(controlOps.includes('harness.disconnect'));
});

test('MW.03.02.01.02.A1: OpenCode auth detection, session lifecycle (create, list, read) and session identity', async t => {
  const server = new MockOpenCodeServer();
  await server.start();
  t.after(() => server.stop());

  const adapter = new OpenCodeOwnedAdapter({
    hostId,
    instanceId,
    baseUrl: `http://127.0.0.1:${server.port}`,
  });
  await adapter.initialize();
  t.after(() => adapter.stop());

  const status = adapter.status();
  assert.equal(status.connected, true);
  assert.equal(status.auth, 'not_required');
  assert.equal(status.surface, 'http-sse');

  // List existing sessions before creation: all existing sessions should be read-only
  const initialSessions = await adapter.listSessions();
  assert.equal(initialSessions.length, 1);
  assert.equal(initialSessions[0].nativeId, 'existing-1');
  assert.equal(initialSessions[0].readOnly, true);
  assert.equal(initialSessions[0].ownerId, null);

  // Create a new owned session
  const created = await adapter.createSession('/workspace/project-alpha');
  assert.ok(created.sessionKey);
  assert.equal(created.ownerId, adapter.ownerId);

  // List sessions again: created session must be owned, existing session remains read-only
  const updatedSessions = await adapter.listSessions();
  assert.equal(updatedSessions.length, 2);
  const owned = updatedSessions.find(s => s.nativeId === 'session-2');
  assert.ok(owned);
  assert.equal(owned.readOnly, false);
  assert.equal(owned.ownerId, adapter.ownerId);
  assert.equal(owned.sessionKey, created.sessionKey);

  // Read session
  const read = await adapter.readSession('session-2');
  assert.equal(read.nativeId, 'session-2');
  assert.equal(read.readOnly, false);
});

test('MW.03.02.01.02.A1: OpenCode command dispatch (send, interrupt, decision) and owner protection', async t => {
  const server = new MockOpenCodeServer();
  await server.start();
  t.after(() => server.stop());

  const adapter = new OpenCodeOwnedAdapter({
    hostId,
    instanceId,
    baseUrl: `http://127.0.0.1:${server.port}`,
  });
  await adapter.initialize();
  t.after(() => adapter.stop());

  const created = await adapter.createSession('/workspace/project-beta');
  const signal = new AbortController().signal;

  // 1. Send message
  const sendEnvelope = {
    command: {
      input: {
        commandId: 'cmd-send-1',
        actorId: 'ctl_test',
        ownerId: adapter.ownerId,
        sessionKey: created.sessionKey,
        operation: 'sessions.send',
        payload: { text: 'Hello from Snowball' },
        expectedRevision: 0,
      },
    },
  };
  const sendReceipt = await adapter.execute(sendEnvelope, signal);
  assert.equal(sendReceipt.status, 'acknowledged');
  assert.ok(sendReceipt.correlationId);
  assert.equal(server.messages.length, 1);
  assert.equal(server.messages[0].text, 'Hello from Snowball');

  // 2. Interrupt turn
  const interruptEnvelope = {
    command: {
      input: {
        commandId: 'cmd-int-1',
        actorId: 'ctl_test',
        ownerId: adapter.ownerId,
        sessionKey: created.sessionKey,
        operation: 'sessions.interrupt',
        payload: { turnId: sendReceipt.correlationId },
        expectedRevision: 1,
      },
    },
  };
  const intReceipt = await adapter.execute(interruptEnvelope, signal);
  assert.equal(intReceipt.status, 'acknowledged');
  assert.equal(server.aborted.length, 1);

  // 3. Resolve decision
  const decisionEnvelope = {
    command: {
      input: {
        commandId: 'cmd-dec-1',
        actorId: 'ctl_test',
        ownerId: adapter.ownerId,
        sessionKey: created.sessionKey,
        operation: 'decisions.resolve',
        payload: { answer: 'accept' },
        expectedRevision: 2,
      },
    },
    decision: {
      decisionId: 'dec-1',
      sessionKey: created.sessionKey,
      ownerId: adapter.ownerId,
      status: 'pending',
      revision: 0,
      updatedAt: Date.now(),
    },
  };
  const decReceipt = await adapter.execute(decisionEnvelope, signal);
  assert.equal(decReceipt.status, 'acknowledged');
  assert.equal(server.decisions.length, 1);
  assert.equal(server.decisions[0].answer, 'accept');

  // 4. Wrong owner or unowned session rejected
  const wrongOwnerEnvelope = structuredClone(sendEnvelope);
  wrongOwnerEnvelope.command.input.ownerId = 'other-owner';
  const wrongReceipt = await adapter.execute(wrongOwnerEnvelope, signal);
  assert.equal(wrongReceipt.status, 'not_sent');
  assert.equal(wrongReceipt.reason, 'owner_mismatch');
});

test('MW.03.02.01.02.A1: OpenCode external turn revokes local ownership via SSE', async t => {
  const server = new MockOpenCodeServer();
  await server.start();
  t.after(() => server.stop());

  const adapter = new OpenCodeOwnedAdapter({
    hostId,
    instanceId,
    baseUrl: `http://127.0.0.1:${server.port}`,
  });
  await adapter.initialize();
  t.after(() => adapter.stop());

  const created = await adapter.createSession('/workspace/project-gamma');
  let ownerLostEvent;
  adapter.once('ownerLost', ev => { ownerLostEvent = ev; });

  // Wait briefly for SSE stream to establish
  await new Promise(r => setTimeout(r, 100));

  // Server broadcasts that a foreign turn started on our session
  server.broadcast('turn/started', { sessionId: 'session-2', turnId: 'foreign-turn-999' });

  // Wait for event to propagate
  await new Promise(r => setTimeout(r, 150));

  assert.ok(ownerLostEvent);
  assert.equal(ownerLostEvent.sessionKey, created.sessionKey);
  assert.equal(ownerLostEvent.reason, 'external_turn');

  // After ownership lost, sending must fail with owner_mismatch
  const envelope = {
    command: {
      input: {
        commandId: 'cmd-after-lost',
        actorId: 'ctl_test',
        ownerId: adapter.ownerId,
        sessionKey: created.sessionKey,
        operation: 'sessions.send',
        payload: { text: 'should not send' },
        expectedRevision: 0,
      },
    },
  };
  const receipt = await adapter.execute(envelope, new AbortController().signal);
  assert.equal(receipt.status, 'not_sent');
  assert.equal(receipt.reason, 'owner_mismatch');
});
