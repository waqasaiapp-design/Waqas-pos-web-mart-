import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import tls from 'tls';
import zlib from 'zlib';
import {
  Product,
  SaleTransaction,
  PurchaseTransaction,
  Customer,
  CustomerLedgerEntry,
  Supplier,
  SaleReturn,
  HeldBill,
  StoreBranding,
  DeviceInfo,
  PairingSession,
  SyncEvent,
  UserProfile,
  ShopAccount,
  SubscriptionPaymentRecord,
  SubscriptionRenewalRecord,
  AuthUser,
  UserRole,
  AuditLogEntry,
  DefaultSubscriptionPricing,
  StockTransaction,
  StockTransactionType,
  PurchaseReturn,
  ExpenseEntry,
  StaffMember,
  StaffModulePermissions,
  DEFAULT_STAFF_PERMISSIONS,
  SupplierLedgerEntry,
  PrinterSettings,
  CategoryInfo,
  DailyHisabRow,
  ReceiptSettings,
} from './src/types/pos';
import {
  SCREENSHOT_CATEGORIES,
  INITIAL_SUPPLIERS,
  SEED_CATALOG_PRODUCTS,
} from './src/data/defaultProducts';
import {
  applyPurchaseDeleteToState,
  applyPurchaseSaveToState,
  formatStockAuditTimestamp,
} from './src/utils/purchaseHelpers';

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.WAQAS_DATA_DIR
  ? path.resolve(process.env.WAQAS_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const SHOPS_DIR = path.join(DATA_DIR, 'shops');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(SHOPS_DIR)) {
  fs.mkdirSync(SHOPS_DIR, { recursive: true });
}

const STORE_DB_FILE = path.join(DATA_DIR, 'store_db.json');
const DEVICES_DB_FILE = path.join(DATA_DIR, 'devices_db.json');
const SUBSCRIPTIONS_DB_FILE = path.join(DATA_DIR, 'subscriptions_db.json');
const AUTH_DB_FILE = path.join(DATA_DIR, 'auth_db.json');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit_logs.json');

export interface StoredSuperAdmin {
  id: string;
  gmail: string;
  googleSub?: string;
  mobile?: string;
  fullName: string;
  status: 'active';
  verifiedGmail: boolean;
  verifiedMobile?: boolean;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface PendingOAuthState {
  purpose: 'login' | 'provision';
  redirectUri: string;
  createdAt: number;
  expiresAt: number;
}

export interface PendingGoogleAssertion {
  gmail: string;
  googleSub: string;
  fullName: string;
  purpose: 'login' | 'provision';
  createdAt: number;
  expiresAt: number;
  used: boolean;
  passwordRetries: number;
}

export interface PendingOtpSession {
  purpose: 'setup' | 'recovery';
  gmail?: string;
  mobile?: string;
  fullName?: string;
  passwordSaltTemp?: string;
  passwordHashTemp?: string;
  emailOtpHash?: string;
  smsOtpHash?: string;
  channel?: 'gmail' | 'mobile';
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

export interface StoredUser {
  id: string;
  email?: string;
  username?: string;
  secondaryEmails?: string[];
  fullName: string;
  phone?: string;
  whatsapp?: string;
  role: UserRole;
  shopId?: string;
  passwordHash: string;
  passwordSalt: string;
  mustChangePasswordOnFirstLogin?: boolean;
  createdAt: string;
}

export interface AuthSessionData {
  token: string;
  userId: string;
  email?: string;
  gmail?: string;
  username?: string;
  fullName?: string;
  role: UserRole;
  shopId?: string;
  staffId?: string;
  permissions?: StaffModulePermissions;
  createdAt: number;
  expiresAt: number;
  ip?: string;
}

export interface AuthDb {
  superAdmin: StoredSuperAdmin | null;
  superAdminSetupLocked?: boolean;
  users: StoredUser[];
  sessions: Record<string, AuthSessionData>;
  pendingOtps: Record<string, PendingOtpSession>;
  failedAttempts: Record<string, { count: number; lastAttempt: number }>;
}

function normalizeMobile(input: string): string {
  const digits = String(input || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0092') && digits.length >= 12) {
    return '0' + digits.slice(4);
  }
  if (digits.startsWith('92') && digits.length === 12) {
    return '0' + digits.slice(2);
  }
  if (digits.length === 10 && digits.startsWith('3')) {
    return '0' + digits;
  }
  return digits;
}

function maskEmail(email?: string): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(6, local.length - 2))}@${domain}`;
}

function maskMobile(mobile?: string): string {
  const clean = String(mobile || '').trim();
  if (clean.length <= 4) return '****';
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

function hashOtpCode(code: string): string {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

function hashPassword(password: string, salt: string): string {
  return 'scrypt:' + crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function verifyPasswordRecord(password: string, salt: string, storedHash: string): boolean {
  if (!password || !salt || !storedHash) return false;
  if (storedHash.startsWith('scrypt:')) {
    const expectedHex = storedHash.slice(7);
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  }
  // Legacy PBKDF2 support (100k or 1k) -> callers can upgrade hash cleanly on login
  const calc100k = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  if (calc100k === storedHash) return true;
  const calc1k = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex');
  return calc1k === storedHash;
}

function verifyPassword(password: string, user: StoredUser): boolean {
  if (!user || !user.passwordSalt || !user.passwordHash) return false;
  const ok = verifyPasswordRecord(password, user.passwordSalt, user.passwordHash);
  if (ok && !user.passwordHash.startsWith('scrypt:')) {
    user.passwordHash = hashPassword(password, user.passwordSalt);
    persistAuthDb();
  }
  return ok;
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

function isExternalEmailConfigured(): boolean {
  return Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
      process.env.EMAIL_WEBHOOK_URL
  );
}

function isExternalSmsConfigured(): boolean {
  return Boolean(
    process.env.SMS_WEBHOOK_URL ||
      (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
  );
}

async function sendSmtpEmail(to: string, subject: string, textBody: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass || !from) return false;

  return new Promise((resolve) => {
    try {
      const socket: net.Socket | tls.TLSSocket =
        port === 465 ? tls.connect(port, host, { servername: host }) : net.connect(port, host);
      let buffer = '';
      let step = 0;
      const timer = setTimeout(() => {
        try {
          socket.destroy();
        } catch {}
        resolve(false);
      }, 8000);

      const finish = (ok: boolean) => {
        clearTimeout(timer);
        try {
          socket.end();
        } catch {}
        resolve(ok);
      };

      const sendLine = (line: string) => {
        socket.write(`${line}\r\n`);
      };

      socket.on('error', () => finish(false));
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (!buffer.endsWith('\n')) return;
        const code = parseInt(buffer.slice(0, 3), 10);
        buffer = '';
        if (code >= 400) return finish(false);

        if (step === 0) {
          step = 1;
          sendLine('EHLO waqaspos.local');
        } else if (step === 1) {
          step = 2;
          sendLine('AUTH LOGIN');
        } else if (step === 2) {
          step = 3;
          sendLine(Buffer.from(user).toString('base64'));
        } else if (step === 3) {
          step = 4;
          sendLine(Buffer.from(pass).toString('base64'));
        } else if (step === 4) {
          step = 5;
          sendLine(`MAIL FROM:<${from}>`);
        } else if (step === 5) {
          step = 6;
          sendLine(`RCPT TO:<${to}>`);
        } else if (step === 6) {
          step = 7;
          sendLine('DATA');
        } else if (step === 7) {
          step = 8;
          sendLine(
            `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${textBody}\r\n.`
          );
        } else {
          sendLine('QUIT');
          finish(true);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

async function dispatchEmailOtp(toGmail: string, code: string, purpose: 'setup' | 'recovery'): Promise<boolean> {
  const subject =
    purpose === 'setup'
      ? 'WAQAS POS SOFTWARE — Super Admin Email Verification OTP'
      : 'WAQAS POS SOFTWARE — Super Admin Password Recovery OTP';
  const text = `Your WAQAS POS SOFTWARE Super Admin OTP code is: ${code}. Valid for 10 minutes. Never share this code.`;

  if (process.env.EMAIL_WEBHOOK_URL) {
    try {
      const resp = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EMAIL_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: toGmail, subject, text, code, purpose }),
      });
      if (resp.ok) return true;
    } catch {}
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return await sendSmtpEmail(toGmail, subject, text);
  }
  return false;
}

async function dispatchSmsOtp(toMobile: string, code: string, purpose: 'setup' | 'recovery'): Promise<boolean> {
  const text = `WAQAS POS SOFTWARE ${purpose === 'setup' ? 'Super Admin Setup' : 'Recovery'} OTP: ${code}. Valid 10 mins.`;

  if (process.env.SMS_WEBHOOK_URL) {
    try {
      const resp = await fetch(process.env.SMS_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: toMobile, message: text, code, purpose }),
      });
      if (resp.ok) return true;
    } catch {}
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const params = new URLSearchParams({
        To: toMobile,
        From: process.env.TWILIO_FROM_NUMBER,
        Body: text,
      });
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      if (resp.ok) return true;
    } catch {}
  }
  return false;
}

function loadInitialAuditLogs(): AuditLogEntry[] {
  if (fs.existsSync(AUDIT_LOGS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(AUDIT_LOGS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        return parsed.map((entry: any) => ({
          ...entry,
          actorRole: entry.actorRole === 'MASTER_ADMIN' ? 'SUPER_ADMIN' : entry.actorRole,
        }));
      }
    } catch (e) {
      console.warn('Failed to parse audit_logs.json, initializing', e);
    }
  }
  const initialLogs: AuditLogEntry[] = [
    {
      id: `AUD-${Date.now()}-001`,
      timestamp: new Date().toISOString(),
      action: 'SYSTEM_INITIALIZED',
      actorEmail: 'system@waqaspos',
      actorRole: 'SUPER_ADMIN',
      details: 'WAQAS POS SOFTWARE centralized multi-shop authentication initialized.',
    },
  ];
  try {
    fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(initialLogs, null, 2));
  } catch (err) {
    console.error('Error saving audit_logs.json', err);
  }
  return initialLogs;
}

let auditLogs: AuditLogEntry[] = loadInitialAuditLogs();

function persistAuditLogs() {
  try {
    fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(auditLogs.slice(0, 500), null, 2));
  } catch (e) {
    console.error('Error persisting audit_logs.json', e);
  }
}

function recordAuditLog(
  action: string,
  actorEmail: string,
  actorRole: UserRole,
  details: string,
  shopId?: string,
  ipAddress?: string
) {
  const entry: AuditLogEntry = {
    id: `AUD-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    action,
    actorEmail,
    actorRole,
    details,
    shopId,
    ipAddress,
  };
  auditLogs.unshift(entry);
  persistAuditLogs();
}

