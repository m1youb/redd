import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Globe, Plus, Upload, Wifi, MapPin, Trash2, AlertTriangle } from 'lucide-react'
import { proxiesApi, type Proxy } from '../api/proxies'
import ProxyTable from '../components/proxies/ProxyTable'
import AddProxyModal from '../components/proxies/AddProxyModal'
import BulkImportProxyModal from '../components/proxies/BulkImportProxyModal'
import EditProxyModal from '../components/proxies/EditProxyModal'
import ConfirmDialog from '../components/ui/ConfirmDialog'

export default function ProxyManager() {
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [editProxy, setEditProxy] = useState<Proxy | null>(null)
  const [deleteProxy, setDeleteProxy] = useState<Proxy | null>(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set())
  const [checkingLocationIds, setCheckingLocationIds] = useState<Set<number>>(new Set())
  const [testAllLoading, setTestAllLoading] = useState(false)
  const [checkAllLoading, setCheckAllLoading] = useState(false)

  const { data: proxies = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['proxies'],
    queryFn: async () => {
      const res = await proxiesApi.getAll()
      return res.data
    },
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['proxies'] })
  }, [queryClient])

  const createMutation = useMutation({
    mutationFn: (data: { address?: string; addresses?: string[] }) => proxiesApi.create(data),
    onSuccess: () => {
      invalidate()
      setShowAddModal(false)
      setShowBulkModal(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, address }: { id: number; address: string }) =>
      proxiesApi.update(id, { address }),
    onSuccess: () => {
      invalidate()
      setEditProxy(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => proxiesApi.delete(id),
    onSuccess: () => {
      invalidate()
      setDeleteProxy(null)
    },
  })

  const deleteAllMutation = useMutation({
    mutationFn: () => proxiesApi.deleteAll(),
    onSuccess: () => {
      invalidate()
      setShowDeleteAll(false)
    },
  })

  const handleTest = useCallback(async (proxy: Proxy) => {
    setTestingIds((prev) => new Set(prev).add(proxy.id))
    try {
      await proxiesApi.test(proxy.id)
      invalidate()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      alert(message)
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(proxy.id)
        return next
      })
    }
  }, [invalidate])

  const handleTestAll = useCallback(async () => {
    setTestAllLoading(true)
    try {
      await proxiesApi.testAll()
      setTimeout(() => invalidate(), 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      alert(message)
    } finally {
      setTestAllLoading(false)
    }
  }, [invalidate])

  const handleCheckLocation = useCallback(async (proxy: Proxy) => {
    setCheckingLocationIds((prev) => new Set(prev).add(proxy.id))
    try {
      await proxiesApi.checkLocation(proxy.id)
      invalidate()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      alert(message)
    } finally {
      setCheckingLocationIds((prev) => {
        const next = new Set(prev)
        next.delete(proxy.id)
        return next
      })
    }
  }, [invalidate])

  const handleCheckAllLocations = useCallback(async () => {
    setCheckAllLoading(true)
    try {
      await proxiesApi.checkAllLocations()
      setTimeout(() => invalidate(), 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      alert(message)
    } finally {
      setCheckAllLoading(false)
    }
  }, [invalidate])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6">
          <div className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-900" />
          <div className="h-96 rounded-2xl bg-gray-100 dark:bg-gray-900" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-lg rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center shadow-2xl shadow-black/30">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-gray-900 dark:text-white">Failed to load proxies</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {error instanceof Error ? error.message : 'Could not fetch proxy data.'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-6 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36]"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const workingCount = proxies.filter((p) => p.status === 'working').length
  const failedCount = proxies.filter((p) => p.status === 'failed').length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#E8461E]/10 p-3 text-[#ff8c6d]">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Proxy Manager</h1>
                <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                  {proxies.length} proxies
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-xs text-gray-500">
                <span className="text-emerald-600 dark:text-emerald-400">{workingCount} working</span>
                <span className="text-red-600 dark:text-red-400">{failedCount} failed</span>
                <span>{proxies.length - workingCount - failedCount} untested</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#cf3d18]"
            >
              <Plus className="h-4 w-4" />
              Add Proxy
            </button>
            <button
              type="button"
              onClick={() => setShowBulkModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <Upload className="h-4 w-4" />
              Bulk Import
            </button>
            <button
              type="button"
              onClick={handleTestAll}
              disabled={testAllLoading || proxies.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testAllLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400/30 border-t-gray-400" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              Test All
            </button>
            <button
              type="button"
              onClick={handleCheckAllLocations}
              disabled={checkAllLoading || proxies.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checkAllLoading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400/30 border-t-gray-400" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              Check Locations
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteAll(true)}
              disabled={proxies.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800/50 bg-red-100 dark:bg-red-900/20 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-200 dark:hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              Delete All
            </button>
          </div>
        </div>

        {/* Table */}
        <ProxyTable
          proxies={proxies}
          onEdit={setEditProxy}
          onDelete={setDeleteProxy}
          onTest={handleTest}
          onCheckLocation={handleCheckLocation}
          testingIds={testingIds}
          checkingLocationIds={checkingLocationIds}
        />

        {/* Modals */}
        <AddProxyModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSubmit={(address) => createMutation.mutate({ address })}
          isLoading={createMutation.isPending}
        />

        <BulkImportProxyModal
          isOpen={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          onSubmit={(addresses) => createMutation.mutate({ addresses })}
          isLoading={createMutation.isPending}
        />

        <EditProxyModal
          isOpen={!!editProxy}
          onClose={() => setEditProxy(null)}
          onSubmit={(id, address) => updateMutation.mutate({ id, address })}
          proxy={editProxy}
          isLoading={updateMutation.isPending}
        />

        <ConfirmDialog
          isOpen={!!deleteProxy}
          onClose={() => setDeleteProxy(null)}
          onConfirm={() => deleteProxy && deleteMutation.mutate(deleteProxy.id)}
          title="Delete Proxy"
          message={`Are you sure you want to delete proxy "${deleteProxy?.address}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={showDeleteAll}
          onClose={() => setShowDeleteAll(false)}
          onConfirm={() => deleteAllMutation.mutate()}
          title="Delete All Proxies"
          message={`This will permanently delete all ${proxies.length} proxies and remove all account proxy assignments. This action cannot be undone.`}
          confirmLabel="Delete All"
          variant="danger"
        />
      </div>
    </div>
  )
}
