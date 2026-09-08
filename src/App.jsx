import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  Bike,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  FileBadge,
  Gift,
  Globe,
  Home,
  Info,
  ListChecks,
  LocateFixed,
  LogOut,
  MapPin,
  Menu,
  Minus,
  Navigation,
  PackageCheck,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import { products as seedProducts, orderStages } from './data.js'
import { api, getToken, setToken, ApiError, getApiBase, setApiBase, defaultApiBase, canOverrideApiBase } from './api.js'
import { canUseFirebasePhone, sendFirebaseOtp, confirmFirebaseOtp, firebaseSignOut } from './firebaseClient.js'

// Turns Firebase/native error codes into a message that names the real cause, so
// a screenshot of the error is enough to diagnose a mis-configuration.
function firebaseErrorMessage(error) {
  const raw = String(error?.code || error?.message || error || '')
  if (/app-not-authorized|not authorized|CONFIGURATION_NOT_FOUND/i.test(raw)) {
    return 'App not authorised by Firebase. Add the SHA-256 fingerprint to the Firebase app.'
  }
  if (/missing-client-identifier|missing a valid app identifier|invalid-app-credential|app-credential|integrity|recaptcha|SafetyNet|PlayIntegrity/i.test(raw)) {
    return 'Phone verification is not fully set up in Firebase (SHA-256 + Play Integrity). See setup.'
  }
  if (/BILLING_NOT_ENABLED|billing/i.test(raw)) {
    return 'Firebase needs the Blaze plan to send OTP. Upgrade the project (free within limits).'
  }
  if (/operation-not-allowed|provider is disabled|not allowed/i.test(raw)) {
    return 'Enable Phone sign-in in Firebase Authentication.'
  }
  if (/too-many-requests|quota|QUOTA/i.test(raw)) return 'SMS limit reached. Use a Firebase test number, or try later.'
  if (/invalid-verification-code|invalid code|17044/i.test(raw)) return 'Incorrect OTP. Please re-enter the code.'
  if (/invalid-phone-number|17042/i.test(raw)) return 'That phone number looks invalid.'
  if (/network|timeout|unreachable/i.test(raw)) return 'Network error. Check your connection and retry.'
  // Fall back to the raw message so nothing is hidden while we're stabilising OTP.
  return `OTP error: ${error?.message || raw || 'unknown'}`
}

const money = (value) => {
  const amount = Number(value)
  return `₹${(Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN')}`
}

// Percentage off the MRP, rounded. Returns 0 when there's no genuine discount
// (no MRP, or MRP not above the selling price) so we don't show a fake "0% OFF".
const discountPercent = (product) => {
  const price = Number(product?.price)
  const mrp = Number(product?.mrp)
  if (!Number.isFinite(mrp) || !Number.isFinite(price) || mrp <= price) return 0
  return Math.round(((mrp - price) / mrp) * 100)
}

const MAX_QUANTITY = 99
const MAX_TOPUP = 50000
const ACTIVE_ORDER_STATUSES = ['Confirmed', 'Packed', 'Out for delivery', 'Assigned']

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

// The cart is the one piece of state kept in localStorage (it is pre-order and
// device-local); everything else is loaded from the backend. Saved carts survive
// code changes, so the shape is validated before it reaches a render.
const reviveCart = (saved) => {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  const cart = {}
  for (const [id, quantity] of Object.entries(saved)) {
    const amount = Math.floor(Number(quantity))
    if (typeof id === 'string' && Number.isFinite(amount) && amount > 0) {
      cart[id] = Math.min(amount, MAX_QUANTITY)
    }
  }
  return cart
}

// Session is cached locally for an instant boot, then re-validated against the
// backend (via /me) using the stored token.
const reviveSession = (saved) => {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null
  return {
    id: Number(saved.id) || null,
    role: saved.role === 'rider' ? 'rider' : 'customer',
    phone: text(saved.phone),
    name: text(saved.name),
  }
}

