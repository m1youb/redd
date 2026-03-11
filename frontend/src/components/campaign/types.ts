import type { Account } from '../../api/accounts'

export const CAMPAIGN_DASHBOARD_QUERY_KEY = ['campaign-dashboard'] as const

export type CampaignTabKey = 'setup' | 'approvals' | 'memory' | 'accounts' | 'activity'
export type ApprovalFilter = 'all' | 'customer' | 'employee'
export type AccountRole = 'customer' | 'employee' | 'inactive'
export type LaneId = 'customer_normal' | 'employee_helpful' | 'customer_brand' | 'employee_brand'
export type MemorySuggestionStatus = 'pending' | 'approved' | 'dismissed'
export type BusinessMemoryCategory =
  | 'tone'
  | 'preferred_phrasing'
  | 'avoid_phrasing'
  | 'operations'
  | 'itinerary_guidance'
  | 'lodge_operator_preferences'
  | 'conservation_guidance'

export interface CampaignConfig {
  start_time: string
  end_time: string
  customer_normal_per_agent: number
  customer_brand_total: number
  employee_helpful_total: number
  employee_brand_total: number
  approval_digest_time: string
}

export interface CampaignState {
  enabled: boolean
  active_now: boolean
  window_label: string
  current_local_time_label: string
}

export interface CampaignStrategy {
  brand_name: string
  brand_mention_requires_approval: boolean
  max_managed_accounts_per_thread: number
  rolling_window_actions: number
  max_brand_mentions_per_window: number
  planner_interval_hours: number
  planner_customer_jobs_per_round: number
  planner_employee_jobs_per_round: number
  customer_brand_soft_ratio: number
  max_pending_customer_brand_drafts: number
  max_pending_employee_brand_drafts: number
  customer_job_type: string
  employee_job_type: string
}

export interface LaneConfig {
  enabled: boolean
  start_time: string
  end_time: string
  daily_target: number
  gap_minutes: number
  auto_calculate_gap: boolean
}

export interface CampaignLane {
  id: string
  label: string
  short_label: string
  description: string
  mode: 'auto' | 'approval'
  defaults: LaneConfig
  effective: LaneConfig
  today_override: LaneConfig | null
  using_override: boolean
  paused_today: boolean
  run_count_today: number
  remaining_today: number
  used_accounts_today: string[]
  available_accounts: number
  pending_approvals: number | null
  window_active: boolean
  window_start: string
  window_end: string
  window_label: string
  current_local_time: string
  current_local_time_label: string
  gap_minutes: number
  last_run_at: string | null
  last_attempt_at: string | null
  next_run_at: string | null
  next_run_label: string
  time_until_next_run_seconds: number | null
  time_until_next_run_label: string
}

export interface ApprovalDraft {
  id: number
  account_id: number
  account_username: string | null
  role: string | null
  draft_type: string
  managed_action_id: number | null
  title: string
  job_type: string
  keyword: string | null
  thread_url: string | null
  post_title: string | null
  post_body: string | null
  post_author: string | null
  subreddit_name: string | null
  has_media: boolean
  media_hint: string | null
  brief: string | null
  generated_comment: string | null
  edited_comment: string | null
  approval_notes: string | null
  status: string
  params: Record<string, unknown>
  created_at: string | null
  digest_sent_at: string | null
  prepared_at: string | null
  reviewed_at: string | null
}

export interface ManagedAction {
  id: number
  account_id: number
  account_username: string | null
  role: string | null
  job_id: number | null
  title: string
  action_type: string
  content_mode: string
  status: string
  approval_state: string
  keyword: string | null
  thread_url: string | null
  notes: string | null
  params: Record<string, unknown>
  result: Record<string, unknown> | null
  created_at: string | null
  queued_at: string | null
  executed_at: string | null
  updated_at: string | null
}

export interface MemorySuggestionSourceReview {
  id: number | null
  role: string | null
  post_title: string | null
  original_comment: string | null
  final_comment: string | null
  approval_notes: string | null
  reviewer_username: string | null
}

export interface MemorySuggestion {
  id: number
  source_review_id: number
  account_id: number | null
  account_username: string | null
  draft_type: string
  category: BusinessMemoryCategory
  title: string
  content: string
  confidence: number
  status: MemorySuggestionStatus
  approved_memory_id: number | null
  reviewed_by: number | null
  reviewed_by_username: string | null
  created_at: string | null
  reviewed_at: string | null
  source_review: MemorySuggestionSourceReview
}

export interface BusinessMemoryEntry {
  id: number
  category: BusinessMemoryCategory
  title: string
  content: string
  priority: number
  is_active: boolean
  source_review_id: number | null
  created_by: number | null
  created_by_username: string | null
  created_at: string | null
}

export interface BusinessMemoryPayload {
  category: BusinessMemoryCategory
  title: string
  content: string
  priority: number
  is_active?: boolean
  source_review_id?: number | null
}

export interface WindowStats {
  window_size: number
  considered: number
  organic: number
  expert: number
  brand: number
  customer_brand: number
  employee_brand: number
  customer_brand_ratio: number
  customer_brand_target: number
  maintenance: number
  brand_remaining: number
  brand_limit: number
  reset_at: string | null
}

export interface CampaignStats {
  total_accounts: number
  role_counts: Record<string, number>
  planned_actions: number
  queued_actions: number
  running_actions: number
  pending_approvals: number
  active_lanes: number
  window: WindowStats
  campaign_window: CampaignWindowStats
}

export interface CampaignWindowStats {
  customer_normal_created: number
  customer_normal_target: number
  customer_brand_created: number
  customer_brand_total: number
  employee_helpful_created: number
  employee_helpful_total: number
  employee_brand_created: number
  employee_brand_total: number
}

export interface CampaignAccount extends Omit<Account, 'role'> {
  role: AccountRole | null
}

export interface CampaignDashboardData {
  strategy: CampaignStrategy
  lanes: Record<LaneId, CampaignLane>
  approval_digest_time: string
  campaign_config: CampaignConfig
  campaign_state: CampaignState
  accounts: CampaignAccount[]
  planned_actions: ManagedAction[]
  recent_actions: ManagedAction[]
  approval_drafts: ApprovalDraft[]
  approval_groups: Record<string, ApprovalDraft[]>
  stats: CampaignStats
}
