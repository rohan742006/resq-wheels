const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { promisify } = require('util');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(__dirname, 'resq-wheels.sqlite');
const PROVIDER_SEARCH_RADIUS_KM = 20;
const DEFAULT_ADMIN_UPI_ID = 'kolwalerohan8-2@oksbi';
const DEFAULT_COMMISSION_RATE = 6;
const MAX_DEPOSIT_PROOF_BYTES = 3 * 1024 * 1024;
const SESSION_COOKIE = 'resq_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const SERVICE_CATEGORIES = [
  'vehicle-towing',
  'car-mechanic',
  'puncture-repair',
  'battery-jumpstart',
  'bike-mechanic',
  'battery-replacement',
  'spare-parts',
  'emergency-assistance',
  'authorized-fuel'
];

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

// Runtime application data is empty until customers and providers use the platform.
const db = {
  services: [
    { id: 'puncture-repair', name: 'Puncture Repair', priceText: 'from Rs 150', basePrice: 150, icon: 'disc', tag: 'Fast Response' },
    { id: 'battery-jumpstart', name: 'Battery Jump-Start', priceText: 'from Rs 350', basePrice: 350, icon: 'battery-charging', tag: 'High Voltage Cables' },
    { id: 'vehicle-towing', name: 'Vehicle Towing', priceText: 'from Rs 800', basePrice: 800, icon: 'truck', tag: 'Hydraulic Flatbed' },
    { id: 'car-mechanic', name: 'Car Mechanic', priceText: 'from Rs 500', basePrice: 500, icon: 'wrench', tag: 'Engine & Electricals' },
    { id: 'bike-mechanic', name: 'Bike Mechanic', priceText: 'from Rs 300', basePrice: 300, icon: 'bike', tag: 'On-Spot Quick Fix' },
    { id: 'battery-replacement', name: 'Battery Replacement', priceText: 'from Rs 2,800', basePrice: 2800, icon: 'zap', tag: 'Warranty Batteries' },
    { id: 'spare-parts', name: 'Spare Parts Delivery', priceText: 'from Rs 200', basePrice: 200, icon: 'package', tag: 'Genuine OEM Parts' },
    { id: 'emergency-assistance', name: 'Emergency Vehicle Assistance', priceText: 'from Rs 400', basePrice: 400, icon: 'alert-triangle', tag: 'Accident Triage & Winch' },
    { id: 'authorized-fuel', name: 'Authorized Fuel Assistance', priceText: 'from Rs 250', basePrice: 250, icon: 'droplet', tag: 'Statutory Authorized Emergency Fuel' }
  ],
  providers: [],
  emergencies: [],
  bookings: [],
  verifications: [],
  adminStats: {
    totalCustomers: 0,
    totalProviders: 0,
    pendingVerifications: 0,
    activeBookings: 0,
    completedBookings: 0,
    cancelledBookings: 0,
    totalGmv: 0,
    platformRevenue: 0,
    commissionRate: DEFAULT_COMMISSION_RATE,
    platformFee: 40
  }
};