const searchable = (value) => value.toLowerCase().replace(/[’‘`]/g, "'")

// Pull a short locality name out of a full address for the "Delivering to" header.
const localityOf = (detail) => {
  const parts = String(detail || '').split(',').map((s) => s.trim()).filter(Boolean)
  const patnaIndex = parts.findIndex((p) => /patna/i.test(p))
  if (patnaIndex > 0) return parts[patnaIndex - 1]
  return parts[0] || 'Patna'
}

const dialable = (value) => String(value).replace(/[^\d+]/g, '')

function usePersistentState(key, fallback, revive) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved === null) return fallback
      const parsed = JSON.parse(saved)
      return revive ? revive(parsed, fallback) : parsed
    } catch {
      return fallback
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage can be full or blocked (private browsing) — the app stays usable in memory.
    }
  }, [key, value])

  return [value, setValue]
}

function useEscapeKey(active, onEscape) {
  const latest = useRef(onEscape)

  useEffect(() => {
    latest.current = onEscape
  })

  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') latest.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active])
}

function App() {
  const [splash, setSplash] = useState(true)
  const [session, setSession] = usePersistentState('milky-mart-session', null, reviveSession)
  const [authPage, setAuthPage] = useState('landing')
  const [authRole, setAuthRole] = useState('customer')
  // Remembered so a returning customer sees their own number already filled in;
  // a first-time user gets an empty field rather than a demo placeholder.
  const [phone, setPhone] = usePersistentState('milky-mart-last-phone', '')
  const [otp, setOtp] = useState('')
  const [page, setPage] = useState('home')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [cart, setCart] = usePersistentState('milky-mart-cart', {}, reviveCart)
  // Product catalogue is public; seed with the bundled list for an instant first
  // paint, then replace with the live catalogue from the backend.
  const [catalog, setCatalog] = useState(seedProducts)
  // All of the following are loaded from the backend once a session exists.
  const [orders, setOrders] = useState([])
  const [deliveries, setDeliveries] = useState([])
  const [notices, setNotices] = useState([])
  const [balance, setBalance] = useState(0)
  const [ledger, setLedger] = useState([])
  const [addresses, setAddresses] = useState([])
  const [profileName, setProfileName] = useState('')
  const [riderApproved, setRiderApproved] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [toast, setToast] = useState(null)
  // Firebase phone sign-in is used when the backend has it enabled AND we're in
  // the native app; otherwise the built-in OTP flow runs. `firebaseVerification`
  // holds the in-progress verificationId between the send and confirm steps.
  // Default to Firebase whenever we're in the native app, so a slow (cold-start)
  // config fetch can never make login briefly fall back to the wrong path. The
  // config check below only turns it OFF if the backend says Firebase is disabled.
  const [useFirebaseLogin, setUseFirebaseLogin] = useState(canUseFirebasePhone)
  const [otpSending, setOtpSending] = useState(false)
  const firebaseVerification = useRef(null)
  const toastId = useRef(0)
  const pageRef = useRef(page)
  const drawerRef = useRef(drawerOpen)
  const sessionRef = useRef(session)

  useEffect(() => {
    pageRef.current = page
    drawerRef.current = drawerOpen
    sessionRef.current = session
  }, [page, drawerOpen, session])

  // Keyed by id so repeating the same message restarts the auto-dismiss timer.
  // Longer/error messages linger so they can actually be read.
  const showToast = useCallback((message) => {
    toastId.current += 1
    const duration = String(message).length > 45 ? 6000 : 2200
    setToast({ id: toastId.current, message, duration })
  }, [])

  useEffect(() => {
    const timeout = setTimeout(() => setSplash(false), 950)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = setTimeout(() => setToast(null), toast.duration || 2200)
    return () => clearTimeout(timeout)
  }, [toast])

  // Load the live product catalogue (public). Keeps the bundled seed on failure.
  useEffect(() => {
    let alive = true
    api.products()
      .then((list) => { if (alive && Array.isArray(list) && list.length) setCatalog(list) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Ask the backend whether Firebase phone sign-in is live. Only switch the login
  // flow to Firebase when it's enabled server-side and we're in the native app.
  useEffect(() => {
    let alive = true
    api.config()
      .then((cfg) => { if (alive) setUseFirebaseLogin(canUseFirebasePhone && cfg?.firebaseAuth !== false) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // me() runs first and is allowed to throw (a 401 there means the token is
  // stale); the rest settle independently so one slow call can't block the UI.
  const refreshCustomer = useCallback(async () => {
    const prof = await api.me()
    setProfileName(prof.user.name)
    const [ords, wal, addr, notif] = await Promise.allSettled([
      api.orders(), api.wallet(), api.addresses(), api.notifications(),
    ])
    if (ords.status === 'fulfilled') setOrders(ords.value)
    if (wal.status === 'fulfilled') { setBalance(wal.value.balance); setLedger(wal.value.transactions) }
    if (addr.status === 'fulfilled') setAddresses(addr.value)
    if (notif.status === 'fulfilled') setNotices(notif.value)
  }, [])

  const refreshRider = useCallback(async () => {
    const prof = await api.me()
    setProfileName(prof.user.name)
    setRiderApproved(prof.user.approved !== false)
    const [dels, wal] = await Promise.allSettled([api.riderDeliveries(), api.wallet()])
    if (dels.status === 'fulfilled') setDeliveries(dels.value)
    else setDeliveries([]) // pending riders get 403 — show no deliveries
    if (wal.status === 'fulfilled') { setBalance(wal.value.balance); setLedger(wal.value.transactions) }
  }, [])

  // Pulls the latest server state for whichever role is signed in.
  const refreshAll = useCallback(() => {
    if (!sessionRef.current) return
    const load = sessionRef.current.role === 'rider' ? refreshRider : refreshCustomer
    load().catch(() => {
      // a failed background refresh keeps the last known data on screen
    })
  }, [refreshCustomer, refreshRider])

  // Keep the app in step with the backend without a manual refresh: re-fetch when
  // the app comes back to the foreground and on a light poll while it is visible.
  // (Admin/rider changes made elsewhere then show up on their own.)
  useEffect(() => {
    if (!session) return undefined
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refreshAll()
    }
    document.addEventListener('visibilitychange', refreshIfVisible)
    const poll = setInterval(refreshIfVisible, 45000)

    let removeResume = () => {}
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor?.isNativePlatform?.()) return
        const { App: CapacitorApp } = await import('@capacitor/app')
        const handle = await CapacitorApp.addListener('resume', refreshAll)
        removeResume = () => handle.remove()
      } catch {
        // plugin unavailable on web — visibilitychange already covers it
      }
    })()

    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible)
      clearInterval(poll)
      removeResume()
    }
  }, [session, refreshAll])

  // Opening a data-backed screen always shows fresh data.
  useEffect(() => {
    if (!session) return
    if (['home', 'orders', 'order', 'wallet', 'notifications', 'deliveries'].includes(page)) refreshAll()
  }, [page, session, refreshAll])

  // Tint the native status bar to match the current screen: blue with white
  // icons on the blue splash/landing, light with dark icons everywhere else.
  useEffect(() => {
    const onBlue = splash || (!session && authPage === 'landing')
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor?.isNativePlatform?.()) return
        const { StatusBar, Style } = await import('@capacitor/status-bar')
        await StatusBar.setBackgroundColor({ color: onBlue ? '#15abe2' : '#f7fafb' })
        await StatusBar.setStyle({ style: onBlue ? Style.Dark : Style.Light })
      } catch {
        // plugin unavailable (plain web build) — nothing to do
      }
    })()
  }, [splash, session, authPage])

  // Whenever a session appears (login, or restored token on boot), pull the
  // role-appropriate data from the backend. A cached session with no token is
  // stale — clear it so the user lands on the login screen.
  useEffect(() => {
    if (!session) return
    if (!getToken()) {
      setSession(null)
      return
    }
    const load = session.role === 'rider' ? refreshRider : refreshCustomer
    load().catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        setToken(null)
        setSession(null)
        setAuthPage('landing')
      }
    })
  }, [session, setSession, refreshCustomer, refreshRider])

  const cartItems = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => ({
          ...catalog.find((product) => product.id === id),
          quantity,
        }))
        .filter((item) => item.id),
    [cart, catalog],
  )

  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0)
  const cartSubtotal = cartItems.reduce((total, item) => total + item.price * item.quantity, 0)

  // History side effects are kept out of state updaters — StrictMode invokes
  // updaters twice, which would push every entry onto the stack twice.
  const navigate = useCallback((nextPage) => {
    if (pageRef.current !== nextPage) {
      pageRef.current = nextPage
      window.history.pushState({ page: nextPage }, '')
    }
    setPage(nextPage)
    setDrawerOpen(false)
    document.querySelector('.app-frame')?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // Maps browser/Android hardware back onto in-app navigation. The open drawer
  // counts as a dismissable layer, so back closes it instead of leaving the screen.
  useEffect(() => {
    window.history.replaceState({ page: pageRef.current }, '')
    const onPopState = (event) => {
      if (drawerRef.current) {
        setDrawerOpen(false)
        window.history.pushState({ page: pageRef.current }, '')
        return
      }
      const nextPage = event.state?.page || 'home'
      pageRef.current = nextPage
      setPage(nextPage)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // On Android the hardware/gesture back button doesn't emit popstate, so route
  // it through the same history stack. canGoBack is false only at the root entry,
  // where back should leave the app. No-op in a browser (isNativePlatform false).
  useEffect(() => {
    let cleanup = () => {}
    ;(async () => {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor?.isNativePlatform?.()) return
        const { App: CapacitorApp } = await import('@capacitor/app')
        const handle = await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
          if (drawerRef.current) {
            setDrawerOpen(false)
          } else if (canGoBack) {
            window.history.back()
          } else {
            CapacitorApp.exitApp()
          }
        })
        cleanup = () => handle.remove()
      } catch {
        // Plugin unavailable (plain web build) — nothing to wire up.
      }
    })()
    return () => cleanup()
  }, [])

  const updateCart = (productId, change) => {
    setCart((current) => {
      const existing = Number(current[productId]) || 0
      const quantity = Math.min(MAX_QUANTITY, Math.max(0, existing + change))
      const next = { ...current, [productId]: quantity }
      if (!quantity) delete next[productId]
      return next
    })
  }

  // Collapses the history stack back to a single 'home' entry so a session change
  // cannot leave the previous user's screens reachable via back.
  const resetToHome = useCallback(() => {
    pageRef.current = 'home'
    window.history.replaceState({ page: 'home' }, '')
    setPage('home')
    setDrawerOpen(false)
    setSelectedProduct(null)
    setSelectedOrder(null)
  }, [])

  const startLogin = (role) => {
    setAuthRole(role)
    setAuthPage('phone')
  }

  // Shared once a session token is obtained, whichever login path produced it.
  const applySession = useCallback((token, user) => {
    setToken(token)
    setProfileName(user.name)
    setBalance(user.wallet || 0)
    setRiderApproved(user.approved !== false)
    setSession({ id: user.id, role: user.role, phone: user.phone, name: user.name })
    resetToHome()
    showToast(user.role === 'rider' ? 'Welcome, delivery partner' : 'Welcome to Milky Mart')
  }, [resetToHome, showToast])

  const sendOtp = async (event) => {
    event.preventDefault()
    const digits = phone.replace(/\D/g, '')
    if (!/^\d{10}$/.test(digits)) {
      showToast('Please enter a valid 10-digit mobile number')
      return
    }
    setOtpSending(true)
    try {
      if (useFirebaseLogin) {
        // Firebase sends the real SMS; auto-verification may sign us in outright.
        const result = await sendFirebaseOtp(`+91${digits}`)
        if (result.autoIdToken) {
          const { token, user } = await api.authFirebase(result.autoIdToken, authRole)
          applySession(token, user)
          return
        }
        firebaseVerification.current = result.verificationId
        setOtp('')
        setAuthPage('otp')
        showToast('OTP sent to your phone')
      } else {
        await api.requestOtp(digits)
        setOtp('')
        setAuthPage('otp')
        showToast('Demo OTP sent successfully')
      }
    } catch (error) {
      showToast(firebaseErrorMessage(error))
    } finally {
      setOtpSending(false)
    }
  }

  const verifyOtp = async (event) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(otp)) {
      showToast('Please enter a 6-digit OTP')
      return
    }
    try {
      if (useFirebaseLogin) {
        const idToken = await confirmFirebaseOtp(firebaseVerification.current, otp)
        const { token, user } = await api.authFirebase(idToken, authRole)
        firebaseVerification.current = null
        applySession(token, user)
      } else {
        const { token, user } = await api.verifyOtp(phone.replace(/\D/g, ''), otp, authRole)
        applySession(token, user)
      }
    } catch (error) {
      showToast(useFirebaseLogin ? 'Incorrect or expired OTP. Please try again.' : error.message)
    }
  }

  const logout = () => {
    // Tell the server to invalidate this token, then clear locally either way.
    api.logout().catch(() => {})
    if (useFirebaseLogin) firebaseSignOut()
    setToken(null)
    setSession(null)
    setAuthPage('landing')
    setOrders([])
    setDeliveries([])
    setNotices([])
    setLedger([])
    setAddresses([])
    setBalance(0)
    setCart({})
    resetToHome()
  }

  const placeOrder = async (checkout) => {
    if (!cartItems.length) {
      showToast('Your cart is empty')
      navigate('home')
      return
    }
    try {
      // Payment is decided by the server: wallet if it covers the order, else COD.
      // The idempotency key makes a double-tap or retry return the same order
      // instead of placing (and charging for) a second one.
      const order = await api.placeOrder({
        items: cartItems.map((item) => ({ id: item.id, quantity: item.quantity })),
        address: checkout.address,
        slot: checkout.slot,
        date: checkout.date,
        idempotencyKey: checkout.idempotencyKey,
      })
      setCart({})
      await refreshCustomer()
      navigate('orders')
      const paidBy = order.status && cartSubtotal <= balance ? 'from your wallet' : 'as cash on delivery'
      showToast(`Order #${order.id} placed — paying ${paidBy}`)
    } catch (error) {
      showToast(error.message)
    }
  }

  // Re-sync everything from the backend and clear the local cart.
  const resetDemo = async () => {
    setCart({})
    setSelectedProduct(null)
    try {
      const list = await api.products()
      if (Array.isArray(list) && list.length) setCatalog(list)
    } catch {
      // keep current catalogue
    }
    if (session?.role === 'rider') await refreshRider()
    else await refreshCustomer()
    showToast('Synced with the server')
  }

  // ---- Action handlers passed to screens (each hits the API, then updates state) ----
  const topupWallet = async (amount, note) => {
    const { balance: next } = await api.topup(amount, note)
    setBalance(next)
    if (session?.role === 'rider') await refreshRider()
    else {
      const wal = await api.wallet()
      setLedger(wal.transactions)
    }
  }

  const saveName = async (name) => {
    const { user } = await api.updateName(name)
    setProfileName(user.name)
    setSession((current) => (current ? { ...current, name: user.name } : current))
  }

  const addAddress = async (label, detail) => {
    const created = await api.addAddress(label, detail)
    setAddresses((current) => [...current, created])
  }
  const updateAddress = async (id, label, detail) => {
    const updated = await api.updateAddress(id, label, detail)
    setAddresses((current) => current.map((a) => (a.id === id ? updated : a)))
  }
  const deleteAddress = async (id) => {
    await api.deleteAddress(id)
    setAddresses((current) => current.filter((a) => a.id !== id))
  }

  const markAllRead = async () => {
    setNotices((current) => current.map((n) => ({ ...n, unread: false })))
    try {
      await api.markAllRead()
    } catch {
      // optimistic update already applied
    }
  }

  const advanceDelivery = async (id) => {
    const updated = await api.advanceDelivery(id)
    setDeliveries((current) => current.map((d) => (d.id === id ? updated : d)))
    return updated
  }

  if (splash) {
    return (
      <AppFrame>
        <Splash />
      </AppFrame>
    )
  }

  if (!session) {
    return (
      <AppFrame>
        {authPage === 'landing' && <Landing onSelect={startLogin} setToast={showToast} />}
        {authPage === 'phone' && (
          <PhoneLogin
            role={authRole}
            phone={phone}
            setPhone={setPhone}
            onSubmit={sendOtp}
            onBack={() => setAuthPage('landing')}
            busy={otpSending}
          />
        )}
        {authPage === 'otp' && (
          <OtpScreen
            phone={phone}
            otp={otp}
            setOtp={setOtp}
            onSubmit={verifyOtp}
            onBack={() => setAuthPage('phone')}
            onResend={() => sendOtp({ preventDefault() {} })}
            firebase={useFirebaseLogin}
          />
        )}
        <Toast message={toast?.message} />
      </AppFrame>
    )
  }

  return (
    <AppFrame>
      {session.role === 'customer' ? (
        <CustomerApp
          page={page}
          navigate={navigate}
          drawerOpen={drawerOpen}
          setDrawerOpen={setDrawerOpen}
          selectedProduct={selectedProduct}
          setSelectedProduct={setSelectedProduct}
          cart={cart}
          cartItems={cartItems}
          cartCount={cartCount}
          cartSubtotal={cartSubtotal}
          updateCart={updateCart}
          catalog={catalog}
          orders={orders}
          notices={notices}
          markAllRead={markAllRead}
          placeOrder={placeOrder}
          logout={logout}
          resetDemo={resetDemo}
          setToast={showToast}
          phone={session.phone}
          name={profileName}
          saveName={saveName}
          balance={balance}
          topupWallet={topupWallet}
          ledger={ledger}
          addresses={addresses}
          addAddress={addAddress}
          updateAddress={updateAddress}
          deleteAddress={deleteAddress}
          selectedOrder={selectedOrder}
          setSelectedOrder={setSelectedOrder}
        />
      ) : (
        <RiderApp
          page={page}
          navigate={navigate}
          drawerOpen={drawerOpen}
          setDrawerOpen={setDrawerOpen}
          deliveries={deliveries}
          advanceDelivery={advanceDelivery}
          logout={logout}
          resetDemo={resetDemo}
          setToast={showToast}
          phone={session.phone}
          name={profileName}
          saveName={saveName}
          balance={balance}
          topupWallet={topupWallet}
          ledger={ledger}
          approved={riderApproved}
        />
      )}
      <Toast message={toast?.message} />
    </AppFrame>
  )
}

