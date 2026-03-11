import axios from 'axios'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || ''
      const isAuthEndpoint = url.includes('/api/auth/login') || url.includes('/api/auth/signup') || url.includes('/api/login') || url.includes('/api/signup')

      if (!isAuthEndpoint) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        localStorage.removeItem('auth_token')
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  },
)

export default apiClient
