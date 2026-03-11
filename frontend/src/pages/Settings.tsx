import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlertTriangle,
  Bot,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Save,
  Send,
  Settings2,
  Shield,
  Zap,
} from 'lucide-react'
import { settingsApi, type TestEmailPayload } from '../api/settings'

interface SettingsData {
  [key: string]: string | boolean | undefined
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const axiosErr = error as {
      response?: { data?: { error?: string; message?: string } }
      message?: string
    }
    if (axiosErr.response?.data?.error) return axiosErr.response.data.error
    if (axiosErr.response?.data?.message) return axiosErr.response.data.message
    if (axiosErr.message) return axiosErr.message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
        checked ? 'bg-[#E8461E]' : 'bg-gray-300 dark:bg-gray-700',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}

function SkeletonSection() {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i}>
            <div className="mb-1.5 h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Settings() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SettingsData>({})
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSmtpPass, setShowSmtpPass] = useState(false)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [showTestEmailInput, setShowTestEmailInput] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [apiTestResult, setApiTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const {
    data: settings,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.getAll()).data as SettingsData,
  })

  useEffect(() => {
    if (settings) {
      setForm((prev) => {
        const merged: SettingsData = { ...settings }
        // Preserve user edits for password fields
        if (prev.smtp_app_password) merged.smtp_app_password = prev.smtp_app_password
        if (prev.claude_api_key !== undefined && prev.claude_api_key !== settings.claude_api_key) {
          merged.claude_api_key = prev.claude_api_key
        }
        return merged
      })
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      return settingsApi.update(data)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    },
  })

  const testApiMutation = useMutation({
    mutationFn: () => settingsApi.testApi(),
    onSuccess: (res) => {
      setApiTestResult({ ok: true, message: res.data?.message || 'API key works!' })
    },
    onError: (err) => {
      setApiTestResult({ ok: false, message: getErrorMessage(err, 'API test failed') })
    },
  })

  const testEmailMutation = useMutation({
    mutationFn: (data: TestEmailPayload) => settingsApi.testEmail(data),
    onSuccess: (res) => {
      setEmailTestResult({ ok: true, message: res.data?.message || 'Test email sent!' })
      setShowTestEmailInput(false)
      setTestEmailTo('')
    },
    onError: (err) => {
      setEmailTestResult({ ok: false, message: getErrorMessage(err, 'Email test failed') })
    },
  })

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    const payload: Record<string, string> = {}
    for (const [key, value] of Object.entries(form)) {
      if (key === 'smtp_app_password_configured') continue
      if (key === 'smtp_app_password' && (!value || String(value).trim() === '')) continue
      payload[key] = String(value ?? '')
    }
    saveMutation.mutate(payload)
  }

  const buildTestEmailPayload = (recipient: string): TestEmailPayload => {
    const payload: TestEmailPayload = {
      smtp_host: String(form.smtp_host ?? ''),
      smtp_port: String(form.smtp_port ?? ''),
      smtp_username: String(form.smtp_username ?? ''),
      smtp_from_name: String(form.smtp_from_name ?? ''),
      smtp_from_email: String(form.smtp_from_email ?? ''),
      email_recipients: recipient,
      email_base_url: String(form.email_base_url ?? ''),
    }

    const pw = form.smtp_app_password
    if (pw && String(pw).trim()) {
      payload.smtp_app_password = String(pw)
    }

    return payload
  }

  const isSmtpConfigured = settings?.smtp_app_password_configured === true

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8461E]/10">
            <Settings2 className="h-5 w-5 text-[#E8461E]" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        </div>
        <SkeletonSection />
        <SkeletonSection />
        <SkeletonSection />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8461E]/10">
            <Settings2 className="h-5 w-5 text-[#E8461E]" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16">
          <AlertTriangle className="mb-3 h-10 w-10 text-red-400" />
          <p className="mb-1 text-sm font-medium text-gray-800 dark:text-gray-200">Failed to load settings</p>
          <p className="mb-4 text-xs text-gray-500">{getErrorMessage(error, 'Unknown error')}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d13d17]"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8461E]/10">
            <Settings2 className="h-5 w-5 text-[#E8461E]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
            <p className="text-sm text-gray-500">Manage API keys, email, and general configuration</p>
          </div>
        </div>
      </div>

      {/* Success Banner */}
      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-300">
          <Check className="h-4 w-4" />
          Settings saved successfully
        </div>
      )}

      {saveMutation.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" />
          {getErrorMessage(saveMutation.error, 'Failed to save settings')}
        </div>
      )}

      {/* Section 1: Claude AI */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="mb-5 flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Claude AI Configuration</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={String(form.claude_api_key ?? '')}
                onChange={(e) => updateField('claude_api_key', e.target.value)}
                placeholder="sk-ant-..."
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 pr-10 font-mono text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Model</label>
            <input
              type="text"
              value={String(form.claude_model_comment ?? '')}
              onChange={(e) => updateField('claude_model_comment', e.target.value)}
              placeholder="claude-sonnet-4-20250514"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setApiTestResult(null)
                testApiMutation.mutate()
              }}
              disabled={testApiMutation.isPending}
              className="flex items-center gap-2 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-sm font-medium text-purple-600 dark:text-purple-300 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
            >
              {testApiMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Test API Connection
            </button>
            {apiTestResult && (
              <span
                className={clsx(
                  'text-xs font-medium',
                  apiTestResult.ok ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {apiTestResult.message}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Email / SMTP */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="mb-5 flex items-center gap-2">
          <Mail className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Email / SMTP Configuration</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">SMTP Host</label>
            <input
              type="text"
              value={String(form.smtp_host ?? '')}
              onChange={(e) => updateField('smtp_host', e.target.value)}
              placeholder="smtp.gmail.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">SMTP Port</label>
            <input
              type="number"
              value={String(form.smtp_port ?? '587')}
              onChange={(e) => updateField('smtp_port', e.target.value)}
              placeholder="587"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">SMTP Username</label>
            <input
              type="text"
              value={String(form.smtp_username ?? '')}
              onChange={(e) => updateField('smtp_username', e.target.value)}
              placeholder="your@gmail.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">
              SMTP App Password
              {isSmtpConfigured && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-300">
                  <Shield className="h-3 w-3" />
                  Configured
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showSmtpPass ? 'text' : 'password'}
                value={String(form.smtp_app_password ?? '')}
                onChange={(e) => updateField('smtp_app_password', e.target.value)}
                placeholder={isSmtpConfigured ? 'Enter new password to change' : 'Enter app password'}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 pr-10 font-mono text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowSmtpPass(!showSmtpPass)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">From Name</label>
            <input
              type="text"
              value={String(form.smtp_from_name ?? '')}
              onChange={(e) => updateField('smtp_from_name', e.target.value)}
              placeholder="Reddit Bot Manager"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">From Email</label>
            <input
              type="text"
              value={String(form.smtp_from_email ?? '')}
              onChange={(e) => updateField('smtp_from_email', e.target.value)}
              placeholder="bot@example.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">
              Email Recipients (one per line)
            </label>
            <textarea
              rows={3}
              value={String(form.email_recipients ?? '')}
              onChange={(e) => updateField('email_recipients', e.target.value)}
              placeholder={"admin@example.com\nother@example.com"}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Base URL</label>
            <input
              type="text"
              value={String(form.email_base_url ?? '')}
              onChange={(e) => updateField('email_base_url', e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-500 dark:text-gray-400">Approval Digest Time</label>
            <input
              type="time"
              value={String(form.approval_digest_time ?? '08:00')}
              onChange={(e) => updateField('approval_digest_time', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 transition-colors focus:border-[#E8461E] focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          {!showTestEmailInput ? (
            <button
              type="button"
              onClick={() => setShowTestEmailInput(true)}
              className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-300 transition-colors hover:bg-blue-500/20"
            >
              <Send className="h-4 w-4" />
              Test Email
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="recipient@example.com"
                className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-200 placeholder-gray-600 focus:border-[#E8461E] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (testEmailTo.trim()) {
                    setEmailTestResult(null)
                    testEmailMutation.mutate(buildTestEmailPayload(testEmailTo.trim()))
                  }
                }}
                disabled={testEmailMutation.isPending || !testEmailTo.trim()}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {testEmailMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTestEmailInput(false)
                  setTestEmailTo('')
                }}
                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
          {emailTestResult && (
            <span
              className={clsx(
                'text-xs font-medium',
                emailTestResult.ok ? 'text-emerald-400' : 'text-red-400'
              )}
            >
              {emailTestResult.message}
            </span>
          )}
        </div>
      </div>

      {/* Section 3: General */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <div className="mb-5 flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">General</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Allow User Signups</p>
              <p className="text-xs text-gray-500">Enable or disable new user registration</p>
            </div>
            <ToggleSwitch
              checked={String(form.signup_enabled ?? 'false').toLowerCase() === 'true'}
              onChange={(val) => updateField('signup_enabled', val ? 'true' : 'false')}
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 rounded-xl bg-[#E8461E] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#d13d17] disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save All Settings
        </button>
      </div>
    </div>
  )
}