function AppFrame({ children }) {
  return (
    <main className="browser-stage">
      <div className="app-frame">{children}</div>
    </main>
  )
}

function Splash() {
  return (
    <section className="splash-screen">
      <div className="splash-orbit splash-orbit-one" />
      <div className="splash-orbit splash-orbit-two" />
      <img src="/assets/images/applogo.png" alt="Milky Mart" className="splash-logo" />
      <div className="splash-loader"><span /></div>
      <p>Freshness at your doorstep</p>
    </section>
  )
}

function Landing({ onSelect, setToast }) {
  const [showServer, setShowServer] = useState(false)
  const [serverUrl, setServerUrl] = useState(getApiBase())

  const saveServer = () => {
    const value = serverUrl.trim()
    setApiBase(value || null)
    setShowServer(false)
    setToast(value ? 'Server updated' : 'Reverted to default server')
  }

  // Server settings exist for troubleshooting a deployment: press-and-hold the
  // logo (2s) to open them. Development builds only — see the note in api.js.
  // In a release build canOverrideApiBase is false, so these are inert and the
  // modal below is dropped from the bundle entirely.
  const holdTimer = useRef(null)
  const startHold = () => {
    if (!canOverrideApiBase) return
    holdTimer.current = setTimeout(() => { setServerUrl(getApiBase()); setShowServer(true) }, 2000)
  }
  const cancelHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current) }

  // Release the pending timer if the screen unmounts mid-hold.
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current) }, [])

  return (
    <section className="auth-screen landing-screen">
      <div className="landing-glow" />
      <img
        src="/assets/images/applogo.png"
        alt="Milky Mart"
        className="landing-logo"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
      />
      <div className="landing-visual">
        <div className="visual-bubble bubble-a" />
        <div className="visual-bubble bubble-b" />
        <img src="/assets/images/milkman.png" alt="Milk delivery partner" />
      </div>
      <div className="landing-copy">
        <span className="eyebrow light"><Sparkles size={15} /> Farm fresh every day</span>
        <h1>Milk, delivered with care.</h1>
        <p>Order fresh dairy products or manage your delivery route in one simple app.</p>
      </div>
      <div className="role-actions">
        <button className="role-button customer-role" onClick={() => onSelect('customer')}>
          <span><ShoppingBag size={23} /></span>
          <div><strong>Continue as customer</strong><small>Order milk and manage subscriptions</small></div>
          <ChevronRight size={20} />
        </button>
        <button className="role-button rider-role" onClick={() => onSelect('rider')}>
          <span><Bike size={23} /></span>
          <div><strong>Delivery partner login</strong><small>View and complete assigned orders</small></div>
          <ChevronRight size={20} />
        </button>
      </div>
      {canOverrideApiBase && showServer && (
        <Modal close={() => setShowServer(false)} title="Server settings">
          <label className="modal-label" htmlFor="server-url">Backend URL</label>
          <input
            className="modal-input"
            id="server-url"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder={defaultApiBase}
            autoFocus
          />
          <p className="modal-hint">Points the app at your deployed backend. Default: {defaultApiBase}</p>
          <button className="primary-button" onClick={saveServer}>Save <Check size={18} /></button>
        </Modal>
      )}
    </section>
  )
}

function PhoneLogin({ role, phone, setPhone, onSubmit, onBack, busy = false }) {
  return (
    <section className="auth-screen login-screen">
      <BackButton onClick={onBack} />
      <div className="auth-top">
        <img src={role === 'rider' ? '/assets/images/riderprofile.png' : '/assets/images/applogo1.png'} alt="" />
        <span className="eyebrow">{role === 'rider' ? 'DELIVERY PARTNER' : 'MILKY MART CUSTOMER'}</span>
        <h1>{role === 'rider' ? 'Rider Login' : 'Welcome back'}</h1>
        <p>Enter your mobile number and we’ll send you a one-time password.</p>
      </div>
      <form className="auth-form" onSubmit={onSubmit}>
        <label htmlFor="phone">Phone number</label>
        <div className="phone-field">
          <span><img src="/assets/icons/in.png" alt="India" /> +91</span>
          <input
            id="phone"
            inputMode="numeric"
            maxLength="10"
            value={phone}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
            placeholder="Enter mobile number"
            autoFocus
          />
        </div>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Sending…' : <>Send OTP <ChevronRight size={19} /></>}</button>
      </form>
      <div className="secure-note"><ShieldCheck size={17} /> Your number is used only to secure your account.</div>
    </section>
  )
}

function OtpScreen({ phone, otp, setOtp, onSubmit, onBack, onResend, firebase = false }) {
  return (
    <section className="auth-screen login-screen">
      <BackButton onClick={onBack} />
      <div className="auth-top otp-top">
        <img src="/assets/images/otpimage.svg" alt="" className="otp-image" />
        <span className="eyebrow">SECURE VERIFICATION</span>
        <h1>Verify your number</h1>
        <p>Enter the 6-digit OTP sent to <strong>+91 {phone}</strong>.</p>
      </div>
      <form className="auth-form" onSubmit={onSubmit}>
        <label htmlFor="otp">One-time password</label>
        <input
          className="otp-input"
          id="otp"
          inputMode="numeric"
          maxLength="6"
          value={otp}
          onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
          placeholder="• • • • • •"
          autoFocus
        />
        <button className="primary-button" type="submit">Verify & continue <Check size={19} /></button>
      </form>
      <p className="resend-copy">Didn’t receive it? <button type="button" onClick={onResend}>Resend OTP</button></p>
      {!firebase && <div className="demo-hint">Demo: any 6 digits will work</div>}
    </section>
  )
}

function BackButton({ onClick }) {
  return <button className="back-button" onClick={onClick} aria-label="Go back"><ArrowLeft size={21} /></button>
}

