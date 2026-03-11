import apiClient from './client'

export interface Account {
  id: number
  username: string
  personality: string | null
  persona_name: string | null
  interests: string | null
  role: string | null
  proxy_id: number | null
  proxy_address: string | null
  cookies_json: string | null
  has_cookies: boolean
  status: string
  created_at: string
}

export const accountsApi = {
  getAll: () => apiClient.get<Account[]>('/api/accounts'),
  create: (data: { username: string; password: string; personality?: string }) =>
    apiClient.post('/api/accounts', data),
  bulkCreate: (data: { accounts_text: string }) => apiClient.post('/api/accounts/bulk', data),
  update: (id: number, data: Partial<Account>) => apiClient.put(`/api/accounts/${id}`, data),
  delete: (id: number) => apiClient.delete(`/api/accounts/${id}`, { data: {} }),
  deleteCookies: (id: number) => apiClient.delete(`/api/accounts/${id}/cookies`, { data: {} }),
  deleteAllCookies: () => apiClient.delete('/api/accounts/cookies/delete-all', { data: {} }),
  launch: (id: number) => apiClient.post(`/api/accounts/${id}/launch`, {}),
  stop: (id: number) => apiClient.post(`/api/accounts/${id}/stop`, {}),
  testProxyBrowser: (id: number) => apiClient.post(`/api/accounts/${id}/test_proxy_browser`, {}),
  assignProxy: (id: number, data: { proxy_id: number | null }) =>
    apiClient.post(`/api/accounts/${id}/assign_proxy`, data),
  generateInterests: (id: number) => apiClient.post(`/api/accounts/${id}/generate_interests`, {}),
}
