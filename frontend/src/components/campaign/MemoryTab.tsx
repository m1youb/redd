import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Brain,
  Check,
  Clock3,
  Lightbulb,
  PencilLine,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { campaignApi } from '../../api/campaign'
import ConfirmDialog from '../ui/ConfirmDialog'
import Modal from '../ui/Modal'
import type {
  BusinessMemoryCategory,
  BusinessMemoryEntry,
  BusinessMemoryPayload,
  MemorySuggestion,
} from './types'

const MEMORY_SUGGESTIONS_QUERY_KEY = ['memory-suggestions'] as const
const BUSINESS_MEMORY_QUERY_KEY = ['business-memory'] as const

const memoryCategoryOptions: Array<{ value: BusinessMemoryCategory; label: string; description: string }> = [
  { value: 'tone', label: 'Tone', description: 'Reusable voice and style guidance.' },
  { value: 'preferred_phrasing', label: 'Preferred Phrasing', description: 'Words or sentence patterns to lean into.' },
  { value: 'avoid_phrasing', label: 'Avoid Phrasing', description: 'Language patterns to avoid in future drafts.' },
  { value: 'operations', label: 'Operations', description: 'Business process or admin-specific rules.' },
  { value: 'itinerary_guidance', label: 'Itinerary Guidance', description: 'Trip planning and guest advice guidance.' },
  {
    value: 'lodge_operator_preferences',
    label: 'Lodge Operator Preferences',
    description: 'Partner, lodge, or operator-specific preferences.',
  },
  {
    value: 'conservation_guidance',
    label: 'Conservation Guidance',
    description: 'Environmental, wildlife, or conservation positioning.',
  },
]

interface FeedbackState {
  tone: 'success' | 'error'
  message: string
}

interface MemoryFormValues {
  category: BusinessMemoryCategory
  title: string
  content: string
  priority: number
  is_active: boolean
}

interface MemoryFormModalProps {
  isOpen: boolean
  title: string
  description: string
  submitLabel: string
  initialValues: MemoryFormValues
  isSubmitting: boolean
  onClose: () => void
  onSubmit: (values: MemoryFormValues) => Promise<void>
  context?: ReactNode
  allowActiveToggle?: boolean
}

