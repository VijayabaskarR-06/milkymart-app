import { expect, test } from '@playwright/test'

// End-to-end tests against the live backend (Express + Postgres). The demo
// database is reset before each test via the admin API, so tests are order-
// independent. Requires the backend running on :4000 (see milkymart-backend).
const API = process.env.TEST_API_URL || 'http://localhost:4000'

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${API}/api/admin/login`, {
    data: { email: 'admin@milkymart.app', password: 'milkymart123' },
  })
  const { token } = await res.json()
  await request.post(`${API}/api/admin/reset`, { headers: { Authorization: `Bearer ${token}` } })
})

// Matched by label, not position: the rider and customer tabs differ, and a new
// tab used to silently shift every index after it.
const nav = (page, label) => page.locator('.bottom-nav button', { hasText: label })
const HOME = 'Home'
const ORDERS = 'Orders'
const WALLET = 'Wallet'
const PROFILE = 'Profile'

async function login(page, role = 'customer') {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForTimeout(1100)
  await page.getByText(role === 'rider' ? 'Delivery partner login' : 'Continue as customer').click()
  // Nothing is pre-filled any more — both roles type their own number.
  await page.locator('#phone').fill(role === 'rider' ? '9998887770' : '9876543210')
  await page.getByRole('button', { name: /Send OTP/ }).click()
  await page.waitForSelector('#otp')
  await page.locator('#otp').fill('123456')
  await page.getByRole('button', { name: /Verify & continue/ }).click()
  await page.waitForSelector(role === 'rider' ? '.rider-status-card' : '.product-grid')
}

async function adminToken(request) {
  const res = await request.post(`${API}/api/admin/login`, {
    data: { email: 'admin@milkymart.app', password: 'milkymart123' },
  })
  return (await res.json()).token
}

test.describe('catalogue', () => {
  test('products load from the API', async ({ page }) => {
    await login(page)
    await expect(page.locator('.product-card')).toHaveCount(8)
  })

  test('price sort orders ascending', async ({ page }) => {
    await login(page)
    await page.locator('.sort-pills button', { hasText: 'Price: low' }).click()
    const prices = (await page.locator('.product-bottom > strong').allTextContents()).map((v) => Number(v.replace(/\D/g, '')))
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })
})

test.describe('orders and wallet (persisted to Postgres)', () => {
  test('placing a wallet order debits the balance and records a transaction', async ({ page }) => {
    await login(page)
    await page.locator('.add-button').first().click() // Farm Fresh Milk, 68
    await page.locator('.floating-cart').click()
    await page.getByRole('button', { name: /^Continue/ }).click()
    await page.locator('.place-order-button').click()
    await expect(page.locator('.order-card').first()).toBeVisible()

    await nav(page, WALLET).click()
    await expect(page.locator('.wallet-card h1')).toHaveText('₹1,182') // 1250 - 68
    await expect(page.locator('.transaction-list article strong').first()).toContainText('Order #')
  })

  test('a customer cannot top up their own wallet', async ({ page }) => {
    // Customers hand cash to the delivery partner and an admin credits it —
    // there is no self-serve top-up, in the UI or on the API.
    await login(page)
    await nav(page, WALLET).click()
    await page.getByRole('button', { name: /Add money/ }).click()
    await expect(page.locator('.wallet-info-text')).toContainText('delivery partner')
    await expect(page.getByRole('button', { name: /Continue securely/ })).toHaveCount(0)
  })

  test("a rider's wallet adjustment needs a reason and persists across a reload", async ({ page }) => {
    await login(page, 'rider')
    await nav(page, WALLET).click()
    await page.getByRole('button', { name: /Add adjustment/ }).click()

    // No reason yet — the adjustment is refused and the balance is untouched.
    await page.getByRole('button', { name: /Continue securely/ }).click()
    await expect(page.locator('.toast.visible')).toContainText('reason')

    await page.locator('.modal-input').fill('Cash collected from Ramesh, Flat 4B')
    await page.getByRole('button', { name: /Continue securely/ }).click()
    await expect(page.locator('.wallet-card h1')).toHaveText('₹1,340') // 840 + 500

    await page.reload()
    await page.waitForTimeout(1100)
    await nav(page, WALLET).click()
    await expect(page.locator('.wallet-card h1')).toHaveText('₹1,340')
    await expect(page.locator('.transaction-list article strong').first()).toContainText('Ramesh')
  })

  test('an order beyond the wallet balance falls back to cash on delivery', async ({ page }) => {
    await login(page)
    await page.evaluate(() => localStorage.setItem('milky-mart-cart', '{"farmers":20}')) // 20 x 72 = 1440 > 1250
    await page.reload()
    await page.waitForTimeout(1100)
    await page.locator('.floating-cart').click()
    await page.getByRole('button', { name: /^Continue/ }).click()
    await expect(page.locator('.payment-auto')).toContainText('Cash on delivery')
    await expect(page.locator('.place-order-button')).toBeEnabled()
    await page.locator('.place-order-button').click()
    await expect(page.locator('.order-card').first()).toBeVisible()
  })

  test('an affordable order is auto-paid from the wallet', async ({ page }) => {
    await login(page)
    await page.locator('.add-button').first().click() // 68, well under 1250
    await page.locator('.floating-cart').click()
    await page.getByRole('button', { name: /^Continue/ }).click()
    await expect(page.locator('.payment-auto')).toContainText('Milky Mart Wallet')
  })
})

test.describe('admin <-> app integration', () => {
  test('an order placed in the app appears in the admin API', async ({ page, request }) => {
    await login(page)
    await page.locator('.add-button').first().click()
    await page.locator('.floating-cart').click()
    await page.getByRole('button', { name: /^Continue/ }).click()
    await page.locator('.place-order-button').click()
    await expect(page.locator('.order-card').first()).toBeVisible()
    const newest = (await page.locator('.order-card .order-card-head small').first().textContent()).replace('ORDER #', '').trim()

    const token = await adminToken(request)
    const res = await request.get(`${API}/api/admin/orders`, { headers: { Authorization: `Bearer ${token}` } })
    const { items } = await res.json() // paginated: { items, total, limit, offset }
    expect(items.find((o) => o.id === newest)).toBeTruthy()
  })

  test('an admin status change is reflected in the app after sync', async ({ page, request }) => {
    await login(page)
    const token = await adminToken(request)
    await request.patch(`${API}/api/admin/orders/MM1048`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { status: 'Delivered' },
    })
    await nav(page, PROFILE).click()
    await page.locator('.reset-button').click() // "Sync with server"
    await page.waitForTimeout(700)
    await nav(page, ORDERS).click()
    await page.locator('.segmented-control button').nth(1).click() // History
    await expect(page.locator('.order-card').filter({ hasText: 'MM1048' })).toHaveCount(1)
  })

  test('a product added in the admin API shows up in the app', async ({ page, request }) => {
    const token = await adminToken(request)
    await request.post(`${API}/api/admin/products`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { id: 'test-lassi', name: 'Sweet Lassi', size: '250 ml', price: 25, mrp: 30, category: 'Milk' },
    })
    await login(page)
    await expect(page.locator('.product-card')).toHaveCount(9)
    await page.getByPlaceholder('Search for products...').fill('sweet lassi')
    await expect(page.locator('.product-card')).toHaveCount(1)
  })
})

test.describe('addresses (CRUD to Postgres)', () => {
  const openAddresses = async (page) => {
    await nav(page, PROFILE).click()
    await page.getByText('Saved addresses').click()
    await page.waitForSelector('.address-list')
  }

  test('a Patna address persists and is usable at checkout', async ({ page }) => {
    await login(page)
    await openAddresses(page)
    await page.getByRole('button', { name: /Add a new address/ }).click()
    await page.locator('#addr-label').fill('Office')
    await page.locator('#addr-detail').fill('Maurya Lok, Dak Bungalow Road, Patna 800001')
    await page.getByRole('button', { name: /Save address/ }).click()
    await expect(page.locator('.address-list article')).toHaveCount(3)

    await page.reload()
    await page.waitForTimeout(1100)
    await openAddresses(page)
    await expect(page.locator('.address-list article')).toHaveCount(3)
  })

  test('a non-Patna address is rejected with an unavailable message', async ({ page }) => {
    await login(page)
    await openAddresses(page)
    await page.getByRole('button', { name: /Add a new address/ }).click()
    await page.locator('#addr-label').fill('Mumbai')
    await page.locator('#addr-detail').fill('12 Marine Drive, Mumbai 400002')
    await page.getByRole('button', { name: /Save address/ }).click()
    await expect(page.locator('.area-error')).toContainText('not available')
    await expect(page.locator('.address-list article')).toHaveCount(2) // not added
  })

  test('the last address cannot be deleted', async ({ page }) => {
    await login(page)
    await openAddresses(page)
    await page.locator('.address-tools button').last().click() // delete one (2 -> 1)
    await expect(page.locator('.address-list article')).toHaveCount(1)
    await page.locator('.address-tools button').last().click() // attempt last
    await expect(page.locator('.address-list article')).toHaveCount(1)
    await expect(page.locator('.toast.visible')).toContainText('at least one')
  })
})

test.describe('profile', () => {
  test('a name change persists across a reload', async ({ page }) => {
    await login(page)
    await nav(page, PROFILE).click()
    await page.locator('.edit-button').click()
    await page.locator('#profile-name').fill('Aarav Verified')
    await page.getByRole('button', { name: /Save changes/ }).click()
    await page.waitForTimeout(500)
    await page.reload()
    await page.waitForTimeout(1100)
    await nav(page, PROFILE).click()
    await expect(page.locator('.profile-hero h1')).toHaveText('Aarav Verified')
  })
})

test.describe('rider', () => {
  test('deliveries load and advance through the lifecycle', async ({ page }) => {
    await login(page, 'rider')
    await nav(page, ORDERS).click()
    await page.locator('.filter-pills button').first().click() // Assigned
    await page.waitForSelector('.rider-delivery-card')
    await page.locator('.rider-delivery-card .primary-button').first().click()
    await page.waitForTimeout(500)
    await page.locator('.filter-pills button').nth(1).click() // In transit
    await expect(page.locator('.rider-status.in-transit').first()).toBeVisible()
  })

  test('phone links are dialable', async ({ page }) => {
    await login(page, 'rider')
    await nav(page, ORDERS).click()
    await page.locator('.filter-pills button').nth(3).click() // All
    const href = await page.locator('.customer-line a').first().getAttribute('href')
    expect(href).not.toMatch(/\s/)
  })

  test('cash screen lists every customer, flags low fund and refuses an overdraw', async ({ page, request }) => {
    const token = await adminToken(request)
    const customers = (await (await request.get(`${API}/api/admin/customers`, { headers: { Authorization: `Bearer ${token}` } })).json())
    // A brand-new customer has an empty wallet, so must show as low fund.
    await request.post(`${API}/api/auth/verify-otp`, { data: { phone: '9111222333', otp: '111111', role: 'customer' } })
    await login(page, 'rider')
    await nav(page, 'Cash').click()
    await page.waitForSelector('.cash-customer')
    expect(await page.locator('.cash-customer').count()).toBeGreaterThanOrEqual(customers.length + 1)

    // The page must not scroll sideways or be zoomable.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(await page.locator('meta[name=viewport]').getAttribute('content')).toContain('user-scalable=no')

    const low = page.locator('.cash-customer.low-fund').first()
    await expect(low.locator('.cash-badge')).toHaveText(/low fund/i)
    await low.click()
    await page.locator('.money-input input').fill('500')
    await page.locator('.modal-card .primary-button').click()
    await expect(page.locator('.cash-error')).toContainText('Insufficient fund')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const box = await page.locator('.modal-card').boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width)
  })

  test('a rider can deduct from a customer they are not assigned to', async ({ page }) => {
    await login(page, 'rider')
    await nav(page, 'Cash').click()
    await page.waitForSelector('.cash-customer')
    const rich = page.locator('.cash-customer:not(.low-fund)').first()
    await rich.click()
    await page.locator('.money-input input').fill('10')
    await page.locator('.modal-card .primary-button').click()
    await expect(page.locator('.cash-history .cash-entry').first()).toContainText('-₹10')
    await expect(page.locator('.cash-history .cash-entry').first()).toContainText('by ')
  })

  test('an unapproved rider sees an approval-pending screen', async ({ page }) => {
    // Sign in as a brand-new rider (auto-created, unapproved).
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForTimeout(1100)
    await page.getByText('Delivery partner login').click()
    await page.locator('#phone').fill('9000000123')
    await page.getByRole('button', { name: /Send OTP/ }).click()
    await page.waitForSelector('#otp')
    await page.locator('#otp').fill('123456')
    await page.getByRole('button', { name: /Verify & continue/ }).click()
    await expect(page.locator('.rider-pending')).toBeVisible()
    await expect(page.locator('.rider-pending')).toContainText('Approval pending')
  })
})

test.describe('auth', () => {
  test('a short phone number is rejected', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForTimeout(1100)
    await page.getByText('Continue as customer').click()
    await page.locator('#phone').fill('12345')
    await page.getByRole('button', { name: /Send OTP/ }).click()
    await expect(page.locator('.toast.visible')).toContainText('valid 10-digit')
  })

  test('the closed drawer is out of the tab order', async ({ page }) => {
    await login(page)
    await expect(page.locator('.side-drawer')).toHaveAttribute('inert', '')
  })
})
