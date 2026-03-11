import apiClient from './client'

export interface TestEmailPayload {
  smtp_host: string
  smtp_port: string
  smtp_username: string
  smtp_app_password?: string
  smtp_from_name: string
  smtp_from_email: string
  email_recipients: string
  email_base_url: string
}

export const settingsApi = {
  getAll: () => apiClient.get('/api/settings'),
  update: (data: Record<string, string>) => apiClient.post('/api/settings', data),
  testEmail: (data: TestEmailPayload) => apiClient.post('/api/settings/test_email', data),
  testApi: () => apiClient.post('/api/settings/test_api', {}),
}
