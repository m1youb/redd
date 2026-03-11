import apiClient from './client'

export interface Proxy {
  id: number
  address: string
  protocol: string | null
  location: string | null
  status: string | null
  last_tested: string | null
  assigned_accounts: number[]
}

export const proxiesApi = {
  getAll: () => apiClient.get<Proxy[]>('/api/proxies'),
  create: (data: { address?: string; addresses?: string[] }) => apiClient.post('/api/proxies', data),
  update: (id: number, data: { address: string }) => apiClient.put(`/api/proxies/${id}`, data),
  delete: (id: number) => apiClient.delete(`/api/proxies/${id}`, { data: {} }),
  deleteAll: () => apiClient.delete('/api/proxies/delete-all', { data: {} }),
  checkLocation: (id: number) => apiClient.post(`/api/proxies/${id}/check-location`, {}),
  checkAllLocations: () => apiClient.post('/api/proxies/check-locations', {}),
  test: (id: number) => apiClient.post(`/api/proxies/${id}/test`, {}),
  testAll: () => apiClient.post('/api/proxies/test-all', {}),
}