function CustomerApp(props) {
  const {
    page,
    navigate,
    drawerOpen,
    setDrawerOpen,
    selectedProduct,
    setSelectedProduct,
    cart,
    cartItems,
    cartCount,
    cartSubtotal,
    updateCart,
    catalog,
    orders,
    notices,
    markAllRead,
    placeOrder,
    logout,
    resetDemo,
    setToast,
    phone,
    name,
    saveName,
    balance,
    topupWallet,
    ledger,
    addresses,
    addAddress,
    updateAddress,
    deleteAddress,
    selectedOrder,
    setSelectedOrder,
  } = props

  const openProduct = (product) => {
    setSelectedProduct(product)
    navigate('product')
  }

  const primaryPages = ['home', 'orders', 'wallet', 'profile']
  const unreadCount = notices.filter((notice) => notice.unread).length

  return (
    <>
      <div className="app-content">
        {page === 'home' && (
          <CustomerHome
            onMenu={() => setDrawerOpen(true)}
            onNotifications={() => navigate('notifications')}
            onCart={() => navigate('cart')}
            cart={cart}
            cartCount={cartCount}
            updateCart={updateCart}
            openProduct={openProduct}
            unreadCount={unreadCount}
            catalog={catalog}
            primaryAddress={addresses[0]}
          />
        )}
        {page === 'orders' && (
          <OrdersScreen
            orders={orders}
            onMenu={() => setDrawerOpen(true)}
            onOpenOrder={(order) => { setSelectedOrder(order); navigate('order') }}
          />
        )}
        {page === 'order' &&
          (selectedOrder ? (
            <OrderTrackingScreen
              order={orders.find((entry) => entry.id === selectedOrder.id) || selectedOrder}
              onBack={() => navigate('orders')}
            />
          ) : (
            <div className="screen tracking-screen">
              <PageHeader title="Order" onBack={() => navigate('orders')} />
              <EmptyState image="/assets/images/OrderList.png" title="Order not found" text="Pick an order to track it." button="Back to orders" onClick={() => navigate('orders')} />
            </div>
          ))}
        {page === 'addresses' && (
          <AddressesScreen
            addresses={addresses}
            addAddress={addAddress}
            updateAddress={updateAddress}
            deleteAddress={deleteAddress}
            onBack={() => navigate('profile')}
            setToast={setToast}
          />
        )}
        {page === 'wallet' && (
          <WalletScreen
            onMenu={() => setDrawerOpen(true)}
            setToast={setToast}
            balance={balance}
            topupWallet={topupWallet}
            ledger={ledger}
          />
        )}
        {page === 'profile' && (
          <ProfileScreen
            onMenu={() => setDrawerOpen(true)}
            phone={phone}
            logout={logout}
            resetDemo={resetDemo}
            setToast={setToast}
            name={name}
            saveName={saveName}
            addresses={addresses}
            onManageAddresses={() => navigate('addresses')}
          />
        )}
        {page === 'product' &&
          (selectedProduct ? (
            <ProductDetail
              product={selectedProduct}
              quantity={cart[selectedProduct.id] || 0}
              updateCart={updateCart}
              onBack={() => navigate('home')}
              onCart={() => navigate('cart')}
              cartCount={cartCount}
            />
          ) : (
            <div className="screen detail-screen">
              <PageHeader title="Product details" onBack={() => navigate('home')} />
              <EmptyState
                image="/assets/images/No_Product_Found.png"
                title="Product unavailable"
                text="Pick a product from the home screen to see its details."
                button="Back to home"
                onClick={() => navigate('home')}
              />
            </div>
          ))}
        {page === 'cart' && (
          <CartScreen
            items={cartItems}
            subtotal={cartSubtotal}
            updateCart={updateCart}
            onBack={() => navigate('home')}
            onCheckout={() => navigate('checkout')}
          />
        )}
        {page === 'checkout' && (
          <CheckoutScreen
            count={cartCount}
            subtotal={cartSubtotal}
            balance={balance}
            addresses={addresses}
            onBack={() => navigate('cart')}
            onPlaceOrder={placeOrder}
            onManageAddresses={() => navigate('addresses')}
          />
        )}
        {page === 'notifications' && (
          <NotificationsScreen
            notices={notices}
            onBack={() => navigate('home')}
            markAll={markAllRead}
          />
        )}
        {page === 'about' && <InfoScreen type="about" onBack={() => navigate('home')} />}
        {page === 'learn' && <InfoScreen type="learn" onBack={() => navigate('home')} />}
        {page === 'terms' && <InfoScreen type="terms" onBack={() => navigate('profile')} />}
      </div>
      {primaryPages.includes(page) && (
        <BottomNav
          current={page}
          onChange={navigate}
          items={[
            { id: 'home', label: 'Home', icon: Home },
            { id: 'orders', label: 'Orders', icon: ListChecks },
            { id: 'wallet', label: 'Wallet', icon: WalletCards },
            { id: 'profile', label: 'Profile', icon: UserRound },
          ]}
        />
      )}
      <SideDrawer
        open={drawerOpen}
        close={() => setDrawerOpen(false)}
        navigate={navigate}
        logout={logout}
        role="customer"
        name={name}
      />
    </>
  )
}

function AppHeader({ onMenu, onNotifications, title, subtitle, showLocation = false, unreadCount = 0 }) {
  return (
    <header className="app-header">
      <button className="round-icon" onClick={onMenu} aria-label="Open menu"><Menu size={22} /></button>
      <div className="header-copy">
        {showLocation && <span className="location-line"><MapPin size={13} /> Delivering to</span>}
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {onNotifications ? (
        <button
          className="round-icon notification-button"
          onClick={onNotifications}
          aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell size={21} />{unreadCount > 0 && <i />}
        </button>
      ) : <img src="/assets/images/applogo1.png" className="header-logo" alt="Milky Mart" />}
    </header>
  )
}

function CustomerHome({ onMenu, onNotifications, onCart, cart, cartCount, updateCart, openProduct, unreadCount, catalog, primaryAddress }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('Popular')
  const search = searchable(query.trim())
  const visibleProducts = useMemo(() => {
    const matched = catalog.filter((product) => searchable(`${product.name} ${product.size}`).includes(search))
    if (sort === 'Price: low') return [...matched].sort((a, b) => a.price - b.price)
    if (sort === 'Price: high') return [...matched].sort((a, b) => b.price - a.price)
    if (sort === 'Offers') return matched.filter((product) => product.badge)
    return matched
  }, [search, sort, catalog])

  return (
    <div className="screen home-screen">
      <AppHeader
        onMenu={onMenu}
        onNotifications={onNotifications}
        title={primaryAddress ? localityOf(primaryAddress.detail) : 'Patna'}
        subtitle="Patna, Bihar"
        showLocation
        unreadCount={unreadCount}
      />
      <section className="welcome-line">
        <div><p>Good morning 👋</p><h1>What would you like today?</h1></div>
      </section>
      <section className="hero-card">
        <div className="hero-copy">
          <span>FARM TO HOME</span>
          <h2>Fresh milk,<br />every morning.</h2>
          <p>Pure dairy delivered in your preferred time slot.</p>
          <button onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}>Shop now <ChevronRight size={16} /></button>
        </div>
        <img src="/assets/images/milkman.png" alt="Milk delivery" />
        <div className="milk-drop drop-one" />
        <div className="milk-drop drop-two" />
      </section>
      <div className="search-box">
        <Search size={19} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for products..." />
        {query && <button onClick={() => setQuery('')}><X size={17} /></button>}
      </div>
      <section className="service-strip">
        <div><span><Truck size={18} /></span><p><strong>Free delivery</strong><small>Above ₹199</small></p></div>
        <div><span><Clock3 size={18} /></span><p><strong>Daily fresh</strong><small>Before 8 AM</small></p></div>
        <div><span><ShieldCheck size={18} /></span><p><strong>Pure quality</strong><small>Tested batches</small></p></div>
      </section>
      <div className="filter-pills sort-pills" role="group" aria-label="Sort products">
        {['Popular', 'Price: low', 'Price: high', 'Offers'].map((value) => (
          <button key={value} className={sort === value ? 'active' : ''} aria-pressed={sort === value} onClick={() => setSort(value)}>{value}</button>
        ))}
      </div>
      <section className="product-section" id="products">
        <div className="section-heading"><div><span>DAIRY PRODUCTS</span><h2>Fresh picks for you</h2></div><small>{visibleProducts.length} items</small></div>
        {visibleProducts.length ? (
          <div className="product-grid">
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                quantity={cart[product.id] || 0}
                updateCart={updateCart}
                openProduct={openProduct}
              />
            ))}
          </div>
        ) : (
          <EmptyState image="/assets/images/No_Product_Found.png" title="No products found" text="Try another product name." />
        )}
      </section>
      {cartCount > 0 && (
        <button className="floating-cart" onClick={onCart}>
          <span><ShoppingCart size={20} /><b>{cartCount}</b></span>
          <p><small>{cartCount} {cartCount === 1 ? 'item' : 'items'}</small><strong>View cart</strong></p>
          <ChevronRight size={20} />
        </button>
      )}
    </div>
  )
}

function ProductCard({ product, quantity, updateCart, openProduct }) {
  const discount = discountPercent(product)
  return (
    <article className="product-card">
      <button className="product-image" onClick={() => openProduct(product)}>
        {discount > 0 && <span className="discount-badge">{discount}% OFF</span>}
        {product.badge && <span className="product-badge">{product.badge}</span>}
        <img src={product.image} alt={product.name} />
      </button>
      <button className="product-info" onClick={() => openProduct(product)}>
        <h3>{product.name}</h3><p>{product.size}</p>
      </button>
      <div className="product-bottom">
        <div className="price-block">
          <strong>{money(product.price)}</strong>
          {discount > 0 && <span className="price-mrp">{money(product.mrp)}</span>}
        </div>
        {quantity ? (
          <QuantityControl quantity={quantity} minus={() => updateCart(product.id, -1)} plus={() => updateCart(product.id, 1)} small />
        ) : (
          <button className="add-button" onClick={() => updateCart(product.id, 1)}>ADD <Plus size={15} /></button>
        )}
      </div>
    </article>
  )
}

function ProductDetail({ product, quantity, updateCart, onBack, onCart, cartCount }) {
  return (
    <div className="screen detail-screen">
      <PageHeader title="Product details" onBack={onBack} action={
        <button className="round-icon cart-head-button" onClick={onCart}><ShoppingCart size={20} />{cartCount > 0 && <b>{cartCount}</b>}</button>
      } />
      <div className="detail-image"><img src={product.image} alt={product.name} />{product.badge && <span>{product.badge}</span>}</div>
      <section className="detail-copy">
        <span className="eyebrow">FRESH DAIRY</span>
        <h1>{product.name}</h1>
        <p className="detail-size">{product.size} • Delivered fresh</p>
        <div className="rating-row"><span>★ 4.8</span><small>128 ratings</small></div>
        <h2 className="detail-price">
          {money(product.price)}
          {discountPercent(product) > 0 && (
            <>
              <span className="detail-mrp">{money(product.mrp)}</span>
              <span className="detail-off">{discountPercent(product)}% OFF</span>
            </>
          )}
          <small>inclusive of all taxes</small>
        </h2>
        <div className="soft-divider" />
        <h3>About this product</h3>
        <p>{product.description}</p>
        <ul className="feature-list">
          <li><Check size={16} /> Quality checked before dispatch</li>
          <li><Check size={16} /> Cold-chain delivery</li>
          <li><Check size={16} /> Easy daily scheduling</li>
        </ul>
      </section>
      <div className="detail-action">
        <div><small>Price</small><strong>{money(product.price)} {discountPercent(product) > 0 && <span className="price-mrp">{money(product.mrp)}</span>}</strong></div>
        {quantity ? (
          <QuantityControl quantity={quantity} minus={() => updateCart(product.id, -1)} plus={() => updateCart(product.id, 1)} />
        ) : (
          <button className="primary-button" onClick={() => updateCart(product.id, 1)}>Add to cart <ShoppingBag size={19} /></button>
        )}
      </div>
    </div>
  )
}

