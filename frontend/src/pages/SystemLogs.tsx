import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Info,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { accountsApi, type Account } from '../api/accounts'
import { logsApi, type LogEntry } from '../api/logs'
import ConfirmDialog from '../components/ui/ConfirmDialog'

type LogLevel = 'all' | 'error' | 'warning' | 'info' | 'debug'

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
]

function getLevelBadge(level: string) {
  switch (level.toLowerCase()) {
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300'
    case 'warning':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300'
    case 'info':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300'
    case 'debug':
      return 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
    default:
      return 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
  }
}

function getLevelIcon(level: string) {
  switch (level.toLowerCase()) {
    case 'error':
      return <XCircle className="h-3.5 w-3.5" />
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5" />
    case 'info':
      return <Info className="h-3.5 w-3.5" />
    default:
      return <FileText className="h-3.5 w-3.5" />
  }
}

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50">
      <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" /></td>
      <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td>
      <td className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td>
    </tr>
  )
}

export default function SystemLogs() {
  const queryClient = useQueryClient()
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all')
  const [accountFilter, setAccountFilter] = useState<number | undefined>(undefined)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [isClearOpen, setIsClearOpen] = useState(false)

  const {
    data: logs = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['logs', accountFilter],
    queryFn: async () => (await logsApi.getAll(accountFilter)).data,
    refetchInterval: autoRefresh ? 5000 : false,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await accountsApi.getAll()).data,
  })

  const clearMutation = useMutation({
    mutationFn: () => logsApi.clear(accountFilter),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['logs'] })
    },
  })

  const filteredLogs = useMemo(() => {
    if (levelFilter === 'all') return logs
    return logs.filter((l: LogEntry) => l.level.toLowerCase() === levelFilter)
  }, [logs, levelFilter])

  const accountMap = useMemo(() => {
    const map = new Map<number, string>()
    accounts.forEach((a: Account) => map.set(a.id, a.username))
    return map
  }, [accounts])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8461E]/10">
            <FileText className="h-5 w-5 text-[#E8461E]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">System Logs</h1>
            <p className="text-sm text-gray-500">
              {filteredLogs.length} log{filteredLogs.length !== 1 ? 's' : ''}
              {accountFilter ? ` for ${accountMap.get(accountFilter) ?? 'account'}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={clsx(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
              autoRefresh
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            <RefreshCw className={clsx('h-4 w-4', autoRefresh && 'animate-spin')} />
            Auto-refresh
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setIsClearOpen(true)}
            disabled={filteredLogs.length === 0}
            className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Clear Logs
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          {LEVEL_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => setLevelFilter(opt.value)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                levelFilter === opt.value
                  ? 'border-[#E8461E]/30 bg-[#E8461E]/10 text-[#E8461E]'
                  : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <select
            value={accountFilter ?? ''}
            onChange={(e) => setAccountFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="appearance-none rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 pl-3 pr-8 text-sm text-gray-700 dark:text-gray-300 transition-colors hover:border-gray-400 dark:hover:border-gray-600 focus:border-[#E8461E] focus:outline-none"
          >
            <option value="">All Accounts</option>
            {accounts.map((a: Account) => (
              <option key={a.id} value={a.id}>
                {a.username}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        </div>
      </div>

      {/* Log Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {isLoading ? (
          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Time</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Level</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Account</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Message</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </tbody>
            </table>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="mb-3 h-10 w-10 text-red-400" />
            <p className="mb-1 text-sm font-medium text-gray-800 dark:text-gray-200">Failed to load logs</p>
            <p className="mb-4 text-xs text-gray-500">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d13d17]"
            >
              Retry
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <FileText className="mb-3 h-10 w-10 text-gray-400 dark:text-gray-600" />
            <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">No logs found</p>
            <p className="text-xs text-gray-500">
              {levelFilter !== 'all' || accountFilter
                ? 'Try adjusting your filters'
                : 'Logs will appear here as the system runs'}
            </p>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="min-w-[720px] w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Time</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Level</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Account</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Message</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log: LogEntry) => (
                  <tr key={log.id} className="border-b border-gray-200 dark:border-gray-800/50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                          getLevelBadge(log.level)
                        )}
                      >
                        {getLevelIcon(log.level)}
                        {log.level}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {log.account_id ? accountMap.get(log.account_id) ?? `#${log.account_id}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm break-words text-gray-700 dark:text-gray-300">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clear Confirm Dialog */}
      <ConfirmDialog
        isOpen={isClearOpen}
        onClose={() => setIsClearOpen(false)}
        onConfirm={() => clearMutation.mutate()}
        title="Clear Logs"
        message={
          accountFilter
            ? `Are you sure you want to clear all logs for ${accountMap.get(accountFilter) ?? 'this account'}? This cannot be undone.`
            : 'Are you sure you want to clear ALL logs? This cannot be undone.'
        }
        confirmLabel={clearMutation.isPending ? 'Clearing...' : 'Clear Logs'}
        variant="danger"
      />
    </div>
  )
}
