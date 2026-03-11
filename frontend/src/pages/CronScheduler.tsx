import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { accountsApi, type Account } from '../api/accounts'
import { cronApi, type CronJob } from '../api/cron'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Modal from '../components/ui/Modal'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const JOB_TYPES = ['search', 'comment', 'post']

interface CronFormState {
  name: string
  account_id: string
  job_type: string
  schedule_type: 'interval' | 'daily' | 'weekly'
  interval_minutes: string
  daily_time: string
  weekly_days: number[]
  weekly_time: string
  is_active: boolean
}

const DEFAULT_FORM: CronFormState = {
  name: '',
  account_id: '',
  job_type: 'search',
  schedule_type: 'interval',
  interval_minutes: '30',
  daily_time: '16:00',
  weekly_days: [],
  weekly_time: '10:00',
  is_active: true,
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function formatSchedule(type: string, config: Record<string, unknown>) {
  switch (type) {
    case 'interval': {
      const mins = Number(config.minutes ?? 0)
      if (mins >= 60 && mins % 60 === 0) return `Every ${mins / 60} hour${mins / 60 > 1 ? 's' : ''}`
      return `Every ${mins} minute${mins !== 1 ? 's' : ''}`
    }
    case 'daily':
      return `Daily at ${String(config.time ?? '00:00')}`
    case 'weekly': {
      const days = (config.days as number[] | undefined) ?? []
      const dayNames = days.map((d: number) => DAY_LABELS[d] ?? `Day ${d}`).join(', ')
      return `${dayNames} at ${String(config.time ?? '00:00')}`
    }
    default:
      return type
  }
}

function formatTimestamp(ts: string | null) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function getJobTypeBadge(type: string) {
  switch (type) {
    case 'search':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300'
    case 'comment':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    case 'post':
      return 'border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-300'
    default:
      return 'border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
  }
}

function formToPayload(form: CronFormState) {
  let schedule_config: Record<string, unknown> = {}
  switch (form.schedule_type) {
    case 'interval':
      schedule_config = { minutes: Number(form.interval_minutes) || 30 }
      break
    case 'daily':
      schedule_config = { time: form.daily_time }
      break
    case 'weekly':
      schedule_config = { days: form.weekly_days, time: form.weekly_time }
      break
  }
  return {
    name: form.name,
    account_id: Number(form.account_id),
    job_type: form.job_type,
    schedule_type: form.schedule_type,
    schedule_config,
    is_active: form.is_active,
  }
}

function cronToForm(job: CronJob): CronFormState {
  const config = job.schedule_config ?? {}
  return {
    name: job.name,
    account_id: String(job.account_id),
    job_type: job.job_type,
    schedule_type: job.schedule_type,
    interval_minutes: String(config.minutes ?? '30'),
    daily_time: String(config.time ?? '16:00'),
    weekly_days: (config.days as number[] | undefined) ?? [],
    weekly_time: String(config.time ?? '10:00'),
    is_active: job.is_active,
  }
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>
        <div className="h-8 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
      <div className="mt-4 flex gap-4">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
    </div>
  )
}

