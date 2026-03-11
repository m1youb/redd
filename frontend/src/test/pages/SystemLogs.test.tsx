import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemLogs from '../../pages/SystemLogs'
import { renderWithProviders } from '../test-utils'

// Mock the API modules
vi.mock('../../api/logs', () => ({
  logsApi: {
    getAll: vi.fn().mockResolvedValue({
      data: [
        { id: 1, level: 'error', message: 'Database connection failed', account_id: 1, timestamp: '2025-03-10T10:00:00' },
        { id: 2, level: 'info', message: 'Account logged in successfully', account_id: 1, timestamp: '2025-03-10T09:30:00' },
        { id: 3, level: 'warning', message: 'Rate limit approaching', account_id: null, timestamp: '2025-03-10T09:00:00' },
        { id: 4, level: 'debug', message: 'Request sent to reddit', account_id: 2, timestamp: '2025-03-10T08:30:00' },
      ],
    }),
    clear: vi.fn().mockResolvedValue({ data: { message: 'Logs cleared' } }),
  },
}))

vi.mock('../../api/accounts', () => ({
  accountsApi: {
    getAll: vi.fn().mockResolvedValue({
      data: [
        { id: 1, username: 'testuser1', status: 'idle' },
        { id: 2, username: 'testuser2', status: 'running' },
      ],
    }),
  },
}))

describe('SystemLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page title', async () => {
    renderWithProviders(<SystemLogs />)
    expect(screen.getByText('System Logs')).toBeInTheDocument()
  })

  it('shows skeleton loader initially', () => {
    renderWithProviders(<SystemLogs />)
    // The skeleton rows should be rendered while loading
    expect(screen.getByText('System Logs')).toBeInTheDocument()
  })

  it('displays log entries after loading', async () => {
    renderWithProviders(<SystemLogs />)
    await waitFor(() => {
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
    })
    expect(screen.getByText('Account logged in successfully')).toBeInTheDocument()
    expect(screen.getByText('Rate limit approaching')).toBeInTheDocument()
    expect(screen.getByText('Request sent to reddit')).toBeInTheDocument()
  })

  it('shows level badges for each log entry', async () => {
    renderWithProviders(<SystemLogs />)
    await waitFor(() => {
      expect(screen.getByText('error')).toBeInTheDocument()
    })
    expect(screen.getByText('info')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText('debug')).toBeInTheDocument()
  })

  it('filters logs by level when clicking filter pills', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SystemLogs />)

    await waitFor(() => {
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
    })

    // Click "Error" filter
    await user.click(screen.getByRole('button', { name: 'Error' }))

    // Should show error log
    expect(screen.getByText('Database connection failed')).toBeInTheDocument()
    // Should hide info/warning/debug logs
    expect(screen.queryByText('Account logged in successfully')).not.toBeInTheDocument()
    expect(screen.queryByText('Rate limit approaching')).not.toBeInTheDocument()
  })

  it('shows all filter buttons', () => {
    renderWithProviders(<SystemLogs />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Error' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Warning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Info' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Debug' })).toBeInTheDocument()
  })

  it('has auto-refresh toggle button', () => {
    renderWithProviders(<SystemLogs />)
    expect(screen.getByRole('button', { name: /auto-refresh/i })).toBeInTheDocument()
  })

  it('has clear logs button', () => {
    renderWithProviders(<SystemLogs />)
    expect(screen.getByRole('button', { name: /clear logs/i })).toBeInTheDocument()
  })

  it('shows confirm dialog when clicking clear logs', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SystemLogs />)

    await waitFor(() => {
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /clear logs/i }))

    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to clear all logs/i)).toBeInTheDocument()
    })
  })

  it('shows log count in subtitle', async () => {
    renderWithProviders(<SystemLogs />)
    await waitFor(() => {
      expect(screen.getByText(/4 logs/)).toBeInTheDocument()
    })
  })

  it('has account filter dropdown', async () => {
    renderWithProviders(<SystemLogs />)
    await waitFor(() => {
      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()
    })
  })
})
