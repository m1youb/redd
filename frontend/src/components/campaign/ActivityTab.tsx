import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import type { ManagedAction } from './types'

interface ActivityTabProps {
  actions: ManagedAction[]
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return 'Unknown time'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-5 w-5" />
    case 'error':
      return <XCircle className="h-5 w-5" />
    case 'cancelled':
      return <AlertCircle className="h-5 w-5" />
    default:
      return <AlertCircle className="h-5 w-5" />
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'done':
      return 'bg-green-500/10 text-green-600 dark:text-green-300'
    case 'error':
      return 'bg-red-500/10 text-red-600 dark:text-red-300'
    case 'cancelled':
      return 'bg-gray-500/10 text-gray-400'
    default:
      return 'bg-gray-500/10 text-gray-400'
  }
}

function getStatusBadgeClasses(status: string) {
  switch (status) {
    case 'done':
      return 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-300'
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300'
    case 'cancelled':
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
    default:
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
  }
}

export default function ActivityTab({ actions }: ActivityTabProps) {
  const items = actions.slice(0, 25)

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Recent Activity</p>
        <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Action timeline</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">A focused view of the latest completed, errored, and cancelled actions.</p>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm shadow-black/20">
        {items.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center text-center">
            <div>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">No recent activity</p>
              <p className="mt-2 text-sm text-gray-500">Completed and failed actions will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((action, index) => (
              <div key={action.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`mt-1 flex h-10 w-10 items-center justify-center rounded-full ${getStatusColor(action.status)}`}>
                    {getStatusIcon(action.status)}
                  </div>
                  {index !== items.length - 1 ? <div className="mt-2 h-full w-px bg-gray-200 dark:bg-gray-800" /> : null}
                </div>
                <article className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {action.account_username && (
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">u/{action.account_username}</p>
                      )}
                      <span className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${getStatusBadgeClasses(action.status)}`}>
                        {action.status}
                      </span>
                      <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs text-gray-700 dark:text-gray-300">
                        {action.content_mode}
                      </span>
                    </div>
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">{formatTimestamp(action.updated_at ?? action.created_at)}</p>
                  </div>
                  <p className="mt-3 break-words text-sm font-medium leading-6 text-gray-800 dark:text-gray-200">{action.title}</p>
                  {action.keyword && (
                    <p className="mt-1 text-xs text-gray-500">Keyword: {action.keyword}</p>
                  )}
                </article>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
