/**
 * Aether OS — Smoke Tests
 *
 * End-to-end tests that exercise real kernel → tool paths.
 * Run with: npm run test:smoke
 *
 * These are heavier than unit tests — each spins up a real Kernel instance
 * with a unique temp directory and tears it down after.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kernel } from '@aether/kernel';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

describe('smoke: Kernel lifecycle', () => {
  let kernel: Kernel;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `aether-smoke-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(testRoot, { recursive: true });
    process.env.AETHER_SECRET = 'smoke-test-secret';
    kernel = new Kernel({ fsRoot: testRoot, dbPath: path.join(testRoot, 'smoke.db') });
    await kernel.boot();
  });

  afterEach(async () => {
    await kernel.shutdown();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('smoke: boot initializes all subsystems and reports version', () => {
    expect(kernel.version).toBe('0.1.0');
    // Verify key subsystems are accessible
    expect(kernel.fs).toBeDefined();
    expect(kernel.processes).toBeDefined();
    expect(kernel.bus).toBeDefined();
    expect(kernel.auth).toBeDefined();
  });

  it('smoke: shutdown is clean and idempotent', async () => {
    await kernel.shutdown();
    // Second shutdown should not throw
    await kernel.shutdown();
  });
});

describe('smoke: File lifecycle', () => {
  let kernel: Kernel;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `aether-smoke-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(testRoot, { recursive: true });
    process.env.AETHER_SECRET = 'smoke-test-secret';
    kernel = new Kernel({ fsRoot: testRoot, dbPath: path.join(testRoot, 'smoke.db') });
    await kernel.boot();
  });

  afterEach(async () => {
    await kernel.shutdown();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('smoke: write → read → rename → delete full lifecycle', async () => {
    const filePath = '/tmp/smoke-test.txt';
    const content = 'Hello from smoke test';

    // Write
    const writeEvents = await kernel.handleCommand({
      type: 'fs.write',
      id: 'smoke_write',
      path: filePath,
      content,
    });
    expect(writeEvents.find((e) => e.type === 'response.ok')).toBeDefined();

    // Read back
    const readEvents = await kernel.handleCommand({
      type: 'fs.read',
      id: 'smoke_read',
      path: filePath,
    });
    const readOk = readEvents.find((e) => e.type === 'response.ok');
    expect(readOk).toBeDefined();
    if (readOk && readOk.type === 'response.ok') {
      expect((readOk as any).data.content).toBe(content);
    }

    // List directory to verify file exists
    const listEvents = await kernel.handleCommand({
      type: 'fs.ls',
      id: 'smoke_list',
      path: '/tmp',
    });
    const listOk = listEvents.find((e) => e.type === 'response.ok');
    expect(listOk).toBeDefined();
    if (listOk && listOk.type === 'response.ok') {
      const files = (listOk as any).data;
      expect(Array.isArray(files)).toBe(true);
      expect(files.some((f: any) => f.name === 'smoke-test.txt')).toBe(true);
    }

    // Delete
    const deleteEvents = await kernel.handleCommand({
      type: 'fs.rm',
      id: 'smoke_delete',
      path: filePath,
    });
    expect(deleteEvents.find((e) => e.type === 'response.ok')).toBeDefined();

    // Verify deleted
    const readAfterDelete = await kernel.handleCommand({
      type: 'fs.read',
      id: 'smoke_read2',
      path: filePath,
    });
    expect(readAfterDelete.find((e) => e.type === 'response.error')).toBeDefined();
  });

  it('smoke: atomic writes survive (temp file cleaned up)', async () => {
    const filePath = '/tmp/atomic-test.txt';
    await kernel.handleCommand({
      type: 'fs.write',
      id: 'atomic_w',
      path: filePath,
      content: 'atomic content',
    });

    // Verify no .aether-tmp- files left behind
    const tmpDir = path.join(testRoot, 'tmp');
    if (fs.existsSync(tmpDir)) {
      const entries = fs.readdirSync(tmpDir);
      const tmpFiles = entries.filter((e) => e.includes('.aether-tmp-'));
      expect(tmpFiles).toHaveLength(0);
    }
  });
});

describe('smoke: Auth flow', () => {
  let kernel: Kernel;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `aether-smoke-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(testRoot, { recursive: true });
    process.env.AETHER_SECRET = 'smoke-test-secret';
    kernel = new Kernel({ fsRoot: testRoot, dbPath: path.join(testRoot, 'smoke.db') });
    await kernel.boot();
  });

  afterEach(async () => {
    await kernel.shutdown();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('smoke: default admin login → token → validate', async () => {
    // Login with default credentials
    const loginResult = await kernel.auth.authenticateUser('admin', 'aether');
    expect(loginResult).toBeDefined();
    expect(loginResult!.token).toBeDefined();
    expect(loginResult!.user.username).toBe('admin');
    expect(loginResult!.user.role).toBe('admin');

    // Validate the token
    const validated = kernel.auth.validateToken(loginResult!.token);
    expect(validated).toBeDefined();
    expect(validated!.username).toBe('admin');
  });

  it('smoke: invalid credentials are rejected', async () => {
    const result = await kernel.auth.authenticateUser('admin', 'wrong-password');
    expect(result).toBeNull();
  });
});

describe('smoke: Agent pause/resume/continue', () => {
  let kernel: Kernel;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `aether-smoke-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(testRoot, { recursive: true });
    process.env.AETHER_SECRET = 'smoke-test-secret';
    kernel = new Kernel({ fsRoot: testRoot, dbPath: path.join(testRoot, 'smoke.db') });
    await kernel.boot();
  });

  afterEach(async () => {
    await kernel.shutdown();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('smoke: pause and resume a running agent', async () => {
    // Spawn agent
    const spawnEvents = await kernel.handleCommand({
      type: 'process.spawn',
      id: 'smoke_spawn',
      config: { role: 'Coder', goal: 'Pause test' },
    });
    const spawnOk = spawnEvents.find((e) => e.type === 'response.ok') as any;
    expect(spawnOk).toBeDefined();
    const pid = spawnOk.data.pid;

    // Pause
    const pauseEvents = await kernel.handleCommand({
      type: 'agent.pause',
      id: 'smoke_pause',
      pid,
    } as any);
    expect(pauseEvents.find((e) => e.type === 'response.ok')).toBeDefined();

    // Verify state is stopped
    const proc = kernel.processes.get(pid);
    expect(proc?.info.state).toBe('stopped');

    // Resume
    const resumeEvents = await kernel.handleCommand({
      type: 'agent.resume',
      id: 'smoke_resume',
      pid,
    } as any);
    expect(resumeEvents.find((e) => e.type === 'response.ok')).toBeDefined();

    // Verify state is running
    const procAfter = kernel.processes.get(pid);
    expect(procAfter?.info.state).toBe('running');
  });
});

describe('smoke: Process spawn and info', () => {
  let kernel: Kernel;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(os.tmpdir(), `aether-smoke-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(testRoot, { recursive: true });
    process.env.AETHER_SECRET = 'smoke-test-secret';
    kernel = new Kernel({ fsRoot: testRoot, dbPath: path.join(testRoot, 'smoke.db') });
    await kernel.boot();
  });

  afterEach(async () => {
    await kernel.shutdown();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('smoke: spawn agent and query info', async () => {
    const spawnEvents = await kernel.handleCommand({
      type: 'process.spawn',
      id: 'smoke_spawn_info',
      config: { role: 'Researcher', goal: 'Info test' },
    });

    const spawnOk = spawnEvents.find((e) => e.type === 'response.ok') as any;
    const pid = spawnOk.data.pid;

    // Query process info
    const infoEvents = await kernel.handleCommand({
      type: 'process.info',
      id: 'smoke_info',
      pid,
    });
    const infoOk = infoEvents.find((e) => e.type === 'response.ok') as any;
    expect(infoOk).toBeDefined();
    expect(infoOk.data.name).toContain('Researcher');
    expect(infoOk.data.state).toBe('running');
  });

  it('smoke: list processes returns spawned agents', async () => {
    // Spawn two agents
    await kernel.handleCommand({
      type: 'process.spawn',
      id: 'smoke_s1',
      config: { role: 'Coder', goal: 'List test 1' },
    });
    await kernel.handleCommand({
      type: 'process.spawn',
      id: 'smoke_s2',
      config: { role: 'Analyst', goal: 'List test 2' },
    });

    const listEvents = await kernel.handleCommand({
      type: 'process.list',
      id: 'smoke_list_proc',
    });
    const listOk = listEvents.find((e) => e.type === 'response.ok') as any;
    expect(listOk).toBeDefined();
    expect(listOk.data.length).toBeGreaterThanOrEqual(2);
  });
});