function getErrorMessage(error: unknown) {
  if (isAxiosError(error)) {
    const responseData = error.response?.data
    if (typeof responseData === 'object' && responseData !== null) {
      if ('error' in responseData && typeof responseData.error === 'string') {
        return responseData.error
      }
      if ('message' in responseData && typeof responseData.message === 'string') {
        return responseData.message
      }
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong. Please try again.'
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Unknown date'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function toLabel(value: string) {
  return value
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function truncateText(value: string | null, limit: number) {
  if (!value) {
    return null
  }

  if (value.length <= limit) {
    return value
  }

  return `${value.slice(0, limit).trimEnd()}...`
}

function buildSuggestionValues(suggestion: MemorySuggestion): MemoryFormValues {
  return {
    category: suggestion.category,
    title: suggestion.title,
    content: suggestion.content,
    priority: suggestion.confidence,
    is_active: true,
  }
}

function buildEntryValues(entry: BusinessMemoryEntry): MemoryFormValues {
  return {
    category: entry.category,
    title: entry.title,
    content: entry.content,
    priority: entry.priority,
    is_active: entry.is_active,
  }
}

const defaultMemoryValues: MemoryFormValues = {
  category: 'operations',
  title: '',
  content: '',
  priority: 3,
  is_active: true,
}

function MemoryFormModal({
  isOpen,
  title,
  description,
  submitLabel,
  initialValues,
  isSubmitting,
  onClose,
  onSubmit,
  context,
  allowActiveToggle = true,
}: MemoryFormModalProps) {
  const [values, setValues] = useState<MemoryFormValues>(initialValues)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setValues(initialValues)
    setValidationError(null)
  }, [initialValues, isOpen])

  const handleSubmit = async () => {
    if (!values.title.trim()) {
      setValidationError('Title is required.')
      return
    }

    if (!values.content.trim()) {
      setValidationError('Content is required.')
      return
    }

    setValidationError(null)
    await onSubmit({
      ...values,
      title: values.title.trim(),
      content: values.content.trim(),
    })
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="xl"
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-100 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/60"
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50 via-white to-amber-50 p-4">
          <p className="text-sm font-medium text-gray-900">{description}</p>
        </div>

        {context ? <div className="space-y-3">{context}</div> : null}

        {validationError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{validationError}</div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-800">Category</span>
            <select
              value={values.category}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  category: event.target.value as BusinessMemoryCategory,
                }))
              }}
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20"
            >
              {memoryCategoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs leading-5 text-gray-500">
              {memoryCategoryOptions.find((option) => option.value === values.category)?.description}
            </p>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-gray-800">Priority</span>
            <select
              value={String(values.priority)}
              onChange={(event) => {
                setValues((current) => ({
                  ...current,
                  priority: Number(event.target.value),
                }))
              }}
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} - {value <= 2 ? 'Low' : value === 3 ? 'Normal' : 'High'}
                </option>
              ))}
            </select>
            <p className="text-xs leading-5 text-gray-500">Higher priority memories are more likely to shape future prompt guidance.</p>
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-800">Title</span>
          <input
            type="text"
            value={values.title}
            onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
            placeholder="Short reusable rule title"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-800">Memory content</span>
          <textarea
            value={values.content}
            onChange={(event) => setValues((current) => ({ ...current, content: event.target.value }))}
            rows={6}
            placeholder="Direct instruction or reusable writing guidance"
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20"
          />
        </label>

        {allowActiveToggle ? (
          <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
            <input
              type="checkbox"
              checked={values.is_active}
              onChange={(event) => setValues((current) => ({ ...current, is_active: event.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#E8461E] focus:ring-[#E8461E]"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Keep this memory active</span>
              <span className="mt-1 block text-xs leading-5 text-gray-500">
                Inactive memory stays on record but is excluded from future prompt generation.
              </span>
            </span>
          </label>
        ) : null}
      </div>
    </Modal>
  )
}

export default function MemoryTab() {
  const queryClient = useQueryClient()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState | null>(null)
  const [suggestionToReview, setSuggestionToReview] = useState<MemorySuggestion | null>(null)
  const [suggestionToDismiss, setSuggestionToDismiss] = useState<MemorySuggestion | null>(null)
  const [entryToEdit, setEntryToEdit] = useState<BusinessMemoryEntry | null>(null)
  const [entryToToggle, setEntryToToggle] = useState<BusinessMemoryEntry | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const pendingSuggestionsQuery = useQuery({
    queryKey: [...MEMORY_SUGGESTIONS_QUERY_KEY, 'pending'],
    queryFn: async () => (await campaignApi.getMemorySuggestions('pending')).data,
  })

  const businessMemoryQuery = useQuery({
    queryKey: [...BUSINESS_MEMORY_QUERY_KEY, includeArchived],
    queryFn: async () => (await campaignApi.getBusinessMemory(includeArchived)).data,
  })

  const refreshMemoryData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MEMORY_SUGGESTIONS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: BUSINESS_MEMORY_QUERY_KEY }),
    ])
  }

  const approveSuggestionMutation = useMutation({
    mutationFn: async ({ suggestionId, payload }: { suggestionId: number; payload?: BusinessMemoryPayload }) =>
      campaignApi.approveMemorySuggestion(suggestionId, payload),
    onSuccess: async (response) => {
      setSuggestionToReview(null)
      setFeedback({ tone: 'success', message: response.data.message || 'Suggestion promoted to business memory.' })
      await refreshMemoryData()
    },
    onError: (error) => {
      setFeedback({ tone: 'error', message: getErrorMessage(error) })
    },
  })

  const dismissSuggestionMutation = useMutation({
    mutationFn: async (suggestionId: number) => campaignApi.dismissMemorySuggestion(suggestionId),
    onSuccess: async (response) => {
      setFeedback({ tone: 'success', message: response.data.message || 'Suggestion dismissed.' })
      await refreshMemoryData()
    },
    onError: (error) => {
      setFeedback({ tone: 'error', message: getErrorMessage(error) })
    },
  })

  const createEntryMutation = useMutation({
    mutationFn: async (payload: BusinessMemoryPayload) => campaignApi.createBusinessMemory(payload),
    onSuccess: async (response) => {
      setIsCreateModalOpen(false)
      setFeedback({ tone: 'success', message: response.data.message || 'Business memory saved.' })
      await refreshMemoryData()
    },
    onError: (error) => {
      setFeedback({ tone: 'error', message: getErrorMessage(error) })
    },
  })

  const updateEntryMutation = useMutation({
    mutationFn: async ({ entryId, payload }: { entryId: number; payload: Partial<BusinessMemoryPayload> & { is_active?: boolean } }) =>
      campaignApi.updateBusinessMemory(entryId, payload),
    onSuccess: async (response) => {
      setEntryToEdit(null)
      setFeedback({ tone: 'success', message: response.data.message || 'Business memory updated.' })
      await refreshMemoryData()
    },
    onError: (error) => {
      setFeedback({ tone: 'error', message: getErrorMessage(error) })
    },
  })

  const memoryEntries = businessMemoryQuery.data ?? []
  const pendingSuggestions = pendingSuggestionsQuery.data ?? []

  const activeEntriesCount = useMemo(
    () => memoryEntries.filter((entry) => entry.is_active).length,
    [memoryEntries],
  )

  const archivedEntriesCount = useMemo(
    () => memoryEntries.filter((entry) => !entry.is_active).length,
    [memoryEntries],
  )

  const anyMutationPending =
    approveSuggestionMutation.isPending ||
    dismissSuggestionMutation.isPending ||
    createEntryMutation.isPending ||
    updateEntryMutation.isPending

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-orange-100 bg-gradient-to-br from-white via-orange-50 to-amber-100 shadow-xl shadow-[#E8461E]/10">
        <div className="grid gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#E8461E]">Memory Loop</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-gray-900 sm:text-3xl">Review reusable guidance and keep business memory sharp</h2>
              <span className="rounded-full border border-orange-200 bg-white/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#E8461E] shadow-sm">
                Admin only
              </span>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-600">
              Suggestions come from meaningful approval edits. Promote the ones worth reusing, dismiss noisy lessons, and maintain the memory bank that future draft generation relies on.
            </p>
          </div>

          <div className="rounded-3xl border border-white/80 bg-white/80 p-5 shadow-sm shadow-[#E8461E]/10 backdrop-blur-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-black/5">
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Pending suggestions</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{pendingSuggestions.length}</p>
              </div>
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-black/5">
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Active memory</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{activeEntriesCount}</p>
              </div>
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm shadow-black/5">
                <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Archived</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{archivedEntriesCount}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {feedback ? (
        <div
          className={clsx(
            'rounded-2xl border px-4 py-3 text-sm shadow-sm',
            feedback.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p>{feedback.message}</p>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="rounded-md p-1 text-current transition hover:bg-black/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#E8461E]">
              <Lightbulb className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-[0.24em]">Pending Suggestions</p>
            </div>
            <h3 className="mt-2 text-xl font-semibold text-gray-900">Suggestions extracted from approval edits</h3>
            <p className="mt-1 text-sm text-gray-500">Review and promote reusable lessons before they become part of the shared memory bank.</p>
          </div>
          <button
            type="button"
            onClick={() => void pendingSuggestionsQuery.refetch()}
            disabled={pendingSuggestionsQuery.isFetching}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-[#E8461E]/40 hover:bg-[#E8461E]/5 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingSuggestionsQuery.isFetching ? 'Refreshing...' : 'Refresh suggestions'}
          </button>
        </div>

        {pendingSuggestionsQuery.isLoading ? (
          <div className="grid gap-4 pt-5 xl:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="h-64 animate-pulse rounded-2xl bg-gray-100" />
            ))}
          </div>
        ) : pendingSuggestionsQuery.isError ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            {getErrorMessage(pendingSuggestionsQuery.error)}
          </div>
        ) : pendingSuggestions.length === 0 ? (
          <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 text-center">
            <Sparkles className="h-10 w-10 text-gray-400" />
            <h4 className="mt-4 text-lg font-semibold text-gray-900">No pending suggestions</h4>
            <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
              When reviewers make meaningful edits to approved drafts, reusable lessons will appear here for admin review.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 pt-5 xl:grid-cols-2">
            {pendingSuggestions.map((suggestion) => (
              <article key={suggestion.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
                <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#E8461E]">
                        {toLabel(suggestion.category)}
                      </span>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                        Confidence {suggestion.confidence}/5
                      </span>
                      <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {toLabel(suggestion.draft_type)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
                      <span>{suggestion.account_username ? `u/${suggestion.account_username}` : 'Unknown account'}</span>
                      <span>Review #{suggestion.source_review_id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock3 className="h-4 w-4" />
                    <span>{formatDateTime(suggestion.created_at)}</span>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{suggestion.title}</h4>
                    <p className="mt-2 text-sm leading-6 text-gray-700">{suggestion.content}</p>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {suggestion.source_review.post_title ? (
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Source thread</p>
                        <p className="mt-2 text-sm font-medium leading-6 text-gray-800">{truncateText(suggestion.source_review.post_title, 160)}</p>
                      </div>
                    ) : null}

                    {suggestion.source_review.approval_notes ? (
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Reviewer notes</p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">{truncateText(suggestion.source_review.approval_notes, 180)}</p>
                      </div>
                    ) : null}
                  </div>

                  {(suggestion.source_review.original_comment || suggestion.source_review.final_comment) ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Original draft</p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">
                          {truncateText(suggestion.source_review.original_comment, 220) || 'No original draft captured.'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Approved edit</p>
                        <p className="mt-2 text-sm leading-6 text-gray-700">
                          {truncateText(suggestion.source_review.final_comment, 220) || 'No approved edit captured.'}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => approveSuggestionMutation.mutate({ suggestionId: suggestion.id })}
                      disabled={anyMutationPending}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/60"
                    >
                      <Check className="h-4 w-4" />
                      Promote now
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestionToReview(suggestion)}
                      disabled={anyMutationPending}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:border-[#E8461E]/40 hover:bg-[#E8461E]/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PencilLine className="h-4 w-4" />
                      Review before promote
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestionToDismiss(suggestion)}
                      disabled={anyMutationPending}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                      Dismiss
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[#E8461E]">
              <BookOpen className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-[0.24em]">Business Memory</p>
            </div>
            <h3 className="mt-2 text-xl font-semibold text-gray-900">Reusable guidance available to future prompt generation</h3>
            <p className="mt-1 text-sm text-gray-500">Create, refine, archive, and reactivate memory entries without leaving campaign management.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="inline-flex items-center gap-3 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#E8461E] focus:ring-[#E8461E]"
              />
              Show archived entries
            </label>
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36]"
            >
              <Plus className="h-4 w-4" />
              New memory entry
            </button>
          </div>
        </div>

        {businessMemoryQuery.isLoading ? (
          <div className="grid gap-4 pt-5 xl:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="h-56 animate-pulse rounded-2xl bg-gray-100" />
            ))}
          </div>
        ) : businessMemoryQuery.isError ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            {getErrorMessage(businessMemoryQuery.error)}
          </div>
        ) : memoryEntries.length === 0 ? (
          <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 text-center">
            <Brain className="h-10 w-10 text-gray-400" />
            <h4 className="mt-4 text-lg font-semibold text-gray-900">No business memory entries yet</h4>
            <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">
              Promote a suggestion or create a manual entry to give future drafts reusable business guidance.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 pt-5 xl:grid-cols-2">
            {memoryEntries.map((entry) => (
              <article key={entry.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm shadow-black/5">
                <div className="flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#E8461E]">
                        {toLabel(entry.category)}
                      </span>
                      <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        Priority {entry.priority}/5
                      </span>
                      <span
                        className={clsx(
                          'rounded-full border px-3 py-1 text-xs font-medium',
                          entry.is_active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-100 text-gray-600',
                        )}
                      >
                        {entry.is_active ? 'Active' : 'Archived'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
                      <span>Entry #{entry.id}</span>
                      {entry.created_by_username ? <span>Added by {entry.created_by_username}</span> : null}
                      {entry.source_review_id ? <span>From review #{entry.source_review_id}</span> : <span>Manual entry</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock3 className="h-4 w-4" />
                    <span>{formatDateTime(entry.created_at)}</span>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{entry.title}</h4>
                    <p className="mt-2 text-sm leading-6 text-gray-700">{entry.content}</p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => setEntryToEdit(entry)}
                      disabled={anyMutationPending}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 transition hover:border-[#E8461E]/40 hover:bg-[#E8461E]/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <PencilLine className="h-4 w-4" />
                      Edit entry
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryToToggle(entry)}
                      disabled={anyMutationPending}
                      className={clsx(
                        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                        entry.is_active
                          ? 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                          : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                      )}
                    >
                      {entry.is_active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                      {entry.is_active ? 'Archive' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <MemoryFormModal
        isOpen={suggestionToReview !== null}
        title="Promote suggestion to business memory"
        description="Tighten the lesson before it becomes part of the reusable memory bank."
        submitLabel="Promote to memory"
        initialValues={suggestionToReview ? buildSuggestionValues(suggestionToReview) : defaultMemoryValues}
        isSubmitting={approveSuggestionMutation.isPending}
        allowActiveToggle={false}
        onClose={() => setSuggestionToReview(null)}
        onSubmit={async (values) => {
          if (!suggestionToReview) {
            return
          }

          await approveSuggestionMutation.mutateAsync({
            suggestionId: suggestionToReview.id,
            payload: {
              category: values.category,
              title: values.title,
              content: values.content,
              priority: values.priority,
              is_active: true,
            },
          })
        }}
        context={suggestionToReview ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Source context</p>
              <p className="mt-2 text-sm leading-6 text-gray-700">
                {suggestionToReview.source_review.post_title || suggestionToReview.source_review.final_comment || 'No source review text available.'}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Suggestion details</p>
              <p className="mt-2 text-sm leading-6 text-gray-700">
                {suggestionToReview.account_username ? `u/${suggestionToReview.account_username}` : 'Unknown account'}
                {' · '}
                {toLabel(suggestionToReview.draft_type)}
                {' · '}
                Confidence {suggestionToReview.confidence}/5
              </p>
            </div>
          </div>
        ) : undefined}
      />

      <MemoryFormModal
        isOpen={isCreateModalOpen}
        title="Create business memory entry"
        description="Add a manual rule or reusable instruction for future prompt generation."
        submitLabel="Create entry"
        initialValues={defaultMemoryValues}
        isSubmitting={createEntryMutation.isPending}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={async (values) => {
          await createEntryMutation.mutateAsync({
            category: values.category,
            title: values.title,
            content: values.content,
            priority: values.priority,
            is_active: values.is_active,
          })
        }}
      />

      <MemoryFormModal
        isOpen={entryToEdit !== null}
        title="Edit business memory entry"
        description="Adjust wording, category, or priority without leaving the memory workspace."
        submitLabel="Save changes"
        initialValues={entryToEdit ? buildEntryValues(entryToEdit) : defaultMemoryValues}
        isSubmitting={updateEntryMutation.isPending}
        onClose={() => setEntryToEdit(null)}
        onSubmit={async (values) => {
          if (!entryToEdit) {
            return
          }

          await updateEntryMutation.mutateAsync({
            entryId: entryToEdit.id,
            payload: {
              category: values.category,
              title: values.title,
              content: values.content,
              priority: values.priority,
              is_active: values.is_active,
            },
          })
        }}
        context={entryToEdit ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700">
            {entryToEdit.source_review_id ? `Originally created from review #${entryToEdit.source_review_id}.` : 'This entry was created manually.'}
          </div>
        ) : undefined}
      />

      <ConfirmDialog
        isOpen={suggestionToDismiss !== null}
        onClose={() => setSuggestionToDismiss(null)}
        onConfirm={() => {
          if (suggestionToDismiss) {
            dismissSuggestionMutation.mutate(suggestionToDismiss.id)
          }
        }}
        title="Dismiss memory suggestion"
        message="Dismissed suggestions stay out of the business memory bank. Use this when a lesson is too specific, low value, or not reusable."
        confirmLabel={dismissSuggestionMutation.isPending ? 'Dismissing...' : 'Dismiss suggestion'}
        variant="danger"
      />

      <ConfirmDialog
        isOpen={entryToToggle !== null}
        onClose={() => setEntryToToggle(null)}
        onConfirm={() => {
          if (entryToToggle) {
            updateEntryMutation.mutate({
              entryId: entryToToggle.id,
              payload: { is_active: !entryToToggle.is_active },
            })
          }
        }}
        title={entryToToggle?.is_active ? 'Archive business memory' : 'Reactivate business memory'}
        message={entryToToggle?.is_active
          ? 'Archived memory remains stored but will no longer be used in future prompt generation.'
          : 'Reactivated memory becomes eligible for future prompt generation again.'}
        confirmLabel={updateEntryMutation.isPending ? 'Saving...' : entryToToggle?.is_active ? 'Archive' : 'Reactivate'}
        variant={entryToToggle?.is_active ? 'warning' : 'info'}
      />
    </div>
  )
}
