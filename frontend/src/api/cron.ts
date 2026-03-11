import apiClient from './client'

export interface CronJob {
  id: number
  name: string
  account_id: number
  account_username: string | null
  job_type: string
  params: Record<string, unknown>
  schedule_type: 'interval' | 'daily' | 'weekly'
  schedule_config: Record<string, unknown>
  is_active: boolean
  last_run: string | null
  next_run: string | null
  created_at: string
}

export const cronApi = {
  getAll: () => apiClient.get<CronJob[]>('/api/cron'),
  create: (data: Partial<CronJob>) => apiClient.post('/api/cron', data),
  update: (id: number, data: Partial<CronJob>) => apiClient.put(`/api/cron/${id}`, data),
  delete: (id: number) => apiClient.delete(`/api/cron/${id}`, { data: {} }),
  trigger: (id: number) => apiClient.post(`/api/cron/${id}/trigger`, {}),
}
