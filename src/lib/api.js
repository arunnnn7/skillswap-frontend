import axios from 'axios'

// Debug log to check environment variables
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL)

// Use fallback URL if environment variable is not set
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://skillswap-backend-w0b7.onrender.com'

const API = axios.create({ 
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 10000 // 10 second timeout
})

API.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = 'Bearer ' + token
  return cfg
})

// Add response interceptor for better error handling
API.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message)
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('userId')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default API