function loadInitialAuthDb(): AuthDb {
  if (fs.existsSync(AUTH_DB_FILE)) {
    try {
      const raw: any = JSON.parse(fs.readFileSync(AUTH_DB_FILE, 'utf-8'));
      const users: StoredUser[] = Array.isArray(raw.users)
        ? raw.users
            .filter((u: any) => u && u.role !== 'MASTER_ADMIN')
            .map((u: any) => {
              // Backfill username on existing USR-SHOP-001 without touching existing passwordHash
              if (u.id === 'USR-SHOP-001' && !u.username) {
                return { ...u, username: 'waqasmart' };
              }
              return u;
            })
        : [];
      const sessions: Record<string, AuthSessionData> = {};
      if (raw.sessions && typeof raw.sessions === 'object') {
        for (const [tok, sess] of Object.entries<any>(raw.sessions)) {
          if (sess && sess.role && sess.role !== 'MASTER_ADMIN') {
            sessions[tok] = sess;
          }
        }
      }
      const superAdmin: StoredSuperAdmin | null =
        raw.superAdmin && raw.superAdmin.gmail && raw.superAdmin.passwordHash
          ? raw.superAdmin
          : null;

      const loaded: AuthDb = {
        superAdmin,
        superAdminSetupLocked: Boolean(superAdmin || raw.superAdminSetupLocked),
        users,
        sessions,
        pendingOtps: raw.pendingOtps && typeof raw.pendingOtps === 'object' ? raw.pendingOtps : {},
        failedAttempts: raw.failedAttempts && typeof raw.failedAttempts === 'object' ? raw.failedAttempts : {},
      };
      if (loaded.users.length > 0 || loaded.superAdmin) {
        fs.writeFileSync(AUTH_DB_FILE, JSON.stringify(loaded, null, 2));
        return loaded;
      }
    } catch (e) {
      console.warn('Failed to parse auth_db.json, initializing', e);
    }
  }

  const shopOwnerSalt = crypto.randomBytes(16).toString('hex');
  const shopOwnerHash = hashPassword('ShopOwner@123', shopOwnerSalt);

  const initialAuth: AuthDb = {
    superAdmin: null, // Must be privately provisioned once before public distribution
    superAdminSetupLocked: false,
    users: [
      {
        id: 'USR-SHOP-001',
        email: 'waqasmart.pos@gmail.com',
        username: 'waqasmart',
        secondaryEmails: [],
        fullName: 'Muhammad Waqas',
        phone: '03429634133',
        whatsapp: '03228570782',
        role: 'SHOP_OWNER',
        shopId: 'SHOP-WM-001',
        passwordSalt: shopOwnerSalt,
        passwordHash: shopOwnerHash,
        mustChangePasswordOnFirstLogin: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    sessions: {},
    pendingOtps: {},
    failedAttempts: {},
  };

  try {
    fs.writeFileSync(AUTH_DB_FILE, JSON.stringify(initialAuth, null, 2));
  } catch (err) {
    console.error('Error creating default auth_db.json', err);
  }

  return initialAuth;
}

let authDb: AuthDb = loadInitialAuthDb();

const pendingOAuthStates = new Map<string, PendingOAuthState>();
const pendingGoogleAssertions = new Map<string, PendingGoogleAssertion>();
const EPHEMERAL_PROVISION_TOKEN =
  !authDb.superAdmin && !authDb.superAdminSetupLocked && !process.env.SUPER_ADMIN_PROVISION_SECRET
    ? crypto.randomBytes(24).toString('hex')
    : '';

function getActiveProvisionSecret(): string {
  return String(process.env.SUPER_ADMIN_PROVISION_SECRET || EPHEMERAL_PROVISION_TOKEN || '').trim();
}

function constantTimeMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

if (!authDb.superAdmin && !authDb.superAdminSetupLocked) {
  const token = getActiveProvisionSecret();
  const baseAppUrl =
    process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' && process.env.APP_URL.startsWith('http')
      ? process.env.APP_URL.replace(/\/$/, '')
      : `http://localhost:${PORT}`;
  console.log('==================================================================');
  console.log('[WAQAS POS — PRIVATE SUPER ADMIN ONE-TIME PROVISIONING]');
  console.log('Super Admin is not provisioned yet. Public registration is disabled.');
  console.log(`Private Setup URL: ${baseAppUrl}/?provision=${token}`);
  console.log('Or run CLI: npx tsx scripts/provision-super-admin.ts');
  console.log('==================================================================');
}

function persistAuthDb() {
  try {
    const tmpFile = `${AUTH_DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(authDb, null, 2));
    fs.renameSync(tmpFile, AUTH_DB_FILE);
  } catch (e) {
    console.error('Error persisting auth_db.json', e);
  }
}

interface SubscriptionsData {
  shops: ShopAccount[];
  payments: SubscriptionPaymentRecord[];
  renewals: SubscriptionRenewalRecord[];
  defaultPricing?: DefaultSubscriptionPricing;
}

function loadInitialSubscriptions(): SubscriptionsData {
  if (fs.existsSync(SUBSCRIPTIONS_DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_DB_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Failed to parse subscriptions_db.json, using defaults', e);
    }
  }

  const defaultSubs: SubscriptionsData = {
    shops: [
      {
        id: 'SHOP-WM-001',
        shopName: 'WAQAS MART (Main Branch)',
        ownerName: 'Muhammad Waqas',
        email: 'waqasmart.pos@gmail.com',
        phone: '03429634133',
        whatsapp: '03228570782',
        address: 'Main Commercial Market, Pakistan',
        status: 'active',
        plan: '12_months',
        startDate: '2026-01-01',
        expiryDate: '2027-01-01',
        pricing: {
          oneMonth: 1500,
          threeMonths: 4000,
          sixMonths: 7500,
          twelveMonths: 14000,
          customPricePerMonth: 1500,
          lastUpdated: '2026-10-24',
        },
        initialPayment: 14000,
        remainingBalance: 0,
        totalPaid: 14000,
        totalIncome: 14000,
        renewalsCount: 1,
        mustChangePasswordOnFirstLogin: false,
        createdAt: '2026-01-01',
      },
    ],
    payments: [
      {
        id: 'PAY-1001',
        receiptNumber: 'RCP-9821',
        shopId: 'SHOP-WM-001',
        shopName: 'WAQAS MART (Main Branch)',
        ownerName: 'Muhammad Waqas',
        ownerEmail: 'waqasmart.pos@gmail.com',
        plan: '12_months',
        durationLabel: '12 Months (1 Year)',
        totalAmount: 14000,
        discount: 0,
        finalAmount: 14000,
        amountPaid: 14000,
        remainingBalance: 0,
        paymentMethod: 'Bank Transfer',
        paymentDate: '2026-01-01',
        transactionReference: 'TRX-PKR-00192',
        confirmedBy: 'Super Admin',
        status: 'Paid',
        createdAt: '2026-01-01T10:00:00Z',
      },
    ],
    renewals: [
      {
        id: 'REN-1001',
        shopId: 'SHOP-WM-001',
        shopName: 'WAQAS MART (Main Branch)',
        plan: '12_months',
        durationDays: 365,
        previousExpiry: '2026-01-01',
        newExpiry: '2027-01-01',
        paymentReceiptNumber: 'RCP-9821',
        amount: 14000,
        renewedAt: '2026-01-01',
        confirmedBy: 'Super Admin',
      },
    ],
  };

  try {
    fs.writeFileSync(SUBSCRIPTIONS_DB_FILE, JSON.stringify(defaultSubs, null, 2));
  } catch (err) {
    console.error('Error creating default subscriptions_db.json', err);
  }

  return defaultSubs;
}

let subscriptionsDb: SubscriptionsData = loadInitialSubscriptions();

function persistSubscriptions() {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_DB_FILE, JSON.stringify(subscriptionsDb, null, 2));
  } catch (e) {
    console.error('Error persisting subscriptions_db.json', e);
  }
}

// Per-Shop Isolated Store Data Schema
interface StoreData {
  products: Product[];
  transactions: SaleTransaction[];
  purchases: PurchaseTransaction[];
  customers: Customer[];
  customerLedgers: CustomerLedgerEntry[];
  saleReturns: SaleReturn[];
  suppliers: Supplier[];
  heldBills: HeldBill[];
  branding: StoreBranding;
  userProfile: UserProfile;
  martOwner?: any;
  stockHistory?: StockTransaction[];
  purchaseReturns?: PurchaseReturn[];
  supplierLedgers?: SupplierLedgerEntry[];
  expenses?: ExpenseEntry[];
  staffList?: StaffMember[];
  printerSettings?: PrinterSettings;
  categories?: CategoryInfo[];
  dailyHisab?: Record<string, Record<string, Partial<DailyHisabRow>>>;
  receiptSettings?: ReceiptSettings;
  syncVersion?: number;
  lastUpdated?: string;
}

function normalizeStaffPermissions(raw?: Partial<StaffModulePermissions>): StaffModulePermissions {
  const r = raw || {};
  return {
    newSale: typeof r.newSale === 'boolean' ? r.newSale : DEFAULT_STAFF_PERMISSIONS.newSale,
    oldSale: typeof r.oldSale === 'boolean' ? r.oldSale : DEFAULT_STAFF_PERMISSIONS.oldSale,
    newPurchase: typeof r.newPurchase === 'boolean' ? r.newPurchase : DEFAULT_STAFF_PERMISSIONS.newPurchase,
    oldPurchase: typeof r.oldPurchase === 'boolean' ? r.oldPurchase : DEFAULT_STAFF_PERMISSIONS.oldPurchase,
    stock: typeof r.stock === 'boolean' ? r.stock : DEFAULT_STAFF_PERMISSIONS.stock,
    products: typeof r.products === 'boolean' ? r.products : DEFAULT_STAFF_PERMISSIONS.products,
    customers: typeof r.customers === 'boolean' ? r.customers : DEFAULT_STAFF_PERMISSIONS.customers,
    suppliers: typeof r.suppliers === 'boolean' ? r.suppliers : DEFAULT_STAFF_PERMISSIONS.suppliers,
    expenses: typeof r.expenses === 'boolean' ? r.expenses : DEFAULT_STAFF_PERMISSIONS.expenses,
    reports: typeof r.reports === 'boolean' ? r.reports : Boolean(r.canAccessReports),
    printing: typeof r.printing === 'boolean' ? r.printing : DEFAULT_STAFF_PERMISSIONS.printing,
    settings: typeof r.settings === 'boolean' ? r.settings : Boolean(r.canAccessSettings),
    canEditPrice: Boolean(r.canEditPrice),
    canGiveDiscount: Boolean(r.canGiveDiscount),
    canDeleteItems: Boolean(r.canDeleteItems),
    canAccessReports: typeof r.reports === 'boolean' ? r.reports : Boolean(r.canAccessReports),
    canAccessSettings: typeof r.settings === 'boolean' ? r.settings : Boolean(r.canAccessSettings),
    canAccessLedgers: typeof r.canAccessLedgers === 'boolean' ? r.canAccessLedgers : Boolean(r.customers || r.suppliers),
    canViewCostAndProfit: Boolean(r.canViewCostAndProfit),
  };
}

function normalizeStoreData(raw: Partial<StoreData>, fallbackShopName = 'WAQAS MART'): StoreData {
  const staffNormalized: StaffMember[] = Array.isArray(raw.staffList)
    ? raw.staffList.map((st: any) => ({
        ...st,
        permissions: normalizeStaffPermissions(st?.permissions),
      }))
    : [];

  return {
    products: Array.isArray(raw.products) ? raw.products : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    purchases: Array.isArray(raw.purchases) ? raw.purchases : [],
    customers: Array.isArray(raw.customers) ? raw.customers : [],
    customerLedgers: Array.isArray(raw.customerLedgers) ? raw.customerLedgers : [],
    saleReturns: Array.isArray(raw.saleReturns) ? raw.saleReturns : [],
    suppliers: Array.isArray(raw.suppliers) && raw.suppliers.length > 0 ? raw.suppliers : INITIAL_SUPPLIERS,
    heldBills: Array.isArray(raw.heldBills) ? raw.heldBills : [],
    stockHistory: Array.isArray(raw.stockHistory) ? raw.stockHistory : [],
    purchaseReturns: Array.isArray(raw.purchaseReturns) ? raw.purchaseReturns : [],
    supplierLedgers: Array.isArray(raw.supplierLedgers) ? raw.supplierLedgers : [],
    expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
    staffList: staffNormalized,
    printerSettings: raw.printerSettings,
    categories: Array.isArray(raw.categories) && raw.categories.length > 0 ? raw.categories : SCREENSHOT_CATEGORIES,
    dailyHisab: raw.dailyHisab && typeof raw.dailyHisab === 'object' ? raw.dailyHisab : {},
    receiptSettings: raw.receiptSettings,
    martOwner: raw.martOwner,
    syncVersion: typeof raw.syncVersion === 'number' ? raw.syncVersion : 1,
    lastUpdated: raw.lastUpdated || new Date().toISOString(),
    branding: raw.branding || {
      storeName: fallbackShopName,
      primaryName: fallbackShopName.split(' ')[0] || 'WAQAS',
      accentName: fallbackShopName.split(' ').slice(1).join(' ') || 'MART',
      subtitle: 'Supermarket Management',
      primaryColor: '#00a859',
      sidebarPromoTitle: 'Small Steps Big Dreams',
      sidebarPromoBadge: fallbackShopName,
      bottomBannerTitle: 'Fresh Products Everyday',
      bottomBannerSubtitle: 'Best Quality • Lowest Prices',
      terminalDeviceId: 'WM-001',
    },
    userProfile: raw.userProfile || {
      id: 'USR-SHOP-OWNER',
      displayName: 'Shop Owner',
      email: '',
      phone: '',
      role: 'Shop Owner',
      createdAt: new Date().toLocaleDateString('en-GB'),
    },
  };
}

function getShopStoreFile(shopId: string): string {
  const cleanId = (shopId || 'SHOP-WM-001').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(SHOPS_DIR, `${cleanId}.json`);
}

// Per-Shop In-Memory Store Cache
const shopStoreCache = new Map<string, StoreData>();

function getShopStore(shopId: string): StoreData {
  const targetId = shopId || 'SHOP-WM-001';
  const cached = shopStoreCache.get(targetId);
  if (cached) return cached;

  const shopMeta = subscriptionsDb.shops.find((s) => s.id === targetId);
  const shopName = shopMeta?.shopName || (targetId === 'SHOP-WM-001' ? 'WAQAS MART' : 'NEW MART');
  const file = getShopStoreFile(targetId);

  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const normalized = normalizeStoreData(parsed, shopName);
      shopStoreCache.set(targetId, normalized);
      return normalized;
    } catch (e) {
      console.warn(`Failed to parse shop store for ${targetId}, using fallback`, e);
    }
  }

  if (targetId === 'SHOP-WM-001' && fs.existsSync(STORE_DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_DB_FILE, 'utf-8'));
      const normalized = normalizeStoreData(parsed, shopName);
      shopStoreCache.set(targetId, normalized);
      fs.writeFileSync(file, JSON.stringify(normalized, null, 2));
      return normalized;
    } catch {}
  }

  const fresh = normalizeStoreData({}, shopName);
  if (shopMeta) {
    fresh.userProfile = {
      id: `USR-${targetId}`,
      displayName: shopMeta.ownerName || shopName,
      email: shopMeta.email || '',
      phone: shopMeta.phone || '',
      role: 'Shop Owner',
      createdAt: shopMeta.createdAt || new Date().toLocaleDateString('en-GB'),
    };
  }
  shopStoreCache.set(targetId, fresh);
  try {
    fs.writeFileSync(file, JSON.stringify(fresh, null, 2));
    if (targetId === 'SHOP-WM-001') {
      fs.writeFileSync(STORE_DB_FILE, JSON.stringify(fresh, null, 2));
    }
  } catch {}
  return fresh;
}

function persistShopStore(shopId: string, bumpVersion = true): StoreData {
  const targetId = shopId || 'SHOP-WM-001';
  const store = getShopStore(targetId);
  if (bumpVersion) {
    store.syncVersion = (Number(store.syncVersion) || 0) + 1;
    store.lastUpdated = new Date().toISOString();
  }
  const serialized = JSON.stringify(store, null, 2);
  try {
    fs.writeFileSync(getShopStoreFile(targetId), serialized);
    if (targetId === 'SHOP-WM-001') {
      fs.writeFileSync(STORE_DB_FILE, serialized);
    }
  } catch (err) {
    console.error(`Error saving shop store data for ${targetId}:`, err);
  }
  return store;
}

function setShopStore(shopId: string, data: StoreData, bumpVersion = true): StoreData {
  const targetId = shopId || 'SHOP-WM-001';
  const shopMeta = subscriptionsDb.shops.find((s) => s.id === targetId);
  const normalized = normalizeStoreData(data, shopMeta?.shopName || 'WAQAS MART');
  shopStoreCache.set(targetId, normalized);
  return persistShopStore(targetId, bumpVersion);
}

// Strip sensitive password hashes & optional cost/profit fields depending on actor role
function sanitizeStoreForClient(store: StoreData, role: UserRole, permissions?: StaffModulePermissions): StoreData {
  const cloned: StoreData = {
    ...store,
    staffList: (store.staffList || []).map((st: any) => ({
      ...st,
      passwordHash: undefined,
      passwordSalt: undefined,
    })),
  };

  if (role === 'STAFF' && !permissions?.canViewCostAndProfit) {
    cloned.products = (store.products || []).map((p) => ({ ...p, costPrice: 0 }));
    cloned.transactions = (store.transactions || []).map((tx) => ({
      ...tx,
      items: (tx.items || []).map((it) => ({
        ...it,
        product: it.product ? { ...it.product, costPrice: 0 } : it.product,
      })),
    }));
    if (!permissions?.newPurchase && !permissions?.oldPurchase && !permissions?.reports) {
      cloned.purchases = [];
      cloned.purchaseReturns = [];
    }
    if (!permissions?.expenses && !permissions?.reports) {
      cloned.expenses = [];
    }
  }

  return cloned;
}

function loadInitialDevices(): DeviceInfo[] {
  if (fs.existsSync(DEVICES_DB_FILE)) {
    try {
      const content = fs.readFileSync(DEVICES_DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.map((d: any) => ({
          ...d,
          shopId: d.shopId || 'SHOP-WM-001',
        }));
      }
    } catch (e) {
      console.warn('Failed to parse devices_db.json, initializing', e);
    }
  }

  const initialDevices: DeviceInfo[] = [
    {
      deviceId: 'DEV-PRIMARY-TERMINAL',
      sessionToken: 'TOKEN-PRIMARY-TERMINAL-ROOT',
      shopId: 'SHOP-WM-001',
      deviceName: 'Main Store Windows Terminal',
      deviceType: 'Windows PC',
      browser: 'Chrome / Desktop',
      os: 'Windows 11 / 10',
      isCurrentDevice: false,
      firstRegistered: new Date().toLocaleDateString('en-GB'),
      lastActive: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      status: 'active',
      connectionState: 'online',
    },
  ];

  try {
    fs.writeFileSync(DEVICES_DB_FILE, JSON.stringify(initialDevices, null, 2));
  } catch (err) {
    console.error('Error saving default devices', err);
  }

  return initialDevices;
}

// Preload primary shop cache on boot
getShopStore('SHOP-WM-001');
let registeredDevices: DeviceInfo[] = loadInitialDevices();
const pairingSessions = new Map<string, PairingSession>();
const removedDeviceIds = new Set<string>();

function verifyDeviceAccess(
  deviceId?: string,
  sessionToken?: string
): { allowed: boolean; statusCode: number; error?: string; message?: string; device?: DeviceInfo } {
  if (!deviceId) {
    return { allowed: true, statusCode: 200 };
  }
  if (removedDeviceIds.has(deviceId)) {
    return {
      allowed: false,
      statusCode: 403,
      error: 'DEVICE_REMOVED',
      message: 'This device was removed by the administrator. Re-pair via QR code to reconnect.',
    };
  }
  const dev = registeredDevices.find((d) => d.deviceId === deviceId);
  if (!dev) {
    if (sessionToken) {
      return {
        allowed: false,
        statusCode: 403,
        error: 'DEVICE_UNKNOWN',
        message: 'Device session is no longer registered. Please pair again.',
      };
    }
    return { allowed: true, statusCode: 200 };
  }
  if (dev.status === 'revoked') {
    return {
      allowed: false,
      statusCode: 403,
      error: 'DEVICE_REVOKED',
      message: 'Device access has been revoked by administrator.',
      device: dev,
    };
  }
  if (dev.sessionToken && sessionToken && dev.sessionToken !== sessionToken) {
    return {
      allowed: false,
      statusCode: 403,
      error: 'INVALID_DEVICE_TOKEN',
      message: 'Invalid or expired device authorization token.',
      device: dev,
    };
  }
  return { allowed: true, statusCode: 200, device: dev };
}

function recordShopStockTx(
  shopData: StoreData,
  product: Product,
  previousStock: number,
  quantityChange: number,
  newStock: number,
  transactionType: StockTransactionType,
  invoiceNumber: string,
  userName?: string,
  notes?: string
) {
  const entry: StockTransaction = {
    id: `STK-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    productId: product.id,
    productName: product.name,
    barcode: product.barcode,
    previousStock,
    quantityChange,
    newStock,
    transactionType,
    invoiceNumber,
    dateTime: new Date().toLocaleString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
    userName,
    notes,
  };
  shopData.stockHistory = [entry, ...(shopData.stockHistory || [])].slice(0, 5000);
}

function persistDevices() {
  try {
    fs.writeFileSync(DEVICES_DB_FILE, JSON.stringify(registeredDevices, null, 2));
  } catch (e) {
    console.error('Error persisting devices_db.json', e);
  }
}

// Active Server-Sent Events (SSE) subscribers strictly scoped per Shop ID
interface SseClient {
  id: string;
  res: Response;
  deviceId: string;
  shopId: string;
  role: UserRole;
  canViewCostAndProfit: boolean;
  ip: string;
  connectedAt: number;
}
const sseClients = new Map<string, SseClient>();

function sanitizeSseEventForClient(event: SyncEvent, client: SseClient): SyncEvent {
  if (client.role !== 'STAFF' || client.canViewCostAndProfit) {
    return event;
  }
  const p = event.payload;
  if (!p) return event;

  if (event.type === 'store:sync' && typeof p === 'object') {
    return {
      ...event,
      payload: sanitizeStoreForClient(p as StoreData, 'STAFF', { ...DEFAULT_STAFF_PERMISSIONS, canViewCostAndProfit: false }),
    };
  }
  if (Array.isArray(p) && event.type === 'stock:updated') {
    return {
      ...event,
      payload: p.map((item: any) => ({ ...item, costPrice: 0 })),
    };
  }
  if (typeof p === 'object' && Array.isArray(p.updatedProducts)) {
    return {
      ...event,
      payload: {
        ...p,
        updatedProducts: p.updatedProducts.map((item: any) => ({ ...item, costPrice: 0 })),
      },
    };
  }
  return event;
}

function broadcastSyncEventToShop(shopId: string, event: SyncEvent) {
  const targetShopId = shopId || 'SHOP-WM-001';
  sseClients.forEach((client) => {
    if (client.shopId !== targetShopId) return;
    try {
      const safeEvent = sanitizeSseEventForClient(event, client);
      client.res.write(`data: ${JSON.stringify(safeEvent)}\n\n`);
    } catch {
      sseClients.delete(client.id);
    }
  });
}

function disconnectShopClients(shopId: string, eventType: 'device:revoked' | 'auth:shop_restricted' = 'device:revoked', message?: string) {
  for (const [cid, client] of sseClients.entries()) {
    if (client.shopId === shopId) {
      try {
        client.res.write(
          `data: ${JSON.stringify({
            type: eventType,
            timestamp: Date.now(),
            payload: { shopId, message },
          })}\n\n`
        );
        client.res.end();
      } catch {}
      sseClients.delete(cid);
    }
  }
}

// Clean up expired pairing sessions, OAuth states, Google assertions, and OTP sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of pairingSessions.entries()) {
    if (session.expiresAt <= now) {
      session.status = 'expired';
      pairingSessions.delete(token);
    }
  }
  for (const [state, st] of pendingOAuthStates.entries()) {
    if (st.expiresAt <= now) pendingOAuthStates.delete(state);
  }
  for (const [tok, asrt] of pendingGoogleAssertions.entries()) {
    if (asrt.expiresAt <= now || asrt.used) pendingGoogleAssertions.delete(tok);
  }
  let otpDirty = false;
  for (const [k, otp] of Object.entries(authDb.pendingOtps || {})) {
    if (otp.expiresAt <= now) {
      delete authDb.pendingOtps[k];
      otpDirty = true;
    }
  }
  if (otpDirty) persistAuthDb();
}, 60 * 1000);

// Heartbeat for SSE connections
setInterval(() => {
  const ping = JSON.stringify({
    type: 'ping',
    timestamp: Date.now(),
  });
  sseClients.forEach((client) => {
    try {
      client.res.write(`data: ${ping}\n\n`);
    } catch {
      sseClients.delete(client.id);
    }
  });
}, 20 * 1000);

