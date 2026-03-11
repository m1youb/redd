import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bot, CheckCircle2, ChevronDown, Clock3, Pause, Play, Send, Settings2, Sparkles, Users, XCircle, Zap } from 'lucide-react'
import { campaignApi } from '../../api/campaign'
import { CAMPAIGN_DASHBOARD_QUERY_KEY, type CampaignLane, type LaneConfig, type LaneId, type ManagedAction } from './types'

interface LanesTabProps {
  lanes: Record<LaneId, CampaignLane>
  plannedActions: ManagedAction[]
}

const laneOrder: LaneId[] = ['customer_normal', 'employee_helpful', 'customer_brand', 'employee_brand']

interface LaneConfigFormState {
  enabled: boolean
  start_time: string
  end_time: string
  daily_target: string
  gap_minutes: string
  auto_calculate_gap: boolean
}

interface LaneFormErrors {
  start_time?: string
  end_time?: string
  daily_target?: string
  gap_minutes?: string
}

const inputClasses = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-900 dark:disabled:text-gray-500'

function createFormState(config: LaneConfig): LaneConfigFormState {
  return {
    enabled: config.enabled,
    start_time: config.start_time ?? '09:00',
    end_time: config.end_time ?? '17:00',
    daily_target: String(config.daily_target ?? 0),
    gap_minutes: String(config.gap_minutes ?? 1),
    auto_calculate_gap: config.auto_calculate_gap ?? false,
  }
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours > 23 || minutes > 59) {
    return null
  }

  return hours * 60 + minutes
}

function getWindowMinutes(startTime: string, endTime: string) {
  const start = parseTimeToMinutes(startTime)
  const end = parseTimeToMinutes(endTime)

  if (start == null || end == null || end <= start) {
    return null
  }

  return end - start
}

function validateForm(formState: LaneConfigFormState): LaneFormErrors {
  const errors: LaneFormErrors = {}
  const start = parseTimeToMinutes(formState.start_time)
  const end = parseTimeToMinutes(formState.end_time)
  const dailyTarget = Number(formState.daily_target)
  const gapMinutes = Number(formState.gap_minutes)

  if (start == null) {
    errors.start_time = 'Enter a valid start time.'
  }

  if (end == null) {
    errors.end_time = 'Enter a valid end time.'
  } else if (start != null && end <= start) {
    errors.end_time = 'End time must be after start time.'
  }

  if (!Number.isFinite(dailyTarget) || dailyTarget < 0) {
    errors.daily_target = 'Daily target must be 0 or greater.'
  }

  if (!formState.auto_calculate_gap && (!Number.isFinite(gapMinutes) || gapMinutes < 1)) {
    errors.gap_minutes = 'Gap minutes must be at least 1.'
  }

  return errors
}

function buildPayload(formState: LaneConfigFormState) {
  const windowMinutes = getWindowMinutes(formState.start_time, formState.end_time)
  const dailyTarget = Number(formState.daily_target)
  const manualGap = Number(formState.gap_minutes)
  const computedGap = formState.auto_calculate_gap && windowMinutes != null && dailyTarget > 0
    ? Math.max(1, Math.round(windowMinutes / dailyTarget))
    : null

  return {
    enabled: formState.enabled,
    start_time: formState.start_time,
    end_time: formState.end_time,
    daily_target: dailyTarget,
    gap_minutes: computedGap ?? manualGap,
    auto_calculate_gap: formState.auto_calculate_gap,
  } satisfies Partial<LaneConfig>
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null
  }

  return <p className="mt-1 text-xs text-red-600 dark:text-red-300">{message}</p>
}

