/**
 * Aether Kernel - S3 Integration (v0.4 Wave 4)
 *
 * Implements the IIntegration interface for Amazon S3 REST API.
 * Uses native fetch() and node:crypto for AWS Signature V4 signing.
 * No external dependencies.
 */

import * as crypto from 'node:crypto';
import type { IIntegration, IntegrationActionDef } from './IIntegration.js';
import { errMsg } from '../logger.js';

const ACTIONS: IntegrationActionDef[] = [
  {
    name: 's3.list_buckets',
    description: 'List all S3 buckets owned by the authenticated user',
  },
  {
    name: 's3.list_objects',
    description: 'List objects in an S3 bucket',
    parameters: {
      bucket: { type: 'string', description: 'Bucket name', required: true },
      prefix: { type: 'string', description: 'Key prefix filter' },
      max_keys: { type: 'number', description: 'Maximum keys to return (default 1000)' },
      continuation_token: { type: 'string', description: 'Pagination continuation token' },
    },
  },
  {
    name: 's3.get_object',
    description: 'Get an object from an S3 bucket',
    parameters: {
      bucket: { type: 'string', description: 'Bucket name', required: true },
      key: { type: 'string', description: 'Object key', required: true },
    },
  },
  {
    name: 's3.put_object',
    description: 'Put an object into an S3 bucket',
    parameters: {
      bucket: { type: 'string', description: 'Bucket name', required: true },
      key: { type: 'string', description: 'Object key', required: true },
      body: { type: 'string', description: 'Object content', required: true },
      content_type: {
        type: 'string',
        description: 'Content-Type header (default application/octet-stream)',
      },
    },
  },
  {
    name: 's3.delete_object',
    description: 'Delete an object from an S3 bucket',
    parameters: {
      bucket: { type: 'string', description: 'Bucket name', required: true },
      key: { type: 'string', description: 'Object key', required: true },
    },
  },
  {
    name: 's3.copy_object',
    description: 'Copy an object within or between S3 buckets',
    parameters: {
      source_bucket: { type: 'string', description: 'Source bucket name', required: true },
      source_key: { type: 'string', description: 'Source object key', required: true },
      dest_bucket: { type: 'string', description: 'Destination bucket name', required: true },
      dest_key: { type: 'string', description: 'Destination object key', required: true },
    },
  },
  {
    name: 's3.head_object',
    description: 'Get metadata for an object without downloading it',
    parameters: {
      bucket: { type: 'string', description: 'Bucket name', required: true },
      key: { type: 'string', description: 'Object key', required: true },
    },
  },
];

export class S3Integration implements IIntegration {
  readonly type = 's3';

  getAvailableActions(): IntegrationActionDef[] {
    return ACTIONS;
  }

