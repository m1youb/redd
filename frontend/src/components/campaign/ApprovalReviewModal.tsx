import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Info, X } from 'lucide-react'
import type { ApprovalDraft } from './types'

interface ApprovalReviewModalProps {
  approval: ApprovalDraft | null
  isOpen: boolean
  isSubmitting: boolean
  onClose: () => void
  onApprove: (payload: { commentText: string; notes: string }) => Promise<void>
}

export default function ApprovalReviewModal({
  approval,
  isOpen,
  isSubmitting,
  onClose,
  onApprove,
}: ApprovalReviewModalProps) {
  const [commentText, setCommentText] = useState('')
  const [notes, setNotes] = useState('')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!approval) {
      setCommentText('')
      setNotes('')
      return
    }

    setCommentText(approval.edited_comment ?? approval.generated_comment ?? '')
    setNotes('')
  }, [approval])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) {
        return
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')

      if (focusableElements.length === 0) {
        event.preventDefault()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey) {
        if (activeElement === firstElement || !dialogRef.current.contains(activeElement)) {
          event.preventDefault()
          lastElement.focus()
        }
        return
      }

      if (activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
      previouslyFocused?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen || !approval) {
    return null
  }

  const handleSubmit = async () => {
    await onApprove({ commentText, notes })
  }

  const openThread = () => {
    if (!approval.thread_url) {
      return
    }

    window.open(approval.thread_url, '_blank', 'noopener,noreferrer')
  }

  const dialogTitleId = `approval-review-title-${approval.id}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/40 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-gray-200 px-6 pb-4 pt-6 dark:border-gray-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Review Draft</p>
            <h2 id={dialogTitleId} className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Edit and approve response</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {approval.account_username ? `u/${approval.account_username}` : 'Unknown account'}
              {approval.subreddit_name ? ` in r/${approval.subreddit_name}` : ''}
            </p>
            {approval.thread_url ? (
              <button
                type="button"
                onClick={openThread}
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-950/70"
              >
                <ExternalLink className="h-4 w-4" />
                Visit Post
              </button>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close review dialog"
            onClick={onClose}
            className="rounded-md border border-gray-300 dark:border-gray-800 p-2 text-gray-500 dark:text-gray-400 transition hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 scrollbar-thin">
          {approval.post_title && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Post Title</p>
              <p className="mt-2 break-words text-sm text-gray-800 dark:text-gray-200">{approval.post_title}</p>
            </div>
          )}

          {approval.has_media ? (
            <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>This post includes media. Open the original post if you need the full visual context before approving.</p>
            </div>
          ) : null}

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Original Post Text</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-gray-300">
              {approval.post_body?.trim() || 'No post text was captured for this draft.'}
            </p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Comment text</span>
            <textarea
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              rows={7}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Reviewer notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional notes for context or revision history"
              className="w-full rounded-xl border border-gray-300 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:border-[#E8461E] focus:ring-2 focus:ring-[#E8461E]/20"
            />
          </label>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-800 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 dark:border-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || commentText.trim().length === 0}
            className="rounded-md bg-[#E8461E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#f05c36] disabled:cursor-not-allowed disabled:bg-[#E8461E]/50"
          >
            {isSubmitting ? 'Approving...' : 'Save and approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
