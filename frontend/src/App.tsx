import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { authApi } from './api/auth'
import ProtectedRoute from './components/ProtectedRoute'
import DashboardLayout from './layouts/DashboardLayout'
import Accounts from './pages/Accounts'
import Agents from './pages/Agents'
import Campaign from './pages/Campaign'
import CronScheduler from './pages/CronScheduler'
import Login from './pages/Login'
import ProxyAssignment from './pages/ProxyAssignment'
import ProxyManager from './pages/ProxyManager'
import Settings from './pages/Settings'
import SystemLogs from './pages/SystemLogs'
import { useAuthStore } from './stores/authStore'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
})

function AuthInitializer({ children }: { children: ReactNode }) {
  const { token, setUser, clearAuth, setLoading } = useAuthStore()

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }

    authApi
      .getStatus()
      .then((res) => {
        if (res.data.user) {
          setUser(res.data.user)
        } else {
          clearAuth()
        }
      })
      .catch(() => {
        clearAuth()
      })
  }, [token, setUser, clearAuth, setLoading])

  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthInitializer>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Campaign />} />
              <Route path="agents" element={<Agents />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="proxies" element={<ProxyManager />} />
              <Route path="proxy-assignment" element={<ProxyAssignment />} />
              <Route path="logs" element={<SystemLogs />} />
              <Route path="settings" element={<Settings />} />
              <Route path="cron" element={<CronScheduler />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthInitializer>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
