/**
 * Centralized API client configuration
 * Gets base URL from environment variables with fallback to localhost
 */

const API_BASE_URL =
  typeof window !== 'undefined'
    ? process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'
    : process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

const WS_BASE_URL =
  typeof window !== 'undefined'
    ? process.env.NEXT_PUBLIC_WS_BASE_URL || 'ws://localhost:8080'
    : process.env.NEXT_PUBLIC_WS_BASE_URL || 'ws://localhost:8080';

export const API_CONFIG = {
  baseUrl: API_BASE_URL,
  wsUrl: WS_BASE_URL,
};

export function createWebSocket(path: string = ''): WebSocket {
  const url = `${WS_BASE_URL}${path}`;
  return new WebSocket(url);
}

export async function apiFetch(
  endpoint: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;
  return fetch(url, options);
}

/**
 * Helper to make JSON API calls
 */
export async function apiCall<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await apiFetch(endpoint, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