function QuantityControl({ quantity, minus, plus, small = false }) {
  return (
    <div className={`quantity-control ${small ? 'quantity-small' : ''}`}>
      <button onClick={minus} aria-label="Decrease quantity"><Minus size={small ? 14 : 17} /></button>
      <strong>{quantity}</strong>
      <button onClick={plus} aria-label="Increase quantity"><Plus size={small ? 14 : 17} /></button>
    </div>
  )
}

function CartScreen({ items, subtotal, updateCart, onBack, onCheckout }) {
  return (
    <div className="screen cart-screen">
      <PageHeader title="My Cart" subtitle={items.length ? `${items.length} products` : ''} onBack={onBack} />
      {!items.length ? (
        <EmptyState image="/assets/images/cart.png" title="Your cart is empty" text="Add fresh dairy products to continue." button="Start shopping" onClick={onBack} />
      ) : (
        <>
          <div className="cart-list">
            {items.map((item) => (
              <article className="cart-item" key={item.id}>
                <img src={item.image} alt={item.name} />
                <div className="cart-item-copy"><h3>{item.name}</h3><p>{item.size}</p><strong>{money(item.price)}</strong></div>
                <QuantityControl quantity={item.quantity} minus={() => updateCart(item.id, -1)} plus={() => updateCart(item.id, 1)} small />
              </article>
            ))}
          </div>
          <div className="delivery-promise"><Truck size={22} /><div><strong>Morning delivery available</strong><p>Order now for delivery before 8:00 AM.</p></div></div>
          <section className="bill-card">
            <h3>Bill details</h3>
            <p><span>Item total</span><strong>{money(subtotal)}</strong></p>
            <p><span>Delivery fee</span><strong className="free-text">FREE</strong></p>
            <p><span>Handling charge</span><strong>₹0</strong></p>
            <div />
            <p className="bill-total"><span>To pay</span><strong>{money(subtotal)}</strong></p>
          </section>
          <div className="bottom-action-bar">
            <div><small>Total</small><strong>{money(subtotal)}</strong></div>
            <button className="primary-button" onClick={onCheckout}>Continue <ChevronRight size={19} /></button>
          </div>
        </>
      )}
    </div>
  )
}

function CheckoutScreen({ count, subtotal, balance, addresses, onBack, onPlaceOrder, onManageAddresses }) {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const formattedDate = tomorrow.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const [addressId, setAddressId] = useState(addresses[0]?.id)
  const [slot, setSlot] = useState('6:00 – 8:00 AM')
  const [placing, setPlacing] = useState(false)
  // One key per visit to checkout: retries of this same order are de-duplicated
  // server-side, so a double-tap can never create two orders.
  const idempotencyKey = useRef(
    globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `co-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
  )
  // Payment is automatic: wallet if it covers the bill, otherwise cash on delivery.
  const payByWallet = balance >= subtotal
  // The chosen address can disappear if it is deleted while checkout is open.
  const selected = addresses.find((entry) => entry.id === addressId) || addresses[0]

  return (
    <div className="screen checkout-screen">
      <PageHeader title="Confirm your order" onBack={onBack} />
      <div className="checkout-step">
        <span>1</span>
        <div><strong>Delivery address</strong><small>Where should we deliver?</small></div>
        <button className="step-action" onClick={onManageAddresses}>Manage</button>
      </div>
      <div className="address-choices" role="radiogroup" aria-label="Delivery address">
        {addresses.map((address) => (
          <button
            key={address.id}
            role="radio"
            aria-checked={selected?.id === address.id}
            className={`select-card ${selected?.id === address.id ? 'selected-card' : ''}`}
            onClick={() => setAddressId(address.id)}
          >
            <MapPin size={20} />
            <div><strong>{address.label}</strong><p>{address.detail}</p></div>
            {selected?.id === address.id ? <CheckCircle2 size={19} /> : <i className="radio-dot" />}
          </button>
        ))}
      </div>
      <div className="checkout-step"><span>2</span><div><strong>Delivery schedule</strong><small>Choose your preferred time</small></div></div>
      <div className="date-card"><CalendarDays size={20} /><div><small>DELIVERY DATE</small><strong>{formattedDate}</strong></div></div>
      <div className="slot-grid">
        {['6:00 – 8:00 AM', '8:00 – 10:00 AM', '5:00 – 7:00 PM'].map((value) => (
          <button className={slot === value ? 'active' : ''} onClick={() => setSlot(value)} key={value}><Clock3 size={16} />{value}</button>
        ))}
      </div>
      <div className="checkout-step"><span>3</span><div><strong>Payment method</strong><small>Automatically chosen for you</small></div></div>
      <div className="payment-list">
        {payByWallet ? (
          <div className="payment-auto active">
            <span><WalletCards size={20} /></span>
            <div><strong>Milky Mart Wallet</strong><small>Balance {money(balance)} — enough for this order</small></div>
            <i><Check size={13} /></i>
          </div>
        ) : (
          <div className="payment-auto active">
            <span><PackageCheck size={20} /></span>
            <div><strong>Cash on delivery</strong><small>{balance > 0 ? `Wallet has only ${money(balance)}` : 'Wallet is empty'} — pay at your doorstep</small></div>
            <i><Check size={13} /></i>
          </div>
        )}
      </div>
      <p className="payment-note"><Info size={14} /> {payByWallet ? 'Paid from your wallet balance.' : 'Pay cash on delivery. Add wallet balance via your delivery partner.'}</p>
      <div className="checkout-summary"><span>{count} {count === 1 ? 'item' : 'items'}</span><strong>{money(subtotal)}</strong></div>
      <button
        className="primary-button place-order-button"
        disabled={!count || !selected || placing}
        onClick={async () => {
          setPlacing(true)
          try {
            await onPlaceOrder({ address: selected.detail, slot, date: formattedDate, idempotencyKey: idempotencyKey.current })
          } finally {
            setPlacing(false)
          }
        }}
      >
        {placing ? 'Placing your order…' : `Place order • ${money(subtotal)}`} <CheckCircle2 size={19} />
      </button>
    </div>
  )
}

function OrdersScreen({ orders, onMenu, onOpenOrder }) {
  const [filter, setFilter] = useState('Active')
  const visible = orders.filter((order) =>
    filter === 'Active'
      ? ACTIVE_ORDER_STATUSES.includes(order.status)
      : !ACTIVE_ORDER_STATUSES.includes(order.status),
  )

  return (
    <div className="screen orders-screen">
      <AppHeader onMenu={onMenu} title="My Orders" subtitle="Track your daily deliveries" />
      <div className="segmented-control"><button className={filter === 'Active' ? 'active' : ''} onClick={() => setFilter('Active')}>Active orders</button><button className={filter === 'History' ? 'active' : ''} onClick={() => setFilter('History')}>Order history</button></div>
      {visible.length ? (
        <div className="order-list">{visible.map((order) => <OrderCard key={order.id} order={order} onOpen={onOpenOrder} />)}</div>
      ) : (
        <EmptyState
          image="/assets/images/OrderList.png"
          title={filter === 'Active' ? 'No active orders' : 'No past orders'}
          text="Your orders will appear here."
        />
      )}
    </div>
  )
}

function OrderTrackingScreen({ order, onBack }) {
  const stageIndex = order.status === 'Delivered' ? orderStages.length - 1 : orderStages.indexOf(order.status)
  const reached = stageIndex < 0 ? 0 : stageIndex
  const items = Array.isArray(order.items) ? order.items : []

  return (
    <div className="screen tracking-screen">
      <PageHeader title={`Order #${order.id}`} subtitle={order.date} onBack={onBack} />
      <section className="tracking-hero">
        <div>
          <span>{order.status === 'Delivered' ? 'COMPLETED' : 'ARRIVING'}</span>
          <strong>{order.status === 'Delivered' ? 'Delivered' : order.time}</strong>
          <p>{order.status === 'Delivered' ? `Delivered on ${order.date}` : 'Your milk is on schedule.'}</p>
        </div>
        <img src="/assets/images/milkman.png" alt="" />
      </section>
      <ol className="tracking-timeline">
        {orderStages.map((stage, index) => (
          <li key={stage} className={index <= reached ? 'done' : ''}>
            <span>{index <= reached ? <Check size={12} /> : index + 1}</span>
            <div>
              <strong>{stage}</strong>
              <small>{index < reached ? 'Completed' : index === reached ? 'In progress' : 'Pending'}</small>
            </div>
          </li>
        ))}
      </ol>
      <section className="bill-card">
        <h3>Order summary</h3>
        {items.map((item) => <p key={item}><span>{item}</span></p>)}
        <div />
        <p className="bill-total"><span>Total paid</span><strong>{money(order.total)}</strong></p>
      </section>
      <div className="order-meta tracking-meta">
        <p><Clock3 size={15} />{order.time}</p>
        <p><MapPin size={15} />{order.address}</p>
      </div>
    </div>
  )
}

