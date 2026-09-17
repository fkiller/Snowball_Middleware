import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MeshRouter } from '../dist/peer/mesh.js';

class MockHarness extends EventEmitter {
  constructor(id, name) {
    super();
    this.id = id;
    this.name = name;
    this.lastPrompt = null;
    this.lastInterrupt = null;
  }

  async isAvailable() { return true; }
  async start() {}
  async stop() {}

  async listProjects() {
    return [
      { id: 'remote-proj-1', name: 'StudioApp', path: '/studio/app' },
    ];
  }

  async listSessions(projId) {
    return [
      { id: 'remote-sess-1', title: 'Remote session 1', createdAt: 123456, preview: 'Testing mesh' },
    ];
  }

  async createSession() {
    return { id: 'remote-sess-new', title: 'New Remote Session', createdAt: Date.now(), preview: '' };
  }

  async sendPrompt(sessionId, text, options) {
    this.lastPrompt = { sessionId, text, options };
  }

  async interrupt(sessionId) {
    this.lastInterrupt = sessionId;
  }

  async respondApproval(id, decision) {}
}

test('MeshRouter: distributed peer mesh, RPC proxying, and multi-machine routing', async () => {
  const node1Port = 7710;
  const node2Port = 7711;

  const node1 = new MeshRouter({
    localId: 'dev-pc',
    localName: 'DEV-PC',
    port: node1Port,
    knownPeers: [
      { id: 'dev-pc', name: 'DEV-PC', host: '127.0.0.1', port: node1Port },
      { id: 'mac-studio', name: 'STUDIO', host: '127.0.0.1', port: node2Port },
    ],
  });

  const node2 = new MeshRouter({
    localId: 'mac-studio',
    localName: 'STUDIO',
    port: node2Port,
    knownPeers: [
      { id: 'dev-pc', name: 'DEV-PC', host: '127.0.0.1', port: node1Port },
      { id: 'mac-studio', name: 'STUDIO', host: '127.0.0.1', port: node2Port },
    ],
  });

  const mockHarness = new MockHarness('opencode', 'OpenCode');
  node2.registerHarness(mockHarness);

  await node1.start();
  await node2.start();

  try {
    // 1. Check machine list on node1
    const machines = node1.getMachines();
    assert.equal(machines.length, 2);
    assert.ok(machines.some((m) => m.id === 'dev-pc'));
    assert.ok(machines.some((m) => m.id === 'mac-studio'));

    // 2. RPC proxy: node1 queries node2 for projects
    const remoteProjects = await node1.listProjects('mac-studio', 'opencode');
    assert.equal(remoteProjects.length, 1);
    assert.equal(remoteProjects[0].id, 'remote-proj-1');
    assert.equal(remoteProjects[0].name, 'StudioApp');

    // 3. RPC proxy: node1 queries node2 for sessions
    const remoteSessions = await node1.listSessions('mac-studio', 'opencode', 'remote-proj-1');
    assert.equal(remoteSessions.length, 1);
    assert.equal(remoteSessions[0].id, 'remote-sess-1');
    assert.equal(remoteSessions[0].title, 'Remote session 1');

    // 4. RPC proxy: node1 sends prompt to node2's harness
    await node1.sendPrompt('mac-studio', 'opencode', 'remote-sess-1', 'Build release binary', {
      model: 'claude-3-7',
    });
    assert.ok(mockHarness.lastPrompt);
    assert.equal(mockHarness.lastPrompt.sessionId, 'remote-sess-1');
    assert.equal(mockHarness.lastPrompt.text, 'Build release binary');
    assert.equal(mockHarness.lastPrompt.options.model, 'claude-3-7');

    // 5. RPC proxy: node1 interrupts session on node2
    await node1.interrupt('mac-studio', 'opencode', 'remote-sess-1');
    assert.equal(mockHarness.lastInterrupt, 'remote-sess-1');
  } finally {
    await node1.stop();
    await node2.stop();
  }
});