function CronFormFields({
  form,
  setForm,
  accounts,
}: {
  form: CronFormState
  setForm: React.Dispatch<React.SetStateAction<CronFormState>>
  accounts: Account[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Job Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder="e.g., Daily Safari Search"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Account</label>
        <select
          value={form.account_id}
          onChange={(e) => setForm((p) => ({ ...p, account_id: e.target.value }))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
        >
          <option value="">Select account...</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Job Type</label>
        <select
          value={form.job_type}
          onChange={(e) => setForm((p) => ({ ...p, job_type: e.target.value }))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
        >
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Schedule Type</label>
        <select
          value={form.schedule_type}
          onChange={(e) =>
            setForm((p) => ({ ...p, schedule_type: e.target.value as 'interval' | 'daily' | 'weekly' }))
          }
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
        >
          <option value="interval">Interval</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>

      {/* Dynamic schedule config */}
      {form.schedule_type === 'interval' && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Run every (minutes)</label>
          <input
            type="number"
            min="1"
            value={form.interval_minutes}
            onChange={(e) => setForm((p) => ({ ...p, interval_minutes: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
          />
        </div>
      )}
      {form.schedule_type === 'daily' && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Time of day</label>
          <input
            type="time"
            value={form.daily_time}
            onChange={(e) => setForm((p) => ({ ...p, daily_time: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
          />
        </div>
      )}
      {form.schedule_type === 'weekly' && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Days of week</label>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setForm((p) => ({
                      ...p,
                      weekly_days: p.weekly_days.includes(idx)
                        ? p.weekly_days.filter((d) => d !== idx)
                        : [...p.weekly_days, idx].sort(),
                    }))
                  }
                  className={clsx(
                    'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    form.weekly_days.includes(idx)
                      ? 'border-[#E8461E]/30 bg-[#E8461E]/10 text-[#E8461E]'
                      : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Time</label>
            <input
              type="time"
              value={form.weekly_time}
              onChange={(e) => setForm((p) => ({ ...p, weekly_time: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
        </>
      )}

      <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Active</span>
        <button
          type="button"
          role="switch"
          aria-checked={form.is_active}
          onClick={() => setForm((p) => ({ ...p, is_active: !p.is_active }))}
          className={clsx(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            form.is_active ? 'bg-[#E8461E]' : 'bg-gray-300 dark:bg-gray-700'
          )}
        >
          <span
            className={clsx(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform',
              form.is_active ? 'translate-x-5' : 'translate-x-0'
            )}
          />
        </button>
      </div>
    </div>
  )
}

export default function CronScheduler() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [jobToDelete, setJobToDelete] = useState<CronJob | null>(null)
  const [addForm, setAddForm] = useState<CronFormState>(DEFAULT_FORM)
  const [editForm, setEditForm] = useState<CronFormState>(DEFAULT_FORM)
  const [triggeringId, setTriggeringId] = useState<number | null>(null)

  const {
    data: jobs = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cron'],
    queryFn: async () => (await cronApi.getAll()).data,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await accountsApi.getAll()).data,
  })

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cron'] })
  }

  const createMutation = useMutation({
    mutationFn: (data: ReturnType<typeof formToPayload>) => cronApi.create(data),
    onSuccess: async () => {
      await invalidate()
      setIsAddOpen(false)
      setAddForm(DEFAULT_FORM)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ReturnType<typeof formToPayload> }) =>
      cronApi.update(id, data),
    onSuccess: async () => {
      await invalidate()
      setEditingJob(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => cronApi.delete(id),
    onSuccess: invalidate,
  })

  const triggerMutation = useMutation({
    mutationFn: (id: number) => cronApi.trigger(id),
    onSuccess: async () => {
      await invalidate()
      setTriggeringId(null)
    },
    onError: () => setTriggeringId(null),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      cronApi.update(id, { is_active }),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8461E]/10">
            <Calendar className="h-5 w-5 text-[#E8461E]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cron Scheduler</h1>
            <p className="text-sm text-gray-500">
              {jobs.length} scheduled job{jobs.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddForm(DEFAULT_FORM)
            setIsAddOpen(true)
          }}
          className="flex items-center gap-2 rounded-xl bg-[#E8461E] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#d13d17]"
        >
          <Plus className="h-4 w-4" />
          Add Schedule
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16">
          <AlertTriangle className="mb-3 h-10 w-10 text-red-400" />
          <p className="mb-1 text-sm font-medium text-gray-800 dark:text-gray-200">Failed to load schedules</p>
          <p className="mb-4 text-xs text-gray-500">{getErrorMessage(error, 'Unknown error')}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d13d17]"
          >
            Retry
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16">
          <Calendar className="mb-3 h-10 w-10 text-gray-400 dark:text-gray-600" />
          <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">No scheduled jobs</p>
          <p className="mb-4 text-xs text-gray-500">Create your first schedule to automate tasks</p>
          <button
            type="button"
            onClick={() => {
              setAddForm(DEFAULT_FORM)
              setIsAddOpen(true)
            }}
            className="flex items-center gap-2 rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d13d17]"
          >
            <Plus className="h-4 w-4" />
            Add Schedule
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job: CronJob) => (
            <div
              key={job.id}
              className={clsx(
                'rounded-2xl border bg-white dark:bg-gray-900 p-5 transition-colors',
                job.is_active ? 'border-gray-200 dark:border-gray-800' : 'border-gray-200/50 dark:border-gray-800/50 opacity-60'
              )}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{job.name}</h3>
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                        getJobTypeBadge(job.job_type)
                      )}
                    >
                      {job.job_type}
                    </span>
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                        job.is_active
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                          : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500'
                      )}
                    >
                      {job.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                    <span>Account: <span className="text-gray-700 dark:text-gray-300">{job.account_username ?? `#${job.account_id}`}</span></span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatSchedule(job.schedule_type, job.schedule_config)}
                    </span>
                    <span>Last run: {formatTimestamp(job.last_run)}</span>
                    <span>Next run: {formatTimestamp(job.next_run)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      toggleMutation.mutate({ id: job.id, is_active: !job.is_active })
                    }}
                    title={job.is_active ? 'Pause' : 'Resume'}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                  >
                    {job.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTriggeringId(job.id)
                      triggerMutation.mutate(job.id)
                    }}
                    disabled={triggeringId === job.id}
                    title="Trigger Now"
                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 disabled:opacity-50"
                  >
                    {triggeringId === job.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditForm(cronToForm(job))
                      setEditingJob(job)
                    }}
                    title="Edit"
                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-2 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobToDelete(job)}
                    title="Delete"
                    className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add Schedule"
        size="lg"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="rounded-lg bg-gray-200 dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate(formToPayload(addForm))}
              disabled={createMutation.isPending || !addForm.name.trim() || !addForm.account_id}
              className="flex items-center gap-2 rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d13d17] disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </button>
          </>
        )}
      >
        <CronFormFields form={addForm} setForm={setAddForm} accounts={accounts} />
        {createMutation.isError && (
          <p className="mt-3 text-xs text-red-400">
            {getErrorMessage(createMutation.error, 'Failed to create schedule')}
          </p>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={editingJob !== null}
        onClose={() => setEditingJob(null)}
        title="Edit Schedule"
        size="lg"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setEditingJob(null)}
              className="rounded-lg bg-gray-200 dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingJob) {
                  updateMutation.mutate({ id: editingJob.id, data: formToPayload(editForm) })
                }
              }}
              disabled={updateMutation.isPending || !editForm.name.trim() || !editForm.account_id}
              className="flex items-center gap-2 rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d13d17] disabled:opacity-50"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Changes
            </button>
          </>
        )}
      >
        <CronFormFields form={editForm} setForm={setEditForm} accounts={accounts} />
        {updateMutation.isError && (
          <p className="mt-3 text-xs text-red-400">
            {getErrorMessage(updateMutation.error, 'Failed to update schedule')}
          </p>
        )}
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={jobToDelete !== null}
        onClose={() => setJobToDelete(null)}
        onConfirm={() => {
          if (jobToDelete) deleteMutation.mutate(jobToDelete.id)
        }}
        title="Delete Schedule"
        message={`Are you sure you want to delete "${jobToDelete?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  )
}
