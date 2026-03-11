import apiClient from './client'
import type {
  BusinessMemoryEntry,
  BusinessMemoryPayload,
  MemorySuggestion,
  MemorySuggestionStatus,
} from '../components/campaign/types'

export const campaignApi = {
  getDashboard: () => apiClient.get('/api/campaign/dashboard'),
  getReviews: (limit?: number) => apiClient.get('/api/campaign/reviews', { params: { limit } }),
  saveConfig: (data: {
    start_time: string
    end_time: string
    customer_normal_per_agent: number
    customer_brand_total: number
    employee_helpful_total: number
    employee_brand_total: number
    approval_digest_time: string
  }) => apiClient.post<unknown>('/api/campaign/config', data),
  startCampaign: () => apiClient.post('/api/campaign/start', {}),
  stopCampaign: () => apiClient.post('/api/campaign/stop', {}),
  runNow: async () => {
    try {
      return await apiClient.post('/api/campaign/run-now', {})
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'response' in error) {
        const response = (error as { response?: { status?: number } }).response
        if (response?.status === 404) {
          return apiClient.post('/api/campaign/plan', {})
        }
      }

      throw error
    }
  },
  saveStrategy: (data: Record<string, unknown>) => apiClient.post<unknown>('/api/campaign/strategy', data),
  plan: () => apiClient.post('/api/campaign/plan', {}),
  saveLaneConfig: (laneId: string, data: Record<string, unknown>) =>
    apiClient.post<unknown>(`/api/campaign/lanes/${laneId}/config`, data),
  saveLaneOverride: (laneId: string, data: Record<string, unknown>) =>
    apiClient.post<unknown>(`/api/campaign/lanes/${laneId}/override`, data),
  clearLaneOverride: (laneId: string) => apiClient.post(`/api/campaign/lanes/${laneId}/override/clear`, {}),
  pauseLane: (laneId: string, data: { paused: boolean }) => apiClient.post(`/api/campaign/lanes/${laneId}/pause`, data),
  resetWindow: () => apiClient.post('/api/campaign/reset_window', {}),
  setAccountRole: (accountId: number, data: { role: string }) =>
    apiClient.post(`/api/campaign/accounts/${accountId}/role`, data),
  queueAction: (actionId: number) => apiClient.post(`/api/campaign/actions/${actionId}/queue`, {}),
  queueAllActions: () => apiClient.post('/api/campaign/actions/queue_all', {}),
  cancelAction: (actionId: number) => apiClient.post(`/api/campaign/actions/${actionId}/cancel`, {}),
  approveDraft: (draftId: number, data?: Record<string, unknown>) =>
    apiClient.post<unknown>(`/api/campaign/approvals/${draftId}/approve`, data),
  saveDraft: (draftId: number, data: Record<string, unknown>) =>
    apiClient.post<unknown>(`/api/campaign/approvals/${draftId}/save`, data),
  rejectDraft: (draftId: number, data?: Record<string, unknown>) =>
    apiClient.post<unknown>(`/api/campaign/approvals/${draftId}/reject`, data),
  getMemorySuggestions: (status: MemorySuggestionStatus = 'pending') =>
    apiClient.get<MemorySuggestion[]>('/api/memory-suggestions', { params: { status } }),
  approveMemorySuggestion: (suggestionId: number, data?: BusinessMemoryPayload) =>
    apiClient.post<{ message: string; suggestion: MemorySuggestion; entry: BusinessMemoryEntry }>(
      `/api/memory-suggestions/${suggestionId}/approve`,
      data,
    ),
  dismissMemorySuggestion: (suggestionId: number) =>
    apiClient.post<{ message: string; suggestion: MemorySuggestion }>(`/api/memory-suggestions/${suggestionId}/dismiss`, {}),
  getBusinessMemory: (includeArchived = false) =>
    apiClient.get<BusinessMemoryEntry[]>('/api/business-memory', { params: { include_archived: includeArchived } }),
  createBusinessMemory: (data: BusinessMemoryPayload) =>
    apiClient.post<{ message: string; entry: BusinessMemoryEntry }>('/api/business-memory', data),
  updateBusinessMemory: (entryId: number, data: Partial<BusinessMemoryPayload> & { is_active?: boolean }) =>
    apiClient.patch<{ message: string; entry: BusinessMemoryEntry }>(`/api/business-memory/${entryId}`, data),
}