function OrderCard({ order, onOpen }) {
  const isActive = ACTIVE_ORDER_STATUSES.includes(order.status)
  const items = Array.isArray(order.items) ? order.items : []
  return (
    <article className="order-card">
      <div className="order-card-head"><div><small>ORDER #{order.id}</small><strong>{order.date}</strong></div><span className={isActive ? 'status-active' : 'status-complete'}>{order.status}</span></div>
      <div className="order-products"><div className="mini-product-stack"><img src="/assets/images/milk1.png" alt="" /></div><div><strong>{order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}</strong><p>{items.join(' • ')}</p></div></div>
      <div className="order-meta"><p><Clock3 size={15} />{order.time}</p><p><MapPin size={15} />{order.address}</p></div>
      <div className="order-card-foot"><strong>{money(order.total)}</strong><button onClick={() => onOpen(order)}>{isActive ? 'Track order' : 'View details'} <ChevronRight size={16} /></button></div>
    </article>
  )
}

function WalletScreen({ onMenu, setToast, balance, topupWallet, ledger, rider = false }) {
  const [showTopup, setShowTopup] = useState(false)
  const [amount, setAmount] = useState('500')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const addMoney = async () => {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setToast('Enter an amount greater than ₹0')
      return
    }
    if (parsed > MAX_TOPUP) {
      setToast(`Maximum is ${money(MAX_TOPUP)} per top-up`)
      return
    }
    const trimmedNote = note.trim()
    if (rider && !trimmedNote) {
      setToast('Add a reason so admin and the customer can see it')
      return
    }
    setSaving(true)
    try {
      await topupWallet(parsed, rider ? trimmedNote : undefined)
      setShowTopup(false)
      setNote('')
      setToast(`${money(parsed)} added to wallet`)
    } catch (error) {
      setToast(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen wallet-screen">
      <AppHeader onMenu={onMenu} title={rider ? 'Rider Wallet' : 'My Wallet'} subtitle="Secure and instant payments" />
      <section className="wallet-card">
        <div className="wallet-shape wallet-shape-one" /><div className="wallet-shape wallet-shape-two" />
        <div><span>AVAILABLE BALANCE</span><h1>{money(balance)}</h1><p>{rider ? 'Earnings ready for withdrawal' : 'Use for faster milk deliveries'}</p></div>
        <img src="/assets/images/wallet.png" alt="Wallet" />
        <button onClick={() => setShowTopup(true)}><Plus size={17} />{rider ? 'Add adjustment' : 'Add money'}</button>
      </section>
      <div className="wallet-actions">
        <button onClick={() => setToast('Auto-pay is ready to set up')}><span><RefreshCw size={19} /></span><strong>Auto-pay</strong><small>Never miss a delivery</small></button>
        <button onClick={() => setToast('Rewards unlocked')}><span><Gift size={19} /></span><strong>Rewards</strong><small>₹50 saved this month</small></button>
      </div>
      <div className="section-heading"><div><span>RECENT ACTIVITY</span><h2>Transactions</h2></div><button onClick={() => setToast(`Showing all ${ledger.length} transactions`)}>View all</button></div>
      <div className="transaction-list">
        {ledger.map((transaction) => (
          <article key={transaction.id}><span className={transaction.type}><CreditCard size={18} /></span><div><strong>{transaction.label}</strong><small>{transaction.date}</small></div><b className={transaction.type}>{transaction.type === 'credit' ? '+' : '−'}{money(transaction.amount)}</b></article>
        ))}
      </div>
      {showTopup && (
        rider ? (
          <Modal close={() => setShowTopup(false)} title="Wallet adjustment">
            <label className="modal-label">Amount</label>
            <div className="money-input"><span>₹</span><input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))} autoFocus /></div>
            <div className="quick-amounts">{[200, 500, 1000].map((value) => <button key={value} onClick={() => setAmount(String(value))}>+ {money(value)}</button>)}</div>
            <label className="modal-label">Reason (visible to admin and customer)</label>
            <input className="modal-input" placeholder="e.g. Cash collected from Ramesh, Flat 4B" value={note} maxLength={140} onChange={(event) => setNote(event.target.value)} />
            <p className="payment-note"><Info size={14} /> This adjustment is logged with your name, so it can't be disputed later.</p>
            <button className="primary-button" onClick={addMoney} disabled={saving}>{saving ? 'Adding…' : 'Continue securely'} <ChevronRight size={19} /></button>
          </Modal>
        ) : (
          // Customers cannot top up themselves — wallet money is loaded in cash by
          // the delivery partner, then credited by us.
          <Modal close={() => setShowTopup(false)} title="Add money">
            <div className="wallet-info">
              <span className="wallet-info-icon"><WalletCards size={26} /></span>
              <p className="wallet-info-title">Dear User,</p>
              <p className="wallet-info-text">
                To add balance to your wallet, please hand the cash to your delivery
                partner. We’ll add that amount to your wallet for you.
              </p>
            </div>
            <button className="primary-button" onClick={() => setShowTopup(false)}>Got it <Check size={18} /></button>
          </Modal>
        )
      )}
    </div>
  )
}

