import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Cookie,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { accountsApi, type Account } from '../api/accounts'
import apiClient from '../api/client'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Modal from '../components/ui/Modal'

const ACCOUNTS_QUERY_KEY = ['accounts']

type AccountStatus = 'idle' | 'running' | 'error' | 'launching'
type AccountRole = 'customer' | 'employee' | 'inactive'

interface AccountFormState {
  username: string
  password: string
}

interface EditAccountFormState {
  personality: string
  persona_name: string
  interests: string
  role: '' | AccountRole
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function getStatusBadge(status: string) {
  const normalizedStatus = status.toLowerCase() as AccountStatus | string

  switch (normalizedStatus) {
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

function getRoleBadge(role: string | null) {
  switch (role) {
    case 'customer':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300'
    case 'employee':
      return 'border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300'
    case 'inactive':
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
    default:
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
  }
}

function formatLabel(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback
  }

  return value
}

function getInterestTags(interests: string | null | undefined) {
  if (!interests) {
    return []
  }

  return interests
    .split(',')
    .map((interest) => interest.trim())
    .filter(Boolean)
}

function mergeUniqueTags(existingTags: string[], incomingTags: string[]) {
  const seen = new Set(existingTags.map((tag) => tag.toLowerCase()))
  const mergedTags = [...existingTags]

  incomingTags.forEach((tag) => {
    const normalizedTag = tag.trim()
    const normalizedKey = normalizedTag.toLowerCase()

    if (!normalizedTag || seen.has(normalizedKey)) {
      return
    }

    seen.add(normalizedKey)
    mergedTags.push(normalizedTag)
  })

  return mergedTags
}

export default function Accounts() {
  const queryClient = useQueryClient()
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const editingAccountIdRef = useRef<number | null>(null)
  const editSessionTokenRef = useRef(0)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isBulkOpen, setIsBulkOpen] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  const [accountToEdit, setAccountToEdit] = useState<Account | null>(null)
  const [accountToDeleteCookies, setAccountToDeleteCookies] = useState<Account | null>(null)
  const [isDeleteAllCookiesOpen, setIsDeleteAllCookiesOpen] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountFormState>({ username: '', password: '' })
  const [bulkText, setBulkText] = useState('')
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [generateInterestsError, setGenerateInterestsError] = useState<string | null>(null)
  const [activeGenerateSessionToken, setActiveGenerateSessionToken] = useState<number | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [editForm, setEditForm] = useState<EditAccountFormState>({
    personality: '',
    persona_name: '',
    interests: '',
    role: '',
  })

  const editInterestTags = getInterestTags(editForm.interests)

  const syncInterestTags = (tags: string[]) => {
    setEditForm((current) => ({ ...current, interests: tags.join(', ') }))
  }

  const focusTagInput = () => {
    window.requestAnimationFrame(() => {
      tagInputRef.current?.focus()
    })
  }

  const addInterestTag = (value: string) => {
    const nextTags = mergeUniqueTags(editInterestTags, value.split(','))

    if (nextTags.length === editInterestTags.length) {
      setTagInput('')
      focusTagInput()
      return
    }

    syncInterestTags(nextTags)
    setTagInput('')
    focusTagInput()
  }

  const removeInterestTag = (tagIndexToRemove: number) => {
    syncInterestTags(editInterestTags.filter((_, index) => index !== tagIndexToRemove))
    focusTagInput()
  }

  const moveInterestTag = (tagIndex: number, direction: 'left' | 'right') => {
    const nextIndex = direction === 'left' ? tagIndex - 1 : tagIndex + 1

    if (nextIndex < 0 || nextIndex >= editInterestTags.length) {
      return
    }

    const nextTags = [...editInterestTags]
    const [movedTag] = nextTags.splice(tagIndex, 1)
    nextTags.splice(nextIndex, 0, movedTag)
    syncInterestTags(nextTags)
    focusTagInput()
  }

  const flushPendingInterestInput = () => {
    const nextTags = mergeUniqueTags(editInterestTags, tagInput.split(','))

    syncInterestTags(nextTags)
    setTagInput('')

    return nextTags
  }

  const startEditSession = (account: Account) => {
    editSessionTokenRef.current += 1
    editingAccountIdRef.current = account.id
    setActiveGenerateSessionToken(null)
    setAccountToEdit(account)
    setGenerateInterestsError(null)
    setTagInput('')
    setEditForm({
      personality: account.personality ?? '',
      persona_name: account.persona_name ?? '',
      interests: getInterestTags(account.interests).join(', '),
      role: account.role === 'customer' || account.role === 'employee' || account.role === 'inactive' ? account.role : '',
    })
  }

  const closeEditSession = () => {
    editSessionTokenRef.current += 1
    editingAccountIdRef.current = null
    setActiveGenerateSessionToken(null)
    setAccountToEdit(null)
    setGenerateInterestsError(null)
    setTagInput('')
  }

  const { data: accounts = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ACCOUNTS_QUERY_KEY,
    queryFn: async () => (await accountsApi.getAll()).data,
  })

