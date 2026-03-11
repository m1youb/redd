import apiClient from './client'

export interface Job {
  id: number
  account_id: number
  type: string
  params: Record<string, unknown>
  status: string
  result: string | null
  created_at: string
  updated_at: string
}

export const jobsApi = {
  getAll: (accountId: number) => apiClient.get<Job[]>(`/api/accounts/${accountId}/jobs`),
  create: (accountId: number, data: { type: string; params?: Record<string, unknown> }) =>
    apiClient.post<unknown>(`/api/accounts/${accountId}/jobs`, data),
  update: (accountId: number, jobId: number, data: Record<string, unknown>) =>
    apiClient.put<unknown>(`/api/accounts/${accountId}/jobs/${jobId}`, data),
  delete: (accountId: number, jobId: number) =>
    apiClient.delete(`/api/accounts/${accountId}/jobs/${jobId}`, { data: {} }),
  deleteAll: (accountId: number) => apiClient.delete(`/api/accounts/${accountId}/jobs`, { data: {} }),
  cancel: (accountId: number, jobId: number) => apiClient.post(`/api/accounts/${accountId}/jobs/${jobId}/cancel`, {}),
}
