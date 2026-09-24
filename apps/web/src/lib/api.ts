export interface ApiError extends Error {
  status: number;
  code?: string;
  detail?: unknown;
}

const TOKEN_KEY = 'ogoj-token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, { method, headers, body: payload, credentials: 'include' });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const error = new Error(
      (data && (data.message || data.error)) || `请求失败（${response.status}）`,
    ) as ApiError;
    error.status = response.status;
    error.code = data?.error;
    error.detail = data?.detail;
    throw error;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  upload: <T>(url: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', url, form);
  },
  /** 下载二进制文件（导出 ZIP 等），失败时抛出带后端提示的错误 */
  download: async (url: string, fallbackName = 'download'): Promise<string> => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) {
      let message = `下载失败（${response.status}）`;
      try {
        const data = await response.json();
        message = data?.message || data?.error || message;
      } catch {
        /* 非 JSON 响应，保留默认提示 */
      }
      const error = new Error(message) as ApiError;
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const matched = /filename="?([^";]+)"?/.exec(disposition);
    const name = matched?.[1] ? decodeURIComponent(matched[1]) : fallbackName;
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    return name;
  },
};

export function query(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
