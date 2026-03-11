import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Settings from '../../pages/Settings'
import { renderWithProviders } from '../test-utils'

vi.mock('../../api/settings', () => ({
  settingsApi: {
    getAll: vi.fn().mockResolvedValue({
      data: {
        claude_api_key: 'sk-ant-test-key',
        claude_model_comment: 'claude-sonnet-4-20250514',
        smtp_host: 'smtp.gmail.com',
        smtp_port: '587',
        smtp_username: 'bot@gmail.com',
        smtp_app_password_configured: true,
        smtp_from_name: 'Reddit Bot',
        smtp_from_email: 'bot@example.com',
        email_recipients: 'admin@example.com\nother@example.com',
        email_base_url: 'https://example.com',
        approval_digest_time: '08:00',
        signup_enabled: 'true',
      },
    }),
    update: vi.fn().mockResolvedValue({ data: { message: 'Settings updated' } }),
    testEmail: vi.fn().mockResolvedValue({ data: { message: 'Test email sent to admin@test.com' } }),
    testApi: vi.fn().mockResolvedValue({ data: { message: 'API key works' } }),
  },
}))

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page title', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
  })

  it('shows skeleton while loading', () => {
    renderWithProviders(<Settings />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('displays Claude AI Configuration section', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Claude AI Configuration')).toBeInTheDocument()
    })
  })

  it('displays Email / SMTP Configuration section', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Email / SMTP Configuration')).toBeInTheDocument()
    })
  })

  it('displays General section', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('General')).toBeInTheDocument()
    })
  })

  it('shows configured badge for SMTP password', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Configured')).toBeInTheDocument()
    })
  })

  it('populates form fields from API data', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      const modelInput = screen.getByDisplayValue('claude-sonnet-4-20250514')
      expect(modelInput).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('smtp.gmail.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('bot@gmail.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Reddit Bot')).toBeInTheDocument()
  })

  it('has Test API Connection button', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test api connection/i })).toBeInTheDocument()
    })
  })

  it('has Test Email button', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test email/i })).toBeInTheDocument()
    })
  })

  it('has Save All Settings button', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save all settings/i })).toBeInTheDocument()
    })
  })

  it('shows test email input when clicking Test Email', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test email/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /test email/i }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('recipient@example.com')).toBeInTheDocument()
    })
  })

  it('has signup enabled toggle', async () => {
    renderWithProviders(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Allow User Signups')).toBeInTheDocument()
    })
    const toggle = screen.getByRole('switch')
    expect(toggle).toBeInTheDocument()
  })
})
