import apiClient from './client'

export interface User {
  id: number
  username: string
  email: string
  role: 'admin' | 'reviewer'
}

export interface AuthResponse {
  token: string
  user: User
}

export interface AuthStatus {
  auth_enabled: boolean
  signup_enabled: boolean
  bootstrap_mode: boolean
  user: User | null
}

export const authApi = {
  login: (identity: string, password: string) =>
    apiClient.post<AuthResponse>('/api/auth/login', { identity, password }),

  signup: (username: string, email: string, password: string, confirm_password: string) =>
    apiClient.post<AuthResponse>('/api/auth/signup', { username, email, password, confirm_password }),

  logout: () => apiClient.post('/api/auth/logout', {}),

  getStatus: () => apiClient.get<AuthStatus>('/api/auth/status'),
}
