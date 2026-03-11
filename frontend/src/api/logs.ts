import apiClient from './client'

export interface LogEntry {
  id: number
  level: string
  message: string
  account_id: number | null
  timestamp: string
}

export const logsApi = {
  getAll: (accountId?: number) =>
    apiClient.get<LogEntry[]>('/api/logs', { params: accountId ? { account_id: accountId } : undefined }),
  clear: (accountId?: number) =>
    apiClient.delete('/api/logs', { params: accountId ? { account_id: accountId } : undefined }),
}
