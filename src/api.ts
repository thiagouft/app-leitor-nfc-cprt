import * as SecureStore from 'expo-secure-store';

export async function getApiUrl() {
  const url = await SecureStore.getItemAsync('api_url');
  return url || 'http://192.168.1.14:3000/api';
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisição da API');
  }

  return data;
}
