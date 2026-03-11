import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCcw, Save } from 'lucide-react'
import { campaignApi } from '../../api/campaign'
import { CAMPAIGN_DASHBOARD_QUERY_KEY, type CampaignStrategy } from './types'

interface StrategyTabProps {
  strategy: CampaignStrategy
}

interface StrategyFormState {
  brand_name: string
  brand_mention_requires_approval: boolean
  max_managed_accounts_per_thread: string
  rolling_window_actions: string
  max_brand_mentions_per_window: string
  planner_interval_hours: string
  planner_customer_jobs_per_round: string
  planner_employee_jobs_per_round: string
  customer_brand_soft_ratio: string
  max_pending_customer_brand_drafts: string
  max_pending_employee_brand_drafts: string
  customer_job_type: string
  employee_job_type: string
}

const jobTypeOptions = ['search_and_interact', 'search_and_comment', 'browse_and_comment']

export default function StrategyTab({ strategy }: StrategyTabProps) {
  const queryClient = useQueryClient()
  const [formState, setFormState] = useState<StrategyFormState>({
    brand_name: '',
    brand_mention_requires_approval: true,
    max_managed_accounts_per_thread: '1',
    rolling_window_actions: '20',
    max_brand_mentions_per_window: '2',
    planner_interval_hours: '4',
    planner_customer_jobs_per_round: '3',
    planner_employee_jobs_per_round: '1',
    customer_brand_soft_ratio: '0.1',
    max_pending_customer_brand_drafts: '1',
    max_pending_employee_brand_drafts: '1',
    customer_job_type: 'search_and_interact',
    employee_job_type: 'search_and_interact',
  })

  useEffect(() => {
    setFormState({
      brand_name: strategy.brand_name ?? '',
      brand_mention_requires_approval: strategy.brand_mention_requires_approval ?? true,
      max_managed_accounts_per_thread: String(strategy.max_managed_accounts_per_thread ?? 1),
      rolling_window_actions: String(strategy.rolling_window_actions ?? 20),
      max_brand_mentions_per_window: String(strategy.max_brand_mentions_per_window ?? 2),
      planner_interval_hours: String(strategy.planner_interval_hours ?? 4),
      planner_customer_jobs_per_round: String(strategy.planner_customer_jobs_per_round ?? 3),
      planner_employee_jobs_per_round: String(strategy.planner_employee_jobs_per_round ?? 1),
      customer_brand_soft_ratio: String(strategy.customer_brand_soft_ratio ?? 0.1),
      max_pending_customer_brand_drafts: String(strategy.max_pending_customer_brand_drafts ?? 1),
      max_pending_employee_brand_drafts: String(strategy.max_pending_employee_brand_drafts ?? 1),
      customer_job_type: strategy.customer_job_type ?? 'search_and_interact',
      employee_job_type: strategy.employee_job_type ?? 'search_and_interact',
    })
  }, [strategy])

  const refreshDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY })
  }

  const saveMutation = useMutation({
    mutationFn: async () =>
      campaignApi.saveStrategy({
        brand_name: formState.brand_name.trim(),
        brand_mention_requires_approval: formState.brand_mention_requires_approval,
        max_managed_accounts_per_thread: Number(formState.max_managed_accounts_per_thread),
        rolling_window_actions: Number(formState.rolling_window_actions),
        max_brand_mentions_per_window: Number(formState.max_brand_mentions_per_window),
        planner_interval_hours: Number(formState.planner_interval_hours),
        planner_customer_jobs_per_round: Number(formState.planner_customer_jobs_per_round),
        planner_employee_jobs_per_round: Number(formState.planner_employee_jobs_per_round),
        customer_brand_soft_ratio: Number(formState.customer_brand_soft_ratio),
        max_pending_customer_brand_drafts: Number(formState.max_pending_customer_brand_drafts),
        max_pending_employee_brand_drafts: Number(formState.max_pending_employee_brand_drafts),
        customer_job_type: formState.customer_job_type,
        employee_job_type: formState.employee_job_type,
      }),
    onSuccess: refreshDashboard,
  })

  const resetMutation = useMutation({
    mutationFn: async () => campaignApi.resetWindow(),
    onSuccess: refreshDashboard,
  })

  const updateField = (key: keyof StrategyFormState, value: string | boolean) => {
    setFormState((current) => ({ ...current, [key]: value }))
  }

  const inputClasses = 'w-full rounded-xl border border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20'

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Strategy Guardrails</p>
        <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Tune brand context and posting limits</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Define campaign behavior, approval rules, and rate limits for all lanes.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Brand name</span>
          <input
            value={formState.brand_name}
            onChange={(event) => updateField('brand_name', event.target.value)}
            className={inputClasses}
            placeholder="Acme Labs"
          />
        </label>

        <div className="flex items-center gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <div className="flex-1">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Require approval for brand mentions</span>
            <p className="mt-1 break-words text-xs text-gray-500">When enabled, brand mention drafts require human review.</p>
          </div>
          <button
            type="button"
            onClick={() => updateField('brand_mention_requires_approval', !formState.brand_mention_requires_approval)}
            className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${formState.brand_mention_requires_approval ? 'bg-[#E8461E]' : 'bg-gray-300 dark:bg-gray-700'}`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${formState.brand_mention_requires_approval ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Rolling window size</span>
          <input
            type="number"
            min="1"
            value={formState.rolling_window_actions}
            onChange={(event) => updateField('rolling_window_actions', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">Number of recent actions considered for brand ratio.</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Max brand mentions per window</span>
          <input
            type="number"
            min="0"
            value={formState.max_brand_mentions_per_window}
            onChange={(event) => updateField('max_brand_mentions_per_window', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">Hard cap on brand mentions within the rolling window.</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Planner interval (hours)</span>
          <input
            type="number"
            min="1"
            value={formState.planner_interval_hours}
            onChange={(event) => updateField('planner_interval_hours', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">How often the planner runs to generate new actions.</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Customer brand soft ratio</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={formState.customer_brand_soft_ratio}
            onChange={(event) => updateField('customer_brand_soft_ratio', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">Target ratio of brand vs organic for customer accounts (0-1).</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Customer jobs per round</span>
          <input
            type="number"
            min="0"
            value={formState.planner_customer_jobs_per_round}
            onChange={(event) => updateField('planner_customer_jobs_per_round', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">Actions planned for customer accounts each round.</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Employee jobs per round</span>
          <input
            type="number"
            min="0"
            value={formState.planner_employee_jobs_per_round}
            onChange={(event) => updateField('planner_employee_jobs_per_round', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">Actions planned for employee accounts each round.</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Max pending customer brand drafts</span>
          <input
            type="number"
            min="0"
            value={formState.max_pending_customer_brand_drafts}
            onChange={(event) => updateField('max_pending_customer_brand_drafts', event.target.value)}
            className={inputClasses}
          />
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Max pending employee brand drafts</span>
          <input
            type="number"
            min="0"
            value={formState.max_pending_employee_brand_drafts}
            onChange={(event) => updateField('max_pending_employee_brand_drafts', event.target.value)}
            className={inputClasses}
          />
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Max accounts per thread</span>
          <input
            type="number"
            min="1"
            value={formState.max_managed_accounts_per_thread}
            onChange={(event) => updateField('max_managed_accounts_per_thread', event.target.value)}
            className={inputClasses}
          />
          <p className="text-xs text-gray-500">Max managed accounts that can comment in the same thread.</p>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Customer job type</span>
          <select
            value={formState.customer_job_type}
            onChange={(event) => updateField('customer_job_type', event.target.value)}
            className={inputClasses}
          >
            {jobTypeOptions.map((option) => (
              <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Employee job type</span>
          <select
            value={formState.employee_job_type}
            onChange={(event) => updateField('employee_job_type', event.target.value)}
            className={inputClasses}
          >
            {jobTypeOptions.map((option) => (
              <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending || saveMutation.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCcw className="h-4 w-4" />
          {resetMutation.isPending ? 'Resetting...' : 'Reset Window'}
        </button>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || resetMutation.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? 'Saving...' : 'Save Strategy'}
        </button>
      </div>
    </div>
  )
}
