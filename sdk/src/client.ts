/**
 * Aether SDK - TypeScript Client
 *
 * Full-featured client for the Aether OS REST API v1.
 * Provides typed methods for all API endpoints with
 * namespace-grouped access patterns.
 */

import { subscribeEvents } from './sse.js';

export interface AetherClientOptions {
  baseUrl: string;
  token?: string;
}

export interface ApiResponse<T> {
  data: T;
  meta?: { total: number; limit: number; offset: number };
}

export interface ApiError {
  error: { code: string; message: string };
}

export class AetherApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AetherApiError';
  }
}

export class AetherClient {
  private baseUrl: string;
  private token: string | null;

  constructor(options: AetherClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token ?? null;
  }

  setToken(token: string): void {
    this.token = token;
  }

  // --- Auth ---
  async login(username: string, password: string): Promise<{ token: string; user: any }> {
    const res = await this.post<{ token: string; user: any }>('/api/auth/login', {
      username,
      password,
    });
    if (res.token) this.token = res.token;
    return res;
  }

  // --- Agents ---
  readonly agents = {
    list: (opts?: { status?: string; limit?: number; offset?: number }) =>
      this.get<any[]>('/api/v1/agents', opts),
    spawn: (config: {
      role: string;
      goal: string;
      model?: string;
      tools?: string[];
      maxSteps?: number;
    }) => this.post<any>('/api/v1/agents', config),
    get: (uid: string) => this.get<any>(`/api/v1/agents/${uid}`),
    kill: (uid: string) => this.delete<any>(`/api/v1/agents/${uid}`),
    message: (uid: string, content: string) =>
      this.post<any>(`/api/v1/agents/${uid}/message`, { content }),
    timeline: (uid: string, opts?: { limit?: number; offset?: number }) =>
      this.get<any[]>(`/api/v1/agents/${uid}/timeline`, opts),
    memory: (uid: string, opts?: { query?: string; layer?: string; limit?: number }) =>
      this.get<any[]>(`/api/v1/agents/${uid}/memory`, opts),
    plan: (uid: string) => this.get<any>(`/api/v1/agents/${uid}/plan`),
    profile: (uid: string) => this.get<any>(`/api/v1/agents/${uid}/profile`),
  };

  // --- Filesystem ---
  readonly fs = {
    read: (path: string) => this.get<any>(`/api/v1/fs/${encodeURIComponent(path)}`),
    write: (path: string, content: string) =>
      this.put<any>(`/api/v1/fs/${encodeURIComponent(path)}`, { content }),
    delete: (path: string) => this.delete<any>(`/api/v1/fs/${encodeURIComponent(path)}`),
  };

  // --- Templates ---
  readonly templates = {
    list: () => this.get<any[]>('/api/v1/templates'),
    get: (id: string) => this.get<any>(`/api/v1/templates/${id}`),
  };

  // --- System ---
  readonly system = {
    status: () => this.get<any>('/api/v1/system/status'),
    metrics: () => this.get<any>('/api/v1/system/metrics'),
  };

  // --- Events (SSE) ---
  readonly events = {
    subscribe: (filter?: string[]) => subscribeEvents(this.baseUrl, this.token, filter),
  };

  // --- Cron ---
  readonly cron = {
    list: () => this.get<any[]>('/api/v1/cron'),
    create: (data: { name: string; expression: string; agent_config: any }) =>
      this.post<any>('/api/v1/cron', data),
    delete: (id: string) => this.delete<any>(`/api/v1/cron/${id}`),
    update: (id: string, data: { enabled?: boolean }) =>
      this.patch<any>(`/api/v1/cron/${id}`, data),
  };

  // --- Triggers ---
  readonly triggers = {
    list: () => this.get<any[]>('/api/v1/triggers'),
    create: (data: { name: string; event_type: string; agent_config: any }) =>
      this.post<any>('/api/v1/triggers', data),
    delete: (id: string) => this.delete<any>(`/api/v1/triggers/${id}`),
  };

  // --- Marketplace (Template Marketplace) ---
  readonly marketplace = {
    templates: {
      list: (opts?: { category?: string; tags?: string[] }) =>
        this.get<any[]>('/api/v1/marketplace/templates', opts),
      publish: (template: any) => this.post<any>('/api/v1/marketplace/templates', template),
      unpublish: (id: string) => this.delete<any>(`/api/v1/marketplace/templates/${id}`),
      rate: (id: string, data: { rating: number; review?: string }) =>
        this.post<any>(`/api/v1/marketplace/templates/${id}/rate`, data),
      fork: (id: string) => this.post<any>(`/api/v1/marketplace/templates/${id}/fork`),
    },
  };

  // --- Internal HTTP methods ---
  private async get<T>(path: string, queryParams?: Record<string, any>): Promise<T> {
    const url = this.buildUrl(path, queryParams);
    const res = await fetch(url, { headers: this.headers() });
    return this.handleResponse<T>(res);
  }

  private async post<T>(path: string, body?: any): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(res);
  }

  private async put<T>(path: string, body: any): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async patch<T>(path: string, body: any): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: 'PATCH',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async delete<T>(path: string): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: 'DELETE',
      headers: this.headers(),
    });
    return this.handleResponse<T>(res);
  }

  private buildUrl(path: string, queryParams?: Record<string, any>): string {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            url.searchParams.set(key, value.join(','));
          } else {
            url.searchParams.set(key, String(value));
          }
        }
      }
    }
    return url.toString();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text();
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }
      const message = parsed?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      const code = parsed?.error?.code || `HTTP_${res.status}`;
      throw new AetherApiError(message, code, res.status);
    }
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  }
}
