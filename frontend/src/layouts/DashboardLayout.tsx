import { Outlet, NavLink } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import {
  BarChart3,
  Bot,
  Users,
  Globe,
  Link,
  ScrollText,
  Settings,
  Clock,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { path: '/', label: 'Campaign', icon: BarChart3 },
  { path: '/agents', label: 'Agents', icon: Bot },
  { path: '/accounts', label: 'Accounts', icon: Users },
  { path: '/proxies', label: 'Proxy Manager', icon: Globe },
  { path: '/proxy-assignment', label: 'Proxy Assignment', icon: Link },
  { path: '/logs', label: 'System Logs', icon: ScrollText },
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/cron', label: 'Cron Scheduler', icon: Clock },
]

export default function DashboardLayout() {
  const { user, clearAuth } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      clearAuth()
    }
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <aside className="flex w-64 flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="border-b border-gray-200 dark:border-gray-800 p-4">
          <div className="flex items-center gap-3">
            <img src="/reddit-logo.png" alt="Redditors" className="h-9 w-9 rounded-lg object-cover" />
            <div>
              <h1 className="text-xl font-bold text-[#E8461E]">Redditors</h1>
              <p className="text-xs text-gray-500">Reddit Campaign Manager</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-[#E8461E]/10 text-[#E8461E]'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-3">
          <button
            type="button"
            aria-label="Toggle dark mode"
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{user?.username}</p>
              <p className="text-xs text-gray-500">{user?.role}</p>
            </div>
            <button
              type="button"
              aria-label="Log out"
              onClick={handleLogout}
              className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-red-500 dark:hover:text-red-400"
            >
              <LogOut className="h-3 w-3" />
              Logout
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
