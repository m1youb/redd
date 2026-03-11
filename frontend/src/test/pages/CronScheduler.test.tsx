import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CronScheduler from '../../pages/CronScheduler'
import { renderWithProviders } from '../test-utils'

vi.mock('../../api/cron', () => ({
  cronApi: {
    getAll: vi.fn().mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Daily Safari Search',
          account_id: 1,
          account_username: 'testuser1',
          job_type: 'search',
          params: { query: 'safari' },
          schedule_type: 'interval',
          schedule_config: { minutes: 30 },
          is_active: true,
          last_run: '2025-03-10T10:00:00',
          next_run: '2025-03-10T10:30:00',
          created_at: '2025-03-01T00:00:00',
        },
        {
          id: 2,
          name: 'Weekly Comment Job',
          account_id: 2,
          account_username: 'testuser2',
          job_type: 'comment',
          params: {},
          schedule_type: 'weekly',
          schedule_config: { days: [0, 2, 4], time: '10:00' },
          is_active: false,
          last_run: null,
          next_run: null,
          created_at: '2025-03-05T00:00:00',
        },
      ],
    }),
    create: vi.fn().mockResolvedValue({ data: { id: 3, name: 'New Job' } }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: { message: 'Deleted' } }),
    trigger: vi.fn().mockResolvedValue({ data: { message: 'Triggered' } }),
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

describe('CronScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the page title', async () => {
    renderWithProviders(<CronScheduler />)
    expect(screen.getByText('Cron Scheduler')).toBeInTheDocument()
  })

  it('shows job count in subtitle', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      expect(screen.getByText(/2 scheduled jobs/)).toBeInTheDocument()
    })
  })

  it('displays cron job cards after loading', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      expect(screen.getByText('Daily Safari Search')).toBeInTheDocument()
    })
    expect(screen.getByText('Weekly Comment Job')).toBeInTheDocument()
  })

  it('shows job type badges', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      expect(screen.getByText('search')).toBeInTheDocument()
    })
    expect(screen.getByText('comment')).toBeInTheDocument()
  })

  it('shows active/paused status', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('shows human-readable schedule descriptions', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      expect(screen.getByText('Every 30 minutes')).toBeInTheDocument()
    })
    expect(screen.getByText('Mon, Wed, Fri at 10:00')).toBeInTheDocument()
  })

  it('shows account usernames', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      expect(screen.getByText('testuser1')).toBeInTheDocument()
    })
    expect(screen.getByText('testuser2')).toBeInTheDocument()
  })

  it('has Add Schedule button', () => {
    renderWithProviders(<CronScheduler />)
    expect(screen.getByRole('button', { name: /add schedule/i })).toBeInTheDocument()
  })

  it('opens add modal when clicking Add Schedule', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CronScheduler />)

    await user.click(screen.getByRole('button', { name: /add schedule/i }))

    await waitFor(() => {
      // The modal title is also "Add Schedule", so use getAllByText and check for modal form fields
      expect(screen.getByText('Job Name')).toBeInTheDocument()
      expect(screen.getByText('Account')).toBeInTheDocument()
      expect(screen.getByText('Job Type')).toBeInTheDocument()
      expect(screen.getByText('Schedule Type')).toBeInTheDocument()
    })
  })

  it('shows delete confirmation dialog', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CronScheduler />)

    await waitFor(() => {
      expect(screen.getByText('Daily Safari Search')).toBeInTheDocument()
    })

    // Find the delete buttons (there should be 2 — one per job card)
    const deleteButtons = screen.getAllByTitle('Delete')
    await user.click(deleteButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to delete/i)).toBeInTheDocument()
    })
  })

  it('shows formatted timestamps for last/next run', async () => {
    renderWithProviders(<CronScheduler />)
    await waitFor(() => {
      // The second job has null last_run/next_run, which renders "—" inside "Last run: —" / "Next run: —"
      const lastRunLabels = screen.getAllByText(/Last run:/)
      const nextRunLabels = screen.getAllByText(/Next run:/)
      expect(lastRunLabels.length).toBe(2) // one per job card
      expect(nextRunLabels.length).toBe(2)
      // The second job should show the em dash for null values
      expect(lastRunLabels[1].textContent).toContain('—')
      expect(nextRunLabels[1].textContent).toContain('—')
    })
  })
})
