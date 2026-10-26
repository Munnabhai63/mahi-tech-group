/**
 * Central API Client for MAHI TECH GROUP
 * Handles baseUrl, Bearer token injection, response interceptors,
 * error extraction, and automatic 401 token refresh/redirection.
 */

const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__) || '';
const TOKEN_KEY = 'mtg_auth_token';

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* Storage unavailable in restricted sandbox */
  }
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
}

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function extractErrorMessage(err) {
  if (!err) return 'An unexpected error occurred.';
  if (typeof err === 'string') return err;
  if (err.data?.error) return err.data.error;
  if (err.data?.message) return err.data.message;
  if (err.message) return err.message;
  return 'An unexpected error occurred.';
}

export async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getAuthToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    let res = await fetch(url, { ...options, headers });

    // Handle 401 Unauthorized: Clear invalid/expired token and trigger session expiry
    if (res.status === 401 && !path.includes('/auth/login')) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: { path } }));
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      const text = await res.text().catch(() => '');
      data = { message: text };
    }

    if (!res.ok) {
      const errorMsg = data?.error || data?.message || `Request failed with status ${res.status}`;
      throw new ApiError(errorMsg, res.status, data);
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || 'Network request failed', 0, null);
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  upload: (path, formData, options) => request(path, { ...options, method: 'POST', body: formData }),
  extractError: extractErrorMessage
};
