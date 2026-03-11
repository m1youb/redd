import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Clock3, LoaderCircle, Mail, Play, Save, Square, Zap } from 'lucide-react'
import { campaignApi } from '../../api/campaign'
import {
  CAMPAIGN_DASHBOARD_QUERY_KEY,
  type CampaignConfig,
  type CampaignState,
  type CampaignWindowStats,
} from './types'

interface CampaignSetupTabProps {
  config: CampaignConfig
  state: CampaignState
  stats: CampaignWindowStats
}

interface SetupFormState {
  start_time: string
  end_time: string
  customer_normal_per_agent: number
  customer_brand_total: number
  employee_helpful_total: number
  employee_brand_total: number
  approval_digest_time: string
}

interface MutationNotice {
  tone: 'success' | 'info'
  message: string
}

const volumeFields: Array<{
  key: keyof Pick<SetupFormState, 'customer_normal_per_agent' | 'customer_brand_total' | 'employee_helpful_total' | 'employee_brand_total'>
  label: string
  helper: string
  createdKey: keyof CampaignWindowStats
  targetKey: keyof CampaignWindowStats
}> = [
  {
    key: 'customer_normal_per_agent',
    label: 'Normal customer comments per agent',
    helper: 'Spread across the full campaign window.',
    createdKey: 'customer_normal_created',
    targetKey: 'customer_normal_target',
  },
  {
    key: 'customer_brand_total',
    label: 'Customer brand mention comments',
    helper: 'Total target for the entire campaign window.',
    createdKey: 'customer_brand_created',
    targetKey: 'customer_brand_total',
  },
  {
    key: 'employee_helpful_total',
    label: 'Employee helpful comments',
    helper: 'Non-brand helpful responses across the campaign.',
    createdKey: 'employee_helpful_created',
    targetKey: 'employee_helpful_total',
  },
  {
    key: 'employee_brand_total',
    label: 'Employee brand mention comments',
    helper: 'Brand-facing employee replies for the window.',
    createdKey: 'employee_brand_created',
    targetKey: 'employee_brand_total',
  },
]

function toFormState(config: CampaignConfig): SetupFormState {
  return {
    start_time: config.start_time ?? '09:00',
    end_time: config.end_time ?? '17:00',
    customer_normal_per_agent: config.customer_normal_per_agent ?? 0,
    customer_brand_total: config.customer_brand_total ?? 0,
    employee_helpful_total: config.employee_helpful_total ?? 0,
    employee_brand_total: config.employee_brand_total ?? 0,
    approval_digest_time: config.approval_digest_time ?? '08:00',
  }
}

function getStatusTone(state: CampaignState) {
  if (state.active_now) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  if (state.enabled) {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }

  return 'border-gray-200 bg-gray-100 text-gray-600'
}

function getStatusLabel(state: CampaignState) {
  if (state.active_now) {
    return 'Live now'
  }

  if (state.enabled) {
    return 'Scheduled'
  }

  return 'Stopped'
}

function getNumericValue(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? 0 : Math.max(0, parsed)
}

