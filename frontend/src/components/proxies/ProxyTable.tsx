import { useState } from 'react'
import type { Proxy } from '../../api/proxies'
import { Loader2, MapPin, Pencil, Trash2, Wifi } from 'lucide-react'

interface ProxyTableProps {
  proxies: Proxy[]
  onEdit: (proxy: Proxy) => void
  onDelete: (proxy: Proxy) => void
  onTest: (proxy: Proxy) => void
  onCheckLocation: (proxy: Proxy) => void
  testingIds: Set<number>
  checkingLocationIds: Set<number>
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'untested') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-500" />
        Untested
      </span>
    )
  }

  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-yellow-300 dark:border-yellow-700/50 bg-yellow-100 dark:bg-yellow-900/30 px-2.5 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Testing...
      </span>
    )
  }

  if (status === 'working') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 dark:border-emerald-700/50 bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Working
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-300 dark:border-red-700/50 bg-red-100 dark:bg-red-900/30 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      Failed
    </span>
  )
}

function LocationCell({ location }: { location: string | null }) {
  if (!location || location === 'Unknown') {
    return <span className="text-sm text-gray-500">Unknown</span>
  }

  return (
    <span className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
      <MapPin className="h-3.5 w-3.5 text-gray-500" />
      {location}
    </span>
  )
}

function extractProtocol(address: string): string {
  const match = address.match(/^(https?|socks[45]?):\/\//i)
  return match ? match[1].toUpperCase() : 'HTTP'
}

export default function ProxyTable({
  proxies,
  onEdit,
  onDelete,
  onTest,
  onCheckLocation,
  testingIds,
  checkingLocationIds,
}: ProxyTableProps) {
  const [sortField, setSortField] = useState<'address' | 'status' | 'location'>('address')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sorted = [...proxies].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'address') return (a.address || '').localeCompare(b.address || '') * dir
    if (sortField === 'status') return ((a.status || '') .localeCompare(b.status || '')) * dir
    if (sortField === 'location') return ((a.location || '').localeCompare(b.location || '')) * dir
    return 0
  })

  if (proxies.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900/50 px-6 py-16 text-center">
        <Wifi className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-600" />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No proxies added yet</p>
        <p className="mt-1 text-xs text-gray-500">Click "Add Proxy" or "Bulk Import" to get started</p>
      </div>
    )
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <span className="ml-1 text-gray-400 dark:text-gray-600">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900/50">
      <div className="overflow-x-auto">
        <table className="min-w-[960px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/80">
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                onClick={() => toggleSort('address')}
              >
                Address <SortIcon field="address" />
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Protocol
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                onClick={() => toggleSort('location')}
              >
                Location <SortIcon field="location" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                onClick={() => toggleSort('status')}
              >
                Status <SortIcon field="status" />
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Last Tested
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Assigned To
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800/60">
            {sorted.map((proxy) => {
              const isTesting = testingIds.has(proxy.id)
              const isCheckingLoc = checkingLocationIds.has(proxy.id)
              const displayStatus = isTesting ? 'testing' : proxy.status

              return (
                <tr key={proxy.id} className="transition-colors hover:bg-gray-100/60 dark:hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm break-all text-gray-800 dark:text-gray-200">{proxy.address}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                      {proxy.protocol || extractProtocol(proxy.address)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <LocationCell location={proxy.location} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={displayStatus} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {proxy.last_tested
                      ? new Date(proxy.last_tested).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {proxy.assigned_accounts.length > 0 ? (
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {proxy.assigned_accounts.length} account{proxy.assigned_accounts.length !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-500">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onTest(proxy)}
                        disabled={isTesting}
                        title="Test proxy"
                        className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isTesting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Wifi className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => onCheckLocation(proxy)}
                        disabled={isCheckingLoc}
                        title="Check location"
                        className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isCheckingLoc ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MapPin className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => onEdit(proxy)}
                        title="Edit proxy"
                        className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onDelete(proxy)}
                        title="Delete proxy"
                        className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
