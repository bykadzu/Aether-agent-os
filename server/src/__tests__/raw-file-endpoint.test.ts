import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kernel } from '@aether/kernel';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as nodePath from 'node:path';

// MIME type map (mirrors server/src/index.ts)
const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

/**
 * Minimal HTTP server that replicates the /api/fs/raw endpoint logic
 * from server/src/index.ts, using a real Kernel instance for filesystem access.
 * This avoids booting the full server (with WebSocket, agents, etc.) in tests.
 */
function createTestServer(kernel: Kernel) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);

    if (url.pathname === '/api/fs/raw' && req.method === 'GET') {
      const filePath = url.searchParams.get('path');

      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required "path" query parameter' }));
        return;
      }

      const normalized = nodePath.posix.normalize(filePath);
      if (normalized.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied: path traversal detected' }));
        return;
      }

      try {
        const stat = await kernel.fs.stat(filePath);
        if (stat.type === 'directory') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot serve a directory' }));
          return;
        }

        const fileSize = stat.size;
        const ext = nodePath.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (!match) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end();
            return;
          }
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end();
            return;
          }
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
            'Content-Disposition': 'inline',
          });
          const stream = kernel.fs.createReadStream(filePath, { start, end });
          stream.pipe(res);
          stream.on('error', () => res.end());
          return;
        }

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Content-Disposition': 'inline',
          'Accept-Ranges': 'bytes',
        });
        const stream = kernel.fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', () => res.end());
        return;
      } catch (err: any) {
        if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }
        if (err.message?.includes('Access denied')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });
}

function fetch(url: string, options: { headers?: Record<string, string> } = {}): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
  });
}

describe('/api/fs/raw endpoint', () => {
  let kernel: Kernel;
  let testRoot: string;
  let dbPath: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    testRoot = path.join('/tmp', `aether-raw-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(testRoot, { recursive: true });
    dbPath = path.join(testRoot, 'test.db');
    process.env.AETHER_SECRET = 'raw-test-secret';
    kernel = new Kernel({ fsRoot: testRoot, dbPath });
    await kernel.boot();

    // Create test files
    await kernel.fs.createHome('root');
    await kernel.fs.writeFile('/home/root/hello.txt', 'Hello World');
    // Write binary PNG header
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fsp.writeFile(path.join(testRoot, 'home', 'root', 'image.png'), pngHeader);
    // Write a test MP3 (fake content)
    const mp3Data = Buffer.alloc(1024, 0xff);
    await fsp.writeFile(path.join(testRoot, 'home', 'root', 'song.mp3'), mp3Data);
    // Write a PDF header
    const pdfData = Buffer.from('%PDF-1.4 test content');
    await fsp.writeFile(path.join(testRoot, 'home', 'root', 'doc.pdf'), pdfData);

    server = createTestServer(kernel);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await kernel.shutdown();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {}
  });

  it('returns 400 when path parameter is missing', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw`);
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body.toString());
    expect(body.error).toContain('path');
  });

  it('returns 403 for path traversal attempts', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw?path=../../etc/passwd`);
    expect(res.status).toBe(403);
    const body = JSON.parse(res.body.toString());
    expect(body.error).toContain('path traversal');
  });

  it('returns 403 for path with .. that escapes root', async () => {
    // Path that starts with .. (absolute traversal above root)
    const res = await fetch(`${baseUrl}/api/fs/raw?path=../../../etc/passwd`);
    expect(res.status).toBe(403);
    const body = JSON.parse(res.body.toString());
    expect(body.error).toContain('path traversal');
  });

  it('normalizes paths with internal .. that stay within root', async () => {
    // /home/root/../root/hello.txt normalizes to /home/root/hello.txt (no ..)
    // This should serve the file since it stays within the VFS
    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/Documents/../hello.txt`);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('Hello World');
  });

  it('returns 404 for nonexistent file', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/nonexistent.txt`);
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body.toString());
    expect(body.error).toContain('not found');
  });

  it('serves a text file with correct Content-Type', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/hello.txt`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.body.toString()).toBe('Hello World');
  });

  it('serves a PNG file with correct Content-Type', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/image.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body[0]).toBe(0x89);
    expect(res.body[1]).toBe(0x50);
  });

  it('serves an MP3 file with audio/mpeg Content-Type', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/song.mp3`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(parseInt(res.headers['content-length'] as string, 10)).toBe(1024);
  });

  it('serves a PDF file with correct Content-Type', async () => {
    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/doc.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('returns application/octet-stream for unknown extensions', async () => {
    const unknownData = Buffer.from('binary stuff');
    await fsp.writeFile(path.join(testRoot, 'home', 'root', 'data.xyz'), unknownData);

    const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/data.xyz`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
  });

  describe('Range requests', () => {
    it('returns 206 with partial content for valid Range header', async () => {
      const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/song.mp3`, {
        headers: { Range: 'bytes=0-99' },
      });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-99/1024');
      expect(parseInt(res.headers['content-length'] as string, 10)).toBe(100);
      expect(res.body.length).toBe(100);
    });

    it('returns 206 for range with open end', async () => {
      const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/song.mp3`, {
        headers: { Range: 'bytes=512-' },
      });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 512-1023/1024');
      expect(parseInt(res.headers['content-length'] as string, 10)).toBe(512);
    });

    it('returns 416 for out-of-range request', async () => {
      const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/song.mp3`, {
        headers: { Range: 'bytes=2000-3000' },
      });
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */1024');
    });

    it('returns 416 for invalid range format', async () => {
      const res = await fetch(`${baseUrl}/api/fs/raw?path=/home/root/song.mp3`, {
        headers: { Range: 'bytes=invalid' },
      });
      expect(res.status).toBe(416);
    });
  });
});
