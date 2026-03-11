import { useMutation, useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Moon, Sun } from 'lucide-react'
import { authApi } from '../api/auth'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'

type AuthMode = 'login' | 'signup'

interface LoginFormValues {
  identity: string
  password: string
}

interface SignupFormValues {
  username: string
  email: string
  password: string
  confirmPassword: string
}

type FormErrors = Partial<Record<'identity' | 'username' | 'email' | 'password' | 'confirmPassword', string>>

const loginInitialValues: LoginFormValues = {
  identity: '',
  password: '',
}

const signupInitialValues: SignupFormValues = {
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error

    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function validateLogin(values: LoginFormValues) {
  const errors: FormErrors = {}

  if (!values.identity.trim()) {
    errors.identity = 'Enter your username or email.'
  }

  if (!values.password) {
    errors.password = 'Enter your password.'
  }

  return errors
}

function validateSignup(values: SignupFormValues) {
  const errors: FormErrors = {}

  if (!values.username.trim()) {
    errors.username = 'Choose a username.'
  }

  if (!values.email.trim()) {
    errors.email = 'Enter your email address.'
  } else if (!/^\S+@\S+\.\S+$/.test(values.email)) {
    errors.email = 'Enter a valid email address.'
  }

  if (!values.password) {
    errors.password = 'Create a password.'
  } else if (values.password.length < 6) {
    errors.password = 'Password must be at least 6 characters.'
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = 'Confirm your password.'
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.'
  }

  return errors
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null
  }

  return <p className="mt-2 text-sm text-red-500 dark:text-red-300">{message}</p>
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useThemeStore()
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="absolute right-4 top-4 z-10 rounded-xl bg-white dark:bg-gray-800 p-2 text-gray-600 dark:text-gray-300 shadow-md border border-gray-200 dark:border-gray-700 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading, setAuth, setLoading } = useAuthStore()
  const [mode, setMode] = useState<AuthMode>('login')
  const [serverError, setServerError] = useState('')
  const [loginValues, setLoginValues] = useState<LoginFormValues>(loginInitialValues)
  const [signupValues, setSignupValues] = useState<SignupFormValues>(signupInitialValues)
  const [loginErrors, setLoginErrors] = useState<FormErrors>({})
  const [signupErrors, setSignupErrors] = useState<FormErrors>({})

  const statusQuery = useQuery({
    queryKey: ['auth', 'status', 'login-page'],
    queryFn: async () => {
      const response = await authApi.getStatus()
      return response.data
    },
  })

  useEffect(() => {
    if (!statusQuery.isFetching) {
      setLoading(false)
    }
  }, [setLoading, statusQuery.isFetching])

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  useEffect(() => {
    if (!statusQuery.data) {
      return
    }

    const shouldAutoShowSignup = statusQuery.data.bootstrap_mode || (statusQuery.data.signup_enabled && !statusQuery.data.auth_enabled)

    if (shouldAutoShowSignup) {
      setMode('signup')
    }
  }, [statusQuery.data])

  const signupEnabled = statusQuery.data?.signup_enabled ?? false
  const authEnabled = statusQuery.data?.auth_enabled ?? true
  const bootstrapMode = useMemo(
    () => Boolean(statusQuery.data?.bootstrap_mode),
    [statusQuery.data],
  )

  const loginMutation = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const response = await authApi.login(values.identity.trim(), values.password)
      return response.data
    },
    onSuccess: ({ token, user }) => {
      setAuth(token, user)
      navigate('/', { replace: true })
    },
    onError: (error) => {
      setServerError(getApiErrorMessage(error, 'Unable to sign in right now.'))
    },
  })

  const signupMutation = useMutation({
    mutationFn: async (values: SignupFormValues) => {
      const response = await authApi.signup(
        values.username.trim(),
        values.email.trim(),
        values.password,
        values.confirmPassword,
      )

      return response.data
    },
    onSuccess: ({ token, user }) => {
      setAuth(token, user)
      navigate('/', { replace: true })
    },
    onError: (error) => {
      setServerError(getApiErrorMessage(error, 'Unable to create your account right now.'))
    },
  })

  const isSubmitting = loginMutation.isPending || signupMutation.isPending

  const introTitle = bootstrapMode && mode === 'signup' ? 'Create the first admin account' : 'Sign in to continue'
  const introCopy =
    'Review campaign approvals, manage automation, and keep the brand workflow available to trusted reviewers across your local network and Tailscale access.'
  const cardTitle = mode === 'signup' ? 'Create account' : 'Welcome back'
  const cardCopy =
    mode === 'signup' && bootstrapMode
      ? 'Set up the first admin account to unlock the dashboard.'
      : mode === 'signup'
        ? 'Create your access and get into the dashboard in seconds.'
        : 'Use your username or email to access the dashboard.'

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode)
    setServerError('')
    setLoginErrors({})
    setSignupErrors({})
  }

  const handleLoginChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target

    setLoginValues((current) => ({ ...current, [name]: value }))
    setLoginErrors((current) => ({ ...current, [name]: undefined }))
    setServerError('')
  }

  const handleSignupChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target

    setSignupValues((current) => ({ ...current, [name]: value }))
    setSignupErrors((current) => ({ ...current, [name]: undefined }))
    setServerError('')
  }

  const handleLoginSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setServerError('')

    const errors = validateLogin(loginValues)
    setLoginErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    loginMutation.mutate(loginValues)
  }

  const handleSignupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setServerError('')

    const errors = validateSignup(signupValues)
    setSignupErrors(errors)

    if (Object.keys(errors).length > 0) {
      return
    }

    signupMutation.mutate(signupValues)
  }

  if (isAuthenticated && !isLoading) {
    return <Navigate to="/" replace />
  }

  if (statusQuery.isLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-6 text-gray-900 dark:text-gray-100">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-5 py-4 shadow-2xl shadow-black/10 dark:shadow-black/20 backdrop-blur">
          <Spinner />
          <span className="text-sm text-gray-700 dark:text-gray-300">Loading authentication...</span>
        </div>
      </div>
    )
  }

  if (statusQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-6 text-gray-900 dark:text-gray-100">
        <div className="w-full max-w-md rounded-3xl border border-red-500/20 bg-red-500/10 p-6 shadow-2xl shadow-black/10 dark:shadow-black/20">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Unable to load authentication</h1>
          <p className="mt-3 text-sm leading-6 text-red-600 dark:text-red-100/80">
            {getApiErrorMessage(statusQuery.error, 'We could not verify the login settings. Please try again.')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <ThemeToggleButton />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,440px)]">
          <section className="relative overflow-hidden rounded-[28px] border border-orange-200/70 dark:border-white/10 bg-gradient-to-br from-orange-50 via-white to-amber-100/80 dark:from-gray-900 dark:via-gray-950 dark:to-black p-8 shadow-2xl shadow-orange-200/40 dark:shadow-black/30 lg:p-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(232,70,30,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.2),transparent_32%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(232,70,30,0.24),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%)]" />
            <div className="relative flex h-full flex-col justify-between gap-10">
              <div>
                <div className="inline-flex items-center rounded-full border border-orange-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[#9a3412] shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                  Reddit Automation
                </div>
                <h1 className="mt-6 max-w-xl text-4xl font-semibold leading-tight text-gray-950 dark:text-white sm:text-5xl">
                  {introTitle}
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-gray-700 dark:text-gray-300 sm:text-lg">{introCopy}</p>
              </div>

              <div className="grid gap-4">
                {[
                  'Approval workflows stay restricted to authenticated reviewers.',
                  'The first account automatically becomes the admin for the whole system.',
                  'Use the network-friendly base URL later for email review links.',
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-orange-200/80 bg-white/75 px-4 py-4 text-sm leading-6 text-gray-700 shadow-sm backdrop-blur-sm transition duration-300 hover:border-[#E8461E]/40 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/[0.07]"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-gray-900/90 p-6 shadow-2xl shadow-black/10 dark:shadow-black/30 backdrop-blur sm:p-8">
            <div className="mb-8 flex rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-gray-950/80 p-1">
              <button
                type="button"
                onClick={() => handleModeChange('login')}
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  mode === 'login'
                    ? 'bg-[#E8461E] text-white shadow-lg shadow-[#E8461E]/20'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => signupEnabled && handleModeChange('signup')}
                disabled={!signupEnabled}
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  mode === 'signup'
                    ? 'bg-[#E8461E] text-white shadow-lg shadow-[#E8461E]/20'
                    : signupEnabled
                      ? 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      : 'cursor-not-allowed text-gray-400 dark:text-gray-600'
                }`}
              >
                Create account
              </button>
            </div>

            <div className="min-h-[520px] transition-all duration-300 ease-out sm:min-h-[500px]">
              <div className="mb-6 transition-all duration-300">
                <h2 className="text-3xl font-semibold text-gray-900 dark:text-white">{cardTitle}</h2>
                <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">{cardCopy}</p>
              </div>

              {!authEnabled && (
                <div className="mb-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
                  Authentication is currently open. Create the first account to secure the dashboard.
                </div>
              )}

              {serverError && (
                <div className="mb-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-600 dark:text-red-200">
                  {serverError}
                </div>
              )}

              {mode === 'login' ? (
                <form key="login" onSubmit={handleLoginSubmit} className="space-y-5 transition-all duration-300 ease-out">
                  <div>
                    <label htmlFor="identity" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                      Username or email
                    </label>
                    <input
                      id="identity"
                      name="identity"
                      type="text"
                      autoComplete="username"
                      value={loginValues.identity}
                      onChange={handleLoginChange}
                      className="w-full rounded-2xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
                      placeholder="you@example.com"
                    />
                    <FieldError message={loginErrors.identity} />
                  </div>

                  <div>
                    <label htmlFor="password" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                      Password
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={loginValues.password}
                      onChange={handleLoginChange}
                      className="w-full rounded-2xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
                      placeholder="Enter your password"
                    />
                    <FieldError message={loginErrors.password} />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E8461E] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {loginMutation.isPending ? <Spinner /> : null}
                    {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
                  </button>
                </form>
              ) : (
                <form key="signup" onSubmit={handleSignupSubmit} className="space-y-5 transition-all duration-300 ease-out">
                  <div>
                    <label htmlFor="username" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                      Username
                    </label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      value={signupValues.username}
                      onChange={handleSignupChange}
                      className="w-full rounded-2xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
                      placeholder="Choose a username"
                    />
                    <FieldError message={signupErrors.username} />
                  </div>

                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={signupValues.email}
                      onChange={handleSignupChange}
                      className="w-full rounded-2xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
                      placeholder="you@example.com"
                    />
                    <FieldError message={signupErrors.email} />
                  </div>

                  <div>
                    <label htmlFor="signup-password" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                      Password
                    </label>
                    <input
                      id="signup-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      value={signupValues.password}
                      onChange={handleSignupChange}
                      className="w-full rounded-2xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
                      placeholder="Create a password"
                    />
                    <FieldError message={signupErrors.password} />
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
                      Confirm password
                    </label>
                    <input
                      id="confirm-password"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={signupValues.confirmPassword}
                      onChange={handleSignupChange}
                      className="w-full rounded-2xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
                      placeholder="Repeat your password"
                    />
                    <FieldError message={signupErrors.confirmPassword} />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#E8461E] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {signupMutation.isPending ? <Spinner /> : null}
                    {signupMutation.isPending ? 'Creating account...' : 'Create account'}
                  </button>
                </form>
              )}

              <div className="mt-6 flex items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
                {mode === 'signup' ? (
                  <>
                    <span>Already have an account?</span>
                    <button
                      type="button"
                      onClick={() => handleModeChange('login')}
                      className="font-semibold text-[#E8461E] transition hover:text-[#ff6a45]"
                    >
                      Sign in
                    </button>
                  </>
                ) : signupEnabled ? (
                  <>
                    <span>Need access?</span>
                    <button
                      type="button"
                      onClick={() => handleModeChange('signup')}
                      className="font-semibold text-[#E8461E] transition hover:text-[#ff6a45]"
                    >
                      Create account
                    </button>
                  </>
                ) : (
                  <>
                    <span>Sign-up is currently disabled.</span>
                    <span className="text-gray-400 dark:text-gray-600">Invite only</span>
                  </>
                )}
              </div>

              <p className="mt-4 text-xs leading-6 text-gray-500 dark:text-gray-400">
                {!signupEnabled && !bootstrapMode
                  ? 'Ask an admin to enable sign-up or create your reviewer account.'
                  : bootstrapMode
                    ? 'This first account will be created as an admin automatically.'
                    : 'Only authorized reviewers should have access to this app.'}
              </p>

              <div className="mt-8 text-center text-xs text-gray-400 dark:text-gray-600">
                <Link to="/login" className="transition hover:text-gray-600 dark:hover:text-gray-400">
                  Secure access for your Reddit automation workspace
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
