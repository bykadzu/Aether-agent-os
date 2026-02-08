import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { IntegrationManager } from '../IntegrationManager.js';

// ---------------------------------------------------------------------------
// Unit tests for S3Integration
// ---------------------------------------------------------------------------

describe('S3Integration', () => {
  let bus: EventBus;
  let store: StateStore;
  let manager: IntegrationManager;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-s3-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    manager = new IntegrationManager(bus, store);
    await manager.init();
  });

  afterEach(() => {
    manager.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  describe('registration', () => {
    it('registers an s3 integration and returns info', () => {
      const info = manager.register({
        type: 's3',
        name: 'My S3',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });

      expect(info.id).toBeDefined();
      expect(info.type).toBe('s3');
      expect(info.name).toBe('My S3');
      expect(info.enabled).toBe(true);
      expect(info.status).toBe('disconnected');
      expect(info.available_actions.length).toBe(7);
    });

    it('lists available actions', () => {
      const info = manager.register({ type: 's3', name: 'Actions Test' });
      const names = info.available_actions.map((a: any) => a.name);
      expect(names).toContain('s3.list_buckets');
      expect(names).toContain('s3.list_objects');
      expect(names).toContain('s3.get_object');
      expect(names).toContain('s3.put_object');
      expect(names).toContain('s3.delete_object');
      expect(names).toContain('s3.copy_object');
      expect(names).toContain('s3.head_object');
    });
  });

  // ---------------------------------------------------------------------------
  // testConnection
  // ---------------------------------------------------------------------------

  describe('testConnection', () => {
    it('returns success when list_buckets succeeds', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response('<ListAllMyBucketsResult></ListAllMyBucketsResult>', {
            status: 200,
          }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 's3',
        name: 'Test Conn',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-west-2',
        },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(true);
      expect(result.message).toContain('us-west-2');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('s3.us-west-2.amazonaws.com');
    });

    it('returns failure when S3 returns error status', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response('<Error><Code>InvalidAccessKeyId</Code></Error>', {
            status: 403,
          }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 's3',
        name: 'Fail Conn',
        credentials: {
          access_key_id: 'BADKEY',
          secret_access_key: 'BADSECRET',
          region: 'us-east-1',
        },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('403');
    });

    it('returns failure on network error', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network error');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 's3',
        name: 'Net Error',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });

      const result = await manager.test(info.id);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });
  });

  // ---------------------------------------------------------------------------
  // Actions (all 7)
  // ---------------------------------------------------------------------------

  describe('actions', () => {
    function stubFetch(
      responseBody: string,
      status = 200,
      responseHeaders?: Record<string, string>,
    ) {
      const mockFetch = vi.fn(async () => {
        const headers = new Headers(responseHeaders || {});
        return new Response(responseBody, { status, headers });
      });
      vi.stubGlobal('fetch', mockFetch);
      return mockFetch;
    }

    function registerS3() {
      return manager.register({
        type: 's3',
        name: 'Action Test',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });
    }

    it('list_buckets sends GET to s3 endpoint', async () => {
      const mockFetch = stubFetch('<ListAllMyBucketsResult></ListAllMyBucketsResult>');
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.list_buckets', {});

      expect(result.status).toBe(200);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('s3.us-east-1.amazonaws.com');
    });

    it('list_objects sends GET with query params', async () => {
      const mockFetch = stubFetch('<ListBucketResult></ListBucketResult>');
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.list_objects', {
        bucket: 'my-bucket',
        prefix: 'docs/',
        max_keys: 10,
      });

      expect(result.status).toBe(200);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('my-bucket.s3.us-east-1.amazonaws.com');
      expect(url).toContain('list-type=2');
      expect(url).toContain('prefix=docs');
      expect(url).toContain('max-keys=10');
    });

    it('get_object returns content and metadata', async () => {
      const mockFetch = stubFetch('file content here', 200, {
        'content-type': 'text/plain',
        'content-length': '17',
      });
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.get_object', {
        bucket: 'my-bucket',
        key: 'docs/readme.txt',
      });

      expect(result.content).toBe('file content here');
      expect(result.contentType).toBe('text/plain');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('my-bucket.s3.us-east-1.amazonaws.com/docs/readme.txt');
    });

    it('put_object sends PUT with body', async () => {
      const mockFetch = stubFetch('', 200);
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.put_object', {
        bucket: 'my-bucket',
        key: 'uploads/file.txt',
        body: 'hello world',
        content_type: 'text/plain',
      });

      expect(result.status).toBe(200);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('my-bucket.s3.us-east-1.amazonaws.com/uploads/file.txt');
      expect(opts.method).toBe('PUT');
      expect(opts.body).toBe('hello world');
    });

    it('delete_object sends DELETE', async () => {
      const mockFetch = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', mockFetch);
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.delete_object', {
        bucket: 'my-bucket',
        key: 'old/file.txt',
      });

      expect(result.status).toBe(204);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('my-bucket.s3.us-east-1.amazonaws.com/old/file.txt');
      expect(opts.method).toBe('DELETE');
    });

    it('copy_object sends PUT with x-amz-copy-source', async () => {
      const mockFetch = stubFetch('<CopyObjectResult></CopyObjectResult>');
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.copy_object', {
        source_bucket: 'src-bucket',
        source_key: 'src/key.txt',
        dest_bucket: 'dst-bucket',
        dest_key: 'dst/key.txt',
      });

      expect(result.status).toBe(200);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('dst-bucket.s3.us-east-1.amazonaws.com/dst/key.txt');
      expect(opts.method).toBe('PUT');
      expect(opts.headers['x-amz-copy-source']).toBe('/src-bucket/src/key.txt');
    });

    it('head_object sends HEAD and returns metadata', async () => {
      const mockFetch = stubFetch('', 200, {
        'content-type': 'application/pdf',
        'content-length': '4096',
        'last-modified': 'Thu, 01 Jan 2025 00:00:00 GMT',
        etag: '"abc123"',
      });
      const info = registerS3();

      const result = await manager.execute(info.id, 's3.head_object', {
        bucket: 'my-bucket',
        key: 'docs/report.pdf',
      });

      expect(result.status).toBe(200);
      expect(result.contentType).toBe('application/pdf');
      expect(result.contentLength).toBe('4096');
      expect(result.etag).toBe('"abc123"');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('my-bucket.s3.us-east-1.amazonaws.com/docs/report.pdf');
      expect(opts.method).toBe('HEAD');
    });
  });

  // ---------------------------------------------------------------------------
  // AWS Signature V4
  // ---------------------------------------------------------------------------

  describe('AWS Signature V4', () => {
    it('includes Authorization header with AWS4-HMAC-SHA256', async () => {
      const mockFetch = vi.fn(
        async () =>
          new Response('<ListAllMyBucketsResult></ListAllMyBucketsResult>', {
            status: 200,
          }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 's3',
        name: 'Sig Test',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });

      await manager.execute(info.id, 's3.list_buckets', {});

      const [, opts] = mockFetch.mock.calls[0];
      const authHeader = opts.headers['Authorization'];
      expect(authHeader).toBeDefined();
      expect(authHeader).toMatch(/^AWS4-HMAC-SHA256/);
      expect(authHeader).toContain('Credential=AKIAIOSFODNN7EXAMPLE');
      expect(authHeader).toContain('SignedHeaders=');
      expect(authHeader).toContain('Signature=');
    });

    it('includes x-amz-date and x-amz-content-sha256 headers', async () => {
      const mockFetch = vi.fn(async () => new Response('', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 's3',
        name: 'Header Test',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });

      await manager.execute(info.id, 's3.list_buckets', {});

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(opts.headers['x-amz-content-sha256']).toBeDefined();
      expect(opts.headers['x-amz-content-sha256']).toHaveLength(64);
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws on unknown action', async () => {
      const info = manager.register({
        type: 's3',
        name: 'Error Test',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });
      await expect(manager.execute(info.id, 's3.nonexistent', {})).rejects.toThrow(
        'Unknown action: s3.nonexistent',
      );
    });

    it('logs errors to integration logs', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 's3',
        name: 'Error Log',
        credentials: {
          access_key_id: 'AKIAIOSFODNN7EXAMPLE',
          secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
        },
      });

      await expect(manager.execute(info.id, 's3.list_buckets', {})).rejects.toThrow(
        'Connection refused',
      );

      const logs = store.getIntegrationLogs(info.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('error');
    });
  });
});
