import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, HeartHandshake, MessageSquare, Megaphone, Users } from 'lucide-react'
import { campaignApi } from '../api/campaign'
import AccountsTab from '../components/campaign/AccountsTab'
import ActivityTab from '../components/campaign/ActivityTab'
import ApprovalTab from '../components/campaign/ApprovalTab'
import CampaignSetupTab from '../components/campaign/CampaignSetupTab'
import MemoryTab from '../components/campaign/MemoryTab'
import { CAMPAIGN_DASHBOARD_QUERY_KEY, type CampaignDashboardData, type CampaignTabKey } from '../components/campaign/types'

const tabs: Array<{ key: CampaignTabKey; label: string }> = [
  { key: 'setup', label: 'Setup' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'memory', label: 'Memory' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'activity', label: 'Activity' },
]

const statCards = [
  {
    key: 'customer_normal' as const,
    label: 'Customer Normal',
    icon: MessageSquare,
    createdKey: 'customer_normal_created' as const,
    targetKey: 'customer_normal_target' as const,
  },
  {
    key: 'customer_brand' as const,
    label: 'Customer Brand',
    icon: Megaphone,
    createdKey: 'customer_brand_created' as const,
    targetKey: 'customer_brand_total' as const,
  },
  {
    key: 'employee_helpful' as const,
    label: 'Employee Helpful',
    icon: HeartHandshake,
    createdKey: 'employee_helpful_created' as const,
    targetKey: 'employee_helpful_total' as const,
  },
  {
    key: 'employee_brand' as const,
    label: 'Employee Brand',
    icon: Users,
    createdKey: 'employee_brand_created' as const,
    targetKey: 'employee_brand_total' as const,
  },
] as const

function unwrapDashboard(data: unknown): CampaignDashboardData {
  return data as CampaignDashboardData
}

function renderTabContent(activeTab: CampaignTabKey, dashboard: CampaignDashboardData) {
  switch (activeTab) {
    case 'setup':
      return <CampaignSetupTab config={dashboard.campaign_config} state={dashboard.campaign_state} stats={dashboard.stats.campaign_window} />
    case 'approvals':
      return <ApprovalTab approvals={dashboard.approval_drafts} />
    case 'memory':
      return <MemoryTab />
    case 'accounts':
      return <AccountsTab accounts={dashboard.accounts} />
    case 'activity':
      return <ActivityTab actions={dashboard.recent_actions} />
    default:
      return null
  }
}

export default function Campaign() {
  const [activeTab, setActiveTab] = useState<CampaignTabKey>('setup')

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY,
    queryFn: async () => unwrapDashboard((await campaignApi.getDashboard()).data),
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6">
          <div className="h-40 rounded-3xl bg-gray-100" />
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-32 rounded-2xl bg-gray-100" />
            ))}
          </div>
          <div className="h-16 rounded-2xl bg-gray-100" />
          <div className="h-[28rem] rounded-2xl bg-gray-100" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-6 text-gray-900">
        <div className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-2xl shadow-black/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-gray-900">Campaign dashboard unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500">
            {error instanceof Error ? error.message : 'The dashboard request failed. Retry to load the latest campaign data.'}
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

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-orange-100 bg-gradient-to-br from-white via-orange-50 to-amber-100 shadow-xl shadow-[#E8461E]/10">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.9fr)] lg:px-8 lg:py-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8461E]">Campaign Delivery</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold text-gray-900 sm:text-4xl">Campaign control center</h1>
                <span className={clsx(
                  'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] shadow-sm',
                  data.campaign_state.active_now
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-emerald-100'
                    : data.campaign_state.enabled
                      ? 'border-amber-200 bg-amber-50 text-amber-700 shadow-amber-100'
                      : 'border-gray-200 bg-white/80 text-gray-600 shadow-gray-200/70',
                )}>
                  {data.campaign_state.active_now ? 'Live now' : data.campaign_state.enabled ? 'Scheduled' : 'Stopped'}
                </span>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-600 sm:text-base">
                Configure the campaign window, set client-facing delivery totals, and keep approvals plus recent activity close to the controls that matter.
              </p>
            </div>

            <div className="rounded-3xl border border-white/80 bg-white/75 p-5 shadow-sm shadow-[#E8461E]/10 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Campaign window</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{data.campaign_state.window_label || 'Not scheduled'}</p>
                  <p className="mt-2 text-sm text-gray-600">Current local time: {data.campaign_state.current_local_time_label || 'Unavailable'}</p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-200/80 bg-white/80 p-4 shadow-sm shadow-black/5">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Pending approvals</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{data.stats.pending_approvals}</p>
                </div>
                <div className="rounded-2xl border border-gray-200/80 bg-white/80 p-4 shadow-sm shadow-black/5">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Approval digest</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">{data.campaign_config.approval_digest_time || data.approval_digest_time || '08:00'}</p>
                  <p className="mt-1 text-sm text-gray-500">Default reviewer recap time.</p>
                </div>
                <div className="rounded-2xl border border-gray-200/80 bg-white/80 p-4 shadow-sm shadow-black/5 sm:col-span-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Campaign totals</p>
                  <p className="mt-2 text-2xl font-semibold text-gray-900">
                    {data.stats.campaign_window.customer_normal_created +
                      data.stats.campaign_window.customer_brand_created +
                      data.stats.campaign_window.employee_helpful_created +
                      data.stats.campaign_window.employee_brand_created}
                    <span className="text-base text-gray-500">
                      {' '}
                      / {data.stats.campaign_window.customer_normal_target +
                        data.stats.campaign_window.customer_brand_total +
                        data.stats.campaign_window.employee_helpful_total +
                        data.stats.campaign_window.employee_brand_total}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-gray-500">Created versus total target across the four delivery buckets.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon
            const created = data.stats.campaign_window[card.createdKey]
            const target = data.stats.campaign_window[card.targetKey]

            return (
              <article key={card.key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">{card.label}</p>
                    <p className="mt-3 text-3xl font-semibold text-gray-900">
                      <span className="text-[#E8461E]">{created}</span>
                      <span className="text-lg text-gray-400"> / {target}</span>
                    </p>
                    <p className="mt-2 text-sm text-gray-500">Created versus target for this campaign bucket.</p>
                  </div>
                  <div className="rounded-2xl bg-[#E8461E]/10 p-3 text-[#E8461E]">
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </article>
            )
          })}
        </section>

        <section className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white/90 p-2 backdrop-blur-sm">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'rounded-full px-4 py-2 text-sm font-medium transition',
                activeTab === tab.key
                  ? 'bg-[#E8461E] text-white shadow-lg shadow-[#E8461E]/20'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
              )}
            >
              {tab.label}
            </button>
          ))}
          <div className="ml-auto flex items-center px-2 text-xs uppercase tracking-[0.16em] text-gray-500">
            {isFetching ? 'Refreshing...' : 'Synced'}
          </div>
        </section>

        {renderTabContent(activeTab, data)}
      </div>
    </div>
  )
}
