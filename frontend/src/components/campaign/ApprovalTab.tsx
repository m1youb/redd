import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, Clock3, ExternalLink, Info, ShieldAlert, X } from 'lucide-react'
import { campaignApi } from '../../api/campaign'
import ApprovalReviewModal from './ApprovalReviewModal'
import {
  CAMPAIGN_DASHBOARD_QUERY_KEY,
  type ApprovalDraft,
  type ApprovalFilter,
} from './types'

interface ApprovalTabProps {
  approvals: ApprovalDraft[]
}

const filterOptions: Array<{ key: ApprovalFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'customer', label: 'Customer' },
  { key: 'employee', label: 'Employee' },
]

function getRelativeTime(value: string | null) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function truncateText(value: string, limit: number) {
  if (value.length <= limit) {
    return value
  }

  return `${value.slice(0, limit).trimEnd()}...`
}

function getDraftComment(draft: ApprovalDraft): string {
  return draft.edited_comment ?? draft.generated_comment ?? ''
}

function openThread(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export default function ApprovalTab({ approvals }: ApprovalTabProps) {
  const queryClient = useQueryClient()
  const [activeFilter, setActiveFilter] = useState<ApprovalFilter>('all')
  const [selectedApproval, setSelectedApproval] = useState<ApprovalDraft | null>(null)
  const [expandedCards, setExpandedCards] = useState<Record<number, boolean>>({})

  const filteredApprovals = useMemo(() => {
    if (activeFilter === 'all') {
      return approvals
    }

    return approvals.filter((draft) => {
      if (activeFilter === 'customer') {
        return draft.draft_type === 'customer_brand'
      }
      return draft.draft_type === 'employee_brand' || draft.draft_type === 'employee_helpful'
    })
  }, [activeFilter, approvals])

  const refreshDashboard = async () => {
    await queryClient.invalidateQueries({ queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY })
  }

  const approveMutation = useMutation({
    mutationFn: async (draftId: number) => campaignApi.approveDraft(draftId),
    onSuccess: refreshDashboard,
  })

  const rejectMutation = useMutation({
    mutationFn: async (draftId: number) => campaignApi.rejectDraft(draftId),
    onSuccess: refreshDashboard,
  })

  const editApproveMutation = useMutation({
    mutationFn: async ({ draftId, commentText, notes }: { draftId: number; commentText: string; notes: string }) => {
      await campaignApi.saveDraft(draftId, { comment_text: commentText, notes })
      await campaignApi.approveDraft(draftId)
    },
    onSuccess: async () => {
      setSelectedApproval(null)
      await refreshDashboard()
    },
  })

  const isBusy = approveMutation.isPending || rejectMutation.isPending || editApproveMutation.isPending

  const toggleExpanded = (approvalId: number) => {
    setExpandedCards((current) => ({
      ...current,
      [approvalId]: !current[approvalId],
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Human Review</p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Pending approvals</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Review AI-generated drafts before they enter the queue.</p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-full border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/80 p-1">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setActiveFilter(option.key)}
              className={clsx(
                'rounded-full px-4 py-2 text-sm font-medium transition',
                activeFilter === option.key
                  ? 'bg-[#E8461E] text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filteredApprovals.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/70 px-6 text-center">
          <ShieldAlert className="h-10 w-10 text-gray-400 dark:text-gray-600" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">No pending approvals</h3>
          <p className="mt-2 max-w-md text-sm text-gray-500">New drafts waiting for a reviewer will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredApprovals.map((approval) => {
            const commentText = getDraftComment(approval)
            const isExpanded = expandedCards[approval.id] ?? false
            const contextPanelId = `approval-context-${approval.id}`

            return (
              <article
                key={approval.id}
                className={clsx(
                  'rounded-2xl border bg-white p-5 text-left shadow-sm shadow-black/20 transition dark:bg-gray-900',
                  isExpanded
                    ? 'border-[#E8461E]/40 dark:border-[#E8461E]/40'
                    : 'border-gray-200 hover:border-[#E8461E]/30 dark:border-gray-800 dark:hover:border-gray-700',
                )}
              >
                <div className="flex flex-col gap-3 border-b border-gray-200 dark:border-gray-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {approval.account_username && (
                        <span className="rounded-full border border-[#E8461E]/30 bg-[#E8461E]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#ff8c6d]">
                          u/{approval.account_username}
                        </span>
                      )}
                      {approval.role ? (
                          <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs font-medium capitalize text-gray-700 dark:text-gray-300">
                          {approval.role}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-600 dark:text-yellow-300">
                        {approval.draft_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {approval.subreddit_name && (
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Subreddit</p>
                        <p className="mt-1 break-words text-sm font-medium text-gray-800 dark:text-gray-200">r/{approval.subreddit_name}</p>
                      </div>
                    )}
                    {approval.has_media ? (
                      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          This post includes media. Open the original post if you need the full visual context before approving.
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Clock3 className="h-4 w-4" />
                      <span>{getRelativeTime(approval.created_at)}</span>
                    </div>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={contextPanelId}
                      onClick={() => toggleExpanded(approval.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-[#E8461E]/30 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#E8461E]/20 dark:border-gray-800 dark:bg-gray-950/70 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100"
                    >
                      <span>{isExpanded ? 'Hide context' : 'Show context'}</span>
                      <ChevronDown className={clsx('h-4 w-4 transition-transform', isExpanded && 'rotate-180')} />
                    </button>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  {approval.post_title && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Post title</p>
                      <h3 className="mt-2 break-words text-lg font-semibold text-gray-900 dark:text-white">{approval.post_title}</h3>
                    </div>
                  )}

                  {commentText && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Draft response</p>
                      <p className="mt-2 break-words text-sm leading-6 text-gray-700 dark:text-gray-300">{truncateText(commentText, 220)}</p>
                    </div>
                  )}

                  {isExpanded ? (
                    <div id={contextPanelId} className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Original post</p>
                        {approval.post_title ? (
                          <p className="mt-2 break-words text-sm font-semibold text-gray-900 dark:text-white">{approval.post_title}</p>
                        ) : (
                          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No post title was captured for this draft.</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-gray-500">Post text</p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-gray-300">
                          {approval.post_body?.trim() || 'No post text was captured for this draft.'}
                        </p>
                      </div>
                      {approval.thread_url ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openThread(approval.thread_url as string)
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-950/70"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Visit Post
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        approveMutation.mutate(approval.id)
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
                    >
                      <Check className="h-4 w-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedApproval(approval)
                      }}
                      disabled={isBusy}
                      className="rounded-md border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:border-[#E8461E]/50 hover:bg-[#E8461E]/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Edit & Approve
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        rejectMutation.mutate(approval.id)
                      }}
                      disabled={isBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <ApprovalReviewModal
        approval={selectedApproval}
        isOpen={selectedApproval !== null}
        isSubmitting={editApproveMutation.isPending}
        onClose={() => setSelectedApproval(null)}
        onApprove={async ({ commentText, notes }) => {
          if (!selectedApproval) {
            return
          }

          await editApproveMutation.mutateAsync({
            draftId: selectedApproval.id,
            commentText,
            notes,
          })
        }}
      />
    </div>
  )
}
