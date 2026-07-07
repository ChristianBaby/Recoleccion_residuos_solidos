import { getRefreshToken, getSavedUser, saveSession, clearSession, isTokenExpired } from './auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

interface FetchOptions extends RequestInit {
  token?: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: { field: string; message: string }[],
  ) {
    super(message)
  }
}

let refreshPromise: Promise<string | null> | null = null

async function tryRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    const savedUser = getSavedUser()
    if (!refreshToken || !savedUser) {
      return null
    }

    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) {
        throw new Error('Refresh failed')
      }
      const json = await res.json()
      const data = json.data
      saveSession({ accessToken: data.accessToken, refreshToken: data.refreshToken }, savedUser)
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session-refreshed', { detail: data.accessToken }))
      }
      return data.accessToken
    } catch {
      clearSession()
      if (typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      return null
    }
  })()

  const result = await refreshPromise
  refreshPromise = null
  return result
}

async function request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  let { token, ...init } = options

  // Proactive check: refresh if expired
  if (token && isTokenExpired(token)) {
    const refreshedToken = await tryRefresh()
    if (refreshedToken) {
      token = refreshedToken
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let res = await fetch(`${API_URL}${endpoint}`, { ...init, headers })
  let json = await res.json()

  // Reactive check: retry on 401
  if (res.status === 401) {
    const refreshedToken = await tryRefresh()
    if (refreshedToken) {
      headers['Authorization'] = `Bearer ${refreshedToken}`
      res = await fetch(`${API_URL}${endpoint}`, { ...init, headers })
      json = await res.json()
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, json.message ?? 'Error desconocido', json.errors)
  }

  return json
}

export const api = {
  get: <T>(endpoint: string, token?: string) =>
    request<T>(endpoint, { method: 'GET', token }),

  post: <T>(endpoint: string, body: unknown, token?: string) =>
    request<T>(endpoint, { method: 'POST', body: JSON.stringify(body), token }),

  put: <T>(endpoint: string, body: unknown, token?: string) =>
    request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body), token }),

  patch: <T>(endpoint: string, body?: unknown, token?: string) =>
    request<T>(endpoint, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined, token }),

  delete: <T>(endpoint: string, token?: string) =>
    request<T>(endpoint, { method: 'DELETE', token }),
}
