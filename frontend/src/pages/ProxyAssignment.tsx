import { useState, useCallback, type DragEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, AlertTriangle, X, Loader2, MapPin, Users, Globe } from 'lucide-react'
import { proxiesApi, type Proxy } from '../api/proxies'
import { accountsApi, type Account } from '../api/accounts'

interface ProxyCardProps {
  proxy: Proxy
  accountCount: number
  onDragStart: (e: DragEvent, proxyId: number) => void
}

function ProxyCard({ proxy, accountCount, onDragStart }: ProxyCardProps) {
  const statusColor =
    proxy.status === 'working'
      ? 'border-emerald-300 dark:border-emerald-700/50 bg-emerald-100 dark:bg-emerald-900/20'
      : proxy.status === 'failed'
        ? 'border-red-300 dark:border-red-700/50 bg-red-100 dark:bg-red-900/20'
        : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50'

  const statusDot =
    proxy.status === 'working'
      ? 'bg-emerald-400'
      : proxy.status === 'failed'
        ? 'bg-red-400'
        : 'bg-gray-500'

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, proxy.id)}
      className={`cursor-grab rounded-xl border p-3 transition-all active:cursor-grabbing ${statusColor} hover:border-[#E8461E]/40 hover:shadow-lg hover:shadow-[#E8461E]/5`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-gray-800 dark:text-gray-200" title={proxy.address}>
            {proxy.address}
          </p>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
              {proxy.status || 'untested'}
            </span>
            {proxy.location && proxy.location !== 'Unknown' && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {proxy.location}
              </span>
            )}
          </div>
        </div>
        <span className="flex-shrink-0 rounded-full bg-gray-200 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {accountCount} acct{accountCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  )
}

interface AccountCardProps {
  account: Account
  proxy: Proxy | undefined
  onDrop: (accountId: number, proxyId: number) => void
  onRemoveProxy: (accountId: number) => void
  isAssigning: boolean
  flashState: 'none' | 'success' | 'error'
}