function ConfigForm({
  title,
  description,
  formState,
  errors,
  onChange,
}: {
  title: string
  description: string
  formState: LaneConfigFormState
  errors: LaneFormErrors
  onChange: (updater: (current: LaneConfigFormState) => LaneConfigFormState) => void
}) {
  const windowMinutes = useMemo(
    () => getWindowMinutes(formState.start_time, formState.end_time),
    [formState.start_time, formState.end_time],
  )

  const dailyTarget = Number(formState.daily_target)
  const computedGap = formState.auto_calculate_gap && windowMinutes != null && dailyTarget > 0
    ? windowMinutes / dailyTarget
    : null

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 p-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/60 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Lane Enabled</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Disable this lane without changing the saved schedule.</p>
        </div>
        <button
          type="button"
          onClick={() => onChange((current) => ({ ...current, enabled: !current.enabled }))}
          className={clsx(
            'relative inline-flex h-7 w-12 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
            formState.enabled ? 'bg-[#E8461E]' : 'bg-gray-300 dark:bg-gray-700',
          )}
          aria-pressed={formState.enabled}
        >
          <span
            className={clsx(
              'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              formState.enabled ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">Start Time</span>
          <input
            type="time"
            value={formState.start_time}
            onChange={(event) => onChange((current) => ({ ...current, start_time: event.target.value }))}
            className={inputClasses}
          />
          <FieldError message={errors.start_time} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">End Time</span>
          <input
            type="time"
            value={formState.end_time}
            onChange={(event) => onChange((current) => ({ ...current, end_time: event.target.value }))}
            className={inputClasses}
          />
          <FieldError message={errors.end_time} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">Daily Target</span>
          <input
            type="number"
            min="0"
            value={formState.daily_target}
            onChange={(event) => onChange((current) => ({ ...current, daily_target: event.target.value }))}
            className={inputClasses}
          />
          <FieldError message={errors.daily_target} />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">Gap Between Runs (minutes)</span>
          <input
            type="number"
            min="1"
            value={formState.gap_minutes}
            onChange={(event) => onChange((current) => ({ ...current, gap_minutes: event.target.value }))}
            className={inputClasses}
            disabled={formState.auto_calculate_gap}
          />
          <FieldError message={errors.gap_minutes} />
        </label>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/60 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Auto-calculate gap from window and target</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Use the configured time window and target to space runs automatically.</p>
          </div>
          <input
            type="checkbox"
            checked={formState.auto_calculate_gap}
            onChange={(event) => onChange((current) => ({ ...current, auto_calculate_gap: event.target.checked }))}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-[#E8461E] focus:ring-[#E8461E]/30"
          />
        </div>
        {formState.auto_calculate_gap && (
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            {computedGap != null
              ? `${windowMinutes} minutes / ${dailyTarget} runs = ${computedGap.toFixed(computedGap % 1 === 0 ? 0 : 1)} min`
              : 'Set a valid window and a daily target above 0 to auto-calculate the gap.'}
          </p>
        )}
      </div>
    </div>
  )
}

function LaneCard({
  laneId,
  lane,
  isActionBusy,
  onTogglePause,
}: {
  laneId: LaneId
  lane: CampaignLane
  isActionBusy: boolean
  onTogglePause: (laneId: LaneId, paused: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isOverrideOpen, setIsOverrideOpen] = useState(Boolean(lane.today_override))
  const [defaultForm, setDefaultForm] = useState<LaneConfigFormState>(() => createFormState(lane.defaults))
  const [overrideForm, setOverrideForm] = useState<LaneConfigFormState>(() => createFormState(lane.today_override ?? lane.defaults))
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    setDefaultForm(createFormState(lane.defaults))
    setOverrideForm(createFormState(lane.today_override ?? lane.defaults))
    setIsOverrideOpen(Boolean(lane.today_override))
  }, [lane.defaults, lane.today_override])

  const refreshDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY })
  }

  const saveDefaultMutation = useMutation({
    mutationFn: async (payload: Partial<LaneConfig>) => campaignApi.saveLaneConfig(laneId, payload),
    onSuccess: async () => {
      setStatusMessage('Default schedule saved.')
      await refreshDashboard()
    },
  })

  const saveOverrideMutation = useMutation({
    mutationFn: async (payload: Partial<LaneConfig>) => campaignApi.saveLaneOverride(laneId, payload),
    onSuccess: async () => {
      setStatusMessage('Today override saved.')
      await refreshDashboard()
    },
  })

  const clearOverrideMutation = useMutation({
    mutationFn: async () => campaignApi.clearLaneOverride(laneId),
    onSuccess: async () => {
      setStatusMessage('Today override cleared.')
      await refreshDashboard()
    },
  })

  const defaultErrors = useMemo(() => validateForm(defaultForm), [defaultForm])
  const overrideErrors = useMemo(() => validateForm(overrideForm), [overrideForm])
  const hasDefaultErrors = Object.keys(defaultErrors).length > 0
  const hasOverrideErrors = Object.keys(overrideErrors).length > 0
  const isEnabled = lane.effective.enabled
  const isPaused = lane.paused_today

  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm shadow-black/20">
      <div className="flex flex-col gap-4 border-b border-gray-200 dark:border-gray-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{lane.short_label}</h3>
            {!isEnabled ? (
              <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                Disabled
              </span>
            ) : isPaused ? (
              <span className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-300">
                Paused
              </span>
            ) : (
              <span className="rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-600 dark:text-green-300">
                Active
              </span>
            )}
            <span className={clsx(
              'rounded-full border px-3 py-1 text-xs font-medium capitalize',
              lane.mode === 'approval'
                ? 'border-yellow-500/20 bg-yellow-500/10 text-yellow-600 dark:text-yellow-300'
                : 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300',
            )}>
              {lane.mode}
            </span>
            {lane.today_override && (
              <span className="rounded-full border border-[#E8461E]/20 bg-[#E8461E]/10 px-3 py-1 text-xs font-medium text-[#E8461E]">
                Override Active
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{lane.description}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setIsSettingsOpen((current) => !current)}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:border-[#E8461E]/40 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Settings2 className="h-4 w-4 text-[#E8461E]" />
            Settings
            <ChevronDown className={clsx('h-4 w-4 transition-transform', isSettingsOpen && 'rotate-180')} />
          </button>

          <button
            type="button"
            onClick={() => onTogglePause(laneId, !isPaused)}
            disabled={isActionBusy || !isEnabled}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:border-[#E8461E]/40 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPaused ? <Play className="h-4 w-4 text-green-600 dark:text-green-300" /> : <Pause className="h-4 w-4 text-red-600 dark:text-red-300" />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
              <Clock3 className="h-3.5 w-3.5" />
              Window
            </div>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{lane.window_label}</p>
            <p className={clsx('mt-1 text-xs', lane.window_active ? 'text-green-400' : 'text-gray-500')}>
              {lane.window_active ? 'Window active now' : 'Outside window'}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
              <Zap className="h-3.5 w-3.5" />
              Progress
            </div>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              {lane.run_count_today} / {lane.effective.daily_target}
            </p>
            <p className="mt-1 text-xs text-gray-500">{lane.remaining_today} remaining today</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-500">
              <Users className="h-3.5 w-3.5" />
              Accounts
            </div>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{lane.available_accounts} available</p>
            {lane.used_accounts_today.length > 0 ? (
              <p className="mt-1 break-words text-xs text-gray-500">Used: {lane.used_accounts_today.join(', ')}</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">None used today</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-gray-500" />
            <span className="text-xs text-gray-500 dark:text-gray-400">Next run:</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{lane.next_run_label}</span>
          </div>
          <span className="hidden text-gray-300 dark:text-gray-700 sm:inline">|</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Status:</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">{lane.time_until_next_run_label}</span>
          </div>
          <span className="hidden text-gray-300 dark:text-gray-700 sm:inline">|</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Gap:</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">{lane.gap_minutes}m</span>
          </div>
          {lane.pending_approvals != null && (
            <>
              <span className="hidden text-gray-300 dark:text-gray-700 sm:inline">|</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Pending approvals:</span>
                <span className="text-sm font-medium text-yellow-600 dark:text-yellow-300">{lane.pending_approvals}</span>
              </div>
            </>
          )}
        </div>

        {isSettingsOpen && (
          <div className="space-y-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Lane Schedule</p>
                <h4 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">Configure defaults and today-only overrides</h4>
              </div>
              {statusMessage && (
                <div className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {statusMessage}
                </div>
              )}
            </div>

            {(saveDefaultMutation.error || saveOverrideMutation.error || clearOverrideMutation.error) && (
              <p className="text-sm text-red-600 dark:text-red-300">Unable to save lane settings right now. Please try again.</p>
            )}

            <ConfigForm
              title="Default Configuration"
              description="Used every day unless a today-only override is active."
              formState={defaultForm}
              errors={defaultErrors}
              onChange={(updater) => {
                setStatusMessage(null)
                setDefaultForm(updater)
              }}
            />

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => saveDefaultMutation.mutate(buildPayload(defaultForm))}
                disabled={saveDefaultMutation.isPending || hasDefaultErrors}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
              >
                {saveDefaultMutation.isPending ? 'Saving...' : 'Save Default'}
              </button>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/50">
              <button
                type="button"
                onClick={() => setIsOverrideOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Today Override</h4>
                    {lane.today_override && (
                      <span className="rounded-full border border-[#E8461E]/20 bg-[#E8461E]/10 px-2.5 py-1 text-[11px] font-medium text-[#E8461E]">
                        Override Active
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Temporarily adjust today&apos;s run window and pacing without changing defaults.</p>
                </div>
                <ChevronDown className={clsx('h-4 w-4 text-gray-500 transition-transform', isOverrideOpen && 'rotate-180')} />
              </button>

              {isOverrideOpen && (
                <div className="space-y-4 border-t border-gray-200 dark:border-gray-700 px-4 py-4">
                  <ConfigForm
                    title="Today-Only Settings"
                    description="Starts from the current override when present, otherwise from the lane defaults."
                    formState={overrideForm}
                    errors={overrideErrors}
                    onChange={(updater) => {
                      setStatusMessage(null)
                      setOverrideForm(updater)
                    }}
                  />

                  <div className="flex flex-wrap justify-end gap-3">
                    {lane.today_override && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Clear the today-only override for ${lane.short_label}?`)) {
                            clearOverrideMutation.mutate()
                          }
                        }}
                        disabled={clearOverrideMutation.isPending || saveOverrideMutation.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300"
                      >
                        {clearOverrideMutation.isPending ? 'Clearing...' : 'Clear Override'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => saveOverrideMutation.mutate(buildPayload(overrideForm))}
                      disabled={saveOverrideMutation.isPending || hasOverrideErrors}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
                    >
                      {saveOverrideMutation.isPending ? 'Saving...' : 'Save Today Override'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function getStatusClasses(status: string) {
  switch (status) {
    case 'planned':
      return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-600 dark:text-yellow-300'
    case 'queued':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300'
    case 'running':
      return 'border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-300'
    case 'done':
      return 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-300'
    case 'error':
    case 'cancelled':
      return 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300'
    default:
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  }
}

export default function LanesTab({ lanes, plannedActions }: LanesTabProps) {
  const queryClient = useQueryClient()

  const refreshDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY })
  }

  const planMutation = useMutation({
    mutationFn: async () => campaignApi.plan(),
    onSuccess: refreshDashboard,
  })

  const queueAllMutation = useMutation({
    mutationFn: async () => campaignApi.queueAllActions(),
    onSuccess: refreshDashboard,
  })

  const pauseLaneMutation = useMutation({
    mutationFn: async ({ laneId, paused }: { laneId: LaneId; paused: boolean }) => campaignApi.pauseLane(laneId, { paused }),
    onSuccess: refreshDashboard,
  })

  const queueActionMutation = useMutation({
    mutationFn: async (actionId: number) => campaignApi.queueAction(actionId),
    onSuccess: refreshDashboard,
  })

  const cancelActionMutation = useMutation({
    mutationFn: async (actionId: number) => campaignApi.cancelAction(actionId),
    onSuccess: refreshDashboard,
  })

  const isActionBusy = queueActionMutation.isPending || cancelActionMutation.isPending || pauseLaneMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Execution Lanes</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Plan and queue campaign actions</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Manage four behavioral lanes and move approved items into execution.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => planMutation.mutate()}
            disabled={planMutation.isPending || queueAllMutation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:border-[#E8461E]/40 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4 text-[#E8461E]" />
            {planMutation.isPending ? 'Planning...' : 'Plan'}
          </button>
          <button
            type="button"
            onClick={() => queueAllMutation.mutate()}
            disabled={queueAllMutation.isPending || planMutation.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
          >
            <Send className="h-4 w-4" />
            {queueAllMutation.isPending ? 'Queueing...' : 'Queue All'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {laneOrder.map((laneId) => {
          const lane = lanes[laneId]

          return (
            <LaneCard
              key={laneId}
              laneId={laneId}
              lane={lane}
              isActionBusy={isActionBusy}
              onTogglePause={(targetLaneId, paused) => pauseLaneMutation.mutate({ laneId: targetLaneId, paused })}
            />
          )
        })}
      </div>

      {plannedActions.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Action Queue</p>
            <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Open actions</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{plannedActions.length} action(s) waiting to be queued or currently running.</p>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {plannedActions.map((action) => (
              <article key={action.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${getStatusClasses(action.status)}`}>
                        {action.status}
                      </span>
                      <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs text-gray-700 dark:text-gray-300">
                        {action.content_mode}
                      </span>
                      {action.account_username && (
                        <span className="rounded-full border border-[#E8461E]/30 bg-[#E8461E]/10 px-3 py-1 text-xs text-[#ff8c6d]">
                          u/{action.account_username}
                        </span>
                      )}
                    </div>
                    <p className="break-words text-sm font-medium text-gray-900 dark:text-white">{action.title}</p>
                    {action.keyword && <p className="text-xs text-gray-500">Keyword: {action.keyword}</p>}
                  </div>
                  {action.status === 'planned' && (
                    <div className="flex flex-col gap-2 sm:min-w-28">
                      <button
                        type="button"
                        onClick={() => queueActionMutation.mutate(action.id)}
                        disabled={isActionBusy}
                        className="rounded-md bg-[#E8461E] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
                      >
                        Queue
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelActionMutation.mutate(action.id)}
                        disabled={isActionBusy}
                        className="inline-flex items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <XCircle className="h-4 w-4" />
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
