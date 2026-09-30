// Talks to the Milky Mart backend. Resolution order for the base URL:
//   1. a runtime override saved in localStorage — development builds only;
//   2. VITE_API_URL baked in at build time (used for the APK/production build);
//   3. the local dev server, so `npm run dev` works out of the box.
//
// The override is compiled out of production builds on purpose. Every request
// carries the user's session token, and login hands over a Firebase ID token, so
// an attacker who could repoint a shipped app at a server they control would be
// handed those credentials. In a release build the app only ever talks to
// VITE_API_URL, and a stale override left in storage by a dev build is ignored.
const ALLOW_RUNTIME_OVERRIDE = import.meta.env.DEV
const BASE_KEY = 'milky-mart-api-url'
const BUILD_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '')

export const canOverrideApiBase = ALLOW_RUNTIME_OVERRIDE

export const getApiBase = () => {
  if (!ALLOW_RUNTIME_OVERRIDE) return BUILD_BASE
  try {
    const override = localStorage.getItem(BASE_KEY)
    if (override) return override.replace(/\/$/, '')
  } catch {
    // ignore storage errors
  }
  return BUILD_BASE
}

export const setApiBase = (url) => {
  if (!ALLOW_RUNTIME_OVERRIDE) return
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

// A request that never settles leaves a spinner up forever, which on a flaky
// mobile connection is the difference between "retry" and "the app is frozen".
// The backend cold-starts on Render, so the budget is generous rather than tight.
const REQUEST_TIMEOUT_MS = 20000

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res
  try {
    res = await fetch(`${getApiBase()}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    // Separate messages: a timeout means the server is reachable but slow, which
    // is worth retrying, while a transport failure usually means no connectivity.
    if (error?.name === 'AbortError') {
      throw new ApiError('The server took too long to respond. Please try again.', 0)
    }
    throw new ApiError('Cannot reach the server. Check your connection.', 0)
  } finally {
    clearTimeout(timeout)
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

  // Daily milk plans. Billed one delivery at a time from the wallet.
  subscriptions: () => request('/subscriptions'),
  subscribe: (payload) => request('/subscriptions', { method: 'POST', body: payload }),
  // action: 'pause' | 'resume' | 'cancel'
  setSubscription: (id, action) => request(`/subscriptions/${id}`, { method: 'PATCH', body: { action } }),

  // Cash the rider took at the door. Recording it does not move any money —
  // an admin has to approve it before the customer's wallet changes.
  riderCustomers: () => request('/rider/customers'),
  riderCashCollections: () => request('/rider/cash-collections'),
  riderDeliveryCharges: () => request('/rider/delivery-charges'),
  chargeDelivery: (payload) => request('/rider/delivery-charges', { method: 'POST', body: payload }),
  recordCash: (payload) => request('/rider/cash-collections', { method: 'POST', body: payload }),
}