function getResponseMessage(response: unknown) {
  if (typeof response !== 'object' || response === null || !('data' in response)) {
    return null
  }

  const data = (response as { data?: unknown }).data
  if (typeof data !== 'object' || data === null || !('message' in data)) {
    return null
  }

  const message = (data as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message : null
}

function getNoticeTone(message: string): MutationNotice['tone'] {
  const normalized = message.toLowerCase()
  if (normalized.includes('nothing') || normalized.includes('no ') || normalized.includes('already')) {
    return 'info'
  }

  return 'success'
}

export default function CampaignSetupTab({ config, state, stats }: CampaignSetupTabProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SetupFormState>(() => toFormState(config))
  const [notice, setNotice] = useState<MutationNotice | null>(null)

  useEffect(() => {
    setForm(toFormState(config))
  }, [config])

  const hasChanges = useMemo(() => {
    const initial = toFormState(config)

    return (
      initial.start_time !== form.start_time ||
      initial.end_time !== form.end_time ||
      initial.customer_normal_per_agent !== form.customer_normal_per_agent ||
      initial.customer_brand_total !== form.customer_brand_total ||
      initial.employee_helpful_total !== form.employee_helpful_total ||
      initial.employee_brand_total !== form.employee_brand_total ||
      initial.approval_digest_time !== form.approval_digest_time
    )
  }, [config, form])

  const refreshDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY })
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: SetupFormState) => campaignApi.saveConfig(payload),
    onMutate: () => setNotice(null),
    onSuccess: async (response) => {
      setNotice({
        tone: getNoticeTone(getResponseMessage(response) ?? 'Campaign settings saved.'),
        message: getResponseMessage(response) ?? 'Campaign settings saved.',
      })
      await refreshDashboard()
    },
  })

  const startMutation = useMutation({
    mutationFn: async () => campaignApi.startCampaign(),
    onMutate: () => setNotice(null),
    onSuccess: async (response) => {
      setNotice({
        tone: getNoticeTone(getResponseMessage(response) ?? 'Campaign enabled.'),
        message: getResponseMessage(response) ?? 'Campaign enabled.',
      })
      await refreshDashboard()
    },
  })

  const stopMutation = useMutation({
    mutationFn: async () => campaignApi.stopCampaign(),
    onMutate: () => setNotice(null),
    onSuccess: async (response) => {
      setNotice({
        tone: getNoticeTone(getResponseMessage(response) ?? 'Campaign disabled.'),
        message: getResponseMessage(response) ?? 'Campaign disabled.',
      })
      await refreshDashboard()
    },
  })

  const runNowMutation = useMutation({
    mutationFn: async () => campaignApi.runNow(),
    onMutate: () => setNotice(null),
    onSuccess: async (response) => {
      setNotice({
        tone: getNoticeTone(getResponseMessage(response) ?? 'Campaign run started.'),
        message: getResponseMessage(response) ?? 'Campaign run started.',
      })
      await refreshDashboard()
    },
  })

  const activeError = saveMutation.error ?? startMutation.error ?? stopMutation.error ?? runNowMutation.error
  const isSaving = saveMutation.isPending
  const isRunningAction = startMutation.isPending || stopMutation.isPending || runNowMutation.isPending
  const runNowDisabled = !state.enabled || isSaving || isRunningAction

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Shared Schedule</p>
              <h2 className="mt-2 text-xl font-semibold text-gray-900">Campaign timing</h2>
              <p className="mt-1 text-sm text-gray-500">Set the working window once and keep the run state visible at a glance.</p>
            </div>
            <span className={clsx('inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', getStatusTone(state))}>
              {getStatusLabel(state)}
            </span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">Campaign start time</span>
              <input
                type="time"
                value={form.start_time}
                onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/15"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-gray-700">Campaign end time</span>
              <input
                type="time"
                value={form.end_time}
                onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/15"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Current local time</p>
              <p className="mt-2 text-lg font-semibold text-gray-900">{state.current_local_time_label || 'Unavailable'}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Campaign window</p>
              <p className="mt-2 text-lg font-semibold text-gray-900">{state.window_label || 'Not set'}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:col-span-2 xl:col-span-1">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-[#E8461E]/10 p-2 text-[#E8461E]">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Run state</p>
                  <p className="mt-2 text-lg font-semibold text-gray-900">{state.enabled ? 'Campaign enabled' : 'Campaign paused'}</p>
                  <p className="mt-1 text-sm text-gray-500">{state.active_now ? 'The schedule is currently in its live window.' : 'Outside the live window or manually stopped.'}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
          <div className="border-b border-gray-100 pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Approval Digest</p>
            <h2 className="mt-2 text-xl font-semibold text-gray-900">Reviewer email timing</h2>
            <p className="mt-1 text-sm text-gray-500">Approval emails go out at 8:00 AM by default and stay fully configurable for each delivery.</p>
          </div>

          <div className="mt-5 rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-white p-2 text-[#E8461E] shadow-sm shadow-[#E8461E]/10">
                <Mail className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Approval digest time</span>
                  <input
                    type="time"
                    value={form.approval_digest_time}
                    onChange={(event) => setForm((current) => ({ ...current, approval_digest_time: event.target.value }))}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/15"
                  />
                </label>
                <p className="mt-3 text-sm leading-6 text-gray-600">Use this when client reviewers prefer a later recap or want approvals collected before the daily working session starts.</p>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Actions</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => saveMutation.mutate(form)}
                disabled={!hasChanges || isSaving || isRunningAction}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
              >
                {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Campaign Settings
              </button>
              <button
                type="button"
                onClick={() => startMutation.mutate()}
                disabled={isSaving || isRunningAction}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Enable Campaign
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Disable the campaign schedule now? You can still use Run Campaign Now for a manual pass later.')) {
                    stopMutation.mutate()
                  }
                }}
                disabled={isSaving || isRunningAction}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stopMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                Disable Campaign
              </button>
              <button
                type="button"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowDisabled}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-[#E8461E]/40 hover:bg-[#E8461E]/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runNowMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Run Campaign Now
              </button>
            </div>
            <p className="text-xs text-gray-500">Save updates the campaign schedule and target volumes. Enable or disable scheduling here, and use Run Campaign Now for an immediate manual pass.</p>
            <p className="text-xs text-gray-500">Manual run is only available while the campaign is enabled.</p>
            {notice ? (
              <div
                className={clsx(
                  'rounded-md border px-3 py-2 text-sm',
                  notice.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700',
                )}
              >
                {notice.message}
              </div>
            ) : null}
            {activeError instanceof Error ? <p className="text-sm text-red-600">{activeError.message}</p> : null}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
        <div className="border-b border-gray-100 pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Campaign Volume</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900">Delivery targets and live progress</h2>
          <p className="mt-1 text-sm text-gray-500">Set the full-campaign targets once, then track created versus planned output across each bucket.</p>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {volumeFields.map((field) => {
            const created = stats[field.createdKey] ?? 0
            const target = stats[field.targetKey] ?? form[field.key]
            const safeTarget = Math.max(target, 0)
            const progress = safeTarget === 0 ? 0 : Math.min(100, Math.round((created / safeTarget) * 100))

            return (
              <div key={field.key} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-gray-700">{field.label}</span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={form[field.key]}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            [field.key]: getNumericValue(event.target.value),
                          }))
                        }
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/15"
                      />
                    </label>
                    <p className="mt-2 text-sm text-gray-500">{field.helper}</p>
                  </div>

                  <div className="min-w-32 rounded-xl border border-orange-100 bg-white p-3 text-center shadow-sm shadow-[#E8461E]/5">
                    <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Created / Target</p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">
                      <span className="text-[#E8461E]">{created}</span>
                      <span className="text-base text-gray-400"> / {target}</span>
                    </p>
                    <p className="mt-1 text-xs font-medium text-gray-500">{progress}% delivered</p>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#E8461E] to-orange-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