  const invalidateAccounts = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['jobs'] }),
    ])
  }

  const createMutation = useMutation({
    mutationFn: (data: AccountFormState) => accountsApi.create(data),
    onSuccess: async () => {
      await invalidateAccounts()
      setIsAddOpen(false)
      setAccountForm({ username: '', password: '' })
    },
  })

  const bulkImportMutation = useMutation({
    mutationFn: async (text: string) => {
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      if (lines.length === 0) {
        throw new Error('Add at least one account line before importing.')
      }

      return apiClient.post('/api/accounts/bulk', { lines })
    },
    onSuccess: async () => {
      await invalidateAccounts()
      setIsBulkOpen(false)
      setBulkText('')
      setBulkError(null)
    },
    onError: (mutationError) => {
      setBulkError(getErrorMessage(mutationError, 'Bulk import failed.'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Account> }) => accountsApi.update(id, data),
    onSuccess: async () => {
      await invalidateAccounts()
      setAccountToEdit(null)
      editingAccountIdRef.current = null
      setGenerateInterestsError(null)
    },
  })

  const generateInterestsMutation = useMutation({
    mutationFn: ({ accountId }: { accountId: number; sessionToken: number }) => accountsApi.generateInterests(accountId),
    onSuccess: (response, { accountId, sessionToken }) => {
      if (editingAccountIdRef.current !== accountId || editSessionTokenRef.current !== sessionToken) {
        return
      }

      setGenerateInterestsError(null)

      const tags = Array.isArray(response.data?.tags)
        ? response.data.tags
            .map((tag: string) => tag.trim())
            .filter(Boolean)
        : []

      if (tags.length === 0) {
        setGenerateInterestsError('AI did not return any interests. Try again.')
        return
      }

      setEditForm((current) => ({
        ...current,
        interests: mergeUniqueTags(getInterestTags(current.interests), tags).join(', '),
      }))
      focusTagInput()
    },
    onError: (mutationError, { accountId, sessionToken }) => {
      if (editingAccountIdRef.current !== accountId || editSessionTokenRef.current !== sessionToken) {
        return
      }

      setGenerateInterestsError(getErrorMessage(mutationError, 'Failed to generate interests.'))
    },
    onSettled: (_data, _error, { sessionToken }) => {
      setActiveGenerateSessionToken((current) => (current === sessionToken ? null : current))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => accountsApi.delete(id),
    onSuccess: async () => {
      await invalidateAccounts()
      setAccountToDelete(null)
    },
  })

  const deleteCookiesMutation = useMutation({
    mutationFn: (id: number) => accountsApi.deleteCookies(id),
    onSuccess: async () => {
      await invalidateAccounts()
      setAccountToDeleteCookies(null)
    },
  })

  const deleteAllCookiesMutation = useMutation({
    mutationFn: () => accountsApi.deleteAllCookies(),
    onSuccess: async () => {
      await invalidateAccounts()
      setIsDeleteAllCookiesOpen(false)
    },
  })

  const launchMutation = useMutation({
    mutationFn: (id: number) => accountsApi.launch(id),
    onSuccess: invalidateAccounts,
  })

  const stopMutation = useMutation({
    mutationFn: (id: number) => accountsApi.stop(id),
    onSuccess: invalidateAccounts,
  })

  const launchAccountId = launchMutation.variables
  const stopAccountId = stopMutation.variables

  const runningCount = useMemo(
    () => accounts.filter((account) => account.status.toLowerCase() === 'running').length,
    [accounts],
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl animate-pulse space-y-6">
          <div className="h-20 rounded-2xl bg-gray-100 dark:bg-gray-900" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-64 rounded-2xl bg-gray-100 dark:bg-gray-900" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4 py-6 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-lg rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center shadow-2xl shadow-black/10 dark:shadow-black/30">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-500 dark:text-red-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-gray-900 dark:text-white">Failed to load accounts</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {getErrorMessage(error, 'The accounts request failed. Retry to load the latest account state.')}
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
        <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-[#E8461E]/10 p-3 text-[#ff8c6d]">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Accounts</h1>
                <span className="rounded-full border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                  {accounts.length} accounts
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                <span className="text-emerald-400">{runningCount} running</span>
                <span>{accounts.length - runningCount} idle or stopped</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18]"
            >
              <Plus className="h-4 w-4" />
              Add Account
            </button>
              <button
              type="button"
              onClick={() => setIsBulkOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <Upload className="h-4 w-4" />
              Bulk Import
            </button>
            <button
              type="button"
              onClick={() => setIsDeleteAllCookiesOpen(true)}
              disabled={accounts.length === 0 || deleteAllCookiesMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-red-300 dark:border-red-800/50 bg-red-100 dark:bg-red-900/20 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition hover:bg-red-200 dark:hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleteAllCookiesMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Cookie className="h-4 w-4" />
              )}
              Delete All Cookies
            </button>
          </div>
        </section>

        {accounts.length === 0 ? (
          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900/50 p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <Users className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">No accounts added yet</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Create a Reddit account manually or import a list to start browser sessions.</p>
          </section>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => {
              const isLaunching = launchMutation.isPending && launchAccountId === account.id
              const isStopping = stopMutation.isPending && stopAccountId === account.id
              const isRunning = account.status.toLowerCase() === 'running'
              const interestTags = getInterestTags(account.interests)
              const visibleInterestTags = interestTags.slice(0, 6)
              const remainingInterestCount = interestTags.length - visibleInterestTags.length

              return (
                <article key={account.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-semibold text-gray-900 dark:text-white">{account.username}</h2>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{formatLabel(account.persona_name, 'No persona assigned')}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={clsx('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium capitalize', getStatusBadge(account.status))}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {account.status}
                      </span>
                      <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize', getRoleBadge(account.role))}>
                        {account.role ?? 'unassigned'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-3 py-2.5">
                      <span className="text-gray-500">Proxy</span>
                      <span className={clsx('truncate text-right', account.proxy_address ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500')}>
                        {account.proxy_address ?? 'No proxy'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-3 py-2.5">
                      <span className="text-gray-500">Cookies</span>
                      <span className={clsx('inline-flex items-center gap-2 text-sm', account.has_cookies ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300')}>
                        <span className={clsx('h-2 w-2 rounded-full', account.has_cookies ? 'bg-emerald-400' : 'bg-red-400')} />
                        {account.has_cookies ? 'Stored' : 'Missing'}
                      </span>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950/70 px-3 py-2.5">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Interests</p>
                      {interestTags.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 break-words">
                          {visibleInterestTags.map((tag, index) => (
                            <span
                              key={`${account.id}-${tag}-${index}`}
                              className="inline-flex rounded-full bg-[#E8461E]/10 px-2 py-0.5 text-xs font-medium text-[#E8461E]"
                            >
                              {tag}
                            </span>
                          ))}
                          {remainingInterestCount > 0 ? (
                            <span className="inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              +{remainingInterestCount} more
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">No interests saved.</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => launchMutation.mutate(account.id)}
                      disabled={isRunning || isLaunching || isStopping}
                      className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                      Launch
                    </button>

                    {isRunning ? (
                      <button
                        type="button"
                        onClick={() => stopMutation.mutate(account.id)}
                        disabled={isStopping}
                        className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isStopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                        Stop
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => startEditSession(account)}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => setAccountToDelete(account)}
                      className="inline-flex items-center gap-2 rounded-md border border-red-300 dark:border-red-800/50 bg-red-100 dark:bg-red-900/20 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition hover:bg-red-200 dark:hover:bg-red-900/40"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>

                    {account.has_cookies ? (
                      <button
                        type="button"
                        onClick={() => setAccountToDeleteCookies(account)}
                        className="inline-flex items-center gap-2 rounded-md border border-amber-300 dark:border-amber-800/50 bg-amber-100 dark:bg-amber-900/20 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-200 transition hover:bg-amber-200 dark:hover:bg-amber-900/35"
                      >
                        <Cookie className="h-4 w-4" />
                        Delete Cookies
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </section>
        )}

        <Modal
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          title="Add Account"
          size="md"
          footer={(
            <>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="add-account-form"
                disabled={createMutation.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Add Account
              </button>
            </>
          )}
        >
          <form
            id="add-account-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              createMutation.mutate(accountForm)
            }}
          >
            <div>
              <label htmlFor="account-username" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Username
              </label>
              <input
                id="account-username"
                value={accountForm.username}
                onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
                placeholder="reddit_username"
                required
              />
            </div>
            <div>
              <label htmlFor="account-password" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Password
              </label>
              <input
                id="account-password"
                type="password"
                value={accountForm.password}
                onChange={(event) => setAccountForm((current) => ({ ...current, password: event.target.value }))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
                placeholder="Password"
                required
              />
            </div>
          </form>
        </Modal>

        <Modal
          isOpen={isBulkOpen}
          onClose={() => setIsBulkOpen(false)}
          title="Bulk Import Accounts"
          size="lg"
          footer={(
            <>
              <button
                type="button"
                onClick={() => setIsBulkOpen(false)}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="bulk-accounts-form"
                disabled={bulkImportMutation.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bulkImportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import
              </button>
            </>
          )}
        >
          <form
            id="bulk-accounts-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setBulkError(null)
              bulkImportMutation.mutate(bulkText)
            }}
          >
            <div>
              <label htmlFor="bulk-accounts" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Accounts
              </label>
              <textarea
                id="bulk-accounts"
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                rows={10}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
                placeholder={'username:password\nusername|password'}
              />
              <p className="mt-2 text-xs text-gray-500">Use one account per line in `username:password` or `username|password` format.</p>
              {bulkError ? <p className="mt-2 text-sm text-red-500 dark:text-red-300">{bulkError}</p> : null}
            </div>
          </form>
        </Modal>

        <Modal
          isOpen={!!accountToEdit}
          onClose={closeEditSession}
          title="Edit Account"
          size="lg"
          footer={(
            <>
              <button
                type="button"
                onClick={closeEditSession}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="edit-account-form"
                disabled={updateMutation.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save Changes
              </button>
            </>
          )}
        >
          <form
            id="edit-account-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()

              if (!accountToEdit) {
                return
              }

              const nextInterestTags = flushPendingInterestInput()

              updateMutation.mutate({
                id: accountToEdit.id,
                data: {
                  personality: editForm.personality || null,
                  persona_name: editForm.persona_name || null,
                  interests: nextInterestTags.join(', ') || null,
                  role: editForm.role || null,
                },
              })
            }}
          >
            <div>
              <label htmlFor="edit-persona-name" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Persona Name
              </label>
              <input
                id="edit-persona-name"
                value={editForm.persona_name}
                onChange={(event) => setEditForm((current) => ({ ...current, persona_name: event.target.value }))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
                placeholder="Warm helper persona"
              />
            </div>
            <div>
              <label htmlFor="edit-role" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Role
              </label>
              <select
                id="edit-role"
                value={editForm.role}
                onChange={(event) => setEditForm((current) => ({ ...current, role: event.target.value as EditAccountFormState['role'] }))}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
              >
                <option value="">No role</option>
                <option value="customer">Customer</option>
                <option value="employee">Employee</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-personality" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                Personality
              </label>
              <textarea
                id="edit-personality"
                value={editForm.personality}
                onChange={(event) => setEditForm((current) => ({ ...current, personality: event.target.value }))}
                rows={4}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none transition focus:border-[#E8461E]"
                placeholder="Describe tone, style, and posting behavior"
              />
            </div>
            <div>
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label htmlFor="edit-interests-input" className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                  Interests
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (!accountToEdit) {
                      return
                    }

                    const sessionToken = editSessionTokenRef.current
                    flushPendingInterestInput()
                    setActiveGenerateSessionToken(sessionToken)
                    setGenerateInterestsError(null)
                    generateInterestsMutation.mutate({ accountId: accountToEdit.id, sessionToken })
                  }}
                  disabled={!accountToEdit || activeGenerateSessionToken === editSessionTokenRef.current}
                  className="inline-flex items-center justify-center gap-2 self-start rounded-md border border-[#E8461E]/20 bg-[#E8461E]/10 px-3 py-2 text-sm font-medium text-[#E8461E] transition hover:bg-[#E8461E]/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {activeGenerateSessionToken === editSessionTokenRef.current ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate with AI
                </button>
              </div>
              <div
                className="rounded-md border border-gray-300 bg-white px-3 py-3 text-sm text-gray-900 transition focus-within:border-[#E8461E] focus-within:ring-2 focus-within:ring-[#E8461E]/15 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                onClick={() => tagInputRef.current?.focus()}
              >
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Interests run from left to right. The first one is used next, then it moves to the end after a successful search or comment.
                </p>
                {editInterestTags.length > 0 ? (
                  <div className="mt-3 max-h-[160px] overflow-y-auto scrollbar-thin flex flex-wrap gap-2 pr-1">
                    {editInterestTags.map((tag, index) => (
                      <span
                        key={`edit-interest-${tag}-${index}`}
                        className="inline-flex items-center gap-2 rounded-full border border-[#E8461E]/20 bg-[#E8461E]/10 px-2 py-1 text-sm text-[#E8461E]"
                      >
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/80 px-1 text-[11px] font-semibold text-[#E8461E] dark:bg-gray-900/80">
                          {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            moveInterestTag(index, 'left')
                          }}
                          disabled={index === 0}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#E8461E]/70 transition hover:bg-[#E8461E]/15 hover:text-[#E8461E] disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`Move ${tag} earlier`}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span>{tag}</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            moveInterestTag(index, 'right')
                          }}
                          disabled={index === editInterestTags.length - 1}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#E8461E]/70 transition hover:bg-[#E8461E]/15 hover:text-[#E8461E] disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`Move ${tag} later`}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeInterestTag(index)
                          }}
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[#E8461E]/70 transition hover:bg-[#E8461E]/15 hover:text-[#E8461E]"
                          aria-label={`Remove ${tag}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <input
                  id="edit-interests-input"
                  ref={tagInputRef}
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                      event.preventDefault()
                      addInterestTag(tagInput)
                      return
                    }

                    if (event.key === 'Backspace' && !tagInput.trim() && editInterestTags.length > 0) {
                      event.preventDefault()
                      syncInterestTags(editInterestTags.slice(0, -1))
                      focusTagInput()
                    }
                  }}
                  className="mt-3 w-full border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
                  placeholder="Type an interest and press Enter..."
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Add interests manually, use the arrows to set the order, then use AI to append more tags based on this account&apos;s personality.
              </p>
              {generateInterestsError ? <p className="mt-2 text-sm text-red-500 dark:text-red-300">{generateInterestsError}</p> : null}
            </div>
          </form>
        </Modal>

        <ConfirmDialog
          isOpen={!!accountToDelete}
          onClose={() => setAccountToDelete(null)}
          onConfirm={() => {
            if (accountToDelete) {
              deleteMutation.mutate(accountToDelete.id)
            }
          }}
          title="Delete Account"
          message={`Delete ${accountToDelete?.username ?? 'this account'} permanently? This also removes its saved browser session data.`}
          confirmLabel="Delete"
          variant="danger"
        />

        <ConfirmDialog
          isOpen={!!accountToDeleteCookies}
          onClose={() => setAccountToDeleteCookies(null)}
          onConfirm={() => {
            if (accountToDeleteCookies) {
              deleteCookiesMutation.mutate(accountToDeleteCookies.id)
            }
          }}
          title="Delete Cookies"
          message={`Remove saved cookies for ${accountToDeleteCookies?.username ?? 'this account'}? The next launch may require a fresh login.`}
          confirmLabel="Delete Cookies"
          variant="warning"
        />

        <ConfirmDialog
          isOpen={isDeleteAllCookiesOpen}
          onClose={() => setIsDeleteAllCookiesOpen(false)}
          onConfirm={() => deleteAllCookiesMutation.mutate()}
          title="Delete All Cookies"
          message={`Delete cookies for all ${accounts.length} accounts? This cannot be undone.`}
          confirmLabel="Delete All"
          variant="danger"
        />
      </div>
    </div>
  )
}