async function start() {
  // 1. Comprehensive CORS Configuration for downloaded web app, remote devices, and credentialed PWA manifest
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Vary', 'Origin');
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-device-id, x-device-token');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  // Health and ping routes for downloaded web app status verification
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'healthy',
      app: 'WAQAS POS SOFTWARE',
      version: '3.0.0',
      serverTime: new Date().toISOString(),
      devicesConnected: registeredDevices.length,
    });
  });

  app.get('/api/ping', (_req, res) => {
    res.json({ pong: true, time: Date.now() });
  });

  // PWA Manifest with explicit application/manifest+json MIME type
  app.get(['/manifest.json', '/manifest.webmanifest'], (_req, res) => {
    const manifestPath = path.resolve(process.cwd(), 'public', 'manifest.json');
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    return res.sendFile(manifestPath);
  });

  // PWA Service Worker with Service-Worker-Allowed header
  app.get('/sw.js', (_req, res) => {
    const swPath = path.resolve(process.cwd(), 'public', 'sw.js');
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(swPath);
  });

  // Direct Download routes for WAQAS MART POS App package (.zip)
  app.get(['/download', '/download-app', '/api/download', '/waqas-mart-pos.zip'], (_req, res) => {
    try {
      const rootDir = process.cwd();
      const pkgPath = path.resolve(rootDir, 'dist-packages', 'waqas-mart-pos.zip');
      if (fs.existsSync(pkgPath)) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Disposition', 'attachment; filename="WAQAS-POS-SOFTWARE-v3.0.0.zip"');
        return res.sendFile(pkgPath);
      }

      // Build fresh ZIP dynamically from current workspace files (never 404s, always latest v3.0.0)
      const crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[i] = c >>> 0;
      }
      const crc32 = (buf: Buffer): number => {
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
          crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
      };

      const zipFiles: Array<{ relPath: string; data: Buffer }> = [];
      const addFileIfExists = (absPath: string, relPath: string) => {
        if (!fs.existsSync(absPath)) return;
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return;
        zipFiles.push({ relPath: relPath.replace(/\\/g, '/'), data: fs.readFileSync(absPath) });
      };
      const addDirRecursive = (dirRel: string, skipSubPaths: string[] = []) => {
        const absDir = path.resolve(rootDir, dirRel);
        if (!fs.existsSync(absDir)) return;
        const walk = (curAbs: string, curRel: string) => {
          for (const entry of fs.readdirSync(curAbs, { withFileTypes: true })) {
            const nextRel = path.posix.join(curRel, entry.name);
            if (skipSubPaths.some((skip) => nextRel === skip || nextRel.startsWith(skip + '/'))) {
              continue;
            }
            const nextAbs = path.join(curAbs, entry.name);
            if (entry.isDirectory()) {
              walk(nextAbs, nextRel);
            } else if (entry.isFile() && !entry.name.endsWith('.zip')) {
              addFileIfExists(nextAbs, nextRel);
            }
          }
        };
        walk(absDir, dirRel);
      };

      [
        'package.json',
        'index.html',
        'metadata.json',
        'server.ts',
        'server.cjs',
        'tsconfig.json',
        'vite.config.ts',
        'ecosystem.config.cjs',
        '.env.example',
        'firebase-applet-config.json',
      ].forEach((f) => addFileIfExists(path.resolve(rootDir, f), f));

      addDirRecursive('src');
      addDirRecursive('public', ['public/assets/aistudio']);
      addDirRecursive('dist', ['dist/assets/aistudio']);
      addDirRecursive('.github');

      const localParts: Buffer[] = [];
      const centralParts: Buffer[] = [];
      let offset = 0;

      for (const entry of zipFiles) {
        const nameBuf = Buffer.from(entry.relPath, 'utf-8');
        const compressed = zlib.deflateRawSync(entry.data, { level: 6 });
        const crc = crc32(entry.data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0x5421, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(entry.data.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuf, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x5421, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(entry.data.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compressed.length;
      }

      const centralDir = Buffer.concat(centralParts);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(0, 4);
      eocd.writeUInt16LE(0, 6);
      eocd.writeUInt16LE(zipFiles.length, 8);
      eocd.writeUInt16LE(zipFiles.length, 10);
      eocd.writeUInt32LE(centralDir.length, 12);
      eocd.writeUInt32LE(offset, 16);
      eocd.writeUInt16LE(0, 20);

      const finalZip = Buffer.concat([...localParts, centralDir, eocd]);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Content-Length', String(finalZip.length));
      res.setHeader('Content-Disposition', 'attachment; filename="WAQAS-POS-SOFTWARE-v3.0.0.zip"');
      return res.send(finalZip);
    } catch (err: any) {
      console.error('[Download] Failed to package app ZIP:', err?.message || err);
      return res.status(500).send('Failed to generate app package.');
    }
  });

  // Request logger
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api') && !req.path.includes('/events') && !req.path.includes('/ping')) {
      console.log(`[API] ${req.method} ${req.path}`);
    }
    next();
  });

  // -------------------------------------------------------------
  // 1. CENTRALIZED AUTHENTICATION (SUPER ADMIN, SHOP OWNER, STAFF)
  // -------------------------------------------------------------
  function getSessionFromReq(req: Request): AuthSessionData | null {
    const authHeader = req.headers.authorization;
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['x-session-token']) {
      token = String(req.headers['x-session-token']).trim();
    } else if (req.query?.token && typeof req.query.token === 'string') {
      token = req.query.token.trim();
    } else if (req.body && req.body.sessionToken) {
      token = String(req.body.sessionToken).trim();
    }
    if (!token) return null;
    const session = authDb.sessions[token];
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      delete authDb.sessions[token];
      persistAuthDb();
      return null;
    }
    return session;
  }

  function checkAndAutoExpireSubscriptions() {
    const todayStr = new Date().toISOString().split('T')[0];
    let updated = false;

    subscriptionsDb.shops.forEach((shop) => {
      if (shop.status === 'blocked' || shop.status === 'suspended' || shop.status === 'inactive') {
        return;
      }
      if (shop.expiryDate < todayStr) {
        if (shop.status !== 'expired') {
          shop.status = 'expired';
          updated = true;
          recordAuditLog(
            'SUBSCRIPTION_EXPIRED',
            'system',
            'SUPER_ADMIN',
            `Shop ${shop.shopName} (${shop.id}) expired on ${shop.expiryDate}`,
            shop.id
          );
        }
      } else {
        const expTime = new Date(shop.expiryDate).getTime();
        const diffDays = Math.ceil((expTime - Date.now()) / (1000 * 60 * 60 * 24));
        if (diffDays <= 7 && shop.status === 'active') {
          shop.status = 'expiring_soon';
          updated = true;
        }
      }
    });

    if (updated) {
      persistSubscriptions();
    }
  }

  checkAndAutoExpireSubscriptions();
  setInterval(() => {
    checkAndAutoExpireSubscriptions();
  }, 5 * 60 * 1000);

  function sanitizeAuthUser(session: AuthSessionData): AuthUser {
    if (session.role === 'SUPER_ADMIN' && authDb.superAdmin) {
      return {
        id: authDb.superAdmin.id,
        gmail: authDb.superAdmin.gmail,
        email: authDb.superAdmin.gmail,
        mobile: authDb.superAdmin.mobile,
        phone: authDb.superAdmin.mobile,
        fullName: authDb.superAdmin.fullName,
        role: 'SUPER_ADMIN',
        verifiedGmail: authDb.superAdmin.verifiedGmail,
        verifiedMobile: authDb.superAdmin.verifiedMobile,
        createdAt: authDb.superAdmin.createdAt,
      };
    }
    const shopMeta = session.shopId ? subscriptionsDb.shops.find((s) => s.id === session.shopId) : undefined;
    if (session.role === 'STAFF' && session.shopId && session.staffId) {
      const store = getShopStore(session.shopId);
      const staff = (store.staffList || []).find((s) => s.id === session.staffId);
      return {
        id: session.userId,
        username: staff?.username || session.username,
        fullName: staff?.name || session.fullName || 'Staff Member',
        phone: staff?.phone,
        role: 'STAFF',
        shopId: session.shopId,
        shopName: shopMeta?.shopName,
        staffId: session.staffId,
        permissions: normalizeStaffPermissions(staff?.permissions || session.permissions),
        createdAt: staff?.createdAt || new Date().toISOString(),
      };
    }
    const owner = authDb.users.find((u) => u.id === session.userId);
    return {
      id: owner?.id || session.userId,
      email: owner?.email || session.email,
      username: owner?.username || session.username,
      fullName: owner?.fullName || shopMeta?.ownerName || 'Shop Owner',
      phone: owner?.phone || shopMeta?.phone,
      whatsapp: owner?.whatsapp || shopMeta?.whatsapp,
      role: session.role,
      shopId: session.shopId,
      shopName: shopMeta?.shopName,
      mustChangePasswordOnFirstLogin: owner?.mustChangePasswordOnFirstLogin,
      createdAt: owner?.createdAt || new Date().toISOString(),
    };
  }

  interface ResolvedActor {
    ok: boolean;
    statusCode: number;
    error?: string;
    message?: string;
    role: UserRole;
    shopId: string;
    actorEmail: string;
    staffId?: string;
    permissions?: StaffModulePermissions;
    device?: DeviceInfo;
    session?: AuthSessionData;
  }

  function resolveShopActor(req: Request): ResolvedActor {
    checkAndAutoExpireSubscriptions();
    const session = getSessionFromReq(req);
    const deviceId =
      (req.headers['x-device-id'] as string) ||
      (req.query.deviceId as string) ||
      (req.body?.sourceDeviceId as string) ||
      '';
    const deviceToken =
      (req.headers['x-device-token'] as string) ||
      (req.query.deviceToken as string) ||
      '';

    if (deviceId) {
      const devCheck = verifyDeviceAccess(deviceId, deviceToken || undefined);
      if (!devCheck.allowed) {
        return {
          ok: false,
          statusCode: devCheck.statusCode,
          error: devCheck.error,
          message: devCheck.message,
          role: 'STAFF',
          shopId: '',
          actorEmail: deviceId,
        };
      }
    }

    if (session) {
      if (session.role === 'SUPER_ADMIN') {
        if (!authDb.superAdmin) {
          return {
            ok: false,
            statusCode: 401,
            error: 'SUPER_ADMIN_NOT_CONFIGURED',
            message: 'Super Admin session is invalid.',
            role: 'SUPER_ADMIN',
            shopId: '',
            actorEmail: 'unknown',
          };
        }
        const requestedShopId =
          (req.query.shopId as string) ||
          (req.headers['x-shop-id'] as string) ||
          (req.body?.shopId as string) ||
          'SHOP-WM-001';
        return {
          ok: true,
          statusCode: 200,
          role: 'SUPER_ADMIN',
          shopId: requestedShopId,
          actorEmail: authDb.superAdmin.gmail,
          session,
        };
      }

      const shopId = session.shopId || '';
      const shop = subscriptionsDb.shops.find((s) => s.id === shopId);
      if (!shop) {
        return {
          ok: false,
          statusCode: 403,
          error: 'SHOP_NOT_FOUND',
          message: 'Shop account no longer exists.',
          role: session.role,
          shopId,
          actorEmail: session.username || session.email || session.userId,
        };
      }

      if (shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked' || shop.status === 'expired') {
        return {
          ok: false,
          statusCode: 403,
          error: 'SHOP_ACCOUNT_RESTRICTED',
          message: `Shop "${shop.shopName}" is ${shop.status.toUpperCase()}. Contact Muhammad Waqas (03228570782).`,
          role: session.role,
          shopId,
          actorEmail: session.username || session.email || session.userId,
        };
      }

      const explicitShop = (req.query.shopId as string) || (req.headers['x-shop-id'] as string);
      if (explicitShop && explicitShop !== shopId) {
        return {
          ok: false,
          statusCode: 403,
          error: 'CROSS_SHOP_ACCESS_DENIED',
          message: 'Access to another shop database is prohibited.',
          role: session.role,
          shopId,
          actorEmail: session.username || session.email || session.userId,
        };
      }

      let livePermissions = session.permissions;
      if (session.role === 'STAFF' && session.staffId) {
        const shopStore = getShopStore(shopId);
        const staff = (shopStore.staffList || []).find((st) => st.id === session.staffId);
        if (!staff || staff.accountStatus !== 'active') {
          return {
            ok: false,
            statusCode: 403,
            error: 'STAFF_ACCOUNT_RESTRICTED',
            message: 'Staff account is inactive or suspended.',
            role: 'STAFF',
            shopId,
            actorEmail: session.username || session.userId,
          };
        }
        livePermissions = normalizeStaffPermissions(staff.permissions);
      }

      const dev = deviceId ? registeredDevices.find((d) => d.deviceId === deviceId) : undefined;
      return {
        ok: true,
        statusCode: 200,
        role: session.role,
        shopId,
        actorEmail: session.username || session.email || session.userId,
        staffId: session.staffId,
        permissions: livePermissions,
        device: dev,
        session,
      };
    }

    // Paired POS terminal authentication via deviceId + signed deviceToken
    if (deviceId && deviceToken) {
      const dev = registeredDevices.find((d) => d.deviceId === deviceId && d.sessionToken === deviceToken);
      if (dev && dev.status === 'active') {
        const shopId = dev.shopId || 'SHOP-WM-001';
        const shop = subscriptionsDb.shops.find((s) => s.id === shopId);
        if (shop && (shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked' || shop.status === 'expired')) {
          return {
            ok: false,
            statusCode: 403,
            error: 'SHOP_ACCOUNT_RESTRICTED',
            message: `Shop "${shop.shopName}" is ${shop.status.toUpperCase()}. Terminal access locked.`,
            role: 'SHOP_OWNER',
            shopId,
            actorEmail: dev.deviceId,
          };
        }
        const explicitShop = (req.query.shopId as string) || (req.headers['x-shop-id'] as string);
        if (explicitShop && explicitShop !== shopId) {
          return {
            ok: false,
            statusCode: 403,
            error: 'CROSS_SHOP_ACCESS_DENIED',
            message: 'Terminal cannot access another shop database.',
            role: 'SHOP_OWNER',
            shopId,
            actorEmail: dev.deviceId,
          };
        }
        return {
          ok: true,
          statusCode: 200,
          role: 'SHOP_OWNER',
          shopId,
          actorEmail: dev.deviceId,
          device: dev,
        };
      }
    }

    return {
      ok: false,
      statusCode: 401,
      error: 'AUTH_REQUIRED',
      message: 'Authentication required. Please log in with your Super Admin, Shop Owner, or Staff credentials.',
      role: 'STAFF',
      shopId: '',
      actorEmail: 'anonymous',
    };
  }

  function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({ success: false, error: 'AUTH_REQUIRED', message: 'Super Admin authentication required.' });
    }
    if (session.role !== 'SUPER_ADMIN' || !authDb.superAdmin) {
      return res.status(403).json({ success: false, error: 'SUPER_ADMIN_ONLY', message: 'Access restricted to Primary Super Admin.' });
    }
    (req as any).superAdminSession = session;
    next();
  }

  function checkRateLimit(key: string): { blocked: boolean; retrySeconds?: number } {
    const rec = authDb.failedAttempts[key];
    if (!rec) return { blocked: false };
    const elapsed = Date.now() - rec.lastAttempt;
    if (elapsed > 15 * 60 * 1000) {
      delete authDb.failedAttempts[key];
      return { blocked: false };
    }
    if (rec.count >= 10) {
      return { blocked: true, retrySeconds: Math.ceil((15 * 60 * 1000 - elapsed) / 1000) };
    }
    return { blocked: false };
  }

  function recordFailedAttempt(key: string) {
    const prev = authDb.failedAttempts[key];
    const withinWindow = prev && Date.now() - prev.lastAttempt < 15 * 60 * 1000;
    authDb.failedAttempts[key] = {
      count: withinWindow ? prev.count + 1 : 1,
      lastAttempt: Date.now(),
    };
    persistAuthDb();
  }

  function clearFailedAttempt(key: string) {
    if (authDb.failedAttempts[key]) {
      delete authDb.failedAttempts[key];
      persistAuthDb();
    }
  }

  function getGoogleOAuthRedirectUris(clientOrigin?: string): {
    effective: string;
    dev: string;
    shared: string;
  } {
    const devBase =
      (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL' && process.env.APP_URL.startsWith('http')
        ? process.env.APP_URL.replace(/\/$/, '')
        : 'https://ais-dev-vaudrmkpqhsdlkfvexzjj6-15172624746.asia-southeast1.run.app');
    const sharedBase = 'https://ais-pre-vaudrmkpqhsdlkfvexzjj6-15172624746.asia-southeast1.run.app';
    let effectiveBase = devBase;
    if (clientOrigin && (clientOrigin.startsWith('https://') || clientOrigin.startsWith('http://'))) {
      effectiveBase = clientOrigin.replace(/\/$/, '');
    } else if (!process.env.APP_URL || process.env.APP_URL === 'MY_APP_URL') {
      effectiveBase = `http://127.0.0.1:${PORT}`;
    }
    return {
      effective: `${effectiveBase}/api/auth/google/callback`,
      dev: `${devBase}/api/auth/google/callback`,
      shared: `${sharedBase}/api/auth/google/callback`,
    };
  }

  interface FirebaseClientConfig {
    projectId: string;
    apiKey: string;
    authDomain?: string;
    oAuthClientId?: string;
  }

  let cachedFirebaseConfig: FirebaseClientConfig | null | undefined = undefined;
  function loadFirebaseConfig(): FirebaseClientConfig | null {
    if (cachedFirebaseConfig !== undefined) return cachedFirebaseConfig;
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) {
      cachedFirebaseConfig = null;
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (!parsed?.projectId || parsed.projectId === 'remixed-project-id' || !parsed?.apiKey) {
        cachedFirebaseConfig = null;
        return null;
      }
      cachedFirebaseConfig = parsed as FirebaseClientConfig;
      return cachedFirebaseConfig;
    } catch {
      cachedFirebaseConfig = null;
      return null;
    }
  }

  let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;
  async function fetchGoogleSecureTokenCerts(forceRefresh = false): Promise<Record<string, string>> {
    if (!forceRefresh && cachedGoogleCerts && Date.now() < cachedGoogleCerts.expiresAt) {
      return cachedGoogleCerts.certs;
    }
    const certsUrl =
      process.env.FIREBASE_AUTH_CERTS_URL ||
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
    const resp = await fetch(certsUrl);
    if (!resp.ok) {
      throw new Error('Unable to fetch Google public verification certificates.');
    }
    const certs = (await resp.json()) as Record<string, string>;
    const cc = resp.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 3600 * 1000;
    cachedGoogleCerts = { certs, expiresAt: Date.now() + ttlMs };
    return certs;
  }

  function decodeBase64UrlJson(seg: string): any {
    const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  }

  function base64UrlToBuffer(seg: string): Buffer {
    const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return Buffer.from(b64, 'base64');
  }

  async function verifyFirebaseGoogleIdToken(idToken: string): Promise<{
    email: string;
    sub: string;
    fullName: string;
  }> {
    const fb = loadFirebaseConfig();
    if (!fb) {
      throw new Error('Firebase Google Authentication is not configured on this server.');
    }
    const parts = String(idToken || '').trim().split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed Google ID token.');
    }
    const [hdrSeg, paySeg, sigSeg] = parts;
    const header = decodeBase64UrlJson(hdrSeg);
    const payload = decodeBase64UrlJson(paySeg);

    if (header.alg !== 'RS256' || !header.kid) {
      throw new Error('Unsupported or missing Google token signature key.');
    }

    let certs = await fetchGoogleSecureTokenCerts(false);
    let certPem = certs[String(header.kid)];
    if (!certPem) {
      certs = await fetchGoogleSecureTokenCerts(true);
      certPem = certs[String(header.kid)];
    }
    if (!certPem) {
      throw new Error('Unknown Google signing key ID.');
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${hdrSeg}.${paySeg}`);
    verifier.end();
    const signatureValid = verifier.verify(certPem, base64UrlToBuffer(sigSeg));
    if (!signatureValid) {
      throw new Error('Google ID token signature verification failed.');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.aud !== fb.projectId) {
      throw new Error('Google token audience mismatch.');
    }
    if (payload.iss !== `https://securetoken.google.com/${fb.projectId}`) {
      throw new Error('Google token issuer mismatch.');
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('Google token missing subject.');
    }
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
      throw new Error('Google verification token expired. Please click Continue with Google again.');
    }
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
      throw new Error('Google token timestamp is invalid.');
    }
    if (payload.firebase?.sign_in_provider !== 'google.com') {
      throw new Error('Authentication must use a verified Google account.');
    }
    if (payload.email_verified !== true || !payload.email) {
      throw new Error('Selected Google account does not have a verified email.');
    }

    if (!process.env.FIREBASE_AUTH_CERTS_URL) {
      const lookupResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fb.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!lookupResp.ok) {
        throw new Error('Google account session could not be confirmed.');
      }
      const lookupData: any = await lookupResp.json().catch(() => ({}));
      const matchedUser = Array.isArray(lookupData.users) ? lookupData.users[0] : null;
      if (!matchedUser || matchedUser.disabled || !matchedUser.emailVerified) {
        throw new Error('Google account is disabled or unverified.');
      }
    }

    return {
      email: String(payload.email).trim().toLowerCase(),
      sub: String(payload.sub).trim(),
      fullName: String(payload.name || 'Muhammad Waqas').trim(),
    };
  }

  function isGoogleOAuthConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_ID.trim() &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_CLIENT_SECRET.trim()
    );
  }

  // Bootstrap status: reports locked/provisioned status & Google OAuth readiness (never exposes secrets)
  app.get('/api/auth/bootstrap-status', (_req: Request, res: Response) => {
    const sa = authDb.superAdmin;
    const uris = getGoogleOAuthRedirectUris();
    const fbReady = Boolean(loadFirebaseConfig());
    return res.json({
      success: true,
      superAdminConfigured: Boolean(sa),
      superAdminSetupLocked: Boolean(sa || authDb.superAdminSetupLocked),
      firebaseGoogleAuthConfigured: fbReady,
      googleOAuthConfigured: fbReady || isGoogleOAuthConfigured(),
      googleRedirectUris: {
        dev: uris.dev,
        shared: uris.shared,
      },
      maskedGmail: sa ? maskEmail(sa.gmail) : undefined,
    });
  });

  // Cryptographic Backend Verification for Genuine Google Sign-In ID Tokens (Firebase Auth Google Provider)
  app.post('/api/auth/google/verify-id-token', async (req: Request, res: Response) => {
    try {
      const { idToken, purpose = 'login' } = req.body || {};
      const cleanPurpose: 'login' | 'provision' = purpose === 'provision' ? 'provision' : 'login';

      if (cleanPurpose === 'provision' && (authDb.superAdmin || authDb.superAdminSetupLocked)) {
        return res.status(409).json({
          success: false,
          error: 'SUPER_ADMIN_LOCKED',
          message: 'Permanent Super Admin is already provisioned and locked. Future registrations are permanently disabled.',
        });
      }

      if (cleanPurpose === 'login' && !authDb.superAdmin) {
        return res.status(403).json({
          success: false,
          error: 'SUPER_ADMIN_NOT_CONFIGURED',
          message: 'Permanent Super Admin has not been provisioned yet.',
        });
      }

      if (!idToken || typeof idToken !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'MISSING_ID_TOKEN',
          message: 'Google Sign-In ID token is required.',
        });
      }

      const verified = await verifyFirebaseGoogleIdToken(idToken);
      const cleanGmail = verified.email;
      const googleSub = verified.sub;

      if (cleanPurpose === 'login') {
        const sa = authDb.superAdmin!;
        if (cleanGmail !== sa.gmail.toLowerCase() || (sa.googleSub && googleSub && sa.googleSub !== googleSub)) {
          recordAuditLog(
            'SUPER_ADMIN_WRONG_GMAIL',
            cleanGmail,
            'SUPER_ADMIN',
            `Rejected unauthorized Google account (${cleanGmail}) at Super Admin login`,
            undefined,
            req.ip
          );
          return res.status(403).json({
            success: false,
            error: 'UNAUTHORIZED_GMAIL',
            message: `Google account "${cleanGmail}" is NOT the permanently registered Super Admin Gmail.`,
          });
        }
      }

      const assertionToken = `GSA-${crypto.randomBytes(24).toString('hex')}`;
      pendingGoogleAssertions.set(assertionToken, {
        gmail: cleanGmail,
        googleSub,
        fullName: verified.fullName,
        purpose: cleanPurpose,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        used: false,
        passwordRetries: 0,
      });

      return res.json({
        success: true,
        assertionToken,
        gmail: cleanGmail,
        fullName: verified.fullName,
      });
    } catch (err: any) {
      return res.status(401).json({
        success: false,
        error: 'GOOGLE_VERIFICATION_FAILED',
        message: err?.message || 'Unable to verify Google identity on server.',
      });
    }
  });

  // Explicitly lock & disable any legacy public Super Admin registration/OTP routes
  app.post('/api/auth/super-admin/send-setup-otp', (_req: Request, res: Response) => {
    return res.status(403).json({
      success: false,
      error: 'PUBLIC_REGISTRATION_DISABLED',
      message: 'Public Super Admin registration is permanently disabled. Use private initial provisioning with official Google OAuth.',
    });
  });
  app.post('/api/auth/super-admin/complete-setup', (_req: Request, res: Response) => {
    return res.status(403).json({
      success: false,
      error: 'PUBLIC_REGISTRATION_DISABLED',
      message: 'Public Super Admin registration is permanently disabled.',
    });
  });
  app.post('/api/auth/super-admin/recover/request', (_req: Request, res: Response) => {
    return res.status(403).json({
      success: false,
      error: 'OTP_RECOVERY_DISABLED',
      message: 'SMS/Email OTP recovery is disabled. Super Admin identity requires verified Google OAuth.',
    });
  });
  app.post('/api/auth/super-admin/recover/verify', (_req: Request, res: Response) => {
    return res.status(403).json({
      success: false,
      error: 'OTP_RECOVERY_DISABLED',
      message: 'SMS/Email OTP recovery is disabled.',
    });
  });

  // Official Google OAuth 2.0 URL Generator (opens Google's official account chooser in a popup)
  app.get('/api/auth/google/url', (req: Request, res: Response) => {
    const purpose = req.query.purpose === 'provision' ? 'provision' : 'login';
    const clientOrigin = typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const uris = getGoogleOAuthRedirectUris(clientOrigin);

    if (purpose === 'provision' && (authDb.superAdmin || authDb.superAdminSetupLocked)) {
      return res.status(409).json({
        success: false,
        error: 'SUPER_ADMIN_LOCKED',
        message: 'Permanent Super Admin is already provisioned and locked. Second Super Admin setup is forbidden.',
      });
    }

    if (purpose === 'login' && !authDb.superAdmin) {
      return res.status(403).json({
        success: false,
        error: 'SUPER_ADMIN_NOT_CONFIGURED',
        message: 'Super Admin has not been provisioned yet. Private initial setup is required before login.',
      });
    }

    if (!isGoogleOAuthConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'GOOGLE_OAUTH_NOT_CONFIGURED',
        message: 'Google OAuth credentials (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) are not configured on the backend server.',
        googleRedirectUris: { dev: uris.dev, shared: uris.shared },
      });
    }

    const state = crypto.randomBytes(24).toString('hex');
    pendingOAuthStates.set(state, {
      purpose,
      redirectUri: uris.effective,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      redirect_uri: uris.effective,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      access_type: 'online',
      state,
    });

    return res.json({
      success: true,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri: uris.effective,
    });
  });

  // Official Google OAuth 2.0 Callback Handler (returns lightweight postMessage HTML closing popup)
  app.get(['/api/auth/google/callback', '/api/auth/google/callback/'], async (req: Request, res: Response) => {
    const sendPopupResult = (payload: Record<string, any>) => {
      const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
      return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>WAQAS POS Google Verification</title></head>
<body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center;">
  <div>
    <h2 style="margin:0 0 8px;">${payload.type === 'GOOGLE_OAUTH_SUCCESS' ? 'Google Identity Verified' : 'Verification Notice'}</h2>
    <p style="font-size:14px;color:#cbd5e1;">${String(payload.message || 'Returning to WAQAS POS SOFTWARE...')}</p>
  </div>
  <script>
    (function() {
      var data = ${safeJson};
      if (window.opener) {
        window.opener.postMessage(data, '*');
        setTimeout(function() { window.close(); }, 350);
      }
    })();
  </script>
</body>
</html>`);
    };

    try {
      const { code, state, error: oauthErr } = req.query;
      if (oauthErr) {
        return sendPopupResult({
          type: 'GOOGLE_OAUTH_ERROR',
          error: String(oauthErr),
          message: `Google sign-in was cancelled or denied (${String(oauthErr)}).`,
        });
      }

      const stateStr = String(state || '').trim();
      const stateRecord = pendingOAuthStates.get(stateStr);
      pendingOAuthStates.delete(stateStr);

      if (!stateRecord || Date.now() > stateRecord.expiresAt) {
        return sendPopupResult({
          type: 'GOOGLE_OAUTH_ERROR',
          error: 'INVALID_OAUTH_STATE',
          message: 'OAuth verification session expired or invalid. Please click Continue with Google again.',
        });
      }

      if (!code || !isGoogleOAuthConfigured()) {
        return sendPopupResult({
          type: 'GOOGLE_OAUTH_ERROR',
          error: 'MISSING_CODE_OR_CONFIG',
          message: 'Authorization code or Google OAuth credentials missing.',
        });
      }

      const tokenEndpoint = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
      const tokenBody = new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
        client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
        redirect_uri: stateRecord.redirectUri,
        grant_type: 'authorization_code',
      });

      const tokenResp = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });
      const tokenData: any = await tokenResp.json().catch(() => ({}));
      if (!tokenResp.ok || !tokenData.access_token) {
        return sendPopupResult({
          type: 'GOOGLE_OAUTH_ERROR',
          error: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
          message: tokenData.error_description || 'Failed to verify authorization code with Google.',
        });
      }

      const userInfoEndpoint =
        process.env.GOOGLE_OAUTH_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo';
      const userResp = await fetch(userInfoEndpoint, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile: any = await userResp.json().catch(() => ({}));
      const cleanGmail = String(profile.email || '').trim().toLowerCase();
      const googleSub = String(profile.sub || '').trim();
      const fullName = String(profile.name || 'Super Admin').trim();

      if (!userResp.ok || !cleanGmail || profile.email_verified === false) {
        return sendPopupResult({
          type: 'GOOGLE_OAUTH_ERROR',
          error: 'GOOGLE_EMAIL_NOT_VERIFIED',
          message: 'Selected Google account does not have a verified email address.',
        });
      }

      if (stateRecord.purpose === 'provision') {
        if (authDb.superAdmin || authDb.superAdminSetupLocked) {
          return sendPopupResult({
            type: 'GOOGLE_OAUTH_ERROR',
            error: 'SUPER_ADMIN_LOCKED',
            message: 'Permanent Super Admin is already provisioned and locked.',
          });
        }
      } else {
        const sa = authDb.superAdmin;
        if (!sa) {
          return sendPopupResult({
            type: 'GOOGLE_OAUTH_ERROR',
            error: 'SUPER_ADMIN_NOT_CONFIGURED',
            message: 'Permanent Super Admin is not provisioned yet.',
          });
        }
        if (cleanGmail !== sa.gmail.toLowerCase() || (sa.googleSub && googleSub && sa.googleSub !== googleSub)) {
          recordAuditLog(
            'SUPER_ADMIN_WRONG_GMAIL',
            cleanGmail,
            'SUPER_ADMIN',
            `Rejected unauthorized Google account (${cleanGmail}) at Super Admin login`,
            undefined,
            req.ip
          );
          return sendPopupResult({
            type: 'GOOGLE_OAUTH_ERROR',
            error: 'UNAUTHORIZED_GMAIL',
            message: `Google account "${cleanGmail}" is NOT the permanently registered Super Admin Gmail.`,
          });
        }
      }

      const assertionToken = `GSA-${crypto.randomBytes(24).toString('hex')}`;
      pendingGoogleAssertions.set(assertionToken, {
        gmail: cleanGmail,
        googleSub,
        fullName,
        purpose: stateRecord.purpose,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        used: false,
        passwordRetries: 0,
      });

      return sendPopupResult({
        type: 'GOOGLE_OAUTH_SUCCESS',
        purpose: stateRecord.purpose,
        assertionToken,
        gmail: cleanGmail,
        fullName,
        message: `Verified Google account: ${cleanGmail}`,
      });
    } catch (err: any) {
      return sendPopupResult({
        type: 'GOOGLE_OAUTH_ERROR',
        error: 'OAUTH_CALLBACK_EXCEPTION',
        message: err?.message || 'Unexpected error during Google OAuth verification.',
      });
    }
  });

  // Private Initial Super Admin Provisioning: Validate Secret Provision Token
  app.post('/api/auth/super-admin/validate-provision-token', (req: Request, res: Response) => {
    if (authDb.superAdmin || authDb.superAdminSetupLocked) {
      return res.status(409).json({
        success: false,
        error: 'SUPER_ADMIN_LOCKED',
        message: 'Permanent Super Admin is already provisioned and permanently locked.',
      });
    }
    const { provisionToken } = req.body || {};
    const expected = getActiveProvisionSecret();
    if (!expected || !constantTimeMatch(String(provisionToken || '').trim(), expected)) {
      return res.status(403).json({
        success: false,
        error: 'INVALID_PROVISION_TOKEN',
        message: 'Invalid or unauthorized private provisioning token.',
      });
    }
    const uris = getGoogleOAuthRedirectUris();
    return res.json({
      success: true,
      valid: true,
      googleOAuthConfigured: isGoogleOAuthConfigured(),
      googleRedirectUris: { dev: uris.dev, shared: uris.shared },
    });
  });

  // Private Initial Super Admin Provisioning: Create Single Permanent Super Admin & Atomically Lock Setup
  app.post('/api/auth/super-admin/provision', (req: Request, res: Response) => {
    if (authDb.superAdmin || authDb.superAdminSetupLocked) {
      return res.status(409).json({
        success: false,
        error: 'SUPER_ADMIN_LOCKED',
        message: 'Permanent Super Admin is already provisioned and locked. Duplicate Super Admin setup is forbidden.',
      });
    }

    const { provisionToken, googleAssertionToken, password, confirmPassword, fullName } = req.body || {};
    if (provisionToken !== undefined && String(provisionToken).trim() !== '') {
      const expected = getActiveProvisionSecret();
      if (!expected || !constantTimeMatch(String(provisionToken).trim(), expected)) {
        return res.status(403).json({
          success: false,
          error: 'INVALID_PROVISION_TOKEN',
          message: 'Invalid private provisioning token.',
        });
      }
    }

    const assertion = pendingGoogleAssertions.get(String(googleAssertionToken || '').trim());
    if (!assertion || assertion.used || Date.now() > assertion.expiresAt || assertion.purpose !== 'provision') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_GOOGLE_ASSERTION',
        message: 'Google identity verification expired or missing. Complete Continue with Google first.',
      });
    }

    const cleanPassword = String(password || '');
    const cleanConfirm = String(confirmPassword || '');
    if (cleanPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'WAQAS POS Password must be at least 8 characters long.',
      });
    }
    if (cleanPassword !== cleanConfirm) {
      return res.status(400).json({
        success: false,
        message: 'Create Password and Confirm Password do not match.',
      });
    }

    // Consume single-use Google assertion & atomically lock Super Admin provisioning permanently
    assertion.used = true;
    pendingGoogleAssertions.delete(String(googleAssertionToken || '').trim());

    const salt = crypto.randomBytes(16).toString('hex');
    const superAdmin: StoredSuperAdmin = {
      id: 'SUPER-ADMIN-01',
      gmail: assertion.gmail.toLowerCase(),
      googleSub: assertion.googleSub || undefined,
      fullName: String(fullName || assertion.fullName || 'Muhammad Waqas').trim(),
      status: 'active',
      verifiedGmail: true,
      passwordSalt: salt,
      passwordHash: hashPassword(cleanPassword, salt),
      createdAt: new Date().toISOString(),
    };

    authDb.superAdmin = superAdmin;
    authDb.superAdminSetupLocked = true;
    persistAuthDb();

    recordAuditLog(
      'SUPER_ADMIN_PROVISIONED_LOCKED',
      superAdmin.gmail,
      'SUPER_ADMIN',
      `Single permanent Super Admin privately provisioned via verified Google OAuth (${superAdmin.gmail}); registration permanently locked.`,
      undefined,
      req.ip
    );

    return res.json({
      success: true,
      superAdminSetupLocked: true,
      gmail: superAdmin.gmail,
      fullName: superAdmin.fullName,
      user: {
        id: superAdmin.id,
        email: superAdmin.gmail,
        gmail: superAdmin.gmail,
        fullName: superAdmin.fullName,
        role: 'SUPER_ADMIN',
        verifiedGmail: true,
        createdAt: superAdmin.createdAt,
      },
      message: `Permanent Super Admin registered (${superAdmin.gmail}) and future registrations permanently locked. Sign in now using Continue with Google and your WAQAS POS Password.`,
    });
  });

  // Super Admin Official Login: Requires BOTH Verified Google OAuth Identity AND Separate WAQAS POS Password
  app.post('/api/auth/super-admin/login', (req: Request, res: Response) => {
    const sa = authDb.superAdmin;
    if (!sa) {
      return res.status(403).json({
        success: false,
        error: 'SUPER_ADMIN_NOT_CONFIGURED',
        message: 'Permanent Super Admin has not been provisioned yet.',
      });
    }

    const rateKey = `super_admin:${req.ip || 'local'}`;
    const limitCheck = checkRateLimit(rateKey);
    if (limitCheck.blocked) {
      return res.status(429).json({
        success: false,
        message: `Too many failed login attempts. Try again in ${limitCheck.retrySeconds} seconds.`,
      });
    }

    const { googleAssertionToken, password } = req.body || {};
    const tokStr = String(googleAssertionToken || '').trim();
    const cleanPassword = String(password || '');

    const assertion = pendingGoogleAssertions.get(tokStr);
    if (!assertion || assertion.used || Date.now() > assertion.expiresAt || assertion.purpose !== 'login') {
      return res.status(401).json({
        success: false,
        error: 'GOOGLE_AUTH_REQUIRED',
        message: 'Please sign in with Continue with Google first to verify your registered Super Admin Gmail.',
      });
    }

    if (
      assertion.gmail.toLowerCase() !== sa.gmail.toLowerCase() ||
      (sa.googleSub && assertion.googleSub && sa.googleSub !== assertion.googleSub)
    ) {
      assertion.used = true;
      pendingGoogleAssertions.delete(tokStr);
      recordFailedAttempt(rateKey);
      recordAuditLog(
        'SUPER_ADMIN_WRONG_GMAIL',
        assertion.gmail,
        'SUPER_ADMIN',
        `Rejected unauthorized Gmail "${assertion.gmail}" at Super Admin login`,
        undefined,
        req.ip
      );
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED_GMAIL',
        message: 'Selected Google account does not match the permanently registered Super Admin Gmail.',
      });
    }

    if (!cleanPassword || !verifyPasswordRecord(cleanPassword, sa.passwordSalt, sa.passwordHash)) {
      assertion.passwordRetries += 1;
      if (assertion.passwordRetries >= 5) {
        assertion.used = true;
        pendingGoogleAssertions.delete(tokStr);
      }
      recordFailedAttempt(rateKey);
      recordAuditLog(
        'SUPER_ADMIN_LOGIN_FAILED',
        sa.gmail,
        'SUPER_ADMIN',
        `Invalid WAQAS POS Password for Super Admin from ${req.ip || 'unknown'}`,
        undefined,
        req.ip
      );
      return res.status(401).json({
        success: false,
        error: 'INVALID_SUPER_ADMIN_PASSWORD',
        message: 'Incorrect WAQAS POS Password.',
      });
    }

    clearFailedAttempt(rateKey);
    assertion.used = true;
    pendingGoogleAssertions.delete(tokStr);
    if (!sa.googleSub && assertion.googleSub) {
      sa.googleSub = assertion.googleSub;
    }
    sa.lastLoginAt = new Date().toISOString();

    const token = `SA-${crypto.randomBytes(24).toString('hex')}`;
    const sess: AuthSessionData = {
      token,
      userId: sa.id,
      email: sa.gmail,
      gmail: sa.gmail,
      fullName: sa.fullName,
      role: 'SUPER_ADMIN',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      ip: req.ip,
    };
    authDb.sessions[token] = sess;
    persistAuthDb();

    recordAuditLog(
      'SUPER_ADMIN_LOGIN_SUCCESS',
      sa.gmail,
      'SUPER_ADMIN',
      'Super Admin authenticated with verified Google OAuth + WAQAS POS Password',
      undefined,
      req.ip
    );

    return res.json({
      success: true,
      token,
      expiresAt: new Date(sess.expiresAt).toISOString(),
      user: sanitizeAuthUser(sess),
    });
  });

  // Mart Login Endpoint: Shop Owner (Shop ID or Shop Username + Password) & Staff (Username + Password)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    checkAndAutoExpireSubscriptions();
    const { portal = 'shop', identifier, password } = req.body || {};
    const cleanIdent = String(identifier || '').trim();
    const cleanPassword = String(password || '');

    if (portal === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: 'USE_GOOGLE_SUPER_ADMIN_LOGIN',
        message: 'Super Admin login requires Continue with Google and separate WAQAS POS Password.',
      });
    }

    if (!cleanIdent || !cleanPassword) {
      return res.status(400).json({ success: false, message: 'Shop ID / Username and password are required.' });
    }

    const rateKey = `${portal}:${cleanIdent.toLowerCase()}`;
    const limitCheck = checkRateLimit(rateKey);
    if (limitCheck.blocked) {
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${limitCheck.retrySeconds} seconds.`,
      });
    }

    // SHOP OWNER OR STAFF LOGIN (Strictly isolated to that Mart)
    const lowerIdent = cleanIdent.toLowerCase();
    const normPhoneIdent = normalizeMobile(cleanIdent);

    // Search Shop Owners first (by Shop ID, Shop Username, Email, or Phone)
    const ownerUser = authDb.users.find(
      (u) =>
        u.role === 'SHOP_OWNER' &&
        (u.shopId?.toLowerCase() === lowerIdent ||
          u.username?.toLowerCase() === lowerIdent ||
          u.email?.toLowerCase() === lowerIdent ||
          (normPhoneIdent && normalizeMobile(u.phone || '') === normPhoneIdent))
    );

    if (ownerUser) {
      if (!verifyPassword(cleanPassword, ownerUser)) {
        recordFailedAttempt(rateKey);
        recordAuditLog(
          'SHOP_LOGIN_FAILED',
          cleanIdent,
          'SHOP_OWNER',
          `Invalid password for Shop Owner "${cleanIdent}"`,
          ownerUser.shopId,
          req.ip
        );
        return res.status(401).json({ success: false, message: 'Invalid Shop ID, username, or password.' });
      }

      const shop = subscriptionsDb.shops.find((s) => s.id === ownerUser.shopId);
      if (!shop) {
        return res.status(403).json({ success: false, message: 'Associated mart account was not found.' });
      }
      if (shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked' || shop.status === 'expired') {
        return res.status(403).json({
          success: false,
          error: 'SHOP_ACCOUNT_RESTRICTED',
          status: shop.status,
          shopName: shop.shopName,
          expiryDate: shop.expiryDate,
          whatsapp: '03228570782',
          message: `This mart account ("${shop.shopName}") is currently ${shop.status.toUpperCase()}. Contact Super Admin (03228570782) to restore access.`,
        });
      }

      clearFailedAttempt(rateKey);
      const token = `SO-${crypto.randomBytes(24).toString('hex')}`;
      const sess: AuthSessionData = {
        token,
        userId: ownerUser.id,
        email: ownerUser.email,
        username: ownerUser.username,
        fullName: ownerUser.fullName,
        role: 'SHOP_OWNER',
        shopId: shop.id,
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        ip: req.ip,
      };
      authDb.sessions[token] = sess;
      persistAuthDb();

      recordAuditLog(
        'SHOP_OWNER_LOGIN',
        ownerUser.username || ownerUser.email || ownerUser.id,
        'SHOP_OWNER',
        `Shop Owner signed into ${shop.shopName} (${shop.id})`,
        shop.id,
        req.ip
      );

      return res.json({
        success: true,
        token,
        expiresAt: new Date(sess.expiresAt).toISOString(),
        user: sanitizeAuthUser(sess),
        shop,
      });
    }

    // Search Staff across active shops
    for (const shop of subscriptionsDb.shops) {
      const shopStore = getShopStore(shop.id);
      const staff = (shopStore.staffList || []).find(
        (st) =>
          st.username &&
          st.username.trim().toLowerCase() === lowerIdent &&
          (st as any).passwordHash &&
          (st as any).passwordSalt
      ) as (StaffMember & { passwordSalt?: string }) | undefined;

      if (staff) {
        if (!verifyPasswordRecord(cleanPassword, staff.passwordSalt || '', staff.passwordHash || '')) {
          recordFailedAttempt(rateKey);
          return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }
        if (staff.accountStatus !== 'active') {
          return res.status(403).json({
            success: false,
            message: `Staff account "${staff.name}" is ${staff.accountStatus}. Contact your Shop Owner.`,
          });
        }
        if (shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked' || shop.status === 'expired') {
          return res.status(403).json({
            success: false,
            error: 'SHOP_ACCOUNT_RESTRICTED',
            status: shop.status,
            shopName: shop.shopName,
            whatsapp: '03228570782',
            message: `Shop "${shop.shopName}" is ${shop.status.toUpperCase()}. Contact Super Admin (03228570782).`,
          });
        }

        clearFailedAttempt(rateKey);
        const token = `STF-${crypto.randomBytes(24).toString('hex')}`;
        const perms = normalizeStaffPermissions(staff.permissions);
        const sess: AuthSessionData = {
          token,
          userId: staff.id,
          username: staff.username,
          fullName: staff.name,
          role: 'STAFF',
          shopId: shop.id,
          staffId: staff.id,
          permissions: perms,
          createdAt: Date.now(),
          expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
          ip: req.ip,
        };
        authDb.sessions[token] = sess;
        persistAuthDb();

        recordAuditLog(
          'STAFF_LOGIN',
          staff.username,
          'STAFF',
          `Staff "${staff.name}" (${staff.role}) signed into ${shop.shopName}`,
          shop.id,
          req.ip
        );

        return res.json({
          success: true,
          token,
          expiresAt: new Date(sess.expiresAt).toISOString(),
          user: sanitizeAuthUser(sess),
          shop,
        });
      }
    }

    recordFailedAttempt(rateKey);
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
  });

  // Current Authenticated Session Info
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({ success: false, error: 'SESSION_INVALID', message: 'Not authenticated.' });
    }
    if (session.role === 'SUPER_ADMIN') {
      if (!authDb.superAdmin) {
        return res.status(401).json({ success: false, message: 'Super Admin not configured.' });
      }
      return res.json({
        success: true,
        user: sanitizeAuthUser(session),
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    }

    checkAndAutoExpireSubscriptions();
    const shop = subscriptionsDb.shops.find((s) => s.id === session.shopId);
    if (!shop || shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked' || shop.status === 'expired') {
      return res.status(403).json({
        success: false,
        error: 'SHOP_ACCOUNT_RESTRICTED',
        status: shop?.status || 'inactive',
        message: shop
          ? `Shop "${shop.shopName}" is ${shop.status.toUpperCase()}. Contact Super Admin (03228570782).`
          : 'Shop account removed.',
      });
    }

    if (session.role === 'STAFF' && session.staffId) {
      const store = getShopStore(shop.id);
      const staff = (store.staffList || []).find((st) => st.id === session.staffId);
      if (!staff || staff.accountStatus !== 'active') {
        return res.status(403).json({ success: false, error: 'STAFF_ACCOUNT_RESTRICTED', message: 'Staff account is inactive.' });
      }
    }

    return res.json({
      success: true,
      user: sanitizeAuthUser(session),
      shop,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  // Logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
    if (token && authDb.sessions[token]) {
      delete authDb.sessions[token];
      persistAuthDb();
    }
    return res.json({ success: true, message: 'Signed out cleanly.' });
  });

  // Self-service password change for Super Admin or Shop Owner
  app.post('/api/auth/change-password', (req: Request, res: Response) => {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'Current password and new password (min 6 chars) are required.' });
    }

    if (session.role === 'SUPER_ADMIN' && authDb.superAdmin) {
      if (String(newPassword).length < 8) {
        return res.status(400).json({ success: false, message: 'Super Admin password must be at least 8 characters.' });
      }
      if (!verifyPasswordRecord(String(currentPassword), authDb.superAdmin.passwordSalt, authDb.superAdmin.passwordHash)) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      authDb.superAdmin.passwordSalt = salt;
      authDb.superAdmin.passwordHash = hashPassword(String(newPassword), salt);
      persistAuthDb();
      recordAuditLog('SUPER_ADMIN_PASSWORD_CHANGED', authDb.superAdmin.gmail, 'SUPER_ADMIN', 'Super Admin changed password.', undefined, req.ip);
      return res.json({ success: true, message: 'Super Admin password updated.' });
    }

    const user = authDb.users.find((u) => u.id === session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    if (!verifyPassword(String(currentPassword), user)) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    user.passwordSalt = salt;
    user.passwordHash = hashPassword(String(newPassword), salt);
    user.mustChangePasswordOnFirstLogin = false;
    persistAuthDb();

    recordAuditLog('PASSWORD_CHANGED', user.username || user.email || user.id, session.role, 'Account password updated.', user.shopId, req.ip);
    return res.json({ success: true, message: 'Password updated successfully.' });
  });

  // -------------------------------------------------------------
  // 2. DEVICE PAIRING & QR CODE MANAGEMENT (PER-SHOP SCOPED)
  // -------------------------------------------------------------
  app.post('/api/devices/pairing-session', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const shopStore = getShopStore(actor.shopId);
    const pairingToken = crypto.randomBytes(16).toString('hex');
    const manualCode = `WM-${Math.floor(1000 + Math.random() * 9000)}`;
    const createdAt = Date.now();
    const expiresAt = createdAt + 5 * 60 * 1000;

    const session: PairingSession = {
      pairingToken,
      manualCode,
      shopId: actor.shopId,
      createdAt,
      expiresAt,
      status: 'pending_scan',
    };

    pairingSessions.set(pairingToken, session);

    return res.json({
      success: true,
      pairingToken,
      manualCode,
      shopId: actor.shopId,
      expiresAt,
      storeName: shopStore.branding.storeName || 'WAQAS MART',
      subtitle: shopStore.branding.subtitle || 'Supermarket Management',
    });
  });

  app.get('/api/devices/pairing-status/:token', (req: Request, res: Response) => {
    const { token } = req.params;
    let session: PairingSession | undefined = pairingSessions.get(token);

    if (!session) {
      for (const s of pairingSessions.values()) {
        if (s.manualCode.toUpperCase() === token.toUpperCase()) {
          session = s;
          break;
        }
      }
    }

    if (!session) {
      return res.status(404).json({ success: false, message: 'Pairing session not found or expired.' });
    }

    if (Date.now() > session.expiresAt && session.status !== 'approved') {
      session.status = 'expired';
      return res.json({ success: true, session });
    }

    let authPayload = null;
    if (session.status === 'approved' && session.approvedDeviceId) {
      const targetShopId = session.shopId || 'SHOP-WM-001';
      const approvedDev = registeredDevices.find((d) => d.deviceId === session?.approvedDeviceId);
      const shopStore = getShopStore(targetShopId);
      const shop = subscriptionsDb.shops.find((s) => s.id === targetShopId);
      authPayload = {
        sessionToken: approvedDev?.sessionToken,
        device: approvedDev,
        shopId: targetShopId,
        shop,
        user: shopStore.userProfile,
        storeState: sanitizeStoreForClient(shopStore, 'SHOP_OWNER'),
      };
    }

    return res.json({
      success: true,
      session,
      auth: authPayload,
    });
  });

  app.post('/api/devices/pair', (req: Request, res: Response) => {
    const { tokenOrCode, device } = req.body;
    if (!tokenOrCode || !device?.deviceId) {
      return res.status(400).json({ success: false, message: 'Invalid pairing request payload.' });
    }

    let session: PairingSession | undefined = pairingSessions.get(tokenOrCode);
    if (!session) {
      for (const s of pairingSessions.values()) {
        if (s.manualCode.toUpperCase() === tokenOrCode.trim().toUpperCase()) {
          session = s;
          break;
        }
      }
    }

    if (!session) {
      return res.status(404).json({ success: false, message: 'Invalid or expired QR code.' });
    }
    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      return res.status(410).json({ success: false, message: 'This QR pairing code has expired.' });
    }
    if (session.status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Pairing was rejected by the shop owner.' });
    }
    if (session.status === 'approved' || session.status === 'cancelled' || session.status === 'expired') {
      return res.status(409).json({
        success: false,
        error: 'PAIRING_CODE_ALREADY_USED',
        message: 'This QR pairing code has already been used or closed. Generate a new QR code from the owner device.',
      });
    }
    if (session.status === 'pending_approval' && session.candidateDevice?.deviceId && session.candidateDevice.deviceId !== device.deviceId) {
      return res.status(409).json({
        success: false,
        error: 'PAIRING_SESSION_LOCKED',
        message: 'This QR code is already pending approval for another device.',
      });
    }

    session.candidateDevice = {
      deviceId: device.deviceId,
      deviceName: device.deviceName || 'New Terminal',
      deviceType: device.deviceType || 'Android Mobile',
      browser: device.browser || 'Browser',
      os: device.os || 'OS',
    };
    session.status = 'pending_approval';

    const targetShopId = session.shopId || 'SHOP-WM-001';
    recordAuditLog(
      'DEVICE_PAIR_REQUEST',
      device.deviceId,
      'STAFF',
      `Device pairing requested by "${session.candidateDevice.deviceName}" (${session.candidateDevice.deviceType})`,
      targetShopId,
      req.ip
    );

    broadcastSyncEventToShop(targetShopId, {
      type: 'device:pairing_request',
      timestamp: Date.now(),
      payload: {
        pairingToken: session.pairingToken,
        candidateDevice: session.candidateDevice,
      },
    });

    return res.json({
      success: true,
      message: 'Pairing request submitted. Waiting for shop owner approval.',
      session,
    });
  });

  app.post('/api/devices/approve-pairing', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }

    const { pairingToken, approve } = req.body;
    const session = pairingSessions.get(pairingToken);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Pairing session not found.' });
    }

    const sessionShopId = session.shopId || 'SHOP-WM-001';
    if (actor.role !== 'SUPER_ADMIN' && actor.shopId !== sessionShopId) {
      return res.status(403).json({ success: false, message: 'Cannot approve pairing session belonging to another shop.' });
    }
    if (session.status === 'approved') {
      return res.status(409).json({ success: false, message: 'This pairing code has already been approved and consumed.' });
    }

    if (!approve) {
      session.status = 'rejected';
      recordAuditLog(
        'DEVICE_PAIR_REJECTED',
        actor.actorEmail,
        actor.role,
        `Rejected pairing request for ${session.candidateDevice?.deviceName || session.pairingToken}`,
        sessionShopId,
        req.ip
      );
      broadcastSyncEventToShop(sessionShopId, {
        type: 'device:updated',
        timestamp: Date.now(),
        payload: { pairingToken, status: 'rejected' },
      });
      return res.json({ success: true, message: 'Device pairing rejected.' });
    }

    if (!session.candidateDevice) {
      return res.status(400).json({ success: false, message: 'No candidate device scanned this code.' });
    }

    const sessionToken = `ST-${crypto.randomBytes(16).toString('hex')}`;
    const newDev: DeviceInfo = {
      deviceId: session.candidateDevice.deviceId,
      sessionToken,
      shopId: sessionShopId,
      deviceName: session.candidateDevice.deviceName,
      deviceType: session.candidateDevice.deviceType,
      browser: session.candidateDevice.browser,
      os: session.candidateDevice.os,
      isCurrentDevice: false,
      firstRegistered: new Date().toLocaleDateString('en-GB'),
      lastActive: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      status: 'active',
      connectionState: 'online',
      ipAddress: req.ip,
    };

    removedDeviceIds.delete(newDev.deviceId);
    registeredDevices = registeredDevices.filter((d) => d.deviceId !== newDev.deviceId);
    registeredDevices.push(newDev);
    persistDevices();

    session.status = 'approved';
    session.approvedDeviceId = newDev.deviceId;

    recordAuditLog(
      'DEVICE_PAIR_APPROVED',
      actor.actorEmail,
      actor.role,
      `Approved device "${newDev.deviceName}" (${newDev.deviceId})`,
      sessionShopId,
      req.ip
    );

    const shopDevices = registeredDevices.filter((d) => d.shopId === sessionShopId).map((d) => ({ ...d, sessionToken: undefined }));
    broadcastSyncEventToShop(sessionShopId, {
      type: 'device:approved',
      timestamp: Date.now(),
      payload: { pairingToken, device: { ...newDev, sessionToken: undefined } },
    });
    broadcastSyncEventToShop(sessionShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: shopDevices,
    });

    return res.json({
      success: true,
      message: 'Device successfully authorized!',
      device: newDev,
    });
  });

  app.post('/api/devices/register-primary', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }

    const dev = req.body?.device;
    if (!dev?.deviceId) {
      return res.status(400).json({ success: false, message: 'Device ID is required.' });
    }
    if (removedDeviceIds.has(dev.deviceId)) {
      return res.status(403).json({
        success: false,
        error: 'DEVICE_REMOVED',
        message: 'This device was removed by administrator. Re-pair via QR code.',
      });
    }

    const existing = registeredDevices.find((d) => d.deviceId === dev.deviceId);
    if (existing) {
      if (existing.status === 'revoked') {
        return res.status(403).json({
          success: false,
          error: 'DEVICE_REVOKED',
          message: 'This device is revoked.',
        });
      }
      if (!existing.sessionToken) {
        existing.sessionToken = `ST-${crypto.randomBytes(16).toString('hex')}`;
      }
      existing.shopId = actor.shopId;
      existing.lastActive = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
      existing.connectionState = 'online';
      persistDevices();
      return res.json({ success: true, device: existing, sessionToken: existing.sessionToken });
    }

    const sessionToken = `ST-${crypto.randomBytes(16).toString('hex')}`;
    const primaryDev: DeviceInfo = {
      deviceId: dev.deviceId,
      sessionToken,
      shopId: actor.shopId,
      deviceName: dev.deviceName || 'Primary Terminal',
      deviceType: dev.deviceType || 'Web Browser',
      browser: dev.browser || 'Browser',
      os: dev.os || 'OS',
      isCurrentDevice: false,
      firstRegistered: new Date().toLocaleDateString('en-GB'),
      lastActive: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      status: 'active',
      connectionState: 'online',
      ipAddress: req.ip,
    };
    registeredDevices.push(primaryDev);
    persistDevices();
    recordAuditLog(
      'PRIMARY_DEVICE_REGISTERED',
      actor.actorEmail,
      actor.role,
      `Registered terminal "${primaryDev.deviceName}" (${primaryDev.deviceId})`,
      actor.shopId,
      req.ip
    );
    broadcastSyncEventToShop(actor.shopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === actor.shopId).map((d) => ({ ...d, sessionToken: undefined })),
    });
    return res.json({ success: true, device: primaryDev, sessionToken });
  });

  app.post('/api/devices/cancel-pairing', (req: Request, res: Response) => {
    const { pairingToken } = req.body;
    if (pairingToken && pairingSessions.has(pairingToken)) {
      const s = pairingSessions.get(pairingToken)!;
      s.status = 'cancelled';
      pairingSessions.delete(pairingToken);
    }
    return res.json({ success: true, message: 'Pairing cancelled.' });
  });

  // -------------------------------------------------------------
  // 3. DEVICE MANAGEMENT ENDPOINTS (SHOP-SCOPED OR SUPER ADMIN)
  // -------------------------------------------------------------
  app.get('/api/devices', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const visible =
      actor.role === 'SUPER_ADMIN' && !req.query.shopId
        ? registeredDevices
        : registeredDevices.filter((d) => (d.shopId || 'SHOP-WM-001') === actor.shopId);

    const list = visible.map((d) => {
      const hasLiveSse = Array.from(sseClients.values()).some((c) => c.deviceId === d.deviceId);
      const shop = subscriptionsDb.shops.find((s) => s.id === (d.shopId || 'SHOP-WM-001'));
      return {
        ...d,
        shopName: shop?.shopName || 'WAQAS MART',
        sessionToken: undefined,
        connectionState: hasLiveSse ? ('online' as const) : ('offline' as const),
      };
    });
    return res.json({ success: true, devices: list });
  });

  app.post('/api/devices/:id/rename', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const { id } = req.params;
    const { name } = req.body;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }
    if (actor.role !== 'SUPER_ADMIN' && (target.shopId || 'SHOP-WM-001') !== actor.shopId) {
      return res.status(403).json({ success: false, message: 'Cannot rename device belonging to another shop.' });
    }
    target.deviceName = name || target.deviceName;
    persistDevices();
    const targetShopId = target.shopId || 'SHOP-WM-001';
    recordAuditLog('DEVICE_RENAMED', actor.actorEmail, actor.role, `Renamed device ${id} to "${target.deviceName}"`, targetShopId, req.ip);

    broadcastSyncEventToShop(targetShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === targetShopId).map((d) => ({ ...d, sessionToken: undefined })),
    });

    return res.json({ success: true, device: { ...target, sessionToken: undefined } });
  });

  app.post('/api/devices/:id/revoke', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const { id } = req.params;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }
    if (actor.role !== 'SUPER_ADMIN' && (target.shopId || 'SHOP-WM-001') !== actor.shopId) {
      return res.status(403).json({ success: false, message: 'Cannot revoke device belonging to another shop.' });
    }

    target.status = 'revoked';
    target.connectionState = 'offline';
    persistDevices();

    const targetShopId = target.shopId || 'SHOP-WM-001';
    recordAuditLog('DEVICE_REVOKED', actor.actorEmail, actor.role, `Revoked access for device "${target.deviceName}" (${id})`, targetShopId, req.ip);

    broadcastSyncEventToShop(targetShopId, {
      type: 'device:revoked',
      sourceDeviceId: id,
      timestamp: Date.now(),
      payload: { deviceId: id },
    });

    for (const [cid, client] of sseClients.entries()) {
      if (client.deviceId === id) {
        try { client.res.end(); } catch {}
        sseClients.delete(cid);
      }
    }

    broadcastSyncEventToShop(targetShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === targetShopId).map((d) => ({ ...d, sessionToken: undefined })),
    });

    return res.json({ success: true, message: 'Device access revoked successfully.' });
  });

  app.post('/api/devices/:id/restore', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const { id } = req.params;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }
    if (actor.role !== 'SUPER_ADMIN' && (target.shopId || 'SHOP-WM-001') !== actor.shopId) {
      return res.status(403).json({ success: false, message: 'Cannot restore device belonging to another shop.' });
    }
    target.status = 'active';
    removedDeviceIds.delete(id);
    persistDevices();
    const targetShopId = target.shopId || 'SHOP-WM-001';
    recordAuditLog('DEVICE_RESTORED', actor.actorEmail, actor.role, `Restored access for device "${target.deviceName}" (${id})`, targetShopId, req.ip);
    broadcastSyncEventToShop(targetShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === targetShopId).map((d) => ({ ...d, sessionToken: undefined })),
    });
    return res.json({ success: true, message: 'Device access restored.', device: { ...target, sessionToken: undefined } });
  });

  app.delete('/api/devices/:id', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const { id } = req.params;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Device not found.' });
    }
    if (actor.role !== 'SUPER_ADMIN' && (target.shopId || 'SHOP-WM-001') !== actor.shopId) {
      return res.status(403).json({ success: false, message: 'Cannot remove device belonging to another shop.' });
    }

    const targetShopId = target.shopId || 'SHOP-WM-001';
    registeredDevices = registeredDevices.filter((d) => d.deviceId !== id);
    removedDeviceIds.add(id);
    persistDevices();

    recordAuditLog('DEVICE_REMOVED', actor.actorEmail, actor.role, `Permanently removed device "${target.deviceName}" (${id})`, targetShopId, req.ip);

    broadcastSyncEventToShop(targetShopId, {
      type: 'device:revoked',
      timestamp: Date.now(),
      payload: { deviceId: id },
    });

    for (const [cid, client] of sseClients.entries()) {
      if (client.deviceId === id) {
        try { client.res.end(); } catch {}
        sseClients.delete(cid);
      }
    }

    broadcastSyncEventToShop(targetShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === targetShopId).map((d) => ({ ...d, sessionToken: undefined })),
    });

    return res.json({ success: true, message: 'Device removed.' });
  });

  // -------------------------------------------------------------
  // 4. REAL-TIME SERVER-SENT EVENTS (SSE) STREAM (PER-SHOP SCOPED)
  // -------------------------------------------------------------
  app.get('/api/sync/events', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const deviceId = (req.query.deviceId as string) || (req.headers['x-device-id'] as string) || 'UNKNOWN-DEV';
    const shopStore = getShopStore(actor.shopId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const clientId = `CLIENT-${crypto.randomBytes(8).toString('hex')}`;
    const client: SseClient = {
      id: clientId,
      res,
      deviceId,
      shopId: actor.shopId,
      role: actor.role,
      canViewCostAndProfit: actor.role !== 'STAFF' || Boolean(actor.permissions?.canViewCostAndProfit),
      ip: req.ip || '',
      connectedAt: Date.now(),
    };

    sseClients.set(clientId, client);

    if (actor.device) {
      actor.device.lastActive = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
      actor.device.connectionState = 'online';
    }

    res.write(
      `data: ${JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
        shopId: actor.shopId,
        syncVersion: shopStore.syncVersion || 1,
        message: 'Connected to WAQAS POS Live Sync Engine',
      })}\n\n`
    );

    const shopDevices = registeredDevices.filter((d) => d.shopId === actor.shopId).map((d) => ({ ...d, sessionToken: undefined }));
    broadcastSyncEventToShop(actor.shopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: shopDevices,
    });

    req.on('close', () => {
      sseClients.delete(clientId);
      const remaining = registeredDevices.filter((d) => d.shopId === actor.shopId).map((d) => ({ ...d, sessionToken: undefined }));
      broadcastSyncEventToShop(actor.shopId, {
        type: 'device:updated',
        timestamp: Date.now(),
        payload: remaining,
      });
    });
  });

  // -------------------------------------------------------------
  // 5. AUTHORITATIVE PER-SHOP STORE STATE & ATOMIC MUTATIONS
  // -------------------------------------------------------------
  app.get('/api/store/state', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const shopStore = getShopStore(actor.shopId);
    const safeStore = sanitizeStoreForClient(shopStore, actor.role, actor.permissions);
    return res.json({
      success: true,
      shopId: actor.shopId,
      syncVersion: shopStore.syncVersion || 1,
      store: safeStore,
    });
  });

  function canStaffPerformMutation(action: string, perms?: StaffModulePermissions): boolean {
    if (!perms) return false;
    switch (action) {
      case 'create_sale':
      case 'update_held_bills':
      case 'delete_held_bill':
      case 'delete_all_held_bills':
        return perms.newSale || perms.oldSale;
      case 'process_return':
        return perms.newSale || perms.oldSale || perms.customers;
      case 'create_purchase':
      case 'update_purchase':
      case 'delete_purchase':
      case 'delete_all_purchases':
      case 'sync_purchase_returns':
      case 'create_purchase_return':
        return perms.newPurchase || perms.oldPurchase;
      case 'update_stock':
      case 'sync_stock_history':
      case 'sync_categories':
        return perms.stock || perms.products;
      case 'update_customer_ledger':
        return perms.customers || perms.canAccessLedgers;
      case 'sync_supplier_ledgers':
        return perms.suppliers || perms.canAccessLedgers;
      case 'sync_expenses':
        return perms.expenses;
      case 'sync_daily_hisab':
        return perms.reports || perms.canAccessReports;
      case 'sync_printer_settings':
      case 'sync_receipt_settings':
        return perms.printing || perms.settings;
      case 'sync_staff':
      case 'update_branding':
        return perms.settings || perms.canAccessSettings;
      case 'sync_full':
        return true;
      case 'reset_all_zero':
      case 'load_seed_catalog':
        return false;
      default:
        return false;
    }
  }

  app.post('/api/store/sync', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({
        success: false,
        error: actor.error,
        message: actor.message,
      });
    }

    const { action, payload, sourceDeviceId, baseSyncVersion } = req.body;
    if (actor.role === 'STAFF' && !canStaffPerformMutation(action, actor.permissions)) {
      return res.status(403).json({
        success: false,
        error: 'PERMISSION_DENIED',
        message: `Your staff account does not have permission for "${action}".`,
      });
    }

    if (actor.device) {
      actor.device.lastActive = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
      actor.device.connectionState = 'online';
    }

    const targetShopId = actor.shopId;
    const shopStore = getShopStore(targetShopId);

    switch (action) {
      case 'create_sale': {
        const tx: SaleTransaction = payload;
        if (!tx || !tx.invoiceNumber) {
          return res.status(400).json({ success: false, message: 'Invalid transaction payload.' });
        }

        const exists = shopStore.transactions.some((t) => t.invoiceNumber === tx.invoiceNumber);
        if (!exists) {
          if (tx.mode === 'sale') {
            for (const item of tx.items || []) {
              const product = shopStore.products.find((p) => p.id === item.product.id);
              if (product) {
                const avail = Number(product.stock) || 0;
                const reqQty = Number(item.quantity) || 0;
                if (reqQty > avail) {
                  return res.status(400).json({
                    success: false,
                    error: 'INSUFFICIENT_STOCK',
                    message: `Insufficient stock for "${product.name}". Available: ${avail}, Requested: ${reqQty}`,
                  });
                }
              }
            }
          }

          // Ensure authentic costPrice from server catalog on saved invoice
          const enrichedTx: SaleTransaction = {
            ...tx,
            items: (tx.items || []).map((it) => {
              const srvProd = shopStore.products.find((p) => p.id === it.product?.id);
              return srvProd ? { ...it, product: { ...it.product, costPrice: srvProd.costPrice } } : it;
            }),
          };

          shopStore.transactions.unshift(enrichedTx);

          if (tx.mode === 'sale') {
            tx.items.forEach((item) => {
              const product = shopStore.products.find((p) => p.id === item.product.id);
              if (product) {
                const prevStock = Number(product.stock) || 0;
                const nextStock = prevStock - item.quantity;
                product.stock = nextStock;
                recordShopStockTx(
                  shopStore,
                  product,
                  prevStock,
                  -item.quantity,
                  nextStock,
                  'Sale',
                  tx.invoiceNumber,
                  tx.cashierName || actor.actorEmail
                );
              }
            });
          }

          if (tx.paymentMethod === 'credit' && (tx.customerId || tx.customerName)) {
            const advancePaid = Number(tx.cashTendered) || 0;
            const unpaidCredit = Math.max(0, (Number(tx.grandTotal) || 0) - advancePaid);
            const alreadyRecorded = shopStore.customerLedgers.some(
              (l) => l.invoiceNumber === tx.invoiceNumber && l.credit > 0
            );
            if (unpaidCredit > 0 && !alreadyRecorded) {
              const entry: CustomerLedgerEntry = {
                id: `LED-SALE-${tx.invoiceNumber}`,
                customerId: tx.customerId || 'CUST-GENERAL',
                date: tx.dateTime,
                details: `Sales Invoice #${tx.invoiceNumber}`,
                invoiceNumber: tx.invoiceNumber,
                credit: unpaidCredit,
                debit: 0,
                runningBalance: 0,
                paymentMethod: 'Credit / Pay Later',
                createdAt: new Date().toISOString(),
              };
              shopStore.customerLedgers.push(entry);
            }
          }

          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'sale:completed',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: {
              transaction: sanitizeStoreForClient(shopStore, actor.role, actor.permissions).transactions[0],
              updatedProducts: shopStore.products,
              customerLedgers: shopStore.customerLedgers,
              stockHistory: shopStore.stockHistory,
              syncVersion: shopStore.syncVersion,
            },
          });
        }

        const safeStore = sanitizeStoreForClient(shopStore, actor.role, actor.permissions);
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: safeStore });
      }

      case 'create_purchase': {
        const purchase: PurchaseTransaction = payload;
        if (!purchase) {
          return res.status(400).json({ success: false, message: 'Invalid purchase payload.' });
        }

        const reconciled = applyPurchaseSaveToState({
          purchase,
          isEdit: false,
          products: shopStore.products,
          suppliers: shopStore.suppliers,
          purchases: shopStore.purchases,
          userName: purchase.userName || actor.actorEmail,
          timestampStr: formatStockAuditTimestamp(),
        });

        if (!reconciled.duplicateBlocked) {
          shopStore.products = reconciled.products;
          shopStore.suppliers = reconciled.suppliers;
          shopStore.purchases = reconciled.purchases;
          shopStore.stockHistory = [...reconciled.stockEntries, ...(shopStore.stockHistory || [])].slice(0, 5000);

          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'purchase:added',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: {
              purchase,
              updatedProducts: shopStore.products,
              suppliers: shopStore.suppliers,
              stockHistory: shopStore.stockHistory,
              syncVersion: shopStore.syncVersion,
            },
          });
        }

        const safeStore = sanitizeStoreForClient(shopStore, actor.role, actor.permissions);
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: safeStore });
      }

      case 'update_purchase': {
        const purchase: PurchaseTransaction = payload;
        if (!purchase || !purchase.id) {
          return res.status(400).json({ success: false, message: 'Invalid purchase update payload.' });
        }

        const existingPurchase = shopStore.purchases.find(
          (p) => p.id === purchase.id || p.purchaseInvoiceNo === purchase.purchaseInvoiceNo
        );
        if (
          existingPurchase &&
          typeof baseSyncVersion === 'number' &&
          existingPurchase.updatedAt &&
          purchase.updatedAt &&
          existingPurchase.updatedAt > purchase.updatedAt
        ) {
          return res.status(409).json({
            success: false,
            error: 'CONFLICT',
            message: `Purchase #${purchase.purchaseInvoiceNo} was updated more recently on another device.`,
            serverVersion: shopStore.syncVersion,
            store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions),
          });
        }

        const reconciled = applyPurchaseSaveToState({
          purchase,
          isEdit: Boolean(existingPurchase),
          products: shopStore.products,
          suppliers: shopStore.suppliers,
          purchases: shopStore.purchases,
          userName: purchase.editBy || purchase.userName || actor.actorEmail,
          timestampStr: formatStockAuditTimestamp(),
        });

        if (!reconciled.duplicateBlocked) {
          shopStore.products = reconciled.products;
          shopStore.suppliers = reconciled.suppliers;
          shopStore.purchases = reconciled.purchases;
          shopStore.stockHistory = [...reconciled.stockEntries, ...(shopStore.stockHistory || [])].slice(0, 5000);
        }

        persistShopStore(targetShopId);

        broadcastSyncEventToShop(targetShopId, {
          type: 'purchase:updated',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: {
            purchase,
            updatedProducts: shopStore.products,
            suppliers: shopStore.suppliers,
            stockHistory: shopStore.stockHistory,
            syncVersion: shopStore.syncVersion,
          },
        });

        const safeStore = sanitizeStoreForClient(shopStore, actor.role, actor.permissions);
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: safeStore });
      }

      case 'delete_purchase': {
        const { purchaseId } = payload || {};
        if (!purchaseId) {
          return res.status(400).json({ success: false, message: 'purchaseId is required.' });
        }

        const reversed = applyPurchaseDeleteToState({
          purchaseId,
          products: shopStore.products,
          suppliers: shopStore.suppliers,
          purchases: shopStore.purchases,
          userName: actor.actorEmail,
          timestampStr: formatStockAuditTimestamp(),
        });

        if (reversed.deletedPurchase) {
          shopStore.products = reversed.products;
          shopStore.suppliers = reversed.suppliers;
          shopStore.purchases = reversed.purchases;
          shopStore.stockHistory = [...reversed.stockEntries, ...(shopStore.stockHistory || [])].slice(0, 5000);
          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'purchase:deleted',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: {
              purchaseId: reversed.deletedPurchase.id,
              updatedProducts: shopStore.products,
              suppliers: shopStore.suppliers,
              stockHistory: shopStore.stockHistory,
              syncVersion: shopStore.syncVersion,
            },
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'process_return': {
        const ret: SaleReturn = payload;
        if (!ret) {
          return res.status(400).json({ success: false, message: 'Invalid return payload.' });
        }

        const exists = shopStore.saleReturns.some((r) => r.returnNumber === ret.returnNumber);
        if (!exists) {
          shopStore.saleReturns.unshift(ret);

          ret.items.forEach((item) => {
            if (item.condition === 'resaleable') {
              const product = shopStore.products.find((p) => p.id === item.productId);
              if (product) {
                const prevStock = Number(product.stock) || 0;
                const nextStock = prevStock + item.quantity;
                product.stock = nextStock;
                recordShopStockTx(
                  shopStore,
                  product,
                  prevStock,
                  item.quantity,
                  nextStock,
                  'Sale Return',
                  ret.returnNumber,
                  ret.cashierName || actor.actorEmail
                );
              }
            }
          });

          if (ret.refundMethod === 'credit' && ret.customerId) {
            const entry: CustomerLedgerEntry = {
              id: `LED-RET-${ret.returnNumber}`,
              customerId: ret.customerId,
              date: ret.dateTime,
              details: `Sale Return #${ret.returnNumber}`,
              invoiceNumber: ret.originalInvoiceNumber,
              credit: 0,
              debit: ret.totalRefund,
              runningBalance: 0,
              paymentMethod: 'Credit Adjustment',
              createdAt: new Date().toISOString(),
            };
            if (!shopStore.customerLedgers.some((l) => l.id === entry.id)) {
              shopStore.customerLedgers.push(entry);
            }
          }

          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'return:processed',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: {
              saleReturn: ret,
              updatedProducts: shopStore.products,
              customerLedgers: shopStore.customerLedgers,
              stockHistory: shopStore.stockHistory,
              syncVersion: shopStore.syncVersion,
            },
          });
        }

        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'create_purchase_return': {
        const ret: PurchaseReturn = payload;
        if (!ret || !ret.returnNumber) {
          return res.status(400).json({ success: false, message: 'Invalid purchase return payload.' });
        }
        shopStore.purchaseReturns = shopStore.purchaseReturns || [];
        const exists = shopStore.purchaseReturns.some((r) => r.returnNumber === ret.returnNumber);
        if (!exists) {
          shopStore.purchaseReturns.unshift(ret);
          ret.items.forEach((item) => {
            const product = shopStore.products.find((p) => p.id === item.productId);
            if (product) {
              const prevStock = Number(product.stock) || 0;
              const nextStock = prevStock - item.quantity;
              product.stock = nextStock;
              recordShopStockTx(
                shopStore,
                product,
                prevStock,
                -item.quantity,
                nextStock,
                'Purchase Return',
                ret.returnNumber,
                actor.actorEmail
              );
            }
          });
          if (ret.refundType === 'reduce_payable' && ret.supplierId) {
            const supplier = shopStore.suppliers.find((s) => s.id === ret.supplierId);
            if (supplier) {
              supplier.payableBalance = Math.max(0, (Number(supplier.payableBalance) || 0) - ret.totalRefund);
            }
          }
          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'purchase_return:processed',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: {
              purchaseReturn: ret,
              updatedProducts: shopStore.products,
              suppliers: shopStore.suppliers,
              stockHistory: shopStore.stockHistory,
              syncVersion: shopStore.syncVersion,
            },
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_staff': {
        if (Array.isArray(payload)) {
          const existingMap = new Map<string, any>();
          for (const st of shopStore.staffList || []) {
            existingMap.set(st.id, st);
          }

          const updatedStaff: StaffMember[] = payload.map((rawSt: any) => {
            const prev = existingMap.get(rawSt.id);
            let passwordSalt = prev?.passwordSalt;
            let passwordHash = prev?.passwordHash;
            const plainNewPass = typeof rawSt.newPassword === 'string' ? rawSt.newPassword.trim() : '';
            if (plainNewPass.length >= 4) {
              passwordSalt = crypto.randomBytes(16).toString('hex');
              passwordHash = hashPassword(plainNewPass, passwordSalt);
            }
            const cleanStaff: any = {
              ...rawSt,
              permissions: normalizeStaffPermissions(rawSt.permissions),
            };
            delete cleanStaff.newPassword;
            if (passwordSalt) cleanStaff.passwordSalt = passwordSalt;
            if (passwordHash) cleanStaff.passwordHash = passwordHash;
            return cleanStaff;
          });

          shopStore.staffList = updatedStaff;
          persistShopStore(targetShopId);

          const safeStaff = updatedStaff.map((st: any) => ({
            ...st,
            passwordHash: undefined,
            passwordSalt: undefined,
          }));
          broadcastSyncEventToShop(targetShopId, {
            type: 'staff:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: safeStaff,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_expenses': {
        if (Array.isArray(payload)) {
          shopStore.expenses = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'expenses:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore.expenses,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_supplier_ledgers': {
        const { suppliers: supList, ledgerEntries } = payload || {};
        if (Array.isArray(supList)) shopStore.suppliers = supList;
        if (Array.isArray(ledgerEntries)) shopStore.supplierLedgers = ledgerEntries;
        persistShopStore(targetShopId);
        broadcastSyncEventToShop(targetShopId, {
          type: 'supplier:ledger_updated',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: {
            suppliers: shopStore.suppliers,
            supplierLedgers: shopStore.supplierLedgers,
          },
        });
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_printer_settings': {
        if (payload) {
          shopStore.printerSettings = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'printer:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore.printerSettings,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_receipt_settings': {
        if (payload) {
          shopStore.receiptSettings = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'receipt:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore.receiptSettings,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_categories': {
        if (Array.isArray(payload)) {
          shopStore.categories = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'categories:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore.categories,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_daily_hisab': {
        if (payload && typeof payload === 'object') {
          if (
            typeof baseSyncVersion === 'number' &&
            baseSyncVersion > 0 &&
            (shopStore.syncVersion || 1) > baseSyncVersion &&
            req.body?.enforceConflictCheck === true
          ) {
            return res.status(409).json({
              success: false,
              error: 'CONFLICT',
              message: 'Daily Hisab was modified by another device while offline.',
              serverVersion: shopStore.syncVersion,
              store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions),
            });
          }
          shopStore.dailyHisab = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'daily_hisab:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore.dailyHisab,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_stock_history': {
        if (Array.isArray(payload)) {
          shopStore.stockHistory = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'store:sync',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'update_stock': {
        const updatedProducts: Product[] = payload;
        if (Array.isArray(updatedProducts)) {
          if (
            typeof baseSyncVersion === 'number' &&
            baseSyncVersion > 0 &&
            (shopStore.syncVersion || 1) > baseSyncVersion &&
            req.body?.enforceConflictCheck === true
          ) {
            return res.status(409).json({
              success: false,
              error: 'CONFLICT',
              message: 'Product catalog changed on server while offline. Review server state before retrying.',
              serverVersion: shopStore.syncVersion,
              store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions),
            });
          }
          const seenBarcodes = new Set<string>();
          for (const p of updatedProducts) {
            const b = (p.barcode || '').trim().toLowerCase();
            if (b) {
              if (seenBarcodes.has(b)) {
                return res.status(400).json({
                  success: false,
                  error: 'DUPLICATE_BARCODE',
                  message: `Duplicate barcode "${p.barcode}" is not allowed on product "${p.name}".`,
                });
              }
              seenBarcodes.add(b);
            }
          }

          // Preserve real costPrice if a staff member without cost permission saves retail edits
          if (actor.role === 'STAFF' && !actor.permissions?.canViewCostAndProfit) {
            const costById = new Map(shopStore.products.map((p) => [p.id, p.costPrice]));
            shopStore.products = updatedProducts.map((p) => ({
              ...p,
              costPrice: costById.get(p.id) ?? p.costPrice,
            }));
          } else {
            shopStore.products = updatedProducts;
          }

          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'stock:updated',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore.products,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'update_customer_ledger': {
        const { customers, ledgerEntries } = payload;
        if (Array.isArray(customers)) shopStore.customers = customers;
        if (Array.isArray(ledgerEntries)) shopStore.customerLedgers = ledgerEntries;
        persistShopStore(targetShopId);

        broadcastSyncEventToShop(targetShopId, {
          type: 'customer:ledger_updated',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: {
            customers: shopStore.customers,
            customerLedgers: shopStore.customerLedgers,
          },
        });
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'update_branding': {
        const branding: StoreBranding = payload;
        if (branding) {
          shopStore.branding = branding;
          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'store:sync',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'update_held_bills': {
        const heldBills: HeldBill[] = payload;
        if (Array.isArray(heldBills)) {
          shopStore.heldBills = heldBills;
          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'store:sync',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore,
          });
        }
        return res.json({ success: true, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'delete_held_bill': {
        const { billId } = payload || {};
        if (billId) {
          shopStore.heldBills = (shopStore.heldBills || []).filter((b) => b.id !== billId);
          persistShopStore(targetShopId);

          broadcastSyncEventToShop(targetShopId, {
            type: 'store:sync',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore,
          });
        }
        return res.json({ success: true, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_purchase_returns': {
        if (Array.isArray(payload)) {
          shopStore.purchaseReturns = payload;
          persistShopStore(targetShopId);
          broadcastSyncEventToShop(targetShopId, {
            type: 'store:sync',
            sourceDeviceId,
            timestamp: Date.now(),
            payload: shopStore,
          });
        }
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'delete_all_purchases': {
        if (Array.isArray(payload?.products)) shopStore.products = payload.products;
        if (Array.isArray(payload?.suppliers)) shopStore.suppliers = payload.suppliers;
        shopStore.purchases = [];
        persistShopStore(targetShopId);
        broadcastSyncEventToShop(targetShopId, {
          type: 'store:sync',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: shopStore,
        });
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'delete_all_held_bills': {
        shopStore.heldBills = [];
        persistShopStore(targetShopId);
        broadcastSyncEventToShop(targetShopId, {
          type: 'store:sync',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: shopStore,
        });
        return res.json({ success: true, syncVersion: shopStore.syncVersion, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'sync_full': {
        const { transactions, purchases, saleReturns, products, customers, customerLedgers } = payload || {};
        if (Array.isArray(transactions)) {
          transactions.forEach((tx) => {
            if (!shopStore.transactions.some((t) => t.invoiceNumber === tx.invoiceNumber)) {
              shopStore.transactions.push(tx);
            }
          });
        }
        if (Array.isArray(purchases)) {
          purchases.forEach((p) => {
            if (!shopStore.purchases.some((x) => x.purchaseInvoiceNo === p.purchaseInvoiceNo)) {
              shopStore.purchases.push(p);
            }
          });
        }
        if (Array.isArray(saleReturns)) {
          saleReturns.forEach((r) => {
            if (!shopStore.saleReturns.some((x) => x.returnNumber === r.returnNumber)) {
              shopStore.saleReturns.push(r);
            }
          });
        }
        if (Array.isArray(products) && products.length > 0 && shopStore.products.length === 0) {
          shopStore.products = products;
        }
        if (Array.isArray(customers) && customers.length > 0 && shopStore.customers.length === 0) {
          shopStore.customers = customers;
        }
        if (Array.isArray(customerLedgers)) {
          customerLedgers.forEach((l) => {
            if (!shopStore.customerLedgers.some((x) => x.id === l.id)) {
              shopStore.customerLedgers.push(l);
            }
          });
        }

        persistShopStore(targetShopId);
        broadcastSyncEventToShop(targetShopId, {
          type: 'store:sync',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: shopStore,
        });
        return res.json({ success: true, store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'reset_all_zero': {
        shopStore.products = [];
        shopStore.transactions = [];
        shopStore.purchases = [];
        shopStore.customers = [];
        shopStore.customerLedgers = [];
        shopStore.saleReturns = [];
        shopStore.heldBills = [];
        persistShopStore(targetShopId);

        broadcastSyncEventToShop(targetShopId, {
          type: 'store:sync',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: shopStore,
        });

        return res.json({ success: true, message: 'All store data reset to clean zero state.', store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      case 'load_seed_catalog': {
        shopStore.products = SEED_CATALOG_PRODUCTS;
        persistShopStore(targetShopId);

        broadcastSyncEventToShop(targetShopId, {
          type: 'store:sync',
          sourceDeviceId,
          timestamp: Date.now(),
          payload: shopStore,
        });

        return res.json({ success: true, message: 'Reference 15 picture products loaded.', store: sanitizeStoreForClient(shopStore, actor.role, actor.permissions) });
      }

      default:
        return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
    }
  });

  // -------------------------------------------------------------
  // 6. SUPER ADMIN CONSOLE, MULTI-SHOP, SUBSCRIPTIONS & BACKUP API
  // -------------------------------------------------------------
  function buildSuperAdminOverviewPayload() {
    checkAndAutoExpireSubscriptions();
    const totalIncome = subscriptionsDb.payments.reduce((sum, p) => sum + (p.finalAmount || 0), 0);
    const amountReceived = subscriptionsDb.payments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
    const outstandingBalance = subscriptionsDb.shops.reduce((sum, s) => sum + (s.remainingBalance || 0), 0);
    const currentYearMonth = new Date().toISOString().slice(0, 7);
    const thisMonthIncome = subscriptionsDb.payments
      .filter((p) => (p.paymentDate || '').startsWith(currentYearMonth))
      .reduce((sum, p) => sum + (p.amountPaid || 0), 0);
    const currentYear = new Date().getFullYear().toString();
    const thisYearIncome = subscriptionsDb.payments
      .filter((p) => (p.paymentDate || '').startsWith(currentYear))
      .reduce((sum, p) => sum + (p.amountPaid || 0), 0);

    const onlineDeviceIds = new Set(Array.from(sseClients.values()).map((c) => c.deviceId));
    const enrichedDevices = registeredDevices.map((d) => {
      const sId = d.shopId || 'SHOP-WM-001';
      const shop = subscriptionsDb.shops.find((s) => s.id === sId);
      return {
        ...d,
        shopId: sId,
        shopName: shop?.shopName || 'WAQAS MART',
        sessionToken: undefined,
        connectionState: onlineDeviceIds.has(d.deviceId) ? ('online' as const) : ('offline' as const),
      };
    });

    const enrichedShops = subscriptionsDb.shops.map((s) => {
      const ownerUser = authDb.users.find((u) => u.shopId === s.id && u.role === 'SHOP_OWNER');
      const shopDevs = enrichedDevices.filter((d) => d.shopId === s.id);
      return {
        ...s,
        ownerUsername: ownerUser?.username || s.email,
        deviceCount: shopDevs.filter((d) => d.status === 'active').length,
        onlineDeviceCount: shopDevs.filter((d) => d.connectionState === 'online').length,
      };
    });

    const activeDevices = enrichedDevices.filter((d) => d.status === 'active');
    const onlineDevicesCount = activeDevices.filter((d) => d.connectionState === 'online').length;

    return {
      metrics: {
        totalIncome,
        amountReceived,
        outstandingBalance,
        thisMonthIncome,
        thisYearIncome,
        totalRenewals: subscriptionsDb.renewals.length,
        totalShops: subscriptionsDb.shops.length,
        activeShops: subscriptionsDb.shops.filter((s) => s.status === 'active' || s.status === 'expiring_soon').length,
        inactiveShops: subscriptionsDb.shops.filter((s) => s.status === 'inactive').length,
        expiringSoon: subscriptionsDb.shops.filter((s) => s.status === 'expiring_soon').length,
        expiredShops: subscriptionsDb.shops.filter((s) => s.status === 'expired').length,
        suspendedShops: subscriptionsDb.shops.filter((s) => s.status === 'suspended').length,
        blockedShops: subscriptionsDb.shops.filter((s) => s.status === 'blocked').length,
        totalOwners: authDb.users.filter((u) => u.role === 'SHOP_OWNER').length,
        totalDevices: registeredDevices.length,
        onlineDevices: onlineDevicesCount,
        offlineDevices: Math.max(0, activeDevices.length - onlineDevicesCount),
        revokedDevices: registeredDevices.filter((d) => d.status === 'revoked').length,
      },
      shops: enrichedShops,
      payments: subscriptionsDb.payments,
      renewals: subscriptionsDb.renewals,
      devices: enrichedDevices,
      auditLogs: auditLogs.slice(0, 200),
      superAdmin: authDb.superAdmin
        ? {
            id: authDb.superAdmin.id,
            gmail: authDb.superAdmin.gmail,
            mobile: authDb.superAdmin.mobile,
            fullName: authDb.superAdmin.fullName,
            verifiedGmail: authDb.superAdmin.verifiedGmail,
            verifiedMobile: authDb.superAdmin.verifiedMobile,
            createdAt: authDb.superAdmin.createdAt,
            lastLoginAt: authDb.superAdmin.lastLoginAt,
          }
        : null,
    };
  }

  app.get('/api/super-admin/overview', requireSuperAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, ...buildSuperAdminOverviewPayload() });
  });

  app.get('/api/subscriptions/overview', requireSuperAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, ...buildSuperAdminOverviewPayload() });
  });

  app.get('/api/super-admin/shops', requireSuperAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, shops: buildSuperAdminOverviewPayload().shops });
  });

  app.get('/api/subscriptions/shops', requireSuperAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, shops: buildSuperAdminOverviewPayload().shops });
  });

  // Create Shop Account + Shop Owner Login + Isolated Store DB
  function handleCreateShop(req: Request, res: Response) {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const {
      shopName,
      ownerName,
      username,
      password,
      confirmPassword,
      email,
      phone,
      mobile,
      whatsapp,
      address,
      plan = '12_months',
      status = 'active',
      startDate,
      expiryDate,
      pricing,
      initialPayment = 0,
      paymentMethod = 'Cash',
    } = req.body || {};

    const cleanShopName = String(shopName || '').trim();
    const cleanOwnerName = String(ownerName || cleanShopName).trim();
    const cleanPhone = String(mobile || phone || '').trim();
    const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();
    const cleanConfirm = confirmPassword !== undefined ? String(confirmPassword).trim() : cleanPass;

    if (!cleanShopName || !cleanOwnerName || (!cleanUsername && !cleanEmail) || !cleanPass) {
      return res.status(400).json({
        success: false,
        message: 'Mart Name, Mart Owner Name, Shop Username, and Shop Password are required.',
      });
    }
    if (cleanPass.length < 6) {
      return res.status(400).json({ success: false, message: 'Shop Owner password must be at least 6 characters.' });
    }
    if (cleanPass !== cleanConfirm) {
      return res.status(400).json({ success: false, message: 'Shop Password and Confirm Shop Password do not match.' });
    }

    const effectiveUsername = cleanUsername || cleanEmail.split('@')[0].replace(/[^a-z0-9_.-]/g, '');
    const effectiveEmail = cleanEmail || `${effectiveUsername}@shop.local`;

    const dupUser = authDb.users.find(
      (u) =>
        (effectiveUsername && u.username?.toLowerCase() === effectiveUsername) ||
        (cleanEmail && u.email?.toLowerCase() === cleanEmail)
    );
    if (dupUser) {
      return res.status(409).json({
        success: false,
        message: 'A Shop Owner account with this username or email already exists.',
      });
    }

    let uniqueShopId = `SHOP-WM-${100 + subscriptionsDb.shops.length + Math.floor(Math.random() * 900)}`;
    while (subscriptionsDb.shops.some((s) => s.id === uniqueShopId)) {
      uniqueShopId = `SHOP-WM-${100 + subscriptionsDb.shops.length + Math.floor(Math.random() * 9000)}`;
    }

    const initialPaid = Number(initialPayment) || 0;
    const standardPlanPrices: Record<string, number> = {
      '1_month': Number(pricing?.oneMonth) || 1500,
      '3_months': Number(pricing?.threeMonths) || 4000,
      '6_months': Number(pricing?.sixMonths) || 7500,
      '12_months': Number(pricing?.twelveMonths) || 14000,
      custom: Number(pricing?.customPricePerMonth) || 1500,
    };
    const totalCost = standardPlanPrices[plan] || 1500;
    const remainingBalance = Math.max(0, totalCost - initialPaid);
    const durationDays =
      plan === '1_month' ? 30 : plan === '3_months' ? 90 : plan === '6_months' ? 180 : 365;

    const newShop: ShopAccount = {
      id: uniqueShopId,
      shopName: cleanShopName,
      ownerName: cleanOwnerName,
      email: effectiveEmail,
      phone: cleanPhone,
      whatsapp: String(whatsapp || cleanPhone).trim(),
      address: String(address || '').trim(),
      status: status === 'inactive' || status === 'suspended' ? status : 'active',
      plan: plan as any,
      startDate: startDate || new Date().toISOString().split('T')[0],
      expiryDate:
        expiryDate ||
        new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      pricing: {
        oneMonth: Number(pricing?.oneMonth) || 1500,
        threeMonths: Number(pricing?.threeMonths) || 4000,
        sixMonths: Number(pricing?.sixMonths) || 7500,
        twelveMonths: Number(pricing?.twelveMonths) || 14000,
        customPricePerMonth: Number(pricing?.customPricePerMonth) || 1500,
        lastUpdated: new Date().toISOString().split('T')[0],
      },
      initialPayment: initialPaid,
      remainingBalance,
      totalPaid: initialPaid,
      totalIncome: totalCost,
      renewalsCount: 0,
      mustChangePasswordOnFirstLogin: false,
      createdAt: new Date().toISOString(),
    };

    const salt = crypto.randomBytes(16).toString('hex');
    const newOwnerUser: StoredUser = {
      id: `USR-${uniqueShopId}`,
      username: effectiveUsername,
      email: effectiveEmail,
      fullName: cleanOwnerName,
      phone: cleanPhone,
      whatsapp: String(whatsapp || cleanPhone).trim(),
      role: 'SHOP_OWNER',
      shopId: uniqueShopId,
      passwordSalt: salt,
      passwordHash: hashPassword(cleanPass, salt),
      mustChangePasswordOnFirstLogin: false,
      createdAt: new Date().toISOString(),
    };

    subscriptionsDb.shops.unshift(newShop);
    authDb.users.push(newOwnerUser);

    if (initialPaid > 0) {
      const receiptNumber = `RCP-${crypto.randomInt(1000, 9999)}`;
      subscriptionsDb.payments.unshift({
        id: `PAY-${Date.now()}`,
        receiptNumber,
        shopId: uniqueShopId,
        shopName: cleanShopName,
        ownerName: cleanOwnerName,
        ownerEmail: effectiveEmail,
        plan: newShop.plan,
        durationLabel: newShop.plan.replace('_', ' ').toUpperCase(),
        totalAmount: totalCost,
        discount: 0,
        finalAmount: totalCost,
        amountPaid: initialPaid,
        remainingBalance,
        paymentMethod: paymentMethod as any,
        paymentDate: new Date().toISOString().split('T')[0],
        confirmedBy: saSession?.fullName || 'Super Admin',
        status: remainingBalance === 0 ? 'Paid' : 'Partially Paid',
        createdAt: new Date().toISOString(),
      });
    }

    persistSubscriptions();
    persistAuthDb();

    // Initialize completely isolated store database for the new shop
    const newStore = getShopStore(uniqueShopId);
    newStore.branding.storeName = cleanShopName;
    newStore.branding.primaryName = cleanShopName.split(' ')[0] || cleanShopName;
    newStore.branding.accentName = cleanShopName.split(' ').slice(1).join(' ') || 'POS';
    newStore.branding.sidebarPromoBadge = cleanShopName;
    newStore.userProfile = {
      id: newOwnerUser.id,
      displayName: cleanOwnerName,
      email: effectiveEmail,
      phone: cleanPhone,
      role: 'Shop Owner',
      createdAt: new Date().toLocaleDateString('en-GB'),
    };
    persistShopStore(uniqueShopId, false);

    recordAuditLog(
      'SHOP_CREATED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Created isolated mart "${cleanShopName}" (${uniqueShopId}) for owner "${cleanOwnerName}" (username: ${effectiveUsername})`,
      uniqueShopId,
      req.ip
    );

    return res.json({
      success: true,
      shopId: uniqueShopId,
      shop: { ...newShop, ownerUsername: effectiveUsername },
      ownerUsername: effectiveUsername,
    });
  }

  app.post('/api/super-admin/shops', requireSuperAdmin, handleCreateShop);
  app.post('/api/subscriptions/shops', requireSuperAdmin, handleCreateShop);

  // Edit shop details / shop owner username / plan / expiry
  app.put('/api/super-admin/shops/:id', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const shop = subscriptionsDb.shops.find((s) => s.id === id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found.' });
    }

    const { shopName, ownerName, ownerUsername, phone, whatsapp, email, address, status, plan, expiryDate, pricing } = req.body || {};
    const ownerUser = authDb.users.find((u) => u.shopId === id && u.role === 'SHOP_OWNER');

    if (ownerUsername !== undefined) {
      const cleanNewUsername = String(ownerUsername || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      if (!cleanNewUsername) {
        return res.status(400).json({ success: false, message: 'Shop Username cannot be empty.' });
      }
      const dupUsername = authDb.users.find(
        (u) => u.id !== ownerUser?.id && u.username?.toLowerCase() === cleanNewUsername
      );
      if (dupUsername) {
        return res.status(409).json({ success: false, message: 'That Shop Username is already in use by another mart.' });
      }
      if (ownerUser) ownerUser.username = cleanNewUsername;
    }

    if (shopName) shop.shopName = String(shopName).trim();
    if (ownerName) shop.ownerName = String(ownerName).trim();
    if (phone !== undefined) shop.phone = String(phone).trim();
    if (whatsapp !== undefined) shop.whatsapp = String(whatsapp).trim();
    if (email !== undefined) shop.email = String(email).trim().toLowerCase();
    if (address !== undefined) shop.address = String(address).trim();
    if (status) shop.status = status;
    if (plan) shop.plan = plan;
    if (expiryDate) shop.expiryDate = expiryDate;
    if (pricing) {
      shop.pricing = { ...shop.pricing, ...pricing, lastUpdated: new Date().toISOString().split('T')[0] };
    }

    if (ownerUser) {
      if (ownerName) ownerUser.fullName = shop.ownerName;
      if (phone !== undefined) ownerUser.phone = shop.phone;
      if (whatsapp !== undefined) ownerUser.whatsapp = shop.whatsapp;
      if (email) ownerUser.email = shop.email;
      persistAuthDb();
    }

    if (shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked') {
      for (const token of Object.keys(authDb.sessions)) {
        if (authDb.sessions[token].shopId === shop.id) {
          delete authDb.sessions[token];
        }
      }
      persistAuthDb();
      disconnectShopClients(shop.id, 'auth:shop_restricted', `Shop status changed to ${shop.status}`);
    }

    persistSubscriptions();
    recordAuditLog(
      'SHOP_UPDATED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Updated shop "${shop.shopName}" (${shop.id})`,
      shop.id,
      req.ip
    );
    return res.json({ success: true, shop: { ...shop, ownerUsername: ownerUser?.username } });
  });

  app.put('/api/subscriptions/shops/:id', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const shop = subscriptionsDb.shops.find((s) => s.id === id);
    if (!shop) return res.status(404).json({ success: false, message: 'Shop not found' });
    const { status, pricing, expiryDate, plan } = req.body || {};
    const prevStatus = shop.status;
    if (status) shop.status = status;
    if (pricing) shop.pricing = { ...shop.pricing, ...pricing, lastUpdated: new Date().toISOString().split('T')[0] };
    if (expiryDate) shop.expiryDate = expiryDate;
    if (plan) shop.plan = plan;
    persistSubscriptions();
    if (shop.status === 'inactive' || shop.status === 'suspended' || shop.status === 'blocked') {
      for (const token of Object.keys(authDb.sessions)) {
        if (authDb.sessions[token].shopId === shop.id) delete authDb.sessions[token];
      }
      persistAuthDb();
      disconnectShopClients(shop.id, 'auth:shop_restricted', `Shop status changed to ${shop.status}`);
    }
    recordAuditLog('SHOP_STATUS_UPDATED', saSession?.email || 'superadmin', 'SUPER_ADMIN', `Updated ${shop.shopName} (${shop.id}): ${prevStatus} -> ${shop.status}`, shop.id, req.ip);
    return res.json({ success: true, shop });
  });

  // Activate / Deactivate / Suspend / Block / Restore shop
  app.post('/api/super-admin/shops/:id/status', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const shop = subscriptionsDb.shops.find((s) => s.id === id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found.' });
    }

    const { status } = req.body || {};
    const allowedStatuses = ['active', 'inactive', 'suspended', 'blocked', 'expired', 'expiring_soon'];
    const newStatus = allowedStatuses.includes(status) ? status : shop.status === 'active' ? 'suspended' : 'active';
    const prevStatus = shop.status;
    shop.status = newStatus;
    persistSubscriptions();

    if (newStatus === 'inactive' || newStatus === 'suspended' || newStatus === 'blocked' || newStatus === 'expired') {
      for (const token of Object.keys(authDb.sessions)) {
        if (authDb.sessions[token].shopId === shop.id) {
          delete authDb.sessions[token];
        }
      }
      persistAuthDb();
      disconnectShopClients(shop.id, 'auth:shop_restricted', `Shop access ${newStatus}`);
    }

    recordAuditLog(
      'SHOP_STATUS_CHANGED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Shop "${shop.shopName}" (${shop.id}) status changed: ${prevStatus} -> ${newStatus}`,
      shop.id,
      req.ip
    );
    return res.json({ success: true, status: newStatus, shop });
  });

  // Reset Shop Owner Password
  app.post('/api/super-admin/shops/:id/reset-password', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const shopUser = authDb.users.find((u) => u.shopId === id && u.role === 'SHOP_OWNER');
    if (!shopUser) {
      return res.status(404).json({ success: false, message: 'Shop owner account not found.' });
    }

    const { password, mustChangeOnNextLogin = false } = req.body || {};
    if (!password || String(password).trim().length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    shopUser.passwordSalt = salt;
    shopUser.passwordHash = hashPassword(String(password).trim(), salt);
    shopUser.mustChangePasswordOnFirstLogin = Boolean(mustChangeOnNextLogin);

    for (const token of Object.keys(authDb.sessions)) {
      if (authDb.sessions[token].userId === shopUser.id) {
        delete authDb.sessions[token];
      }
    }
    persistAuthDb();

    recordAuditLog(
      'SHOP_PASSWORD_RESET',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Super Admin reset password for Shop Owner of ${id}`,
      id,
      req.ip
    );
    return res.json({ success: true, message: 'Shop Owner password reset successfully.' });
  });

  // Delete Shop with explicit confirmation match
  app.delete('/api/super-admin/shops/:id', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    if (id === 'SHOP-WM-001' && req.body?.allowPrimaryDelete !== true) {
      return res.status(400).json({ success: false, message: 'Primary branch SHOP-WM-001 cannot be deleted directly.' });
    }
    const shop = subscriptionsDb.shops.find((s) => s.id === id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found.' });
    }
    const confirmText = String(req.body?.confirmText || '').trim();
    if (confirmText !== shop.id && confirmText.toLowerCase() !== shop.shopName.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: `Confirmation failed. Type "${shop.id}" or "${shop.shopName}" to delete this shop.`,
      });
    }

    // Archive shop JSON safely into backups/deleted_shops before deletion
    const archiveDir = path.join(DATA_DIR, 'backups', 'deleted_shops');
    fs.mkdirSync(archiveDir, { recursive: true });
    const shopFile = getShopStoreFile(id);
    if (fs.existsSync(shopFile)) {
      try {
        fs.copyFileSync(shopFile, path.join(archiveDir, `${id}_${Date.now()}.json`));
        fs.unlinkSync(shopFile);
      } catch {}
    }
    shopStoreCache.delete(id);

    subscriptionsDb.shops = subscriptionsDb.shops.filter((s) => s.id !== id);
    persistSubscriptions();

    authDb.users = authDb.users.filter((u) => u.shopId !== id);
    for (const token of Object.keys(authDb.sessions)) {
      if (authDb.sessions[token].shopId === id) {
        delete authDb.sessions[token];
      }
    }
    persistAuthDb();

    disconnectShopClients(id, 'device:revoked', 'Shop account deleted by Super Admin');
    registeredDevices = registeredDevices.filter((d) => d.shopId !== id);
    persistDevices();

    recordAuditLog(
      'SHOP_DELETED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Deleted shop "${shop.shopName}" (${id}) with archive backup`,
      id,
      req.ip
    );
    return res.json({ success: true, message: `Shop "${shop.shopName}" deleted cleanly.` });
  });

  // Record Subscription Payment (PKR)
  function handleRecordPayment(req: Request, res: Response) {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const {
      shopId,
      plan,
      durationLabel,
      totalAmount,
      discount = 0,
      amountPaid,
      paymentMethod = 'Cash',
      paymentDate,
      transactionReference,
      notes,
    } = req.body || {};

    const shop = subscriptionsDb.shops.find((s) => s.id === shopId);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found.' });
    }

    const total = Number(totalAmount) || 0;
    const disc = Number(discount) || 0;
    const finalAmt = Math.max(0, total - disc);
    const paid = Number(amountPaid) || 0;
    const remaining = Math.max(0, finalAmt - paid);

    const receiptNumber = `RCP-${crypto.randomInt(1000, 9999)}`;
    const paymentRecord: SubscriptionPaymentRecord = {
      id: `PAY-${Date.now()}`,
      receiptNumber,
      shopId: shop.id,
      shopName: shop.shopName,
      ownerName: shop.ownerName,
      ownerEmail: shop.email,
      plan: plan || shop.plan,
      durationLabel: durationLabel || 'Subscription Payment',
      totalAmount: total,
      discount: disc,
      finalAmount: finalAmt,
      amountPaid: paid,
      remainingBalance: remaining,
      paymentMethod,
      paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      transactionReference: transactionReference || undefined,
      confirmedBy: saSession?.fullName || 'Super Admin',
      notes: notes || undefined,
      status: remaining === 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid',
      createdAt: new Date().toISOString(),
    };

    subscriptionsDb.payments.unshift(paymentRecord);
    shop.totalPaid = (shop.totalPaid || 0) + paid;
    shop.remainingBalance = remaining;
    if (paid > 0 && shop.status === 'expired') {
      shop.status = 'active';
    }
    persistSubscriptions();

    recordAuditLog(
      'PAYMENT_RECORDED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Recorded PKR ${paid.toLocaleString()} for ${shop.shopName} (${shop.id}) via ${paymentMethod} — Receipt: ${receiptNumber}`,
      shop.id,
      req.ip
    );

    return res.json({ success: true, payment: paymentRecord, shop });
  }

  app.post('/api/super-admin/payments', requireSuperAdmin, handleRecordPayment);
  app.post('/api/subscriptions/payments', requireSuperAdmin, handleRecordPayment);

  // Renew / Extend Subscription
  function handleRenewSubscription(req: Request, res: Response) {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { shopId, plan, additionalDays, amount, paymentMethod, notes } = req.body || {};
    const shop = subscriptionsDb.shops.find((s) => s.id === shopId);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    const durationDays =
      Number(additionalDays) ||
      (plan === '1_month' ? 30 : plan === '3_months' ? 90 : plan === '6_months' ? 180 : plan === '12_months' ? 365 : 30);

    const previousExpiry = shop.expiryDate;
    const currentExpiryDate = new Date(shop.expiryDate);
    const now = new Date();
    const baseDate = currentExpiryDate > now ? currentExpiryDate : now;
    const newExpiry = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    shop.expiryDate = newExpiry;
    shop.status = 'active';
    shop.plan = plan || shop.plan;
    shop.renewalsCount = (shop.renewalsCount || 0) + 1;

    const receiptNumber = `RCP-${crypto.randomInt(1000, 9999)}`;
    const paidAmt = Number(amount) || 0;

    const renewalRecord: SubscriptionRenewalRecord = {
      id: `REN-${Date.now()}`,
      shopId: shop.id,
      shopName: shop.shopName,
      plan: shop.plan,
      durationDays,
      previousExpiry,
      newExpiry,
      paymentReceiptNumber: receiptNumber,
      amount: paidAmt,
      renewedAt: new Date().toISOString(),
      confirmedBy: saSession?.fullName || 'Super Admin',
    };
    subscriptionsDb.renewals.unshift(renewalRecord);

    if (paidAmt > 0) {
      subscriptionsDb.payments.unshift({
        id: `PAY-${Date.now()}`,
        receiptNumber,
        shopId: shop.id,
        shopName: shop.shopName,
        ownerName: shop.ownerName,
        ownerEmail: shop.email,
        plan: shop.plan,
        durationLabel: `${durationDays} Days Renewal`,
        totalAmount: paidAmt,
        discount: 0,
        finalAmount: paidAmt,
        amountPaid: paidAmt,
        remainingBalance: 0,
        paymentMethod: paymentMethod || 'Cash',
        paymentDate: new Date().toISOString().split('T')[0],
        confirmedBy: saSession?.fullName || 'Super Admin',
        notes: notes || 'Renewal payment confirmed',
        status: 'Paid',
        createdAt: new Date().toISOString(),
      });
      shop.totalPaid = (shop.totalPaid || 0) + paidAmt;
    }

    persistSubscriptions();
    recordAuditLog(
      'SUBSCRIPTION_RENEWED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Renewed ${shop.shopName} (${shop.id}) by ${durationDays} days. New expiry: ${newExpiry}`,
      shop.id,
      req.ip
    );
    return res.json({ success: true, shop, renewal: renewalRecord, receiptNumber });
  }

  app.post('/api/super-admin/shops/:id/extend-subscription', requireSuperAdmin, (req: Request, res: Response) => {
    req.body = { ...req.body, shopId: req.params.id };
    return handleRenewSubscription(req, res);
  });
  app.post('/api/subscriptions/renew', requireSuperAdmin, handleRenewSubscription);

  // Super Admin Devices Endpoints
  app.get('/api/super-admin/devices', requireSuperAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, devices: buildSuperAdminOverviewPayload().devices });
  });

  app.post('/api/super-admin/devices/:id/revoke', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) return res.status(404).json({ success: false, message: 'Device not found.' });
    target.status = 'revoked';
    target.connectionState = 'offline';
    persistDevices();
    const targetShopId = target.shopId || 'SHOP-WM-001';
    recordAuditLog('DEVICE_REVOKED', saSession?.email || 'superadmin', 'SUPER_ADMIN', `Super Admin revoked device "${target.deviceName}" (${id})`, targetShopId, req.ip);
    broadcastSyncEventToShop(targetShopId, { type: 'device:revoked', sourceDeviceId: id, timestamp: Date.now(), payload: { deviceId: id } });
    for (const [cid, client] of sseClients.entries()) {
      if (client.deviceId === id) {
        try { client.res.end(); } catch {}
        sseClients.delete(cid);
      }
    }
    broadcastSyncEventToShop(targetShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === targetShopId).map((d) => ({ ...d, sessionToken: undefined })),
    });
    return res.json({ success: true, message: 'Device revoked.' });
  });

  app.post('/api/super-admin/devices/:id/restore', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) return res.status(404).json({ success: false, message: 'Device not found.' });
    target.status = 'active';
    removedDeviceIds.delete(id);
    persistDevices();
    const targetShopId = target.shopId || 'SHOP-WM-001';
    recordAuditLog('DEVICE_RESTORED', saSession?.email || 'superadmin', 'SUPER_ADMIN', `Super Admin restored device "${target.deviceName}" (${id})`, targetShopId, req.ip);
    broadcastSyncEventToShop(targetShopId, {
      type: 'device:updated',
      timestamp: Date.now(),
      payload: registeredDevices.filter((d) => d.shopId === targetShopId).map((d) => ({ ...d, sessionToken: undefined })),
    });
    return res.json({ success: true, message: 'Device restored.' });
  });

  app.delete('/api/super-admin/devices/:id', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const { id } = req.params;
    const target = registeredDevices.find((d) => d.deviceId === id);
    if (!target) return res.status(404).json({ success: false, message: 'Device not found.' });
    const targetShopId = target.shopId || 'SHOP-WM-001';
    registeredDevices = registeredDevices.filter((d) => d.deviceId !== id);
    removedDeviceIds.add(id);
    persistDevices();
    recordAuditLog('DEVICE_REMOVED', saSession?.email || 'superadmin', 'SUPER_ADMIN', `Super Admin removed device "${target.deviceName}" (${id})`, targetShopId, req.ip);
    broadcastSyncEventToShop(targetShopId, { type: 'device:revoked', timestamp: Date.now(), payload: { deviceId: id } });
    for (const [cid, client] of sseClients.entries()) {
      if (client.deviceId === id) {
        try { client.res.end(); } catch {}
        sseClients.delete(cid);
      }
    }
    return res.json({ success: true, message: 'Device removed.' });
  });

  app.get('/api/super-admin/audit-logs', requireSuperAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, logs: auditLogs });
  });

  app.post('/api/super-admin/sessions/revoke-others', requireSuperAdmin, (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const currentTok = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
    let revoked = 0;
    for (const [tok, sess] of Object.entries(authDb.sessions)) {
      if (sess.role === 'SUPER_ADMIN' && tok !== currentTok) {
        delete authDb.sessions[tok];
        revoked += 1;
      }
    }
    if (revoked > 0) persistAuthDb();
    const saSession = (req as any).superAdminSession as AuthSessionData;
    recordAuditLog(
      'SUPER_ADMIN_SESSIONS_REVOKED',
      saSession?.email || 'superadmin',
      'SUPER_ADMIN',
      `Revoked ${revoked} other active Super Admin session(s).`,
      undefined,
      req.ip
    );
    return res.json({ success: true, message: `Terminated ${revoked} other Super Admin session(s).` });
  });

  // Mart Owner Profile Endpoints (Strictly Scoped to Authenticated Shop)
  app.get('/api/settings/mart-owner', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    const shopId = actor.ok ? actor.shopId : 'SHOP-WM-001';
    const shopStore = getShopStore(shopId);
    return res.json({
      success: true,
      martOwner: shopStore.martOwner || {
        martName: shopStore.branding.storeName || 'WAQAS MART',
        badge: 'MART OWNER',
        ownerName: shopStore.userProfile.displayName || 'Shop Owner',
        designation: 'Proprietor & Manager',
        mobileNumber: shopStore.userProfile.phone || '03228570782',
        whatsappNumber: shopStore.userProfile.phone || '03228570782',
        address: 'Commercial Market, Pakistan',
        photoUrl: '/assets/aistudio/female_owner_portrait.svg',
      },
      softwareOwner: {
        name: 'Muhammad Waqas',
        designation: 'WAQAS POS SOFTWARE',
        whatsapp: '03228570782',
        mobile: '03429634133',
        photoUrl: '/5c454cea45cc8c39a24b57a83fbbc5cf_0.webp',
        isPermanentlyLocked: true,
      },
    });
  });

  app.post('/api/settings/mart-owner', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const shopStore = getShopStore(actor.shopId);
    const { martName, ownerName, designation, mobileNumber, whatsappNumber, address, photoUrl } = req.body || {};
    shopStore.martOwner = {
      martName: martName || shopStore.branding.storeName || 'WAQAS MART',
      badge: 'MART OWNER',
      ownerName: ownerName || shopStore.userProfile.displayName || 'Shop Owner',
      designation: designation || 'Proprietor & Manager',
      mobileNumber: mobileNumber || '03228570782',
      whatsappNumber: whatsappNumber || mobileNumber || '03228570782',
      address: address || '',
      photoUrl: photoUrl || '/assets/aistudio/female_owner_portrait.svg',
    };
    persistShopStore(actor.shopId);
    broadcastSyncEventToShop(actor.shopId, {
      type: 'store:sync',
      timestamp: Date.now(),
      payload: shopStore,
    });
    return res.json({ success: true, martOwner: shopStore.martOwner });
  });

  // Super Admin Full System Backup Export & Restore
  app.get('/api/super-admin/backup/export', requireSuperAdmin, (_req: Request, res: Response) => {
    const allShopData: Record<string, any> = {};
    if (fs.existsSync(SHOPS_DIR)) {
      const files = fs.readdirSync(SHOPS_DIR);
      for (const f of files) {
        if (f.endsWith('.json')) {
          const sId = f.replace('.json', '');
          try {
            allShopData[sId] = JSON.parse(fs.readFileSync(path.join(SHOPS_DIR, f), 'utf-8'));
          } catch {}
        }
      }
    }
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      version: '3.0-multishop',
      superAdmin: authDb.superAdmin
        ? { id: authDb.superAdmin.id, gmail: authDb.superAdmin.gmail, mobile: authDb.superAdmin.mobile, fullName: authDb.superAdmin.fullName }
        : null,
      shops: subscriptionsDb.shops,
      shopDatabases: allShopData,
      payments: subscriptionsDb.payments,
      renewals: subscriptionsDb.renewals,
      auditLogs,
      devices: registeredDevices.map((d) => ({ ...d, sessionToken: undefined })),
    });
  });

  app.post('/api/super-admin/backup/import', requireSuperAdmin, (req: Request, res: Response) => {
    const saSession = (req as any).superAdminSession as AuthSessionData;
    const restoredData = req.body?.restoredData || req.body?.data || req.body;
    if (!restoredData || typeof restoredData !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid backup payload.' });
    }

    const safetyDir = path.join(DATA_DIR, 'backups', `safety_before_restore_${Date.now()}`);
    fs.mkdirSync(safetyDir, { recursive: true });
    try {
      if (fs.existsSync(AUTH_DB_FILE)) fs.copyFileSync(AUTH_DB_FILE, path.join(safetyDir, 'auth_db.json'));
      if (fs.existsSync(STORE_DB_FILE)) fs.copyFileSync(STORE_DB_FILE, path.join(safetyDir, 'store_db.json'));
      if (fs.existsSync(SUBSCRIPTIONS_DB_FILE)) fs.copyFileSync(SUBSCRIPTIONS_DB_FILE, path.join(safetyDir, 'subscriptions_db.json'));
    } catch {}

    if (Array.isArray(restoredData.shops)) {
      subscriptionsDb.shops = restoredData.shops;
    }
    if (Array.isArray(restoredData.payments)) {
      subscriptionsDb.payments = restoredData.payments;
    }
    if (Array.isArray(restoredData.renewals)) {
      subscriptionsDb.renewals = restoredData.renewals;
    }
    persistSubscriptions();

    if (restoredData.shopDatabases && typeof restoredData.shopDatabases === 'object') {
      for (const [sId, sData] of Object.entries(restoredData.shopDatabases)) {
        setShopStore(sId, sData as StoreData);
        broadcastSyncEventToShop(sId, {
          type: 'store:sync',
          timestamp: Date.now(),
          payload: getShopStore(sId),
        });
      }
    }

    recordAuditLog('SYSTEM_BACKUP_RESTORED', saSession?.email || 'superadmin', 'SUPER_ADMIN', 'Super Admin restored multi-shop system backup.', undefined, req.ip);
    return res.json({ success: true, message: 'System backup restored across shops.' });
  });

  // Shop-Scoped Backup Export & Restore (For Shop Owners — strictly isolated to their own Shop)
  app.get('/api/shop/backup/export', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    if (actor.role === 'STAFF' && !actor.permissions?.settings) {
      return res.status(403).json({ success: false, message: 'Backup export requires Settings permission.' });
    }
    const shopStore = getShopStore(actor.shopId);
    const shopMeta = subscriptionsDb.shops.find((s) => s.id === actor.shopId);
    return res.json({
      success: true,
      backup: {
        softwareName: 'WAQAS POS SOFTWARE',
        exportedAt: new Date().toISOString(),
        shopId: actor.shopId,
        martName: shopMeta?.shopName || shopStore.branding.storeName,
        storeDb: shopStore,
      },
    });
  });

  app.post('/api/shop/backup/import', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    if (actor.role === 'STAFF' && !actor.permissions?.settings) {
      return res.status(403).json({ success: false, message: 'Backup restore requires Settings permission.' });
    }

    const restoredData = req.body?.restoredData || req.body?.data || req.body;
    if (!restoredData || typeof restoredData !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid backup payload.' });
    }

    const shopId = actor.shopId;
    const current = getShopStore(shopId);
    const safetyDir = path.join(DATA_DIR, 'backups', `safety_shop_${shopId}_${Date.now()}`);
    fs.mkdirSync(safetyDir, { recursive: true });
    try {
      const f = getShopStoreFile(shopId);
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(safetyDir, `${shopId}.json`));
    } catch {}

    const sourceStore = restoredData.storeDb || restoredData.store || restoredData;
    const updated = setShopStore(shopId, {
      ...current,
      products: Array.isArray(sourceStore.products) ? sourceStore.products : current.products,
      transactions: Array.isArray(sourceStore.transactions) ? sourceStore.transactions : current.transactions,
      purchases: Array.isArray(sourceStore.purchases) ? sourceStore.purchases : current.purchases,
      customers: Array.isArray(sourceStore.customers) ? sourceStore.customers : current.customers,
      customerLedgers: Array.isArray(sourceStore.customerLedgerEntries)
        ? sourceStore.customerLedgerEntries
        : Array.isArray(sourceStore.customerLedgers)
        ? sourceStore.customerLedgers
        : current.customerLedgers,
      suppliers: Array.isArray(sourceStore.suppliers) ? sourceStore.suppliers : current.suppliers,
      supplierLedgers: Array.isArray(sourceStore.supplierLedgers) ? sourceStore.supplierLedgers : current.supplierLedgers,
      saleReturns: Array.isArray(sourceStore.saleReturns) ? sourceStore.saleReturns : current.saleReturns,
      purchaseReturns: Array.isArray(sourceStore.purchaseReturns) ? sourceStore.purchaseReturns : current.purchaseReturns,
      expenses: Array.isArray(sourceStore.expenses) ? sourceStore.expenses : current.expenses,
      staffList: Array.isArray(sourceStore.staffList) ? sourceStore.staffList : current.staffList,
      stockHistory: Array.isArray(sourceStore.stockHistory) ? sourceStore.stockHistory : current.stockHistory,
      dailyHisab: sourceStore.dailyHisab || current.dailyHisab,
      categories: Array.isArray(sourceStore.categories) ? sourceStore.categories : current.categories,
      branding: sourceStore.branding || current.branding,
    });

    recordAuditLog('SHOP_BACKUP_RESTORED', actor.actorEmail, actor.role, `Restored backup for shop ${shopId}`, shopId, req.ip);

    broadcastSyncEventToShop(shopId, {
      type: 'store:sync',
      timestamp: Date.now(),
      payload: updated,
    });

    return res.json({ success: true, message: 'Shop backup restored & synchronized.', store: updated });
  });

  // Security & Device Authorization Overview (Scoped per Shop)
  app.get('/api/security/overview', (req: Request, res: Response) => {
    const actor = resolveShopActor(req);
    if (!actor.ok) {
      return res.status(actor.statusCode).json({ success: false, error: actor.error, message: actor.message });
    }
    const shopId = actor.shopId;
    const shopDevs = registeredDevices.filter((d) => (d.shopId || 'SHOP-WM-001') === shopId);
    const shopStore = getShopStore(shopId);
    const shopSseCount = Array.from(sseClients.values()).filter((c) => c.shopId === shopId).length;
    const shopAudit = auditLogs.filter((l) => !l.shopId || l.shopId === shopId).slice(0, 60);

    return res.json({
      success: true,
      deviceAuthorized: true,
      activeDevicesCount: shopDevs.filter((d) => d.status === 'active').length,
      revokedDevicesCount: shopDevs.filter((d) => d.status === 'revoked').length,
      connectedSseClients: shopSseCount,
      syncVersion: shopStore.syncVersion || 1,
      auditLogs: shopAudit,
    });
  });

  // Catch-all for API: guarantees valid JSON response instead of HTML "The page cannot be found..."
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'API_ENDPOINT_NOT_FOUND',
      message: `The API route ${req.method} ${req.path} was not found on WAQAS POS Server.`,
      path: req.path,
    });
  });

  // -------------------------------------------------------------
  // 6. VITE MIDDLEWARE (DEV) & STATIC FILES (PROD)
  // -------------------------------------------------------------
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(process.cwd(), 'dist');

  if (isProd && fs.existsSync(distPath)) {
    console.log('[Server] Production mode: serving static build from /dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.log('[Server] Development mode: mounting Vite middlewares');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[WAQAS MART] Multi-Device Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
