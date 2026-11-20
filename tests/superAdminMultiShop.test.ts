import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';

let BASE_URL = 'http://127.0.0.1:0';
const PROVISION_SECRET = 'priv-secret-test-999';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      srv.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
}

async function jsonReq(
  urlPath: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Isolated test server did not become healthy within timeout');
}

function extractPostMessagePayload(html: string): any {
  const match = html.match(/var data = (\{[\s\S]*?\});/);
  if (!match) throw new Error('Could not find postMessage payload in callback HTML');
  return JSON.parse(match[1]);
}

async function runTests() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-pos-sa-test-'));

  // Mock Google Token & UserInfo endpoint strictly inside isolated test runner
  const mockUsersByCode = new Map<string, { email: string; sub: string; name: string }>();
  const mockGoogleServer = http.createServer((req, res) => {
    if (req.url === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const code = params.get('code') || '';
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ access_token: `tok-${code}` }));
      });
      return;
    }
    if (req.url === '/userinfo' && req.method === 'GET') {
      const auth = String(req.headers.authorization || '');
      const code = auth.replace(/^Bearer tok-/, '');
      const profile = mockUsersByCode.get(code) || {
        email: 'registered.owner@gmail.com',
        sub: 'google-sub-owner-01',
        name: 'Muhammad Waqas',
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...profile, email_verified: true }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => mockGoogleServer.listen(0, '127.0.0.1', resolve));
  const mockAddr = mockGoogleServer.address() as { port: number };
  const mockGoogleBase = `http://127.0.0.1:${mockAddr.port}`;
  const testPort = await getFreePort();
  BASE_URL = `http://127.0.0.1:${testPort}`;

  let serverProc: ChildProcess | null = null;

  try {
    serverProc = spawn('npx', ['tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(testPort),
        APP_URL: BASE_URL,
        WAQAS_DATA_DIR: tempDir,
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        SUPER_ADMIN_PROVISION_SECRET: PROVISION_SECRET,
        GOOGLE_OAUTH_TOKEN_URL: `${mockGoogleBase}/token`,
        GOOGLE_OAUTH_USERINFO_URL: `${mockGoogleBase}/userinfo`,
      },
      stdio: 'pipe',
    });

    await waitForHealth();

    // 1. Legacy public Super Admin setup & recovery endpoints MUST be disabled (403)
    console.log('1. Checking unauthenticated rejection & disabled public OTP registration routes...');
    const unauthStore = await jsonReq('/api/store/state');
    assert.equal(unauthStore.status, 401, 'Unauthenticated /api/store/state must return 401');

    const unauthSA = await jsonReq('/api/super-admin/overview');
    assert.equal(unauthSA.status, 401, 'Unauthenticated /api/super-admin/overview must return 401');

    const legacySetup = await jsonReq('/api/auth/super-admin/send-setup-otp', {
      method: 'POST',
      body: JSON.stringify({ gmail: 'hack@gmail.com', mobile: '03000000000', password: 'Password123!' }),
    });
    assert.equal(legacySetup.status, 403, 'Legacy public OTP setup endpoint must return 403');
    assert.equal(legacySetup.data.error, 'PUBLIC_REGISTRATION_DISABLED');

    // 2. Private Initial Provisioning with Official Google OAuth Callback + Lock Enforcement
    console.log('2. Testing private Super Admin provisioning via Google OAuth + permanent single-admin lock...');
    const bootBefore = await jsonReq('/api/auth/bootstrap-status');
    assert.equal(bootBefore.data.superAdminConfigured, false);
    assert.equal(bootBefore.data.superAdminSetupLocked, false);

    const badToken = await jsonReq('/api/auth/super-admin/validate-provision-token', {
      method: 'POST',
      body: JSON.stringify({ provisionToken: 'wrong-token' }),
    });
    assert.equal(badToken.status, 403);

    const goodToken = await jsonReq('/api/auth/super-admin/validate-provision-token', {
      method: 'POST',
      body: JSON.stringify({ provisionToken: PROVISION_SECRET }),
    });
    assert.equal(goodToken.status, 200);
    assert.equal(goodToken.data.valid, true);

    const oauthUrlProv = await jsonReq(
      `/api/auth/google/url?purpose=provision&origin=${encodeURIComponent(BASE_URL)}`
    );
    assert.equal(oauthUrlProv.status, 200);
    const provUrlObj = new URL(oauthUrlProv.data.url);
    const provState = provUrlObj.searchParams.get('state')!;
    assert.equal(provUrlObj.searchParams.get('prompt'), 'select_account');

    mockUsersByCode.set('code-prov-1', {
      email: 'registered.owner@gmail.com',
      sub: 'google-sub-owner-01',
      name: 'Muhammad Waqas',
    });
    const cbProvRes = await fetch(
      `${BASE_URL}/api/auth/google/callback?code=code-prov-1&state=${encodeURIComponent(provState)}`
    );
    const cbProvPayload = extractPostMessagePayload(await cbProvRes.text());
    assert.equal(cbProvPayload.type, 'GOOGLE_OAUTH_SUCCESS');

    const provComplete = await jsonReq('/api/auth/super-admin/provision', {
      method: 'POST',
      body: JSON.stringify({
        provisionToken: PROVISION_SECRET,
        googleAssertionToken: cbProvPayload.assertionToken,
        password: 'WaqasPosSecret#99',
        confirmPassword: 'WaqasPosSecret#99',
        fullName: 'Muhammad Waqas',
      }),
    });
    assert.equal(provComplete.status, 200, 'Private provisioning should succeed once');
    assert.equal(provComplete.data.user.role, 'SUPER_ADMIN');
    assert.equal(provComplete.data.user.gmail, 'registered.owner@gmail.com');

    // Second provisioning attempt MUST be permanently blocked (409 SUPER_ADMIN_LOCKED)
    const secondProvUrl = await jsonReq(`/api/auth/google/url?purpose=provision&origin=${encodeURIComponent(BASE_URL)}`);
    assert.equal(secondProvUrl.status, 409);
    assert.equal(secondProvUrl.data.error, 'SUPER_ADMIN_LOCKED');

    const secondProv = await jsonReq('/api/auth/super-admin/provision', {
      method: 'POST',
      body: JSON.stringify({
        provisionToken: PROVISION_SECRET,
        googleAssertionToken: 'GSA-fake',
        password: 'WaqasPosSecret#99',
        confirmPassword: 'WaqasPosSecret#99',
      }),
    });
    assert.equal(secondProv.status, 409);
    assert.equal(secondProv.data.error, 'SUPER_ADMIN_LOCKED');

    // 3. Super Admin Login Verification: Wrong Gmail rejected, Wrong Password rejected, Verified Gmail + Password succeeds
    console.log('3. Testing Super Admin login: rejecting wrong Gmail & wrong WAQAS POS Password...');
    const oauthLoginWrong = await jsonReq(`/api/auth/google/url?purpose=login&origin=${encodeURIComponent(BASE_URL)}`);
    const wrongState = new URL(oauthLoginWrong.data.url).searchParams.get('state')!;
    mockUsersByCode.set('code-wrong-gmail', {
      email: 'stranger@gmail.com',
      sub: 'google-sub-stranger',
      name: 'Stranger',
    });
    const cbWrongRes = await fetch(
      `${BASE_URL}/api/auth/google/callback?code=code-wrong-gmail&state=${encodeURIComponent(wrongState)}`
    );
    const cbWrongPayload = extractPostMessagePayload(await cbWrongRes.text());
    assert.equal(cbWrongPayload.type, 'GOOGLE_OAUTH_ERROR');
    assert.equal(cbWrongPayload.error, 'UNAUTHORIZED_GMAIL');

    // Valid registered Gmail with wrong WAQAS POS password -> 401
    const oauthLoginRight = await jsonReq(`/api/auth/google/url?purpose=login&origin=${encodeURIComponent(BASE_URL)}`);
    const rightState = new URL(oauthLoginRight.data.url).searchParams.get('state')!;
    mockUsersByCode.set('code-right-gmail', {
      email: 'registered.owner@gmail.com',
      sub: 'google-sub-owner-01',
      name: 'Muhammad Waqas',
    });
    const cbRightRes = await fetch(
      `${BASE_URL}/api/auth/google/callback?code=code-right-gmail&state=${encodeURIComponent(rightState)}`
    );
    const cbRightPayload = extractPostMessagePayload(await cbRightRes.text());
    assert.equal(cbRightPayload.type, 'GOOGLE_OAUTH_SUCCESS');

    const badPassLogin = await jsonReq('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({
        googleAssertionToken: cbRightPayload.assertionToken,
        password: 'WrongPassword123',
      }),
    });
    assert.equal(badPassLogin.status, 401);

    const goodSaLogin = await jsonReq('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({
        googleAssertionToken: cbRightPayload.assertionToken,
        password: 'WaqasPosSecret#99',
      }),
    });
    assert.equal(goodSaLogin.status, 200);
    const saHeaders = { Authorization: `Bearer ${goodSaLogin.data.token}` };

    // 4. Create Mart A & Mart B, login by Shop ID & Shop Username, enforce strict cross-shop isolation
    console.log('4. Creating Mart A & Mart B, verifying Shop ID/Username login & strict database isolation...');
    const mismatchMart = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'Bad Mart',
        ownerName: 'Test',
        username: 'badmart',
        password: 'MartPass@1',
        confirmPassword: 'MismatchPassword',
      }),
    });
    assert.equal(mismatchMart.status, 400, 'Password confirmation mismatch must return 400');

    const createMartA = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'LAHORE SUPER MART',
        ownerName: 'Hamza Tariq',
        username: 'lahoremart',
        password: 'LahorePass@1',
        confirmPassword: 'LahorePass@1',
        mobile: '03001112233',
        plan: '12_months',
        status: 'active',
        initialPayment: 14000,
      }),
    });
    assert.equal(createMartA.status, 200);
    const martAId = createMartA.data.shopId;
    assert.ok(martAId && martAId !== 'SHOP-WM-001');

    const createMartB = await jsonReq('/api/super-admin/shops', {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({
        shopName: 'KARACHI BAZAAR',
        ownerName: 'Bilal Sheikh',
        username: 'karachimart',
        password: 'KarachiPass@1',
        confirmPassword: 'KarachiPass@1',
        mobile: '03009998877',
        plan: '6_months',
        status: 'active',
      }),
    });
    assert.equal(createMartB.status, 200);
    const martBId = createMartB.data.shopId;

    // Login Mart A by Shop Username
    const loginByUsername = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'lahoremart', password: 'LahorePass@1' }),
    });
    assert.equal(loginByUsername.status, 200);
    assert.equal(loginByUsername.data.shop.id, martAId);

    // Login Mart B by generated Shop ID
    const loginByShopId = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: martBId, password: 'KarachiPass@1' }),
    });
    assert.equal(loginByShopId.status, 200);
    assert.equal(loginByShopId.data.shop.id, martBId);

    const martAHeaders = { Authorization: `Bearer ${loginByUsername.data.token}` };
    const martBHeaders = { Authorization: `Bearer ${loginByShopId.data.token}` };

    // Shop Owner CANNOT access Super Admin endpoints (403 SUPER_ADMIN_ONLY)
    const ownerHitSuperAdmin = await jsonReq('/api/super-admin/overview', { headers: martAHeaders });
    assert.equal(ownerHitSuperAdmin.status, 403);
    assert.equal(ownerHitSuperAdmin.data.error, 'SUPER_ADMIN_ONLY');

    // Mart A CANNOT read Mart B store via x-shop-id (403 CROSS_SHOP_ACCESS_DENIED)
    const crossShopHit = await jsonReq(`/api/store/state?shopId=${encodeURIComponent(martBId)}`, {
      headers: martAHeaders,
    });
    assert.equal(crossShopHit.status, 403);
    assert.equal(crossShopHit.data.error, 'CROSS_SHOP_ACCESS_DENIED');

    // Sync distinct product into Mart A -> Mart B must NOT see it
    await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: martAHeaders,
      body: JSON.stringify({
        action: 'update_stock',
        sourceDeviceId: 'PC-MART-A',
        payload: [
          {
            id: 'PROD-A-ONLY',
            name: 'Lahore Special Rice 5kg',
            barcode: '888000111',
            category: 'Rice',
            unit: 'Bag',
            costPrice: 1400,
            price: 1650,
            stock: 25,
            minStockLevel: 5,
          },
        ],
      }),
    });
    const martBState = await jsonReq('/api/store/state', { headers: martBHeaders });
    assert.equal(
      martBState.data.store.products.some((p: any) => p.id === 'PROD-A-ONLY'),
      false,
      'Mart B store must remain strictly isolated from Mart A data'
    );

    // 5. Staff RBAC + costPrice privacy + Mart Suspension / Reactivation + Password Reset
    console.log('5. Verifying Staff RBAC privacy, Mart Suspend/Reactivate, and Owner Password Reset...');
    await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: martAHeaders,
      body: JSON.stringify({
        action: 'sync_staff',
        sourceDeviceId: 'PC-MART-A',
        payload: [
          {
            id: 'STF-CASH-A',
            name: 'Cashier Usman',
            employeeId: 'EMP-A1',
            role: 'Cashier',
            department: 'POS',
            shift: 'Morning',
            phone: '03110001122',
            salary: 28000,
            address: 'Lahore',
            joiningDate: '2026-11-01',
            username: 'usman_cashier',
            newPassword: 'CashierPass@1',
            accountStatus: 'active',
            permissions: {
              newSale: true,
              oldSale: false,
              newPurchase: false,
              oldPurchase: false,
              stock: true,
              products: true,
              customers: false,
              suppliers: false,
              dailyHisab: false,
              expenses: false,
              reports: false,
              staff: false,
              settings: false,
              barcode: false,
              canEditPrice: false,
              canGiveDiscount: false,
              canDeleteItems: false,
              canAccessReports: false,
              canAccessSettings: false,
              canAccessLedgers: false,
              canViewCostAndProfit: false,
            },
            createdAt: '2026-11-01',
          },
        ],
      }),
    });

    const staffLogin = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'usman_cashier', password: 'CashierPass@1' }),
    });
    assert.equal(staffLogin.status, 200);
    const staffState = await jsonReq('/api/store/state', {
      headers: { Authorization: `Bearer ${staffLogin.data.token}` },
    });
    assert.equal(
      staffState.data.store.products[0].costPrice,
      0,
      'Server must sanitize product costPrice to 0 when staff lacks canViewCostAndProfit'
    );

    // Suspend Mart A -> active Mart A login blocked with 403 SHOP_ACCOUNT_RESTRICTED
    const susp = await jsonReq(`/api/super-admin/shops/${martAId}/status`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ status: 'suspended' }),
    });
    assert.equal(susp.status, 200);

    const suspendedState = await jsonReq('/api/store/state', { headers: martAHeaders });
    assert.equal(suspendedState.status, 401, 'Session of suspended shop should be invalidated');

    const suspendedLogin = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'lahoremart', password: 'LahorePass@1' }),
    });
    assert.equal(suspendedLogin.status, 403);
    assert.equal(suspendedLogin.data.error, 'SHOP_ACCOUNT_RESTRICTED');

    // Reactivate Mart A & Edit username & Reset password
    await jsonReq(`/api/super-admin/shops/${martAId}/status`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ status: 'active' }),
    });
    await jsonReq(`/api/super-admin/shops/${martAId}`, {
      method: 'PUT',
      headers: saHeaders,
      body: JSON.stringify({ ownerUsername: 'lahoremart_v2' }),
    });
    await jsonReq(`/api/super-admin/shops/${martAId}/reset-password`, {
      method: 'POST',
      headers: saHeaders,
      body: JSON.stringify({ password: 'NewLahorePass@2' }),
    });

    const loginUpdatedOwner = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ portal: 'shop', identifier: 'lahoremart_v2', password: 'NewLahorePass@2' }),
    });
    assert.equal(loginUpdatedOwner.status, 200);

    console.log('ALL SUPER ADMIN GOOGLE OAUTH + MULTI-MART ISOLATION TESTS PASSED 100%!');
  } finally {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGKILL');
    }
    try {
      (mockGoogleServer as any).closeAllConnections?.();
      mockGoogleServer.close();
    } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function b64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signTestJwt(
  payload: Record<string, any>,
  privateKeyPem: string,
  kid = 'test-firebase-kid-1'
): string {
  const header = b64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64Url(JSON.stringify(payload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  signer.end();
  const sig = b64Url(signer.sign(privateKeyPem));
  return `${header}.${body}.${sig}`;
}

async function runFirebaseGoogleProvisionTest() {
  console.log('6. Verifying Firebase Google ID Token cryptographic provisioning, lock, and login...');
  const fbCfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const certsServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(JSON.stringify({ 'test-firebase-kid-1': publicKey }));
  });
  await new Promise<void>((resolve) => certsServer.listen(0, '127.0.0.1', resolve));
  const certsPort = (certsServer.address() as { port: number }).port;

  const fbDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'waqas-pos-fb-test-'));
  const fbTestPort = await getFreePort();
  const fbBaseUrl = `http://127.0.0.1:${fbTestPort}`;
  let fbProc: ChildProcess | null = null;

  const fbReq = async (urlPath: string, options: RequestInit & { headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${fbBaseUrl}${urlPath}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}
    return { status: res.status, ok: res.ok, data };
  };

  try {
    fbProc = spawn('npx', ['tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(fbTestPort),
        APP_URL: fbBaseUrl,
        WAQAS_DATA_DIR: fbDataDir,
        FIREBASE_AUTH_CERTS_URL: `http://127.0.0.1:${certsPort}/certs`,
      },
      stdio: 'pipe',
    });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const h = await fetch(`${fbBaseUrl}/api/health`);
        if (h.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }

    const boot0 = await fbReq('/api/auth/bootstrap-status');
    assert.equal(boot0.status, 200);
    assert.equal(boot0.data.firebaseGoogleAuthConfigured, true);
    assert.equal(boot0.data.googleOAuthConfigured, true);
    assert.equal(boot0.data.superAdminConfigured, false);
    assert.equal(boot0.data.superAdminSetupLocked, false);

    const nowSec = Math.floor(Date.now() / 1000);
    // Reject non-google provider
    const nonGoogleJwt = signTestJwt(
      {
        aud: fbCfg.projectId,
        iss: `https://securetoken.google.com/${fbCfg.projectId}`,
        sub: 'uid-pass-1',
        iat: nowSec - 10,
        exp: nowSec + 3600,
        email: 'owner.sa@gmail.com',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      },
      privateKey
    );
    const badProvider = await fbReq('/api/auth/google/verify-id-token', {
      method: 'POST',
      body: JSON.stringify({ idToken: nonGoogleJwt, purpose: 'provision' }),
    });
    assert.equal(badProvider.status, 401);

    // Verify valid Google Firebase ID token for initial provisioning (WITHOUT ?provision token)
    const ownerJwt = signTestJwt(
      {
        aud: fbCfg.projectId,
        iss: `https://securetoken.google.com/${fbCfg.projectId}`,
        sub: 'google-uid-owner-777',
        iat: nowSec - 10,
        exp: nowSec + 3600,
        email: 'muhammedsaad255251@gmail.com',
        name: 'Muhammad Waqas',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      },
      privateKey
    );
    const verifiedProv = await fbReq('/api/auth/google/verify-id-token', {
      method: 'POST',
      body: JSON.stringify({ idToken: ownerJwt, purpose: 'provision' }),
    });
    assert.equal(verifiedProv.status, 200);
    assert.equal(verifiedProv.data.gmail, 'muhammedsaad255251@gmail.com');
    assert.ok(verifiedProv.data.assertionToken.startsWith('GSA-'));

    // Provision directly (no provisionToken required on first-time setup) -> must lock & NOT bypass login with a session token
    const provRes = await fbReq('/api/auth/super-admin/provision', {
      method: 'POST',
      body: JSON.stringify({
        googleAssertionToken: verifiedProv.data.assertionToken,
        password: 'OwnerPosPass@2026',
        confirmPassword: 'OwnerPosPass@2026',
        fullName: 'Muhammad Waqas',
      }),
    });
    assert.equal(provRes.status, 200);
    assert.equal(provRes.data.superAdminSetupLocked, true);
    assert.equal(provRes.data.token, undefined, 'Provisioning must transition to explicit login screen rather than issuing an unverified login token');

    const bootAfter = await fbReq('/api/auth/bootstrap-status');
    assert.equal(bootAfter.data.superAdminConfigured, true);
    assert.equal(bootAfter.data.superAdminSetupLocked, true);

    // Duplicate provisioning attempt MUST fail with 409 SUPER_ADMIN_LOCKED
    const dupVerify = await fbReq('/api/auth/google/verify-id-token', {
      method: 'POST',
      body: JSON.stringify({ idToken: ownerJwt, purpose: 'provision' }),
    });
    assert.equal(dupVerify.status, 409);
    assert.equal(dupVerify.data.error, 'SUPER_ADMIN_LOCKED');

    // Wrong Gmail login MUST fail with 403 UNAUTHORIZED_GMAIL
    const strangerJwt = signTestJwt(
      {
        aud: fbCfg.projectId,
        iss: `https://securetoken.google.com/${fbCfg.projectId}`,
        sub: 'google-uid-stranger',
        iat: nowSec - 10,
        exp: nowSec + 3600,
        email: 'stranger.user@gmail.com',
        name: 'Stranger',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      },
      privateKey
    );
    const wrongLoginVerify = await fbReq('/api/auth/google/verify-id-token', {
      method: 'POST',
      body: JSON.stringify({ idToken: strangerJwt, purpose: 'login' }),
    });
    assert.equal(wrongLoginVerify.status, 403);
    assert.equal(wrongLoginVerify.data.error, 'UNAUTHORIZED_GMAIL');

    // Valid registered Gmail login -> Verify + Login -> Opens Super Admin Dashboard overview
    const rightLoginVerify = await fbReq('/api/auth/google/verify-id-token', {
      method: 'POST',
      body: JSON.stringify({ idToken: ownerJwt, purpose: 'login' }),
    });
    assert.equal(rightLoginVerify.status, 200);

    const saLoginRes = await fbReq('/api/auth/super-admin/login', {
      method: 'POST',
      body: JSON.stringify({
        googleAssertionToken: rightLoginVerify.data.assertionToken,
        password: 'OwnerPosPass@2026',
      }),
    });
    assert.equal(saLoginRes.status, 200);
    assert.ok(saLoginRes.data.token);
    assert.equal(saLoginRes.data.user.role, 'SUPER_ADMIN');

    const overviewRes = await fbReq('/api/super-admin/overview', {
      headers: { Authorization: `Bearer ${saLoginRes.data.token}` },
    });
    assert.equal(overviewRes.status, 200);
    assert.ok(Array.isArray(overviewRes.data.shops));

    console.log('FIREBASE GOOGLE ID TOKEN PROVISION + LOCK + SUPER ADMIN LOGIN TESTS PASSED 100%!');
  } finally {
    if (fbProc && !fbProc.killed) {
      fbProc.kill('SIGKILL');
    }
    try {
      (certsServer as any).closeAllConnections?.();
      certsServer.close();
    } catch {}
    fs.rmSync(fbDataDir, { recursive: true, force: true });
  }
}

runTests()
  .then(() => runFirebaseGoogleProvisionTest())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Super Admin Multi-Shop test failed:', err);
    process.exit(1);
  });