const authDb = new DatabaseSync(AUTH_DB_PATH);
authDb.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('user', 'provider', 'admin')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_profiles (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_system_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    commission_rate REAL NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 100),
    admin_upi_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_credit_accounts (
    provider_account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    balance_paise INTEGER NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
    reserved_paise INTEGER NOT NULL DEFAULT 0 CHECK (reserved_paise >= 0 AND reserved_paise <= balance_paise),
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_credit_deposits (
    id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL REFERENCES accounts(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 20000),
    utr TEXT NOT NULL COLLATE NOCASE UNIQUE,
    screenshot_mime TEXT NOT NULL,
    screenshot_blob BLOB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewed_by TEXT REFERENCES accounts(id)
  );
  CREATE INDEX IF NOT EXISTS provider_credit_deposits_status_idx
    ON provider_credit_deposits (status, created_at DESC);
  CREATE TABLE IF NOT EXISTS provider_credit_transactions (
    id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL REFERENCES accounts(id),
    kind TEXT NOT NULL CHECK (kind IN ('DEPOSIT', 'RESERVE', 'RELEASE', 'COMMISSION', 'ADMIN_ADJUSTMENT')),
    credit_delta_paise INTEGER NOT NULL,
    reserved_delta_paise INTEGER NOT NULL,
    balance_after_paise INTEGER NOT NULL,
    reserved_after_paise INTEGER NOT NULL,
    reason TEXT NOT NULL,
    booking_id TEXT,
    deposit_id TEXT,
    created_by TEXT REFERENCES accounts(id),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS provider_credit_transactions_provider_idx
    ON provider_credit_transactions (provider_account_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS credit_reservations (
    booking_id TEXT PRIMARY KEY,
    provider_account_id TEXT NOT NULL REFERENCES accounts(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    status TEXT NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
authDb.prepare(`
  INSERT OR IGNORE INTO credit_system_config (id, commission_rate, admin_upi_id, updated_at)
  VALUES (1, ?, ?, ?)
`).run(DEFAULT_COMMISSION_RATE, DEFAULT_ADMIN_UPI_ID, Date.now());

const saveDefaultSetting = authDb.prepare(
  'INSERT OR IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?, ?)'
);
saveDefaultSetting.run('platformFee', 40);
const storedSettings = Object.fromEntries(authDb.prepare(
  'SELECT setting_key, setting_value FROM platform_settings'
).all().map(setting => [setting.setting_key, Number(setting.setting_value)]));
const creditSystemConfig = authDb.prepare('SELECT commission_rate, admin_upi_id FROM credit_system_config WHERE id = 1').get();
if (!Number.isFinite(creditSystemConfig.commission_rate) || creditSystemConfig.commission_rate < 0 ||
  creditSystemConfig.commission_rate > 100 || !Number.isFinite(storedSettings.platformFee) ||
  storedSettings.platformFee < 0 || storedSettings.platformFee > 100000) {
  throw new Error('Stored platform pricing settings are invalid.');
}
db.adminStats.commissionRate = creditSystemConfig.commission_rate;
db.adminStats.platformFee = storedSettings.platformFee;

db.providers = authDb.prepare('SELECT profile_json FROM provider_profiles ORDER BY created_at DESC')
  .all()
  .map(row => JSON.parse(row.profile_json));
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const separator = part.indexOf('=');
    if (separator > 0) {
      cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
    }
  });
  return cookies;
}

function getAuthenticatedUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const session = authDb.prepare(`
    SELECT accounts.id, accounts.name, accounts.email, accounts.phone, accounts.role
    FROM sessions
    JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now());
  return session || null;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function isTrustedOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) &&
      origin.origin === req.headers.origin &&
      origin.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function distanceInKm(lat1, lng1, lat2, lng2) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}

async function issueSession(account, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  authDb.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), account.id, expiresAt);
  setSessionCookie(res, token, Math.floor(SESSION_LIFETIME_MS / 1000));
}

function publicAccount(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    role: account.role
  };
}

function bookingForRole(booking, user) {
  const providerRow = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
    .get(booking.providerAccountId);
  const provider = providerRow ? JSON.parse(providerRow.profile_json) : null;
  const creditAccount = provider ? ensureCreditAccount(booking.providerAccountId) : null;
  const commissionPaise = toPaise(booking.pricing && booking.pricing.commission);
  const availablePaise = creditAccount
    ? creditAccount.balance_paise - creditAccount.reserved_paise
    : 0;
  const liveLocation = booking.liveProviderLocation;
  const liveProviderLocation = booking.status === 'PROVIDER_EN_ROUTE' &&
    liveLocation &&
    Number.isFinite(Number(liveLocation.lat)) &&
    Number.isFinite(Number(liveLocation.lng)) &&
    typeof liveLocation.updatedAt === 'string'
    ? {
        lat: Number(liveLocation.lat),
        lng: Number(liveLocation.lng),
        updatedAt: liveLocation.updatedAt
      }
    : null;
  const result = {
    ...booking,
    liveProviderLocation,
    providerUpiId: provider && isValidUpiId(provider.upiId) ? provider.upiId : '',
    canAccept: Boolean(user && user.role === 'provider' &&
      user.id === booking.providerAccountId &&
      isValidUpiId(provider && provider.upiId) &&
      booking.status === 'PENDING' &&
      availablePaise >= commissionPaise)
  };
  if (!user || user.role !== 'provider') return result;
  const { otp, ...providerBooking } = result;
  return providerBooking;
}

function publicProvider(provider) {
  const publicFields = [
    'id', 'name', 'rating', 'reviews', 'distance', 'eta', 'price', 'badge',
    'available', 'image', 'category', 'vehicle', 'phone', 'address',
    'lat', 'lng', 'completedJobs', 'joinDate'
  ];
  return Object.fromEntries(publicFields
    .filter(field => provider[field] !== undefined)
    .map(field => [field, provider[field]]));
}

function roundCurrency(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

function toPaise(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) : NaN;
}

function fromPaise(amount) {
  return roundCurrency(Number(amount) / 100);
}

function generateBookingId() {
  return `BK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function isValidUpiId(value) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,100}$/.test(value.trim());
}

function ensureCreditAccount(providerAccountId) {
  authDb.prepare(`
    INSERT OR IGNORE INTO provider_credit_accounts (provider_account_id, balance_paise, reserved_paise, updated_at)
    VALUES (?, 0, 0, ?)
  `).run(providerAccountId, Date.now());
  return authDb.prepare('SELECT * FROM provider_credit_accounts WHERE provider_account_id = ?')
    .get(providerAccountId);
}

function appendCreditTransaction({
  providerAccountId,
  kind,
  creditDeltaPaise,
  reservedDeltaPaise = 0,
  balanceAfterPaise,
  reservedAfterPaise,
  reason,
  bookingId = null,
  depositId = null,
  createdBy = null
}) {
  authDb.prepare(`
    INSERT INTO provider_credit_transactions (
      id, provider_account_id, kind, credit_delta_paise, reserved_delta_paise,
      balance_after_paise, reserved_after_paise, reason, booking_id, deposit_id,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    providerAccountId,
    kind,
    creditDeltaPaise,
    reservedDeltaPaise,
    balanceAfterPaise,
    reservedAfterPaise,
    reason,
    bookingId,
    depositId,
    createdBy,
    Date.now()
  );
}

function creditCommissionForBooking(booking) {
  const total = Number(booking.pricing && booking.pricing.total);
  const rate = Number(booking.pricing && booking.pricing.commissionRate);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error('Booking pricing is invalid for commission credit calculation.');
  }
  return toPaise(roundCurrency(total * rate / 100));
}

function reserveCommissionCredits(booking) {
  const amountPaise = creditCommissionForBooking(booking);
  const providerAccountId = booking.providerAccountId;
  authDb.exec('BEGIN IMMEDIATE');
  try {
    const account = ensureCreditAccount(providerAccountId);
    const existing = authDb.prepare('SELECT status, amount_paise FROM credit_reservations WHERE booking_id = ?')
      .get(booking.id);
    if (existing && existing.status === 'RESERVED') {
      authDb.exec('COMMIT');
      return { success: true, required: fromPaise(existing.amount_paise) };
    }
    const availablePaise = account.balance_paise - account.reserved_paise;
    if (availablePaise < amountPaise) {
      authDb.exec('ROLLBACK');
      return {
        success: false,
        required: fromPaise(amountPaise),
        available: fromPaise(availablePaise)
      };
    }
    const now = Date.now();
    const reservedAfter = account.reserved_paise + amountPaise;
    authDb.prepare(`
      UPDATE provider_credit_accounts SET reserved_paise = ?, updated_at = ?
      WHERE provider_account_id = ?
    `).run(reservedAfter, now, providerAccountId);
    authDb.prepare(`
      INSERT INTO credit_reservations (booking_id, provider_account_id, amount_paise, status, created_at, updated_at)
      VALUES (?, ?, ?, 'RESERVED', ?, ?)
      ON CONFLICT(booking_id) DO UPDATE SET
        provider_account_id = excluded.provider_account_id,
        amount_paise = excluded.amount_paise,
        status = 'RESERVED',
        updated_at = excluded.updated_at
    `).run(booking.id, providerAccountId, amountPaise, now, now);
    appendCreditTransaction({
      providerAccountId,
      kind: 'RESERVE',
      creditDeltaPaise: 0,
      reservedDeltaPaise: amountPaise,
      balanceAfterPaise: account.balance_paise,
      reservedAfterPaise: reservedAfter,
      reason: `Commission reserve for booking ${booking.id}`,
      bookingId: booking.id
    });
    authDb.exec('COMMIT');
    return { success: true, required: fromPaise(amountPaise) };
  } catch (error) {
    authDb.exec('ROLLBACK');
    throw error;
  }
}

function releaseCommissionReservation(bookingId, reason = 'Booking cancelled') {
  authDb.exec('BEGIN IMMEDIATE');
  try {
    const reservation = authDb.prepare(`
      SELECT provider_account_id, amount_paise, status
      FROM credit_reservations WHERE booking_id = ?
    `).get(bookingId);
    if (!reservation || reservation.status !== 'RESERVED') {
      authDb.exec('COMMIT');
      return;
    }
    const account = ensureCreditAccount(reservation.provider_account_id);
    const reservedAfter = Math.max(0, account.reserved_paise - reservation.amount_paise);
    const now = Date.now();
    authDb.prepare(`
      UPDATE provider_credit_accounts SET reserved_paise = ?, updated_at = ?
      WHERE provider_account_id = ?
    `).run(reservedAfter, now, reservation.provider_account_id);
    authDb.prepare(`
      UPDATE credit_reservations SET status = 'RELEASED', updated_at = ? WHERE booking_id = ?
    `).run(now, bookingId);
    appendCreditTransaction({
      providerAccountId: reservation.provider_account_id,
      kind: 'RELEASE',
      creditDeltaPaise: 0,
      reservedDeltaPaise: -reservation.amount_paise,
      balanceAfterPaise: account.balance_paise,
      reservedAfterPaise: reservedAfter,
      reason,
      bookingId
    });
    authDb.exec('COMMIT');
  } catch (error) {
    authDb.exec('ROLLBACK');
    throw error;
  }
}

function deductCommissionCredits(booking) {
  const amountPaise = creditCommissionForBooking(booking);
  const providerAccountId = booking.providerAccountId;
  authDb.exec('BEGIN IMMEDIATE');
  try {
    const account = ensureCreditAccount(providerAccountId);
    const reservation = authDb.prepare(`
      SELECT amount_paise, status FROM credit_reservations WHERE booking_id = ?
    `).get(booking.id);
    const reservedForBooking = reservation && reservation.status === 'RESERVED'
      ? reservation.amount_paise
      : 0;
    const availablePaise = account.balance_paise - account.reserved_paise;
    if (amountPaise > reservedForBooking &&
        availablePaise < amountPaise - reservedForBooking) {
      authDb.exec('ROLLBACK');
      return {
        success: false,
        required: fromPaise(amountPaise),
        available: fromPaise(availablePaise + reservedForBooking)
      };
    }
    const balanceAfter = account.balance_paise - amountPaise;
    const reservedAfter = account.reserved_paise - reservedForBooking;
    if (balanceAfter < reservedAfter) {
      authDb.exec('ROLLBACK');
      return {
        success: false,
        required: fromPaise(amountPaise),
        available: fromPaise(availablePaise + reservedForBooking)
      };
    }
    const now = Date.now();
    authDb.prepare(`
      UPDATE provider_credit_accounts
      SET balance_paise = ?, reserved_paise = ?, updated_at = ?
      WHERE provider_account_id = ?
    `).run(balanceAfter, reservedAfter, now, providerAccountId);
    if (reservation && reservation.status === 'RESERVED') {
      authDb.prepare(`
        UPDATE credit_reservations SET status = 'SETTLED', updated_at = ? WHERE booking_id = ?
      `).run(now, booking.id);
    }
    appendCreditTransaction({
      providerAccountId,
      kind: 'COMMISSION',
      creditDeltaPaise: -amountPaise,
      reservedDeltaPaise: -reservedForBooking,
      balanceAfterPaise: balanceAfter,
      reservedAfterPaise: reservedAfter,
      reason: `${booking.pricing.commissionRate}% commission for completed booking ${booking.id}`,
      bookingId: booking.id
    });
    authDb.exec('COMMIT');
    return { success: true, deducted: fromPaise(amountPaise), balance: fromPaise(balanceAfter) };
  } catch (error) {
    authDb.exec('ROLLBACK');
    throw error;
  }
}

function providerCreditSummary(providerAccountId) {
  const account = ensureCreditAccount(providerAccountId);
  const transactions = authDb.prepare(`
    SELECT id, kind, credit_delta_paise, reserved_delta_paise, balance_after_paise,
      reserved_after_paise, reason, booking_id, deposit_id, created_at
    FROM provider_credit_transactions
    WHERE provider_account_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(providerAccountId);
  const deposits = authDb.prepare(`
    SELECT id, amount_paise, utr, status, admin_note, created_at, reviewed_at
    FROM provider_credit_deposits
    WHERE provider_account_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).all(providerAccountId);
  return {
    balance: fromPaise(account.balance_paise),
    reserved: fromPaise(account.reserved_paise),
    available: fromPaise(account.balance_paise - account.reserved_paise),
    transactions: transactions.map(transaction => ({
      ...transaction,
      creditDelta: fromPaise(transaction.credit_delta_paise),
      reservedDelta: fromPaise(transaction.reserved_delta_paise),
      balanceAfter: fromPaise(transaction.balance_after_paise),
      reservedAfter: fromPaise(transaction.reserved_after_paise)
    })),
    deposits: deposits.map(deposit => ({
      ...deposit,
      amount: fromPaise(deposit.amount_paise)
    }))
  };
}

async function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.warn('Admin sign-in is disabled until ADMIN_EMAIL and ADMIN_PASSWORD are configured.');
    return;
  }
  if (!validEmail(email) || password.length < 12 || password.length > 128) {
    throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must be 12-128 characters.');
  }

  const existing = authDb.prepare('SELECT id, role FROM accounts WHERE email = ?').get(email);
  if (existing && existing.role !== 'admin') {
    throw new Error('ADMIN_EMAIL is already assigned to a non-admin account.');
  }

  const credentials = await hashPassword(password);
  if (existing) {
    authDb.prepare('UPDATE accounts SET password_salt = ?, password_hash = ? WHERE id = ?')
      .run(credentials.salt, credentials.hash, existing.id);
  } else {
    authDb.prepare(`
      INSERT INTO accounts (id, name, email, role, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, 'admin', ?, ?, ?)
    `).run(crypto.randomUUID(), 'Administrator', email, credentials.salt, credentials.hash, Date.now());
  }
}

// Helper: Parse JSON Body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Helper: JSON Response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

// Request Handler
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // API Routes
  if (pathname.startsWith('/api/')) {
    try {
      if (['POST', 'PUT', 'DELETE'].includes(req.method) && !isTrustedOrigin(req)) {
        return sendJson(res, 403, { success: false, message: 'Request origin is not allowed.' });
      }

      const currentUser = getAuthenticatedUser(req);

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Sign in required.' });
        return sendJson(res, 200, { success: true, user: publicAccount(currentUser) });
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const role = body.role;

        if (!name || name.length > 100 || !validEmail(email) || phone.length > 30 ||
          password.length < 10 || password.length > 128 || !['user', 'provider'].includes(role)) {
          return sendJson(res, 400, { success: false, message: 'Enter valid account details. Passwords must be at least 10 characters.' });
        }
        if (authDb.prepare('SELECT 1 FROM accounts WHERE email = ?').get(email)) {
          return sendJson(res, 409, { success: false, message: 'An account with that email already exists.' });
        }

        const credentials = await hashPassword(password);
        const account = {
          id: crypto.randomUUID(),
          name,
          email,
          phone,
          role
        };
        authDb.prepare(`
          INSERT INTO accounts (id, name, email, phone, role, password_salt, password_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(account.id, account.name, account.email, account.phone, account.role,
          credentials.salt, credentials.hash, Date.now());
        await issueSession(account, res);
        return sendJson(res, 201, { success: true, user: publicAccount(account) });
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const role = body.role;
        const account = authDb.prepare('SELECT * FROM accounts WHERE email = ?').get(email);

        if (!account || !['user', 'provider', 'admin'].includes(role) || account.role !== role ||
          password.length < 10 || password.length > 128) {
          return sendJson(res, 401, { success: false, message: 'Email, password, or account type is incorrect.' });
        }

        const storedHash = Buffer.from(account.password_hash, 'hex');
        const candidateHash = await scrypt(password, account.password_salt, storedHash.length);
        if (!crypto.timingSafeEqual(storedHash, candidateHash)) {
          return sendJson(res, 401, { success: false, message: 'Email, password, or account type is incorrect.' });
        }

        await issueSession(account, res);
        return sendJson(res, 200, { success: true, user: publicAccount(account) });
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = parseCookies(req)[SESSION_COOKIE];
        if (token) authDb.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
        clearSessionCookie(res);
        return sendJson(res, 200, { success: true });
      }

      if (pathname === '/api/providers/mine' && req.method === 'GET') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        return sendJson(res, 200, { success: true, provider: row ? JSON.parse(row.profile_json) : null });
      }

      if (pathname === '/api/providers/mine/upi' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        if (!row) return sendJson(res, 404, { success: false, message: 'Register your service center first.' });
        const provider = JSON.parse(row.profile_json);
        const body = await parseJsonBody(req);
        const upiId = typeof body.upiId === 'string' ? body.upiId.trim() : '';
        if (!isValidUpiId(upiId)) {
          return sendJson(res, 400, { success: false, message: 'Enter a valid provider UPI ID.' });
        }
        const updatedProvider = { ...provider, upiId };
        authDb.prepare('UPDATE provider_profiles SET profile_json = ? WHERE account_id = ?')
          .run(JSON.stringify(updatedProvider), currentUser.id);
        const providerIndex = db.providers.findIndex(item => item.accountId === currentUser.id);
        if (providerIndex >= 0) db.providers[providerIndex] = updatedProvider;
        return sendJson(res, 200, { success: true, provider: updatedProvider });
      }

      if (pathname === '/api/providers/mine/credits' && req.method === 'GET') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        if (!row) return sendJson(res, 404, { success: false, message: 'Register your service center first.' });
        const config = authDb.prepare('SELECT commission_rate, admin_upi_id FROM credit_system_config WHERE id = 1').get();
        return sendJson(res, 200, {
          success: true,
          credits: providerCreditSummary(currentUser.id),
          commissionRate: config.commission_rate,
          adminUpiId: config.admin_upi_id,
          providerUpiId: JSON.parse(row.profile_json).upiId || ''
        });
      }

      if (pathname === '/api/providers/mine/credit-deposits' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        if (!row) return sendJson(res, 404, { success: false, message: 'Register your service center first.' });
        const body = await parseJsonBody(req);
        const amount = Number(body.amount);
        const amountPaise = toPaise(amount);
        const utr = typeof body.utr === 'string' ? body.utr.trim() : '';
        const imageMatch = typeof body.screenshotDataUrl === 'string'
          ? body.screenshotDataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
          : null;
        if (!Number.isSafeInteger(amountPaise) || Math.abs(amount * 100 - amountPaise) > 0.000001 ||
          amountPaise < 20000 || amount > 1000000) {
          return sendJson(res, 400, { success: false, message: 'Enter a deposit of at least Rs 200 and no more than Rs 1,000,000.' });
        }
        if (!/^[A-Za-z0-9-]{6,50}$/.test(utr)) {
          return sendJson(res, 400, { success: false, message: 'Enter the valid UTR/reference number from your transfer receipt.' });
        }
        if (!imageMatch) {
          return sendJson(res, 400, { success: false, message: 'Upload a JPEG, PNG, or WebP payment screenshot.' });
        }
        const screenshot = Buffer.from(imageMatch[2], 'base64');
        const validImage = imageMatch[1] === 'png'
          ? screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : imageMatch[1] === 'jpeg'
            ? screenshot.length >= 3 && screenshot[0] === 0xff && screenshot[1] === 0xd8 && screenshot[2] === 0xff
            : screenshot.length >= 12 && screenshot.toString('ascii', 0, 4) === 'RIFF' &&
              screenshot.toString('ascii', 8, 12) === 'WEBP';
        if (!screenshot.length || screenshot.length > MAX_DEPOSIT_PROOF_BYTES ||
            screenshot.toString('base64') !== imageMatch[2] || !validImage) {
          return sendJson(res, 400, { success: false, message: 'The screenshot must be a valid image no larger than 3 MB.' });
        }
        if (authDb.prepare('SELECT 1 FROM provider_credit_deposits WHERE utr = ?').get(utr)) {
          return sendJson(res, 409, { success: false, message: 'This UTR has already been submitted.' });
        }
        const depositId = crypto.randomUUID();
        try {
          authDb.prepare(`
            INSERT INTO provider_credit_deposits (
              id, provider_account_id, amount_paise, utr, screenshot_mime, screenshot_blob,
              status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
          `).run(depositId, currentUser.id, amountPaise, utr, `image/${imageMatch[1]}`, screenshot, Date.now());
        } catch (error) {
          if (String(error.message).includes('UNIQUE constraint failed')) {
            return sendJson(res, 409, { success: false, message: 'This UTR has already been submitted.' });
          }
          throw error;
        }
        return sendJson(res, 201, {
          success: true,
          deposit: { id: depositId, amount, utr, status: 'PENDING' },
          credits: providerCreditSummary(currentUser.id)
        });
      }

      if (pathname === '/api/providers/mine' && req.method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        if (!row) return sendJson(res, 404, { success: false, message: 'No registered service center was found.' });
        if (db.bookings.some(booking => booking.providerAccountId === currentUser.id &&
          !['COMPLETED', 'CANCELLED'].includes(booking.status))) {
          return sendJson(res, 409, {
            success: false,
            message: 'Complete or cancel your active booking before unregistering your service center.'
          });
        }

        const provider = JSON.parse(row.profile_json);
        authDb.prepare('DELETE FROM provider_profiles WHERE account_id = ?').run(currentUser.id);
        db.providers = db.providers.filter(item => item.accountId !== currentUser.id);
        db.adminStats.totalProviders = db.providers.length;
        db.emergencies.forEach(emergency => {
          emergency.quotes = emergency.quotes.filter(quote =>
            quote.providerAccountId !== currentUser.id || quote.status !== 'PENDING');
        });
        return sendJson(res, 200, {
          success: true,
          message: 'Service center unregistered successfully.',
          providerId: provider.id
        });
      }

      if (pathname === '/api/providers/status' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const body = await parseJsonBody(req);
        if (typeof body.available !== 'boolean') {
          return sendJson(res, 400, { success: false, message: 'Choose whether your service center is available.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        if (!row) return sendJson(res, 404, { success: false, message: 'Register your service center first.' });
        const provider = { ...JSON.parse(row.profile_json), available: body.available };
        authDb.prepare('UPDATE provider_profiles SET profile_json = ? WHERE account_id = ?')
          .run(JSON.stringify(provider), currentUser.id);
        const providerIndex = db.providers.findIndex(item => item.accountId === currentUser.id);
        if (providerIndex >= 0) db.providers[providerIndex] = provider;
        return sendJson(res, 200, { success: true, provider });
      }

      if (pathname === '/api/providers/location' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'Provider account required.' });
        }
        const body = await parseJsonBody(req);
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const address = typeof body.address === 'string' ? body.address.trim() : '';
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lng) || lng < -180 || lng > 180 ||
          !address || address.length > 250) {
          return sendJson(res, 400, { success: false, message: 'Share a valid GPS location and address for your service center.' });
        }
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
          .get(currentUser.id);
        if (!row) return sendJson(res, 404, { success: false, message: 'Register your service center first.' });
        const provider = { ...JSON.parse(row.profile_json), lat, lng, address };
        authDb.prepare('UPDATE provider_profiles SET profile_json = ? WHERE account_id = ?')
          .run(JSON.stringify(provider), currentUser.id);
        const providerIndex = db.providers.findIndex(item => item.accountId === currentUser.id);
        if (providerIndex >= 0) db.providers[providerIndex] = provider;
        return sendJson(res, 200, { success: true, provider });
      }

      if (pathname.startsWith('/api/admin/') && (!currentUser || currentUser.role !== 'admin')) {
        return sendJson(res, 403, { success: false, message: 'Administrator account required.' });
      }

      if (pathname === '/api/platform/pricing' && req.method === 'GET') {
        return sendJson(res, 200, {
          success: true,
          pricing: {
            commissionRate: db.adminStats.commissionRate,
            platformFee: db.adminStats.platformFee
          }
        });
      }

      // 1. Services
      if (pathname === '/api/services' && req.method === 'GET') {
        return sendJson(res, 200, { success: true, services: db.services });
      }

      // 2. Providers
      if (pathname === '/api/providers' && req.method === 'GET') {
        const { category, availableOnly, ratingMin, maxPrice, verifiedOnly } = parsedUrl.query;
        let list = [...db.providers];

        if (category && category !== 'all') {
          list = list.filter(p => p.category === category);
        }
        if (availableOnly === 'true') {
          list = list.filter(p => p.available);
        }
        if (ratingMin) {
          list = list.filter(p => p.rating >= parseFloat(ratingMin));
        }
        if (maxPrice) {
          list = list.filter(p => p.price <= parseFloat(maxPrice));
        }
        if (verifiedOnly === 'true') {
          list = list.filter(p => p.badge.includes('Verified'));
        }

        return sendJson(res, 200, {
          success: true,
          count: list.length,
          providers: list.map(publicProvider)
        });
      }

      // 2b. Register New Service Provider / Workshop
      if (pathname === '/api/providers/register' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'A service-provider account is required.' });
        }
        if (authDb.prepare('SELECT 1 FROM provider_profiles WHERE account_id = ?').get(currentUser.id)) {
          return sendJson(res, 409, { success: false, message: 'This account already has a registered service center.' });
        }

        const body = await parseJsonBody(req);
        const name = typeof body.providerName === 'string' ? body.providerName.trim() : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        const address = typeof body.address === 'string' ? body.address.trim() : '';
        const category = body.serviceCategory;
        const price = Number(body.price);
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const upiId = typeof body.upiId === 'string' ? body.upiId.trim() : '';
        if (!name || name.length > 120 || phone.length < 8 || phone.length > 30 ||
          address.length < 4 || address.length > 250 ||
          !SERVICE_CATEGORIES.includes(category) || !Number.isFinite(price) || price <= 0 ||
          !isValidUpiId(upiId) ||
          !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          return sendJson(res, 400, { success: false, message: 'Complete all service-center details, enter a valid contact phone and UPI ID, and detect its map location before submitting.' });
        }

        const provider = {
          id: crypto.randomUUID(),
          accountId: currentUser.id,
          name,
          rating: 0,
          reviews: 0,
          distance: '',
          eta: '',
          price,
          badge: 'Registered',
          available: true,
          image: '/images/crop_hero.jpg',
          category,
          vehicle: '',
          phone,
          upiId,
          address,
          lat,
          lng,
          completedJobs: 0,
          joinDate: new Date().toISOString()
        };
        ensureCreditAccount(currentUser.id);
        authDb.prepare('INSERT INTO provider_profiles (account_id, profile_json, created_at) VALUES (?, ?, ?)')
          .run(currentUser.id, JSON.stringify(provider), Date.now());
        db.providers.unshift(provider);
        db.adminStats.totalProviders = db.providers.length;

        return sendJson(res, 201, {
          success: true,
          message: 'Service center registered successfully.',
          provider
        });
      }

      // 3. Single Provider
      if (pathname.startsWith('/api/providers/') && req.method === 'GET') {
        const id = pathname.replace('/api/providers/', '');
        const provider = db.providers.find(p => p.id === id);
        if (!provider) return sendJson(res, 404, { success: false, message: 'Provider not found' });
        return sendJson(res, 200, { success: true, provider: publicProvider(provider) });
      }

      // 4. Create Emergency Request
      if (pathname === '/api/emergencies' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'user') {
          return sendJson(res, 403, { success: false, message: 'A customer account is required.' });
        }
        const body = await parseJsonBody(req);
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!body.category || !body.vehicleType || !body.location ||
          !Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lng) || lng < -180 || lng > 180) {
          return sendJson(res, 400, { success: false, message: 'Choose a vehicle and emergency category, then share a valid location.' });
        }
        const newEmergency = {
          id: 'emg-' + (Date.now() % 100000),
          customerId: currentUser.id,
          vehicleType: body.vehicleType,
          category: body.category,
          description: typeof body.description === 'string' ? body.description.trim() : '',
          urgency: body.urgency,
          location: body.location.trim(),
          lat,
          lng,
          status: 'OPEN',
          createdAt: new Date().toISOString(),
          customer: {
            name: currentUser.name,
            phone: currentUser.phone,
            vehicleModel: typeof body.vehicleModel === 'string' ? body.vehicleModel.trim() : ''
          },
          photos: Array.isArray(body.photos) ? body.photos : [],
          quotes: []
        };

        db.emergencies.unshift(newEmergency);
        return sendJson(res, 201, { success: true, emergency: newEmergency });
      }

      // 5. Get Emergencies
      if (pathname === '/api/emergencies' && req.method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Sign in required.' });
        let emergencies;
        if (currentUser.role === 'admin') {
          emergencies = db.emergencies;
        } else if (currentUser.role === 'provider') {
          const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
            .get(currentUser.id);
          if (!row) return sendJson(res, 200, { success: true, emergencies: [] });
          const provider = JSON.parse(row.profile_json);
          if (!provider.available) return sendJson(res, 200, { success: true, emergencies: [] });
          emergencies = db.emergencies
            .filter(emergency => emergency.status === 'OPEN' &&
                distanceInKm(provider.lat, provider.lng, emergency.lat, emergency.lng) <= PROVIDER_SEARCH_RADIUS_KM)
            .map(({ id, vehicleType, category, description, urgency, location, lat, lng, createdAt }) =>
              ({ id, vehicleType, category, description, urgency, location, lat, lng, createdAt }));
        } else {
          emergencies = db.emergencies.filter(emergency => emergency.customerId === currentUser.id);
        }
        return sendJson(res, 200, { success: true, emergencies });
      }

      // 6. Provider Submits Quote for Emergency
      if (pathname.match(/\/api\/emergencies\/([^\/]+)\/quotes/) && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'provider') {
          return sendJson(res, 403, { success: false, message: 'A service-provider account is required.' });
        }
        const emgId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const emg = db.emergencies.find(e => e.id === emgId);
        if (!emg) return sendJson(res, 404, { success: false, message: 'Emergency not found' });
        if (emg.status !== 'OPEN') return sendJson(res, 409, { success: false, message: 'This request is no longer open.' });
        const row = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?').get(currentUser.id);
        if (!row) return sendJson(res, 403, { success: false, message: 'Register your service center before submitting a quote.' });
        const provider = JSON.parse(row.profile_json);
        if (!provider.available) return sendJson(res, 409, { success: false, message: 'Set your service center online before submitting a quote.' });
        const amount = Number(body.amount);
        const eta = typeof body.eta === 'string' ? body.eta.trim() : '';
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 || !eta || eta.length > 50) {
          return sendJson(res, 400, { success: false, message: 'Enter a valid quote amount and arrival estimate.' });
        }

        const quote = {
          id: crypto.randomUUID(),
          providerId: provider.id,
          providerAccountId: currentUser.id,
          providerName: provider.name,
          providerRating: provider.rating,
          amount,
          eta,
          notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '',
          status: 'PENDING'
        };

        emg.quotes.unshift(quote);
        return sendJson(res, 200, { success: true, quote, emergency: emg });
      }

      // 7. Customer Accepts Quote
      if (pathname.match(/\/api\/emergencies\/([^\/]+)\/accept/) && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'user') {
          return sendJson(res, 403, { success: false, message: 'A customer account is required.' });
        }
        const emgId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const emg = db.emergencies.find(e => e.id === emgId);
        if (!emg) return sendJson(res, 404, { success: false, message: 'Emergency not found' });
        if (emg.customerId !== currentUser.id) return sendJson(res, 403, { success: false, message: 'This request does not belong to your account.' });
        if (emg.status !== 'OPEN') return sendJson(res, 409, { success: false, message: 'This request is no longer open.' });

        const quote = emg.quotes.find(q => q.id === body.quoteId && q.status === 'PENDING');
        if (!quote) return sendJson(res, 400, { success: false, message: 'No quote found' });
        const providerRow = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?').get(quote.providerAccountId);
        if (!providerRow) return sendJson(res, 404, { success: false, message: 'Provider profile not found.' });
        const provider = JSON.parse(providerRow.profile_json);

        const servicePrice = quote.amount;
        const platformFee = db.adminStats.platformFee;
        const gst = +(platformFee * 0.18).toFixed(2);
        const total = +(servicePrice + platformFee + gst).toFixed(2);
        const commission = +(total * (db.adminStats.commissionRate / 100)).toFixed(2);

        const newBooking = {
          id: generateBookingId(),
          bookingType: 'EMERGENCY_BROADCAST',
          emergencyId: emg.id,
          customerId: currentUser.id,
          serviceId: emg.category,
          serviceName: emg.category,
          vehicleType: emg.vehicleType,
          providerId: quote.providerId,
          providerName: quote.providerName,
          providerAccountId: quote.providerAccountId,
          providerPhone: provider.phone,
          providerRating: quote.providerRating,
          providerImage: provider.image,
          customerName: emg.customer.name,
          customerPhone: emg.customer.phone,
          vehicleDetails: emg.customer.vehicleModel,
          pickupLocation: emg.location,
          destinationLocation: 'Authorized Workshop / Customer Choice',
          lat: emg.lat,
          lng: emg.lng,
          liveProviderLocation: null,
          status: 'ACCEPTED',
          statusTimeline: [
            { status: 'PENDING', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), label: 'Emergency Broadcast Sent' },
            { status: 'ACCEPTED', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), label: `Quotation Accepted (${quote.providerName})` }
          ],
          otp: Math.floor(1000 + Math.random() * 9000).toString(),
          pricing: {
            serviceCharge: servicePrice,
            platformFee,
            gst,
            total,
            commissionRate: db.adminStats.commissionRate,
            commission
          },
          paymentStatus: 'UNPAID',
          paymentMethod: 'DIRECT_UPI',
          chatMessages: [],
          review: null
        };

        if (!isValidUpiId(provider.upiId)) {
          return sendJson(res, 409, { success: false, message: 'The provider must add a valid UPI ID before accepting this booking.' });
        }
        const reservation = reserveCommissionCredits(newBooking);
        if (!reservation.success) {
          return sendJson(res, 409, {
            success: false,
            message: `The provider needs ${reservation.required} credits but has only ${reservation.available} available.`
          });
        }
        emg.status = 'ASSIGNED';
        quote.status = 'ACCEPTED';
        db.bookings.unshift(newBooking);
        return sendJson(res, 200, {
          success: true,
          booking: bookingForRole(newBooking, currentUser)
        });
      }

      // 8. Direct Browse-and-Book
      if (pathname === '/api/bookings' && req.method === 'POST') {
        if (!currentUser || currentUser.role !== 'user') {
          return sendJson(res, 403, { success: false, message: 'A customer account is required.' });
        }
        const body = await parseJsonBody(req);
        const provider = db.providers.find(p => p.id === body.providerId);
        const service = db.services.find(s => s.id === body.serviceId);
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const vehicleDetails = typeof body.vehicleDetails === 'string' ? body.vehicleDetails.trim() : '';
        const location = typeof body.location === 'string' ? body.location.trim() : '';
        if (!provider || !provider.available || !service || provider.category !== service.id || !vehicleDetails ||
          !location || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lng) || lng < -180 || lng > 180) {
          return sendJson(res, 400, { success: false, message: 'Select a registered provider and provide valid vehicle and location details.' });
        }

        const servicePrice = provider.price;
        const platformFee = db.adminStats.platformFee;
        const gst = +(platformFee * 0.18).toFixed(2);
        const total = +(servicePrice + platformFee + gst).toFixed(2);
        const commission = +(total * (db.adminStats.commissionRate / 100)).toFixed(2);

        const newBooking = {
          id: generateBookingId(),
          bookingType: 'DIRECT',
          customerId: currentUser.id,
          providerAccountId: provider.accountId,
          serviceId: service.id,
          serviceName: service.name,
          vehicleType: body.vehicleType || 'Car',
          providerId: provider.id,
          providerName: provider.name,
          providerPhone: provider.phone,
          providerRating: provider.rating,
          providerImage: provider.image,
          customerName: currentUser.name,
          customerPhone: currentUser.phone,
          vehicleDetails,
          pickupLocation: location,
          destinationLocation: '',
          lat,
          lng,
          liveProviderLocation: null,
          status: 'PENDING',
          statusTimeline: [
            { status: 'PENDING', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), label: 'Booking request sent' }
          ],
          otp: Math.floor(1000 + Math.random() * 9000).toString(),
          pricing: {
            serviceCharge: servicePrice,
            platformFee,
            gst,
            total,
            commissionRate: db.adminStats.commissionRate,
            commission
          },
          paymentStatus: 'UNPAID',
          paymentMethod: 'DIRECT_UPI',
          chatMessages: [],
          review: null
        };

        db.bookings.unshift(newBooking);
        return sendJson(res, 201, {
          success: true,
          booking: bookingForRole(newBooking, currentUser)
        });
      }

      // 9. Get Bookings
      if (pathname === '/api/bookings' && req.method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Sign in required.' });
        const bookings = currentUser.role === 'admin'
          ? db.bookings
          : currentUser.role === 'provider'
            ? db.bookings.filter(booking => booking.providerAccountId === currentUser.id)
            : db.bookings.filter(booking => booking.customerId === currentUser.id);
        return sendJson(res, 200, {
          success: true,
          bookings: bookings.map(booking => bookingForRole(booking, currentUser))
        });
      }

      // 10. Single Booking
      if (pathname.match(/\/api\/bookings\/([^\/]+)$/) && req.method === 'GET') {
        const id = pathname.split('/')[3];
        const booking = db.bookings.find(b => b.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found' });
        if (!currentUser || (currentUser.role === 'user' && booking.customerId !== currentUser.id) ||
          (currentUser.role === 'provider' && booking.providerAccountId !== currentUser.id)) {
          return sendJson(res, 403, { success: false, message: 'This booking is not available to your account.' });
        }
        return sendJson(res, 200, { success: true, booking: bookingForRole(booking, currentUser) });
      }

      if (pathname.match(/\/api\/bookings\/([^\/]+)\/cancel$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const booking = db.bookings.find(item => item.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found.' });
        const isCustomer = currentUser && currentUser.role === 'user' && booking.customerId === currentUser.id;
        const isProvider = currentUser && currentUser.role === 'provider' && booking.providerAccountId === currentUser.id;
        if (!isCustomer && !isProvider) {
          return sendJson(res, 403, { success: false, message: 'Only the customer or assigned provider can cancel this booking.' });
        }
        if (!['PENDING', 'ACCEPTED'].includes(booking.status)) {
          return sendJson(res, 409, { success: false, message: 'This booking can no longer be cancelled.' });
        }
        releaseCommissionReservation(booking.id, 'Booking cancelled');
        booking.status = 'CANCELLED';
        booking.statusTimeline.push({
          status: 'CANCELLED',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          label: 'Booking cancelled; reserved credits released'
        });
        if (booking.emergencyId) {
          const emergency = db.emergencies.find(item => item.id === booking.emergencyId);
          if (emergency) emergency.status = 'CANCELLED';
        }
        db.adminStats.cancelledBookings += 1;
        return sendJson(res, 200, { success: true, booking: bookingForRole(booking, currentUser) });
      }

      if (pathname.match(/\/api\/bookings\/([^\/]+)\/location$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const booking = db.bookings.find(item => item.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found.' });
        if (!currentUser || currentUser.role !== 'provider' ||
          booking.providerAccountId !== currentUser.id) {
          return sendJson(res, 403, { success: false, message: 'Only the assigned provider can share this route location.' });
        }
        if (booking.status !== 'PROVIDER_EN_ROUTE') {
          return sendJson(res, 409, { success: false, message: 'Live location is only accepted while the provider is en route.' });
        }
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lng) || lng < -180 || lng > 180) {
          return sendJson(res, 400, { success: false, message: 'Share valid GPS coordinates to update the live route.' });
        }
        booking.liveProviderLocation = { lat, lng, updatedAt: new Date().toISOString() };
        return sendJson(res, 200, {
          success: true,
          booking: bookingForRole(booking, currentUser)
        });
      }

      // 11. Update Booking Status (Provider en route -> arrived -> in progress -> completed)
      if (pathname.match(/\/api\/bookings\/([^\/]+)\/status$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const booking = db.bookings.find(b => b.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found' });
        if (!currentUser || currentUser.role !== 'provider' || booking.providerAccountId !== currentUser.id) {
          return sendJson(res, 403, { success: false, message: 'The assigned provider account is required.' });
        }

        const validNextStatuses = {
          PENDING: 'ACCEPTED',
          ACCEPTED: 'PROVIDER_EN_ROUTE',
          PROVIDER_EN_ROUTE: 'ARRIVED',
          ARRIVED: 'IN_PROGRESS'
        };
        if (validNextStatuses[booking.status] !== body.status) {
          return sendJson(res, 409, { success: false, message: 'This booking cannot transition to that status.' });
        }

        if (body.status === 'ACCEPTED') {
          const providerRow = authDb.prepare('SELECT profile_json FROM provider_profiles WHERE account_id = ?')
            .get(currentUser.id);
          const provider = providerRow ? JSON.parse(providerRow.profile_json) : null;
          if (!provider || !isValidUpiId(provider.upiId)) {
            return sendJson(res, 409, { success: false, message: 'Add a valid provider UPI ID before accepting bookings.' });
          }
          const reservation = reserveCommissionCredits(booking);
          if (!reservation.success) {
            return sendJson(res, 409, {
              success: false,
              message: `Insufficient available credits. This booking requires ${reservation.required}; available balance is ${reservation.available}.`
            });
          }
        }

        booking.status = body.status;
        booking.liveProviderLocation = null;
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let label = body.status.replace(/_/g, ' ');
        if (body.status === 'PROVIDER_EN_ROUTE') label = 'Provider is on the way';
        if (body.status === 'ARRIVED') label = 'Provider has reached your location';
        if (body.status === 'IN_PROGRESS') label = 'Service is actively in progress';
        if (body.status === 'COMPLETED') label = 'Service successfully completed & verified';

        booking.statusTimeline.push({
          status: body.status,
          time: timeNow,
          label
        });

        return sendJson(res, 200, { success: true, booking: bookingForRole(booking, currentUser) });
      }

      // 12. Verify OTP for completion
      if (pathname.match(/\/api\/bookings\/([^\/]+)\/verify-otp$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const booking = db.bookings.find(b => b.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found' });
        if (!currentUser || currentUser.role !== 'provider' || booking.providerAccountId !== currentUser.id) {
          return sendJson(res, 403, { success: false, message: 'The assigned provider account is required.' });
        }
        if (booking.status !== 'IN_PROGRESS') {
          return sendJson(res, 409, { success: false, message: 'The service must be in progress before it can be completed.' });
        }

        if (booking.otp !== body.otp) {
          return sendJson(res, 400, { success: false, message: 'Invalid OTP code! Please check with customer.' });
        }

        const deduction = deductCommissionCredits(booking);
        if (!deduction.success) {
          return sendJson(res, 409, {
            success: false,
            message: `Insufficient credits to complete commission deduction. Required ${deduction.required}; available ${deduction.available}.`
          });
        }
        booking.status = 'COMPLETED';
        booking.statusTimeline.push({
          status: 'COMPLETED',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          label: 'Service verified with OTP & completed'
        });
        db.adminStats.completedBookings += 1;
        db.adminStats.totalGmv += booking.pricing.total;

        return sendJson(res, 200, {
          success: true,
          message: 'OTP verified successfully!',
          booking: bookingForRole(booking, currentUser)
        });
      }

      // 13. Send Chat Message
      if (pathname.match(/\/api\/bookings\/([^\/]+)\/chat$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const booking = db.bookings.find(b => b.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found' });
        if (!currentUser || !['user', 'provider'].includes(currentUser.role) ||
          (currentUser.role === 'user' && booking.customerId !== currentUser.id) ||
          (currentUser.role === 'provider' && booking.providerAccountId !== currentUser.id)) {
          return sendJson(res, 403, { success: false, message: 'This booking is not available to your account.' });
        }
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1000) {
          return sendJson(res, 400, { success: false, message: 'Enter a message up to 1000 characters.' });
        }

        const msg = {
          sender: currentUser.role,
          text: body.text.trim(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        booking.chatMessages.push(msg);
        return sendJson(res, 200, { success: true, message: msg, booking });
      }

      // 14. Submit Review
      if (pathname.match(/\/api\/bookings\/([^\/]+)\/review$/) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const booking = db.bookings.find(b => b.id === id);
        if (!booking) return sendJson(res, 404, { success: false, message: 'Booking not found' });
        if (!currentUser || currentUser.role !== 'user' || booking.customerId !== currentUser.id) {
          return sendJson(res, 403, { success: false, message: 'Only the customer on this booking can submit a review.' });
        }

        booking.review = {
          rating: Number(body.rating),
          comment: typeof body.comment === 'string' ? body.comment.trim() : '',
          tags: Array.isArray(body.tags) ? body.tags : [],
          submittedAt: new Date().toISOString()
        };
        return sendJson(res, 200, { success: true, review: booking.review });
      }

      // 15. Admin Stats & Verifications
      if (pathname === '/api/admin/stats' && req.method === 'GET') {
        const creditTotals = authDb.prepare(`
          SELECT
            COALESCE(SUM(balance_paise), 0) AS providerCredits,
            COALESCE(SUM(reserved_paise), 0) AS reservedCredits,
            COALESCE((
              SELECT -SUM(credit_delta_paise) FROM provider_credit_transactions
              WHERE kind = 'COMMISSION'
            ), 0) AS commissionCredits
          FROM provider_credit_accounts
        `).get();
        const stats = {
          ...db.adminStats,
          providerCredits: fromPaise(creditTotals.providerCredits),
          reservedCredits: fromPaise(creditTotals.reservedCredits),
          commissionCredits: fromPaise(creditTotals.commissionCredits),
          totalCustomers: authDb.prepare("SELECT COUNT(*) AS count FROM accounts WHERE role = 'user'").get().count,
          totalProviders: authDb.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get().count,
          activeBookings: db.bookings.filter(booking => !['COMPLETED', 'CANCELLED'].includes(booking.status)).length,
          pendingVerifications: db.verifications.length
        };
        return sendJson(res, 200, { success: true, stats });
      }

      if (pathname === '/api/admin/credits' && req.method === 'GET') {
        const config = authDb.prepare('SELECT commission_rate, admin_upi_id FROM credit_system_config WHERE id = 1').get();
        const providerRows = authDb.prepare(`
          SELECT accounts.id, accounts.name, accounts.email, provider_profiles.profile_json
          FROM accounts
          JOIN provider_profiles ON provider_profiles.account_id = accounts.id
          WHERE accounts.role = 'provider'
          ORDER BY accounts.name COLLATE NOCASE
        `).all();
        const providers = providerRows.map(row => {
          const profile = JSON.parse(row.profile_json);
          const credits = providerCreditSummary(row.id);
          return {
            id: row.id,
            name: profile.name || row.name,
            email: row.email,
            upiId: profile.upiId || '',
            balance: credits.balance,
            available: credits.available,
            reserved: credits.reserved
          };
        });
        const deposits = authDb.prepare(`
          SELECT deposits.id, deposits.provider_account_id, deposits.amount_paise,
            deposits.utr, deposits.status, deposits.admin_note, deposits.created_at,
            deposits.reviewed_at, accounts.name AS account_name, accounts.email,
            provider_profiles.profile_json
          FROM provider_credit_deposits AS deposits
          JOIN accounts ON accounts.id = deposits.provider_account_id
          LEFT JOIN provider_profiles ON provider_profiles.account_id = deposits.provider_account_id
          ORDER BY deposits.created_at DESC LIMIT 100
        `).all().map(row => {
          const profile = row.profile_json ? JSON.parse(row.profile_json) : {};
          return {
            id: row.id,
            providerAccountId: row.provider_account_id,
            providerName: profile.name || row.account_name,
            providerEmail: row.email,
            amount: fromPaise(row.amount_paise),
            utr: row.utr,
            status: row.status,
            adminNote: row.admin_note,
            createdAt: row.created_at,
            reviewedAt: row.reviewed_at,
            screenshotUrl: `/api/admin/credit-deposits/${encodeURIComponent(row.id)}/screenshot`
          };
        });
        const transactions = authDb.prepare(`
          SELECT transactions.id, transactions.provider_account_id, transactions.kind,
            transactions.credit_delta_paise, transactions.reserved_delta_paise,
            transactions.balance_after_paise, transactions.reserved_after_paise,
            transactions.reason, transactions.booking_id, transactions.deposit_id,
            transactions.created_at, accounts.name AS account_name, accounts.email,
            provider_profiles.profile_json
          FROM provider_credit_transactions AS transactions
          JOIN accounts ON accounts.id = transactions.provider_account_id
          LEFT JOIN provider_profiles ON provider_profiles.account_id = transactions.provider_account_id
          ORDER BY transactions.created_at DESC LIMIT 200
        `).all().map(row => {
          const profile = row.profile_json ? JSON.parse(row.profile_json) : {};
          return {
            id: row.id,
            providerAccountId: row.provider_account_id,
            providerName: profile.name || row.account_name,
            providerEmail: row.email,
            kind: row.kind,
            creditDelta: fromPaise(row.credit_delta_paise),
            reservedDelta: fromPaise(row.reserved_delta_paise),
            balanceAfter: fromPaise(row.balance_after_paise),
            reservedAfter: fromPaise(row.reserved_after_paise),
            reason: row.reason,
            bookingId: row.booking_id,
            depositId: row.deposit_id,
            createdAt: row.created_at
          };
        });
        return sendJson(res, 200, {
          success: true,
          config: { commissionRate: config.commission_rate, adminUpiId: config.admin_upi_id },
          providers,
          deposits,
          transactions
        });
      }

      const depositScreenshotMatch = pathname.match(/^\/api\/admin\/credit-deposits\/([^/]+)\/screenshot$/);
      if (depositScreenshotMatch && req.method === 'GET') {
        const deposit = authDb.prepare(`
          SELECT screenshot_mime, screenshot_blob
          FROM provider_credit_deposits WHERE id = ?
        `).get(decodeURIComponent(depositScreenshotMatch[1]));
        if (!deposit) return sendJson(res, 404, { success: false, message: 'Deposit receipt not found.' });
        res.writeHead(200, {
          'Content-Type': deposit.screenshot_mime,
          'Content-Length': deposit.screenshot_blob.length,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        return res.end(deposit.screenshot_blob);
      }

      const reviewDepositMatch = pathname.match(/^\/api\/admin\/credit-deposits\/([^/]+)\/review$/);
      if (reviewDepositMatch && req.method === 'POST') {
        const depositId = decodeURIComponent(reviewDepositMatch[1]);
        const body = await parseJsonBody(req);
        const status = body.status;
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
        if (!['APPROVED', 'REJECTED'].includes(status)) {
          return sendJson(res, 400, { success: false, message: 'Choose approve or reject for this deposit.' });
        }
        authDb.exec('BEGIN IMMEDIATE');
        try {
          const deposit = authDb.prepare(`
            SELECT provider_account_id, amount_paise, status
            FROM provider_credit_deposits WHERE id = ?
          `).get(depositId);
          if (!deposit) {
            authDb.exec('ROLLBACK');
            return sendJson(res, 404, { success: false, message: 'Deposit not found.' });
          }
          if (deposit.status !== 'PENDING') {
            authDb.exec('ROLLBACK');
            return sendJson(res, 409, { success: false, message: 'This deposit has already been reviewed.' });
          }
          const now = Date.now();
          if (status === 'APPROVED') {
            const account = ensureCreditAccount(deposit.provider_account_id);
            const balanceAfter = account.balance_paise + deposit.amount_paise;
            authDb.prepare(`
              UPDATE provider_credit_accounts SET balance_paise = ?, updated_at = ?
              WHERE provider_account_id = ?
            `).run(balanceAfter, now, deposit.provider_account_id);
            appendCreditTransaction({
              providerAccountId: deposit.provider_account_id,
              kind: 'DEPOSIT',
              creditDeltaPaise: deposit.amount_paise,
              balanceAfterPaise: balanceAfter,
              reservedAfterPaise: account.reserved_paise,
              reason: `Admin-approved deposit (${depositId})`,
              depositId,
              createdBy: currentUser.id
            });
          }
          authDb.prepare(`
            UPDATE provider_credit_deposits
            SET status = ?, admin_note = ?, reviewed_at = ?, reviewed_by = ?
            WHERE id = ? AND status = 'PENDING'
          `).run(status, note, now, currentUser.id, depositId);
          authDb.exec('COMMIT');
        } catch (error) {
          authDb.exec('ROLLBACK');
          throw error;
        }
        return sendJson(res, 200, { success: true, message: `Deposit ${status.toLowerCase()}.` });
      }

      if (pathname === '/api/admin/credits/config' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const commissionRate = Number(body.commissionRate);
        const adminUpiId = typeof body.adminUpiId === 'string' ? body.adminUpiId.trim() : '';
        if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100 ||
          !isValidUpiId(adminUpiId)) {
          return sendJson(res, 400, { success: false, message: 'Enter a commission rate from 0 to 100 and a valid admin UPI ID.' });
        }
        authDb.prepare(`
          UPDATE credit_system_config SET commission_rate = ?, admin_upi_id = ?, updated_at = ?
          WHERE id = 1
        `).run(commissionRate, adminUpiId, Date.now());
        db.adminStats.commissionRate = commissionRate;
        return sendJson(res, 200, {
          success: true,
          config: { commissionRate, adminUpiId }
        });
      }

      const adjustCreditsMatch = pathname.match(/^\/api\/admin\/providers\/([^/]+)\/credits\/adjust$/);
      if (adjustCreditsMatch && req.method === 'POST') {
        const providerAccountId = decodeURIComponent(adjustCreditsMatch[1]);
        const body = await parseJsonBody(req);
        const deltaPaise = toPaise(body.delta);
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        if (!Number.isSafeInteger(deltaPaise) || deltaPaise === 0 || Math.abs(deltaPaise) > 100000000 ||
          reason.length < 4 || reason.length > 300) {
          return sendJson(res, 400, { success: false, message: 'Enter a non-zero adjustment up to Rs 1,000,000 and a reason.' });
        }
        if (!authDb.prepare("SELECT 1 FROM accounts WHERE id = ? AND role = 'provider'").get(providerAccountId) ||
            !authDb.prepare('SELECT 1 FROM provider_profiles WHERE account_id = ?').get(providerAccountId)) {
          return sendJson(res, 404, { success: false, message: 'Provider account not found.' });
        }
        authDb.exec('BEGIN IMMEDIATE');
        try {
          const account = ensureCreditAccount(providerAccountId);
          const balanceAfter = account.balance_paise + deltaPaise;
          if (balanceAfter < account.reserved_paise) {
            authDb.exec('ROLLBACK');
            return sendJson(res, 409, { success: false, message: 'Adjustment cannot reduce the balance below reserved credits.' });
          }
          authDb.prepare(`
            UPDATE provider_credit_accounts SET balance_paise = ?, updated_at = ?
            WHERE provider_account_id = ?
          `).run(balanceAfter, Date.now(), providerAccountId);
          appendCreditTransaction({
            providerAccountId,
            kind: 'ADMIN_ADJUSTMENT',
            creditDeltaPaise: deltaPaise,
            balanceAfterPaise: balanceAfter,
            reservedAfterPaise: account.reserved_paise,
            reason,
            createdBy: currentUser.id
          });
          authDb.exec('COMMIT');
        } catch (error) {
          authDb.exec('ROLLBACK');
          throw error;
        }
        return sendJson(res, 200, {
          success: true,
          credits: providerCreditSummary(providerAccountId)
        });
      }

      if (pathname === '/api/admin/verifications' && req.method === 'GET') {
        return sendJson(res, 200, { success: true, verifications: db.verifications });
      }

      // 404 for unknown api
      return sendJson(res, 404, { success: false, message: 'API endpoint not found' });
    } catch (err) {
      console.error('API Error:', err);
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // Static File Serving
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\' || safePath === '') {
    safePath = '/index.html';
  }

  // SPA Route fallback
  const clientRoutes = ['/home', '/services', '/providers', '/emergency', '/track', '/dashboard', '/provider', '/admin'];
  if (clientRoutes.includes(safePath)) {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);
  const ext = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for unknown routes if html requested
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (err2, content) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

async function startServer() {
  await bootstrapAdmin();
  server.listen(PORT, () => {
    console.log(`ResQ Wheels Server running at http://localhost:${PORT}`);
  });
}

startServer().catch(error => {
  console.error('Server startup failed:', error);
  authDb.close();
  process.exitCode = 1;
});
