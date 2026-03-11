import { create } from 'zustand'
import type { User } from '../api/auth'

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setAuth: (token: string, user: User) => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  isAuthenticated: !!localStorage.getItem('auth_token'),
  isLoading: true,

  setAuth: (token: string, user: User) => {
    localStorage.setItem('auth_token', token)
    set({ token, user, isAuthenticated: true, isLoading: false })
  },

  clearAuth: () => {
    localStorage.removeItem('auth_token')
    set({ token: null, user: null, isAuthenticated: false, isLoading: false })
  },

  setLoading: (loading: boolean) => set({ isLoading: loading }),

  setUser: (user: User) => set({ user, isAuthenticated: true, isLoading: false }),
}))
