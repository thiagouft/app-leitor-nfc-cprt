import * as SecureStore from 'expo-secure-store';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

let sessionExpiredCallback: (() => void) | null = null;

export function onSessionExpired(callback: () => void) {
  sessionExpiredCallback = callback;
}

export async function getApiUrl() {
  const url = await SecureStore.getItemAsync('api_url');
  return url || 'https://app.mixestec.com.br/api';
}

export async function setApiUrl(url: string) {
  await SecureStore.setItemAsync('api_url', url);
}

export async function getToken() {
  return await SecureStore.getItemAsync('user_token');
}

export async function setToken(token: string) {
  await SecureStore.setItemAsync('user_token', token);
}

export async function apiFetch(endpoint: string, options: any = {}) {
  const baseUrl = await getApiUrl();
  const token = await getToken();

  const headers: any = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers
  });

  let data: any = {};
  try {
    data = await response.json();
  } catch (err) {
    // Fallback if parsing JSON fails
  }

  if (response.status === 401 && endpoint !== '/auth/login') {
    if (sessionExpiredCallback) {
      sessionExpiredCallback();
    }
    throw new ApiError('SESSION_EXPIRED', 401);
  }

  if (!response.ok) {
    throw new ApiError(data.error || 'Erro na requisição da API', response.status);
  }

  return data;
}
