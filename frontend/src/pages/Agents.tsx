import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertTriangle,
  Bot,
  Loader2,
  PlayCircle,
  Plus,
  Rocket,
  Square,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react'
import { accountsApi } from '../api/accounts'
import { jobsApi, type Job } from '../api/jobs'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Modal from '../components/ui/Modal'

const ACCOUNTS_QUERY_KEY = ['accounts']
const JOB_TYPES = ['search', 'comment', 'reply', 'upvote', 'browse'] as const

interface AddJobFormState {
  type: (typeof JOB_TYPES)[number]
  params: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function getAccountStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'running':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300'
    case 'launching':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300'
    default:
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  }
}

function getJobStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'pending':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300'
    case 'running':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-300'
    case 'completed':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    case 'failed':
      return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300'
    case 'cancelled':
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
    default:
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  }
}

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function parseJobParams(paramsText: string) {
  const trimmed = paramsText.trim()

  if (!trimmed) {
    return undefined
  }

  const parsed: unknown = JSON.parse(trimmed)

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Params JSON must be an object.')
  }

  return parsed as Record<string, unknown>
}

export default function Agents() {
  const queryClient = useQueryClient()
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [isAddJobOpen, setIsAddJobOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null)
  const [jobToCancel, setJobToCancel] = useState<Job | null>(null)
  const [isClearAllOpen, setIsClearAllOpen] = useState(false)
  const [jobForm, setJobForm] = useState<AddJobFormState>({ type: 'search', params: '' })
  const [jobFormError, setJobFormError] = useState<string | null>(null)

  const { data: accounts = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: async () => (await accountsApi.getAll()).data,
  })

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedAccountId(null)
      return
    }

    const accountStillExists = accounts.some((account) => account.id === selectedAccountId)

    if (!accountStillExists) {
      setSelectedAccountId(accounts[0].id)
    }
  }, [accounts, selectedAccountId])

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  )

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs', selectedAccountId],
    queryFn: async () => {
      if (!selectedAccountId) {
        return []
      }

      return (await jobsApi.getAll(selectedAccountId)).data
    },
    enabled: selectedAccountId != null,
    refetchInterval: (query) => {
      const data = (query.state.data ?? []) as Job[]
      const hasActiveJobs = data.some((job) => job.status === 'pending' || job.status === 'running')
      const isAccountRunning = selectedAccount?.status.toLowerCase() === 'running'

      return hasActiveJobs || isAccountRunning ? 5000 : false
    },
  })

  const invalidateSelected = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['jobs', selectedAccountId] }),
    ])
  }

  const launchMutation = useMutation({
    mutationFn: (accountId: number) => accountsApi.launch(accountId),
    onSuccess: invalidateSelected,
  })

  const stopMutation = useMutation({
    mutationFn: (accountId: number) => accountsApi.stop(accountId),
    onSuccess: invalidateSelected,
  })

  const testProxyMutation = useMutation({
    mutationFn: (accountId: number) => accountsApi.testProxyBrowser(accountId),
    onSuccess: invalidateSelected,
  })

  const createJobMutation = useMutation({
    mutationFn: ({ accountId, data }: { accountId: number; data: { type: string; params?: Record<string, unknown> } }) =>
      jobsApi.create(accountId, data),
    onSuccess: async () => {
      await invalidateSelected()
      setIsAddJobOpen(false)
      setJobForm({ type: 'search', params: '' })
      setJobFormError(null)
    },
  })

  const deleteJobMutation = useMutation({
    mutationFn: ({ accountId, jobId }: { accountId: number; jobId: number }) => jobsApi.delete(accountId, jobId),
    onSuccess: async () => {
      await invalidateSelected()
      setJobToDelete(null)
    },
  })

  const cancelJobMutation = useMutation({
    mutationFn: ({ accountId, jobId }: { accountId: number; jobId: number }) => jobsApi.cancel(accountId, jobId),
    onSuccess: async () => {
      await invalidateSelected()
      setJobToCancel(null)
    },
  })

  const clearAllMutation = useMutation({
    mutationFn: (accountId: number) => jobsApi.deleteAll(accountId),
    onSuccess: async () => {
      await invalidateSelected()
      setIsClearAllOpen(false)
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6">
          <div className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-900" />
          <div className="h-56 rounded-2xl bg-gray-100 dark:bg-gray-900" />
          <div className="h-80 rounded-2xl bg-gray-100 dark:bg-gray-900" />
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
          <h1 className="mt-5 text-2xl font-semibold text-gray-900 dark:text-white">Failed to load agents</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {getErrorMessage(error, 'The agent control view could not fetch accounts.')}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-6 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#cf3d18]"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[#E8461E]/10 p-3 text-[#ff8c6d]">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Agents</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage running browser sessions and job queues</p>
            </div>
          </div>

          <div className="w-full max-w-sm">
            <label htmlFor="agent-account-select" className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">
              Account
            </label>
            <select
              id="agent-account-select"
              value={selectedAccountId ?? ''}
              onChange={(event) => setSelectedAccountId(event.target.value ? Number(event.target.value) : null)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
            >
              {accounts.length === 0 ? <option value="">No accounts available</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username}
                </option>
              ))}
            </select>
          </div>
        </section>

        {!selectedAccount ? (
          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900/50 p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <Bot className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">No account selected</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Add an account on the Accounts page to launch a browser session and manage jobs.</p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900/50 p-5">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">Session Control</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">{selectedAccount.username}</h2>
                      <span className={clsx('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium capitalize', getAccountStatusBadge(selectedAccount.status))}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {selectedAccount.status}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Proxy</p>
                      <p className="mt-2 truncate text-sm text-gray-800 dark:text-gray-200">{selectedAccount.proxy_address ?? 'No proxy assigned'}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Cookies</p>
                      <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">{selectedAccount.has_cookies ? 'Available' : 'Missing'}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Role</p>
                      <p className="mt-2 text-sm capitalize text-gray-800 dark:text-gray-200">{selectedAccount.role ?? 'Unassigned'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
                  <button
                    type="button"
                    onClick={() => launchMutation.mutate(selectedAccount.id)}
                    disabled={selectedAccount.status.toLowerCase() === 'running' || launchMutation.isPending || stopMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {launchMutation.isPending && launchMutation.variables === selectedAccount.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4" />
                    )}
                    Launch Browser
                  </button>
                  <button
                    type="button"
                    onClick={() => stopMutation.mutate(selectedAccount.id)}
                    disabled={selectedAccount.status.toLowerCase() !== 'running' || stopMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {stopMutation.isPending && stopMutation.variables === selectedAccount.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                    Stop Browser
                  </button>
                  <button
                    type="button"
                    onClick={() => testProxyMutation.mutate(selectedAccount.id)}
                    disabled={testProxyMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {testProxyMutation.isPending && testProxyMutation.variables === selectedAccount.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube2 className="h-4 w-4" />
                    )}
                    Test Proxy in Browser
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900/50 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Job Queue</h2>
                    <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                      {jobs.length} jobs
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Queue work for the selected account and manage active browser automation tasks.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddJobOpen(true)}
                    className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18]"
                  >
                    <Plus className="h-4 w-4" />
                    Add Job
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsClearAllOpen(true)}
                    disabled={jobs.length === 0 || clearAllMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-md border border-red-300 dark:border-red-800/50 bg-red-100 dark:bg-red-900/20 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition hover:bg-red-200 dark:hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {clearAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Clear All Jobs
                  </button>
                </div>
              </div>

              {jobsLoading ? (
                <div className="mt-6 animate-pulse space-y-3">
                  <div className="h-12 rounded-xl bg-white dark:bg-gray-950" />
                  <div className="h-12 rounded-xl bg-white dark:bg-gray-950" />
                  <div className="h-12 rounded-xl bg-white dark:bg-gray-950" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="mt-6 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-gray-100/60 dark:bg-gray-950/40 px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  No jobs queued for this account yet.
                </div>
              ) : (
                <div className="mt-6 overflow-x-auto">
                  <table className="min-w-[640px] divide-y divide-gray-200 dark:divide-gray-800 text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-[0.2em] text-gray-500">
                        <th className="pb-3 pr-4 font-medium">Type</th>
                        <th className="pb-3 pr-4 font-medium">Status</th>
                        <th className="pb-3 pr-4 font-medium">Created</th>
                        <th className="pb-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {jobs.map((job) => {
                        const canCancel = job.status === 'pending' || job.status === 'running'

                        return (
                          <tr key={job.id}>
                            <td className="py-4 pr-4">
                              <div className="flex items-center gap-3">
                                <div className="rounded-lg bg-gray-200 dark:bg-gray-800 p-2 text-gray-700 dark:text-gray-300">
                                  <PlayCircle className="h-4 w-4" />
                                </div>
                                <div>
                                  <p className="font-medium capitalize text-gray-900 dark:text-white">{job.type}</p>
                                  <p className="text-xs text-gray-500">Job #{job.id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 pr-4">
                              <span className={clsx('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium capitalize', getJobStatusBadge(job.status))}>
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                {job.status}
                              </span>
                            </td>
                            <td className="py-4 pr-4 text-gray-700 dark:text-gray-300">{formatDateTime(job.created_at)}</td>
                            <td className="py-4 text-right">
                              <div className="flex justify-end gap-2">
                                {canCancel ? (
                                  <button
                                    type="button"
                                    onClick={() => setJobToCancel(job)}
                                    className="inline-flex items-center gap-2 rounded-md border border-amber-300 dark:border-amber-800/50 bg-amber-100 dark:bg-amber-900/20 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-200 transition hover:bg-amber-200 dark:hover:bg-amber-900/35"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    Cancel
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => setJobToDelete(job)}
                                  className="inline-flex items-center gap-2 rounded-md border border-red-300 dark:border-red-800/50 bg-red-100 dark:bg-red-900/20 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-300 transition hover:bg-red-200 dark:hover:bg-red-900/35"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <Modal
          isOpen={isAddJobOpen}
          onClose={() => setIsAddJobOpen(false)}
          title="Add Job"
          size="lg"
          footer={(
            <>
              <button
                type="button"
                onClick={() => setIsAddJobOpen(false)}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="add-job-form"
                disabled={createJobMutation.isPending || !selectedAccount}
                className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {createJobMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Job
              </button>
            </>
          )}
        >
          <form
            id="add-job-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()

              if (!selectedAccount) {
                return
              }

              try {
                setJobFormError(null)
                const params = parseJobParams(jobForm.params)

                createJobMutation.mutate({
                  accountId: selectedAccount.id,
                  data: {
                    type: jobForm.type,
                    ...(params ? { params } : {}),
                  },
                })
              } catch (parseError) {
                setJobFormError(getErrorMessage(parseError, 'Invalid JSON.'))
              }
            }}
          >
            <div>
              <label htmlFor="job-type" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Job Type
              </label>
              <select
                id="job-type"
                value={jobForm.type}
                onChange={(event) => setJobForm((current) => ({ ...current, type: event.target.value as AddJobFormState['type'] }))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
              >
                {JOB_TYPES.map((jobType) => (
                  <option key={jobType} value={jobType}>
                    {jobType}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="job-params" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Params JSON
              </label>
              <textarea
                id="job-params"
                value={jobForm.params}
                onChange={(event) => setJobForm((current) => ({ ...current, params: event.target.value }))}
                rows={8}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 font-mono text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
                placeholder={'{\n  "query": "best productivity apps"\n}'}
              />
              <p className="mt-2 text-xs text-gray-500">Leave empty for jobs that do not need additional parameters.</p>
              {jobFormError ? <p className="mt-2 text-sm text-red-600 dark:text-red-300">{jobFormError}</p> : null}
            </div>
          </form>
        </Modal>

        <ConfirmDialog
          isOpen={!!jobToCancel}
          onClose={() => setJobToCancel(null)}
          onConfirm={() => {
            if (selectedAccount && jobToCancel) {
              cancelJobMutation.mutate({ accountId: selectedAccount.id, jobId: jobToCancel.id })
            }
          }}
          title="Cancel Job"
          message={`Cancel job #${jobToCancel?.id ?? ''} for ${selectedAccount?.username ?? 'this account'}?`}
          confirmLabel="Cancel Job"
          variant="warning"
        />

        <ConfirmDialog
          isOpen={!!jobToDelete}
          onClose={() => setJobToDelete(null)}
          onConfirm={() => {
            if (selectedAccount && jobToDelete) {
              deleteJobMutation.mutate({ accountId: selectedAccount.id, jobId: jobToDelete.id })
            }
          }}
          title="Delete Job"
          message={`Delete job #${jobToDelete?.id ?? ''} from the queue? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={isClearAllOpen}
          onClose={() => setIsClearAllOpen(false)}
          onConfirm={() => {
            if (selectedAccount) {
              clearAllMutation.mutate(selectedAccount.id)
            }
          }}
          title="Clear All Jobs"
          message={`Delete all ${jobs.length} jobs for ${selectedAccount?.username ?? 'this account'}? This cannot be undone.`}
          confirmLabel="Clear Queue"
          variant="danger"
        />
      </div>
    </div>
  )
}