function ProfileScreen({ onMenu, phone, logout, resetDemo, setToast, name, saveName, onManageAddresses, addresses = [], rider = false, approved = true }) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [saving, setSaving] = useState(false)
  const addressNote = addresses.length
    ? `${addresses.length} saved • ${addresses[0].label}`
    : 'No addresses yet'

  // Keep the field in sync when the name arrives/changes from the server.
  useEffect(() => { setDraftName(name) }, [name])

  const openEditor = () => {
    setDraftName(name)
    setEditing(true)
  }

  const saveProfile = async () => {
    const cleaned = draftName.trim()
    if (!cleaned) {
      setToast('Name cannot be empty')
      return
    }
    setSaving(true)
    try {
      await saveName(cleaned.slice(0, 40))
      setEditing(false)
      setToast('Profile updated')
    } catch (error) {
      setToast(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen profile-screen">
      <AppHeader onMenu={onMenu} title="Profile" subtitle="Your account and preferences" />
      <section className="profile-hero">
        <div className="avatar-wrap"><img src={rider ? '/assets/images/riderprofile.png' : '/assets/images/coustmer1.png'} onError={(event) => { event.currentTarget.src = '/assets/images/riderprofile.png' }} alt="Profile" /><button onClick={() => setToast('Photo picker opened in the Android app')}><Plus size={14} /></button></div>
        <div><h1>{name}</h1><p>{phone}</p><span><CheckCircle2 size={14} /> Verified account</span></div>
        <button className="edit-button" onClick={openEditor}>Edit</button>
      </section>
      {rider && (approved
        ? <div className="approval-banner"><ShieldCheck size={20} /><div><strong>Profile approved</strong><p>You can accept and complete deliveries.</p></div></div>
        : <div className="approval-banner pending"><Clock3 size={20} /><div><strong>Approval pending</strong><p>An admin is reviewing your profile. You’ll get deliveries once approved.</p></div></div>)}
      <section className="profile-group">
        <h3>ACCOUNT</h3>
        <ProfileRow icon={UserRound} label="Personal information" note="Name and phone number" onClick={openEditor} />
        <ProfileRow
          icon={MapPin}
          label={rider ? 'Service area' : 'Saved addresses'}
          note={rider ? 'Bengaluru Central' : addressNote}
          onClick={rider ? () => setToast('You deliver across Bengaluru Central') : onManageAddresses}
        />
        {rider && <ProfileRow icon={FileBadge} label="KYC documents" note="Aadhaar and PAN verified" onClick={() => setToast('Documents are verified')} />}
        {!rider && <ProfileRow icon={RefreshCw} label="Subscriptions" note="Manage recurring milk orders" onClick={() => setToast('No active subscription')} />}
      </section>
      <section className="profile-group">
        <h3>SUPPORT</h3>
        <ProfileRow icon={CircleHelp} label="Help & support" note="FAQs and contact details" onClick={() => setToast('Support is available 7 days a week')} />
        <ProfileRow icon={Info} label="Terms & privacy" note="Read our service policies" onClick={() => setToast('Terms are included in the side menu')} />
      </section>
      <button className="reset-button" onClick={resetDemo}><RefreshCw size={17} /> Sync with server</button>
      <button className="logout-button" onClick={logout}><LogOut size={18} /> Logout</button>
      <p className="version-copy">Milky Mart • Version 3.0.0 clone</p>
      {editing && (
        <Modal close={() => setEditing(false)} title="Edit profile">
          <label className="modal-label" htmlFor="profile-name">Full name</label>
          <input
            className="modal-input"
            id="profile-name"
            value={draftName}
            maxLength={40}
            onChange={(event) => setDraftName(event.target.value)}
            autoFocus
          />
          <label className="modal-label" htmlFor="profile-phone">Phone number</label>
          <input className="modal-input" id="profile-phone" value={phone} disabled />
          <button className="primary-button" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save changes'} <Check size={18} /></button>
        </Modal>
      )}
    </div>
  )
}

function AddressesScreen({ addresses, addAddress, updateAddress, deleteAddress, onBack, setToast }) {
  const [editing, setEditing] = useState(null)
  const [label, setLabel] = useState('')
  const [detail, setDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [areaError, setAreaError] = useState('')

  const openEditor = (address) => {
    setEditing(address || { id: '', label: '', detail: '' })
    setLabel(address ? address.label : '')
    setDetail(address ? address.detail : '')
    setAreaError('')
  }

  const save = async () => {
    const cleanLabel = label.trim()
    const cleanDetail = detail.trim()
    setAreaError('')
    if (!cleanLabel || !cleanDetail) {
      setAreaError('Add both a label and a full address.')
      return
    }
    setSaving(true)
    try {
      if (editing.id) await updateAddress(editing.id, cleanLabel, cleanDetail)
      else await addAddress(cleanLabel, cleanDetail)
      setEditing(null)
      setToast(editing.id ? 'Address updated' : 'Address added')
    } catch (error) {
      // Out-of-service-area and validation errors show inline, Blinkit-style.
      if (error.status === 422) setAreaError(error.message)
      else setToast(error.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    if (addresses.length === 1) {
      setToast('Keep at least one delivery address')
      return
    }
    try {
      await deleteAddress(id)
      setToast('Address removed')
    } catch (error) {
      setToast(error.message)
    }
  }

  return (
    <div className="screen addresses-screen">
      <PageHeader title="Saved addresses" subtitle={`${addresses.length} saved`} onBack={onBack} />
      <div className="address-list">
        {addresses.map((address) => (
          <article key={address.id}>
            <span><MapPin size={18} /></span>
            <div><strong>{address.label}</strong><p>{address.detail}</p></div>
            <div className="address-tools">
              <button onClick={() => openEditor(address)} aria-label={`Edit ${address.label}`}><FileBadge size={16} /></button>
              <button onClick={() => remove(address.id)} aria-label={`Delete ${address.label}`}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </div>
      <button className="primary-button" onClick={() => openEditor(null)}>Add a new address <Plus size={18} /></button>
      {editing && (
        <Modal close={() => setEditing(null)} title={editing.id ? 'Edit address' : 'New address'}>
          <label className="modal-label" htmlFor="addr-label">Label</label>
          <input className="modal-input" id="addr-label" value={label} maxLength={20} placeholder="Home, Work, Mom's place" onChange={(event) => setLabel(event.target.value)} autoFocus />
          <label className="modal-label" htmlFor="addr-detail">Full address</label>
          <textarea className="modal-input modal-textarea" id="addr-detail" value={detail} maxLength={140} placeholder="Flat, street, area, Patna, PIN (e.g. 800020)" onChange={(event) => { setDetail(event.target.value); setAreaError('') }} />
          <p className="area-hint"><MapPin size={13} /> We currently deliver only in Patna.</p>
          {areaError && <div className="area-error"><Info size={16} /><span>{areaError}</span></div>}
          <button className="primary-button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save address'} <Check size={18} /></button>
        </Modal>
      )}
    </div>
  )
}

function ProfileRow({ icon: Icon, label, note, onClick }) {
  return <button className="profile-row" onClick={onClick}><span><Icon size={19} /></span><div><strong>{label}</strong><small>{note}</small></div><ChevronRight size={18} /></button>
}

function NotificationsScreen({ notices, onBack, markAll }) {
  return (
    <div className="screen notifications-screen">
      <PageHeader title="Notifications" onBack={onBack} action={<button className="text-action" onClick={markAll}>Mark all read</button>} />
      <div className="notification-hero"><img src="/assets/icons/paynotificationimage.png" alt="Notifications" /><div><strong>Stay up to date</strong><p>Order, payment and offer updates appear here.</p></div></div>
      <div className="notification-list">{notices.map((notice) => <article className={notice.unread ? 'unread' : ''} key={notice.id}><span><Bell size={18} /></span><div><div><strong>{notice.title}</strong><small>{notice.time}</small></div><p>{notice.body}</p></div>{notice.unread && <i />}</article>)}</div>
    </div>
  )
}

function InfoScreen({ type, onBack }) {
  const content = {
    about: {
      eyebrow: 'ABOUT MILKY MART', title: 'Fresh dairy, made simple.', image: '/assets/icons/aidashboard.jpg',
      paragraphs: ['Milky Mart connects households with fresh dairy products and reliable daily delivery.', 'Every order is designed around flexible scheduling, clear tracking and simple payments.'],
    },
    learn: {
      eyebrow: 'HOW IT WORKS', title: 'Your morning milk in four easy steps.', image: '/assets/images/milkman.png',
      paragraphs: ['Choose your dairy products, select a delivery slot, confirm your address and pay using your preferred method.', 'Our rider dashboard keeps every assigned delivery visible and easy to complete.'],
    },
    terms: {
      eyebrow: 'TERMS & PRIVACY', title: 'नियम एवं शर्तें',
      paragraphs: ['MilkyMart – ग्राहक के लिए महत्वपूर्ण नियम एवं शर्तें'],
      sections: [
        {
          heading: '1. डिलीवरी में देरी',
          body: 'ट्रैफिक, मौसम, रोड की स्थिति या किसी अन्य अप्रत्याशित कारण से दूध की डिलीवरी निर्धारित समय से थोड़ी देर हो सकती है। ऐसी स्थिति में MilkyMart ग्राहक से सहयोग की अपेक्षा करता है।',
        },
        {
          heading: '2. दूध प्राप्त होने के बाद उबालना आवश्यक है',
          body: 'ग्राहक को दूध प्राप्त होने के 30 मिनट के अंदर दूध को अच्छी तरह उबाल लेना चाहिए और उसके बाद उचित तापमान पर सुरक्षित स्थान/फ्रिज में रखना चाहिए। दूध को लंबे समय तक कमरे के तापमान पर न रखें।',
        },
        {
          heading: '3. दूध की गुणवत्ता एवं Refund Policy',
          body: 'MilkyMart का प्रयास रहता है कि दूध को लगभग 4°C तापमान पर Milk Plant से Dispatch किया जाए, ताकि उसकी गुणवत्ता और ताजगी बनी रहे। यदि दूध प्राप्त होने पर उसमें गुणवत्ता संबंधी कोई वास्तविक समस्या पाई जाती है, तो ग्राहक तुरंत MilkyMart Customer Support से संपर्क करें। जांच के बाद उचित स्थिति में Refund/Replacement दिया जा सकता है।',
        },
        {
          heading: '4. Payment केवल Official QR Code पर करें',
          body: 'ग्राहक भुगतान करते समय केवल MilkyMart के Official QR Code का ही उपयोग करें। किसी व्यक्तिगत या अनधिकृत QR Code/UPI ID पर किए गए भुगतान की जिम्मेदारी MilkyMart की नहीं होगी। भुगतान करने के बाद Transaction की जानकारी सुरक्षित रखें।',
        },
        {
          heading: '5. शिकायत एवं Customer Support',
          body: 'दूध या किसी अन्य उत्पाद से संबंधित शिकायत होने पर ग्राहक को उत्पाद प्राप्त होने के बाद जल्द से जल्द MilkyMart Customer Support से संपर्क करना चाहिए। शिकायत के समाधान के लिए Order/Payment की जानकारी उपलब्ध कराना आवश्यक हो सकता है।',
        },
      ],
      support: { phones: ['9006403576', '6261639329'], website: 'www.milkymart.in' },
      fssai: '20426001002366',
      // Registered FBO name and premises exactly as printed on the FSSAI
      // registration certificate, shown alongside the licence number.
      business: 'MILKYMART',
      address: 'Ward No-33, Pillor No-34, Purvi Indra Nagar, Patna Sadar, Patna, Bihar - 800020',
      tagline: 'MilkyMart – Pure Milk, Pure Happiness',
      links: true,
    },
  }[type]
  return (
    <div className="screen info-screen">
      <PageHeader title={type === 'terms' ? 'Terms & privacy' : 'Milky Mart'} onBack={onBack} />
      {content.image && <img className={`info-image info-${type}`} src={content.image} alt="" />}
      <span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1>
      {content.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {content.sections && (
        <div className="terms-list">
          {content.sections.map((section) => (
            <section key={section.heading}>
              <strong>{section.heading}</strong>
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      )}
      {content.support && (
        <div className="support-card">
          <strong><Phone size={15} /> MilkyMart Customer Support</strong>
          <div className="support-numbers">
            {content.support.phones.map((number) => (
              <a key={number} href={`tel:+91${number}`}>+91 {number}</a>
            ))}
          </div>
          <a className="support-site" href={`https://${content.support.website}`} target="_blank" rel="noreferrer">
            <Globe size={14} /> {content.support.website}
          </a>
          {content.fssai && (
            <div className="licence-block">
              <small><strong>{content.business}</strong></small>
              <small>FSSAI Reg. No. {content.fssai}</small>
              <small>{content.address}</small>
            </div>
          )}
          {content.tagline && <em>{content.tagline}</em>}
        </div>
      )}
      {type === 'learn' && <div className="steps-list">{['Browse fresh products', 'Choose delivery timing', 'Confirm and pay', 'Track your order'].map((step, index) => <div key={step}><span>{index + 1}</span><strong>{step}</strong></div>)}</div>}
      {content.links && (
        <div className="legal-links">
          <a href={`${api.base}/legal/terms.html`} target="_blank" rel="noreferrer"><FileBadge size={17} /> Read the full Terms &amp; Conditions <ChevronRight size={16} /></a>
        </div>
      )}
      <div className="info-values"><div><ShieldCheck /><strong>Quality first</strong></div><div><Clock3 /><strong>On-time delivery</strong></div><div><UserRound /><strong>Customer care</strong></div></div>
    </div>
  )
}

function RiderApp({ page, navigate, drawerOpen, setDrawerOpen, deliveries, advanceDelivery, logout, resetDemo, setToast, phone, name, saveName, balance, topupWallet, ledger, approved }) {
  const primaryPages = ['home', 'deliveries', 'wallet', 'profile']

  const onAdvance = async (id) => {
    const delivery = deliveries.find((entry) => entry.id === id)
    if (!delivery) return
    if (delivery.status === 'Completed') {
      setToast(`Delivery #${id} is already completed`)
      return
    }
    try {
      const updated = await advanceDelivery(id)
      setToast(updated.status === 'Completed' ? `Order #${id} completed` : `Delivery #${id} started`)
    } catch (error) {
      setToast(error.message)
    }
  }

  return (
    <>
      <div className="app-content">
        {page === 'home' && (approved
          ? <RiderHome deliveries={deliveries} onMenu={() => setDrawerOpen(true)} navigate={navigate} name={name} />
          : <RiderPending onMenu={() => setDrawerOpen(true)} name={name} />)}
        {page === 'deliveries' && (approved
          ? <RiderDeliveries deliveries={deliveries} onMenu={() => setDrawerOpen(true)} advanceDelivery={onAdvance} setToast={setToast} />
          : <RiderPending onMenu={() => setDrawerOpen(true)} name={name} />)}
        {page === 'wallet' && <WalletScreen onMenu={() => setDrawerOpen(true)} setToast={setToast} balance={balance} topupWallet={topupWallet} ledger={ledger} rider />}
        {page === 'profile' && <ProfileScreen onMenu={() => setDrawerOpen(true)} phone={phone} logout={logout} resetDemo={resetDemo} setToast={setToast} name={name} saveName={saveName} approved={approved} rider />}
        {page === 'about' && <InfoScreen type="about" onBack={() => navigate('home')} />}
        {page === 'learn' && <InfoScreen type="learn" onBack={() => navigate('home')} />}
      </div>
      {primaryPages.includes(page) && <BottomNav current={page} onChange={navigate} items={[
        { id: 'home', label: 'Home', icon: Home },
        { id: 'deliveries', label: 'Orders', icon: PackageCheck },
        { id: 'wallet', label: 'Wallet', icon: WalletCards },
        { id: 'profile', label: 'Profile', icon: UserRound },
      ]} />}
      <SideDrawer open={drawerOpen} close={() => setDrawerOpen(false)} navigate={navigate} logout={logout} role="rider" name={name} />
    </>
  )
}

function RiderPending({ onMenu, name }) {
  return (
    <div className="screen rider-home-screen">
      <AppHeader onMenu={onMenu} title="Rider Dashboard" subtitle={`Hi, ${name.split(' ')[0]}`} />
      <section className="rider-pending">
        <span className="rider-pending-mark"><Clock3 size={34} /></span>
        <h1>Approval pending</h1>
        <p>Your delivery partner account is under review. An admin will approve your profile shortly — you’ll be able to see and complete assigned deliveries once approved.</p>
        <div className="rider-pending-status"><ShieldCheck size={17} /> Waiting for admin approval</div>
      </section>
    </div>
  )
}

function RiderHome({ deliveries, onMenu, navigate, name }) {
  const assigned = deliveries.filter((delivery) => delivery.status === 'Assigned')
  const completed = deliveries.filter((delivery) => delivery.status === 'Completed')
  const earnings = completed.reduce((sum, delivery) => sum + Math.round(delivery.amount * 0.12), 0)
  return (
    <div className="screen rider-home-screen">
      <AppHeader onMenu={onMenu} title="Rider Dashboard" subtitle={`Good morning, ${name.split(' ')[0]}`} />
      <section className="rider-status-card"><div><span className="online-dot" /> ONLINE</div><h1>Ready for today’s route?</h1><p>You have {assigned.length} {assigned.length === 1 ? 'delivery' : 'deliveries'} waiting.</p><img src="/assets/images/milkman.png" alt="Rider" /></section>
      <div className="rider-stats">
        <article><span><PackageCheck size={20} /></span><p><strong>{assigned.length}</strong><small>Assigned</small></p></article>
        <article><span><CheckCircle2 size={20} /></span><p><strong>{completed.length}</strong><small>Completed</small></p></article>
        <article><span><WalletCards size={20} /></span><p><strong>{money(earnings)}</strong><small>Earnings</small></p></article>
      </div>
      <div className="section-heading"><div><span>NEXT DELIVERY</span><h2>Up next</h2></div><button onClick={() => navigate('deliveries')}>View all</button></div>
      {assigned[0] ? <RiderDeliveryCard delivery={assigned[0]} compact onAction={() => navigate('deliveries')} /> : <EmptyState image="/assets/images/OrderList.png" title="No new orders" text="Distributed orders will appear here." />}
      <div className="route-summary"><span><Navigation size={22} /></span><div><strong>Today’s route</strong><p>3 stops • 5.8 km estimated</p></div><ChevronRight size={18} /></div>
    </div>
  )
}

function RiderDeliveries({ deliveries, onMenu, advanceDelivery, setToast }) {
  const [filter, setFilter] = useState('Assigned')
  const visible = deliveries.filter((delivery) => filter === 'All' || delivery.status === filter)
  return (
    <div className="screen rider-delivery-screen">
      <AppHeader onMenu={onMenu} title="Distribute Orders" subtitle="Manage assigned deliveries" />
      <div className="filter-pills">{['Assigned', 'In transit', 'Completed', 'All'].map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</div>
      {visible.length ? (
        <div className="rider-delivery-list">
          {visible.map((delivery) => (
            <RiderDeliveryCard
              key={delivery.id}
              delivery={delivery}
              onAction={() => advanceDelivery(delivery.id)}
              setToast={setToast}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          image="/assets/images/OrderList.png"
          title={filter === 'All' ? 'No orders yet' : `No ${filter.toLowerCase()} orders`}
          text="Your distributed orders will appear here."
        />
      )}
    </div>
  )
}

function RiderDeliveryCard({ delivery, onAction, setToast, compact = false }) {
  const actionLabel = delivery.status === 'Assigned' ? 'Start delivery' : delivery.status === 'In transit' ? 'Mark completed' : 'View receipt'
  const phone = dialable(delivery.phone)
  return (
    <article className={`rider-delivery-card ${compact ? 'compact' : ''}`}>
      <div className="rider-order-head"><div><small>DELIVERY #{delivery.id}</small><strong>{delivery.slot}</strong></div><span className={`rider-status ${delivery.status.toLowerCase().replace(/\s+/g, '-')}`}>{delivery.status}</span></div>
      <div className="customer-line"><span><UserRound size={20} /></span><div><strong>{delivery.customer}</strong><small>{delivery.items}</small></div><a href={`tel:${phone}`} aria-label={`Call ${delivery.customer}`}><Phone size={17} /></a></div>
      <div className="delivery-address"><MapPin size={17} /><p>{delivery.address}</p></div>
      {!compact && <div className="delivery-payment"><span>{delivery.payment}</span><strong>{money(delivery.amount)}</strong></div>}
      <div className="delivery-actions">
        {/* Universal Google Maps link — opens the Maps app for turn-by-turn
            navigation on Android, or maps in a browser elsewhere. No API key. */}
        <a
          className="map-button"
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(delivery.address)}&travelmode=driving`}
          target="_blank"
          rel="noreferrer"
        >
          <LocateFixed size={17} /> Directions
        </a>
        <button className="primary-button" onClick={onAction}>{actionLabel} <ChevronRight size={17} /></button>
      </div>
    </article>
  )
}

function BottomNav({ current, onChange, items }) {
  return (
    <nav className="bottom-nav">
      {items.map(({ id, label, icon: Icon }) => <button key={id} className={current === id ? 'active' : ''} onClick={() => onChange(id)}><span><Icon size={21} /></span><small>{label}</small></button>)}
    </nav>
  )
}

function SideDrawer({ open, close, navigate, logout, role, name }) {
  useEscapeKey(open, close)

  return (
    <>
      <button className={`drawer-scrim ${open ? 'open' : ''}`} onClick={close} aria-label="Close menu" tabIndex={open ? 0 : -1} />
      {/* inert keeps the off-screen drawer out of the tab order while it is closed */}
      <aside className={`side-drawer ${open ? 'open' : ''}`} inert={!open}>
        <div className="drawer-head"><img src="/assets/images/applogo.png" alt="Milky Mart" /><button onClick={close} aria-label="Close menu"><X size={20} /></button></div>
        <div className="drawer-profile"><span><UserRound size={23} /></span><div><strong>{name}</strong><small>{role === 'rider' ? 'Delivery Partner' : 'Milky Mart Customer'}</small></div></div>
        <nav>
          <button onClick={() => navigate('home')}><Home size={19} /> Home <ChevronRight size={17} /></button>
          <button onClick={() => navigate(role === 'rider' ? 'deliveries' : 'orders')}><ListChecks size={19} /> {role === 'rider' ? 'Distribute orders' : 'My orders'} <ChevronRight size={17} /></button>
          <button onClick={() => navigate('wallet')}><WalletCards size={19} /> Wallet <ChevronRight size={17} /></button>
          <button onClick={() => navigate('profile')}><UserRound size={19} /> Profile <ChevronRight size={17} /></button>
          <div />
          <button onClick={() => navigate('about')}><Info size={19} /> About us <ChevronRight size={17} /></button>
          <button onClick={() => navigate('learn')}><CircleHelp size={19} /> Learn more <ChevronRight size={17} /></button>
          {role === 'customer' && <button onClick={() => navigate('terms')}><ShieldCheck size={19} /> Terms & privacy <ChevronRight size={17} /></button>}
        </nav>
        <button className="drawer-logout" onClick={logout}><LogOut size={18} /> Logout</button>
        <p>Milky Mart v3.0.0</p>
      </aside>
    </>
  )
}

function PageHeader({ title, subtitle, onBack, action }) {
  return <header className="page-header"><button className="round-icon" onClick={onBack}><ArrowLeft size={21} /></button><div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>{action || <span />}</header>
}

function EmptyState({ image, title, text, button, onClick }) {
  return <section className="empty-state"><img src={image} alt="" /><h2>{title}</h2><p>{text}</p>{button && <button className="primary-button" onClick={onClick}>{button}<ChevronRight size={18} /></button>}</section>
}

const FOCUSABLE = 'button, [href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

function Modal({ close, title, children }) {
  const card = useRef(null)
  useEscapeKey(true, close)

  // The scrolling element is the phone frame, not the document body.
  useEffect(() => {
    const frame = document.querySelector('.app-frame')
    if (!frame) return undefined
    const previous = frame.style.overflowY
    frame.style.overflowY = 'hidden'
    return () => {
      frame.style.overflowY = previous
    }
  }, [])

  // Keep Tab inside the dialog and hand focus back where it came from on close.
  useEffect(() => {
    const opener = document.activeElement
    const onKeyDown = (event) => {
      if (event.key !== 'Tab' || !card.current) return
      const items = [...card.current.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()} role="dialog" aria-modal="true" aria-label={title}>
      <section className="modal-card" ref={card}>
        <div className="modal-head"><h2>{title}</h2><button onClick={close} aria-label="Close"><X size={20} /></button></div>
        {children}
      </section>
    </div>
  )
}

function Toast({ message }) {
  return <div className={`toast ${message ? 'visible' : ''}`} role="status" aria-live="polite"><CheckCircle2 size={18} /><span>{message}</span></div>
}

export default App
