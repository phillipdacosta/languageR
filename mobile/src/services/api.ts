import { env } from '../config/env';

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else {
      console.warn('[API] No token set for request:', path);
    }

    const res = await fetch(`${env.apiUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message || body.error || `Request failed (${res.status})`);
    }

    return res.json();
  }

  async requestWithToken<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    };

    const res = await fetch(`${env.apiUrl}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message || body.error || `Request failed (${res.status})`);
    }

    return res.json();
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: any) {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put<T>(path: string, body?: any) {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async upload<T>(path: string, formData: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else {
      console.warn('[API upload] No auth token!');
    }

    const url = `${env.apiUrl}${path}`;
    console.log('[API upload] POST', url, 'hasToken:', !!this.token);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    console.log('[API upload] Response status:', res.status);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[API upload] FAILED status:', res.status, 'body:', JSON.stringify(body));
      const msg = body.message || body.error || `Upload failed (${res.status})`;
      const detail = body.detail ? ` — ${body.detail}` : '';
      throw new ApiError(res.status, msg + detail);
    }

    return res.json();
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const api = new ApiClient();
