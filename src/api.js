// Talks to the Milky Mart backend. Resolution order for the base URL:
//   1. a runtime override saved in localStorage (Settings screen) — lets a
//      shipped APK point at a new backend without a rebuild;
//   2. VITE_API_URL baked in at build time (used for the APK/production build);
//   3. the local dev server, so `npm run dev` works out of the box.
const BASE_KEY = 'milky-mart-api-url'
const BUILD_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '')

export const getApiBase = () => {
  try {
    const override = localStorage.getItem(BASE_KEY)
    if (override) return override.replace(/\/$/, '')
  } catch {
    // ignore storage errors
  }
  return BUILD_BASE
}

export const setApiBase = (url) => {
  try {
    if (url && url.trim()) localStorage.setItem(BASE_KEY, url.trim().replace(/\/$/, ''))
    else localStorage.removeItem(BASE_KEY)
  } catch {
    // ignore storage errors
  }
}

export const defaultApiBase = BUILD_BASE

const TOKEN_KEY = 'milky-mart-token'

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage blocked — token lives only in memory for this session
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${getApiBase()}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0)
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status)
  }
  return data
}

export const api = {
  get base() {
    return getApiBase()
  },
  requestOtp: (phone) => request('/auth/request-otp', { method: 'POST', body: { phone }, auth: false }),
  verifyOtp: (phone, otp, role) => request('/auth/verify-otp', { method: 'POST', body: { phone, otp, role }, auth: false }),
  // Exchanges a Firebase phone-auth ID token for a Milky Mart session.
  authFirebase: (idToken, role) => request('/auth/firebase', { method: 'POST', body: { idToken, role }, auth: false }),
  me: () => request('/me'),
  updateName: (name) => request('/me', { method: 'PATCH', body: { name } }),
  // Invalidates this session server-side so the token can't be reused.
  logout: () => request('/auth/logout', { method: 'POST' }),
  config: () => request('/config', { auth: false }),

  products: () => request('/products', { auth: false }),

  addresses: () => request('/addresses'),
  addAddress: (label, detail) => request('/addresses', { method: 'POST', body: { label, detail } }),
  updateAddress: (id, label, detail) => request(`/addresses/${id}`, { method: 'PUT', body: { label, detail } }),
  deleteAddress: (id) => request(`/addresses/${id}`, { method: 'DELETE' }),

  wallet: () => request('/wallet'),
  topup: (amount, note) => request('/wallet/topup', { method: 'POST', body: note ? { amount, note } : { amount } }),

  orders: () => request('/orders'),
  order: (id) => request(`/orders/${id}`),
  placeOrder: (payload) => request('/orders', { method: 'POST', body: payload }),

  notifications: () => request('/notifications'),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),

  riderDeliveries: () => request('/rider/deliveries'),
  advanceDelivery: (id) => request(`/rider/deliveries/${id}`, { method: 'PATCH' }),
}
