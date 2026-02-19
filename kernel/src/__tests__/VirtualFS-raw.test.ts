import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { VirtualFS } from '../VirtualFS.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import os from 'node:os';

describe('VirtualFS - raw file operations', () => {
  let bus: EventBus;
  let vfs: VirtualFS;
  let testRoot: string;

  beforeEach(async () => {
    bus = new EventBus();
    testRoot = path.join(os.tmpdir(), `aether-test-raw-${crypto.randomBytes(8).toString('hex')}`);
    vfs = new VirtualFS(bus, testRoot);
    await vfs.init();
    await vfs.createHome('agent_1');
  });

  afterEach(async () => {
    await vfs.shutdown();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  describe('readFileRaw()', () => {
    it('returns a Buffer for text files', async () => {
      await vfs.writeFile('/home/agent_1/test.txt', 'Hello, raw!');
      const buf = await vfs.readFileRaw('/home/agent_1/test.txt');

      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.toString('utf-8')).toBe('Hello, raw!');
    });

    it('returns a Buffer for binary content', async () => {
      // Write raw binary bytes directly to disk
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
      const realPath = path.join(testRoot, 'home', 'agent_1', 'fake.png');
      await fs.writeFile(realPath, binaryData);

      const buf = await vfs.readFileRaw('/home/agent_1/fake.png');
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBe(8);
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
    });

    it('throws on nonexistent file', async () => {
      await expect(vfs.readFileRaw('/home/agent_1/nope.bin')).rejects.toThrow();
    });

    it('blocks path traversal', async () => {
      await expect(vfs.readFileRaw('../../etc/passwd')).rejects.toThrow('Access denied');
    });
  });

  describe('createReadStream()', () => {
    it('streams file content', async () => {
      await vfs.writeFile('/home/agent_1/stream.txt', 'stream data');

      const stream = vfs.createReadStream('/home/agent_1/stream.txt');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const result = Buffer.concat(chunks).toString('utf-8');
      expect(result).toBe('stream data');
    });

    it('supports byte range with start/end', async () => {
      await vfs.writeFile('/home/agent_1/range.txt', 'ABCDEFGHIJ');

      const stream = vfs.createReadStream('/home/agent_1/range.txt', { start: 2, end: 5 });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const result = Buffer.concat(chunks).toString('utf-8');
      expect(result).toBe('CDEF');
    });

    it('blocks path traversal', () => {
      expect(() => vfs.createReadStream('../../etc/passwd')).toThrow('Access denied');
    });
  });
});