  async testConnection(
    credentials: Record<string, string>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const region = credentials.region || 'us-east-1';
      const url = new URL(`https://s3.${region}.amazonaws.com/`);
      const headers: Record<string, string> = {};
      const signed = this.signRequest('GET', url, headers, '', credentials);

      const res = await fetch(url.toString(), { headers: signed });
      if (res.ok) {
        return { success: true, message: `Connected to S3 in ${region}` };
      }
      return { success: false, message: `S3 API returned ${res.status}` };
    } catch (err: unknown) {
      return { success: false, message: errMsg(err) || 'Connection failed' };
    }
  }

  async executeAction(
    action: string,
    params: Record<string, any>,
    credentials: Record<string, string>,
  ): Promise<any> {
    const region = credentials.region || 'us-east-1';

    switch (action) {
      case 's3.list_buckets': {
        const url = new URL(`https://s3.${region}.amazonaws.com/`);
        const headers: Record<string, string> = {};
        const signed = this.signRequest('GET', url, headers, '', credentials);
        const res = await fetch(url.toString(), { headers: signed });
        const text = await res.text();
        return { status: res.status, body: text };
      }

      case 's3.list_objects': {
        const bucket = params.bucket;
        const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/`);
        url.searchParams.set('list-type', '2');
        if (params.prefix) url.searchParams.set('prefix', params.prefix);
        if (params.max_keys) url.searchParams.set('max-keys', String(params.max_keys));
        if (params.continuation_token) {
          url.searchParams.set('continuation-token', params.continuation_token);
        }
        const headers: Record<string, string> = {};
        const signed = this.signRequest('GET', url, headers, '', credentials);
        const res = await fetch(url.toString(), { headers: signed });
        const text = await res.text();
        return { status: res.status, body: text };
      }

      case 's3.get_object': {
        const bucket = params.bucket;
        const key = params.key;
        const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
        const headers: Record<string, string> = {};
        const signed = this.signRequest('GET', url, headers, '', credentials);
        const res = await fetch(url.toString(), { headers: signed });
        const content = await res.text();
        return {
          content,
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          size: res.headers.get('content-length') || String(content.length),
        };
      }

      case 's3.put_object': {
        const bucket = params.bucket;
        const key = params.key;
        const body = params.body || '';
        const contentType = params.content_type || 'application/octet-stream';
        const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
        const headers: Record<string, string> = {
          'Content-Type': contentType,
        };
        const signed = this.signRequest('PUT', url, headers, body, credentials);
        const res = await fetch(url.toString(), {
          method: 'PUT',
          headers: signed,
          body,
        });
        return { status: res.status, statusText: res.statusText };
      }

      case 's3.delete_object': {
        const bucket = params.bucket;
        const key = params.key;
        const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
        const headers: Record<string, string> = {};
        const signed = this.signRequest('DELETE', url, headers, '', credentials);
        const res = await fetch(url.toString(), {
          method: 'DELETE',
          headers: signed,
        });
        return { status: res.status, statusText: res.statusText };
      }

      case 's3.copy_object': {
        const destBucket = params.dest_bucket;
        const destKey = params.dest_key;
        const copySource = `/${params.source_bucket}/${params.source_key}`;
        const url = new URL(`https://${destBucket}.s3.${region}.amazonaws.com/${destKey}`);
        const headers: Record<string, string> = {
          'x-amz-copy-source': copySource,
        };
        const signed = this.signRequest('PUT', url, headers, '', credentials);
        const res = await fetch(url.toString(), {
          method: 'PUT',
          headers: signed,
        });
        const text = await res.text();
        return { status: res.status, body: text };
      }

      case 's3.head_object': {
        const bucket = params.bucket;
        const key = params.key;
        const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
        const headers: Record<string, string> = {};
        const signed = this.signRequest('HEAD', url, headers, '', credentials);
        const res = await fetch(url.toString(), {
          method: 'HEAD',
          headers: signed,
        });
        const metadata: Record<string, string> = {};
        res.headers.forEach((value, name) => {
          metadata[name] = value;
        });
        return {
          status: res.status,
          contentType: res.headers.get('content-type') || '',
          contentLength: res.headers.get('content-length') || '',
          lastModified: res.headers.get('last-modified') || '',
          etag: res.headers.get('etag') || '',
          metadata,
        };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // ---------------------------------------------------------------------------
  // AWS Signature V4
  // ---------------------------------------------------------------------------

  private signRequest(
    method: string,
    url: URL,
    headers: Record<string, string>,
    body: string,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const region = credentials.region || 'us-east-1';
    const service = 's3';
    const accessKeyId = credentials.access_key_id;
    const secretAccessKey = credentials.secret_access_key;

    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8); // YYYYMMDD
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ

    // Payload hash
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

    // Set required headers
    headers['host'] = url.host;
    headers['x-amz-date'] = amzDate;
    headers['x-amz-content-sha256'] = payloadHash;

    // Canonical headers — sorted lowercase
    const sortedHeaderKeys = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders =
      sortedHeaderKeys
        .map(
          (k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!].trim()}`,
        )
        .join('\n') + '\n';
    const signedHeaders = sortedHeaderKeys.join(';');

    // Canonical query string — sorted
    const searchParams = new URLSearchParams(url.search);
    const sortedParams = [...searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQueryString = sortedParams
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    // Canonical URI
    const canonicalUri = url.pathname || '/';

    // Canonical request
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    // Scope
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;

    // String to sign
    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, canonicalRequestHash].join('\n');

    // Signing key
    const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    // Signature
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    // Authorization header
    headers['Authorization'] =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    return headers;
  }
}