function AccountCard({ account, proxy, onDrop, onRemoveProxy, isAssigning, flashState }: AccountCardProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'link'
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const proxyId = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (!isNaN(proxyId)) {
      onDrop(account.id, proxyId)
    }
  }

  const flashBorder =
    flashState === 'success'
      ? 'border-emerald-500 shadow-emerald-500/20 shadow-lg'
      : flashState === 'error'
        ? 'border-red-500 shadow-red-500/20 shadow-lg'
        : isDragOver
          ? 'border-[#E8461E] border-solid bg-[#E8461E]/5 shadow-lg shadow-[#E8461E]/10'
          : 'border-gray-200 dark:border-gray-800'

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed p-4 transition-all duration-300 ${flashBorder} ${
        isDragOver ? '' : 'bg-white dark:bg-gray-900/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300">
            {account.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{account.username}</p>
            {account.status && (
              <p className="text-xs text-gray-500">{account.status}</p>
            )}
          </div>
        </div>
        {isAssigning && <Loader2 className="h-4 w-4 animate-spin text-[#E8461E]" />}
      </div>

      <div className="mt-3">
        {proxy ? (
          <div className="flex items-center justify-between rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-gray-700 dark:text-gray-300" title={proxy.address}>
                {proxy.address}
              </p>
              {proxy.location && proxy.location !== 'Unknown' && (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                  <MapPin className="h-2.5 w-2.5" />
                  {proxy.location}
                </p>
              )}
            </div>
            <button
              onClick={() => onRemoveProxy(account.id)}
              disabled={isAssigning}
              title="Remove proxy"
              className="ml-2 flex-shrink-0 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-red-400 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-3 py-2 text-center text-xs text-gray-500">
            {isDragOver ? (
              <span className="text-[#E8461E]">Drop proxy here</span>
            ) : (
              'Drag a proxy here to assign'
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProxyAssignment() {
  const queryClient = useQueryClient()
  const [flashStates, setFlashStates] = useState<Record<number, 'success' | 'error'>>({})
  const [assigningIds, setAssigningIds] = useState<Set<number>>(new Set())

  const { data: proxies = [], isLoading: proxiesLoading } = useQuery({
    queryKey: ['proxies'],
    queryFn: async () => (await proxiesApi.getAll()).data,
  })

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await accountsApi.getAll()).data,
  })

  const isLoading = proxiesLoading || accountsLoading

  const assignMutation = useMutation({
    mutationFn: ({ accountId, proxyId }: { accountId: number; proxyId: number | null }) =>
      accountsApi.assignProxy(accountId, { proxy_id: proxyId }),
    onMutate: ({ accountId }) => {
      setAssigningIds((prev) => new Set(prev).add(accountId))
    },
    onSuccess: (_data, { accountId }) => {
      setAssigningIds((prev) => {
        const next = new Set(prev)
        next.delete(accountId)
        return next
      })
      setFlashStates((prev) => ({ ...prev, [accountId]: 'success' }))
      setTimeout(() => {
        setFlashStates((prev) => {
          const next = { ...prev }
          delete next[accountId]
          return next
        })
      }, 1200)
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (_err, { accountId }) => {
      setAssigningIds((prev) => {
        const next = new Set(prev)
        next.delete(accountId)
        return next
      })
      setFlashStates((prev) => ({ ...prev, [accountId]: 'error' }))
      setTimeout(() => {
        setFlashStates((prev) => {
          const next = { ...prev }
          delete next[accountId]
          return next
        })
      }, 1500)
    },
  })

  const handleDrop = useCallback(
    (accountId: number, proxyId: number) => {
      assignMutation.mutate({ accountId, proxyId })
    },
    [assignMutation],
  )

  const handleRemoveProxy = useCallback(
    (accountId: number) => {
      assignMutation.mutate({ accountId, proxyId: null })
    },
    [assignMutation],
  )

  const handleDragStart = useCallback((e: DragEvent, proxyId: number) => {
    e.dataTransfer.setData('text/plain', proxyId.toString())
    e.dataTransfer.effectAllowed = 'link'
  }, [])

  const proxyMap = new Map(proxies.map((p) => [p.id, p]))

  const getAccountCountForProxy = (proxyId: number) => {
    return accounts.filter((a) => a.proxy_id === proxyId).length
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6">
          <div className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-900" />
          <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
            <div className="h-[600px] rounded-2xl bg-gray-100 dark:bg-gray-900" />
            <div className="h-[600px] rounded-2xl bg-gray-100 dark:bg-gray-900" />
          </div>
        </div>
      </div>
    )
  }

  const assignedCount = accounts.filter((a) => a.proxy_id != null).length
  const unassignedCount = accounts.length - assignedCount

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[#E8461E]/10 p-3 text-[#ff8c6d]">
            <Link2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Proxy Assignment</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Drag proxies from the pool onto accounts to assign them
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Globe className="h-3.5 w-3.5" />
              Total Proxies
            </div>
            <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{proxies.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Users className="h-3.5 w-3.5" />
              Accounts Assigned
            </div>
            <p className="mt-2 text-2xl font-semibold text-emerald-400">{assignedCount}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              Unassigned
            </div>
            <p className="mt-2 text-2xl font-semibold text-yellow-400">{unassignedCount}</p>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Left: Proxy Pool */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                Proxy Pool
              </h2>
              <span className="rounded-full bg-gray-200 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                {proxies.length}
              </span>
            </div>
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
              {proxies.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  <Globe className="mx-auto mb-2 h-8 w-8 text-gray-400 dark:text-gray-600" />
                  No proxies available.
                  <br />
                  Add proxies in the Proxy Manager first.
                </div>
              ) : (
                proxies.map((proxy) => (
                  <ProxyCard
                    key={proxy.id}
                    proxy={proxy}
                    accountCount={getAccountCountForProxy(proxy.id)}
                    onDragStart={handleDragStart}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: Accounts Grid */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                Accounts
              </h2>
              <span className="rounded-full bg-gray-200 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                {accounts.length}
              </span>
            </div>
            {accounts.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                <Users className="mx-auto mb-2 h-8 w-8 text-gray-400 dark:text-gray-600" />
                No accounts found.
                <br />
                Add accounts first.
              </div>
            ) : (
              <div
                className="grid gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3"
                style={{ maxHeight: 'calc(100vh - 340px)' }}
              >
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    proxy={account.proxy_id != null ? proxyMap.get(account.proxy_id) : undefined}
                    onDrop={handleDrop}
                    onRemoveProxy={handleRemoveProxy}
                    isAssigning={assigningIds.has(account.id)}
                    flashState={flashStates[account.id] ?? 'none'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
