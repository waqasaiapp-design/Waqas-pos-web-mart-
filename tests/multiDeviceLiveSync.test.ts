import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:3000';
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');

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
  return { status: res.status, ok: res.ok, data };
}

async function waitForServerHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become healthy in time');
}

async function runTests() {
  await waitForServerHealth();

  // Snapshot original JSON files before test run
  const snapshotFiles = [
    path.join(DATA_DIR, 'store_db.json'),
    path.join(DATA_DIR, 'devices_db.json'),
    path.join(DATA_DIR, 'audit_logs.json'),
    path.join(DATA_DIR, 'auth_db.json'),
    path.join(DATA_DIR, 'shops', 'SHOP-WM-001.json'),
  ];
  const fileBackups = new Map<string, string>();
  for (const f of snapshotFiles) {
    if (fs.existsSync(f)) {
      fileBackups.set(f, fs.readFileSync(f, 'utf-8'));
    }
  }
  const originalStore = JSON.parse(
    fileBackups.get(path.join(DATA_DIR, 'shops', 'SHOP-WM-001.json')) ||
      fileBackups.get(path.join(DATA_DIR, 'store_db.json')) ||
      '{}'
  );
  const existingBackupDirs = new Set(
    fs.existsSync(path.join(DATA_DIR, 'backups'))
      ? fs.readdirSync(path.join(DATA_DIR, 'backups'))
      : []
  );

  const devAId = `DEV-TEST-A-${Date.now().toString(36).toUpperCase()}`;
  const devBId = `DEV-TEST-B-${Date.now().toString(36).toUpperCase()}`;
  let devAToken = '';
  let devBToken = '';
  let ownerToken = '';
  let sseController: AbortController | null = null;
  const receivedSseTypes: string[] = [];

  try {
    console.log('0. Authenticating Shop Owner via Mart Login (Shop Username + Password)...');
    const loginRes = await jsonReq('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        portal: 'shop',
        identifier: 'waqasmart',
        password: 'ShopOwner@123',
      }),
    });
    assert.equal(loginRes.status, 200, `Shop Owner login should succeed, got ${JSON.stringify(loginRes.data)}`);
    assert.ok(loginRes.data.token, 'Shop Owner login should return Bearer token');
    ownerToken = loginRes.data.token;
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

    console.log('1. Testing Primary Device Registration + Single-Use QR Pairing...');
    const regA = await jsonReq('/api/devices/register-primary', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        device: {
          deviceId: devAId,
          deviceName: 'Test Admin PC',
          deviceType: 'Windows PC',
          browser: 'Chrome Desktop',
          os: 'Windows 11',
        },
      }),
    });
    assert.equal(regA.status, 200, 'Primary device registration should succeed');
    assert.ok(regA.data.sessionToken, 'Primary device should receive sessionToken');
    devAToken = regA.data.sessionToken;

    const pairingReq = await jsonReq('/api/devices/pairing-session', {
      method: 'POST',
      headers: ownerHeaders,
      body: '{}',
    });
    assert.equal(pairingReq.status, 200);
    const { pairingToken, manualCode } = pairingReq.data;
    assert.ok(pairingToken && manualCode);

    const scanB = await jsonReq('/api/devices/pair', {
      method: 'POST',
      body: JSON.stringify({
        tokenOrCode: manualCode,
        device: {
          deviceId: devBId,
          deviceName: 'Test Android Cashier',
          deviceType: 'Android Mobile',
          browser: 'Chrome Mobile',
          os: 'Android',
        },
      }),
    });
    assert.equal(scanB.status, 200, 'Candidate device B pairing request should succeed');

    const approveB = await jsonReq('/api/devices/approve-pairing', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ pairingToken, approve: true }),
    });
    assert.equal(approveB.status, 200, 'Owner approval should succeed');
    assert.ok(approveB.data.device?.sessionToken, 'Approved device B should get sessionToken');
    devBToken = approveB.data.device.sessionToken;

    // Replay single-use QR token must fail with 409 PAIRING_CODE_ALREADY_USED
    const replay = await jsonReq('/api/devices/pair', {
      method: 'POST',
      body: JSON.stringify({
        tokenOrCode: pairingToken,
        device: { deviceId: 'DEV-ROGUE-1', deviceName: 'Rogue', deviceType: 'Web Browser', browser: 'Chrome', os: 'Linux' },
      }),
    });
    assert.equal(replay.status, 409, 'Reusing approved pairing token must return 409');
    assert.equal(replay.data.error, 'PAIRING_CODE_ALREADY_USED');

    console.log('2. Opening live SSE stream on Device B & verifying Purchase (+10, -2) sync...');
    sseController = new AbortController();
    const sseRes = await fetch(
      `${BASE_URL}/api/sync/events?deviceId=${encodeURIComponent(devBId)}&deviceToken=${encodeURIComponent(devBToken)}`,
      { signal: sseController.signal }
    );
    assert.equal(sseRes.status, 200, 'Authorized Device B SSE connection must succeed');
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const pumpSse = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const frames = sseBuffer.split('\n\n');
          sseBuffer = frames.pop() || '';
          for (const frame of frames) {
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine.slice(6));
                if (parsed.type) receivedSseTypes.push(parsed.type);
              } catch {}
            }
          }
        }
      } catch {}
    })();

    // Give initial SSE ping a moment
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(receivedSseTypes.includes('ping'), 'Device B must receive initial SSE ping');

    const devAHeaders = { 'x-device-id': devAId, 'x-device-token': devAToken };
    const devBHeaders = { 'x-device-id': devBId, 'x-device-token': devBToken };

    const testProdId = 'TEST-PROD-SYNC-1';
    const testBarcode = `89999${Date.now().toString().slice(-6)}`;
    const baseProducts = [
      ...(originalStore.products || []),
      {
        id: testProdId,
        name: 'Test Sync Biscuit',
        barcode: testBarcode,
        category: 'Snacks',
        unit: 'Pcs',
        costPrice: 40,
        price: 50,
        stock: 0,
        minStockLevel: 2,
      },
    ];

    const stockRes = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devAHeaders,
      body: JSON.stringify({ action: 'update_stock', payload: baseProducts, sourceDeviceId: devAId }),
    });
    assert.equal(stockRes.status, 200);

    // Purchase +10 units
    const purPlus = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devAHeaders,
      body: JSON.stringify({
        action: 'create_purchase',
        sourceDeviceId: devAId,
        payload: {
          id: `PUR-TEST-1-${Date.now()}`,
          purchaseInvoiceNo: `PINV-TEST-1-${Date.now()}`,
          purchaseDate: '2026-11-19',
          supplierId: 'sup-test',
          supplierName: 'Test Supplier',
          supplierInvoiceNo: 'SUP-1',
          items: [{ id: 'pi-1', productId: testProdId, barcode: testBarcode, productName: 'Test Sync Biscuit', quantity: 10, costPrice: 40, salePrice: 50, taxRate: 0, netAmount: 400, lineTotal: 400 }],
          subtotal: 400,
          totalDiscount: 0,
          totalTax: 0,
          grandTotal: 400,
          amountPaid: 400,
          remainingBalance: 0,
          paymentMethod: 'cash',
          createdAt: new Date().toISOString(),
          status: 'saved',
        },
      }),
    });
    assert.equal(purPlus.status, 200);

    // Negative Purchase adjustment -2 units
    const purMinus = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devAHeaders,
      body: JSON.stringify({
        action: 'create_purchase',
        sourceDeviceId: devAId,
        payload: {
          id: `PUR-TEST-2-${Date.now()}`,
          purchaseInvoiceNo: `PINV-TEST-2-${Date.now()}`,
          purchaseDate: '2026-11-19',
          supplierId: 'sup-test',
          supplierName: 'Test Supplier',
          supplierInvoiceNo: 'SUP-2',
          items: [{ id: 'pi-2', productId: testProdId, barcode: testBarcode, productName: 'Test Sync Biscuit', quantity: -2, costPrice: 40, salePrice: 50, taxRate: 0, netAmount: -80, lineTotal: -80 }],
          subtotal: -80,
          totalDiscount: 0,
          totalTax: 0,
          grandTotal: -80,
          amountPaid: 0,
          remainingBalance: 0,
          paymentMethod: 'cash',
          hasNegativeAdjustment: true,
          createdAt: new Date().toISOString(),
          status: 'saved',
        },
      }),
    });
    assert.equal(purMinus.status, 200);

    console.log('3. Device B performs Credit Sale + overselling guard check...');
    const saleInv = `WM-TEST-${Date.now()}`;
    const saleRes = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devBHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: devBId,
        payload: {
          invoiceNumber: saleInv,
          dateTime: '19 Nov 2026, 03:30 pm',
          mode: 'sale',
          items: [{ id: 'ci-1', product: baseProducts[baseProducts.length - 1], quantity: 3, unitPrice: 50, discountAmount: 0, lineTotal: 150 }],
          subtotal: 150,
          discount: 0,
          taxAmount: 0,
          grandTotal: 150,
          paymentMethod: 'credit',
          cashTendered: 50,
          customerId: 'CUST-TEST-1',
          customerName: 'Ali Khan',
          status: 'completed',
        },
      }),
    });
    assert.equal(saleRes.status, 200);

    const stateAfterSale = await jsonReq('/api/store/state', { headers: devAHeaders });
    assert.equal(stateAfterSale.status, 200);
    const updatedProd = stateAfterSale.data.store.products.find((p: any) => p.id === testProdId);
    assert.equal(updatedProd.stock, 5, 'Stock should be +10 - 2 - 3 = 5 across both devices');
    const udharEntries = stateAfterSale.data.store.customerLedgers.filter((l: any) => l.invoiceNumber === saleInv);
    assert.equal(udharEntries.length, 1);
    assert.equal(udharEntries[0].id, `LED-SALE-${saleInv}`);
    assert.equal(udharEntries[0].credit, 100);

    // Overselling guard
    const oversell = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devBHeaders,
      body: JSON.stringify({
        action: 'create_sale',
        sourceDeviceId: devBId,
        payload: {
          invoiceNumber: `WM-OVER-${Date.now()}`,
          dateTime: '19 Nov 2026',
          mode: 'sale',
          items: [{ id: 'ci-over', product: updatedProd, quantity: 999, unitPrice: 50, discountAmount: 0, lineTotal: 49950 }],
          subtotal: 49950,
          discount: 0,
          taxAmount: 0,
          grandTotal: 49950,
          paymentMethod: 'cash',
          status: 'completed',
        },
      }),
    });
    assert.equal(oversell.status, 400);
    assert.equal(oversell.data.error, 'INSUFFICIENT_STOCK');

    console.log('4. Testing Duplicate Barcode (400) and Stale syncVersion Conflict (409)...');
    const dupRes = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devAHeaders,
      body: JSON.stringify({
        action: 'update_stock',
        sourceDeviceId: devAId,
        payload: [
          { id: 'DUP-1', name: 'Item One', barcode: 'DUPBAR99', category: 'General', unit: 'Pcs', costPrice: 10, price: 20, stock: 1, minStockLevel: 1 },
          { id: 'DUP-2', name: 'Item Two', barcode: 'dupbar99', category: 'General', unit: 'Pcs', costPrice: 10, price: 20, stock: 1, minStockLevel: 1 },
        ],
      }),
    });
    assert.equal(dupRes.status, 400);
    assert.equal(dupRes.data.error, 'DUPLICATE_BARCODE');

    const conflictRes = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devBHeaders,
      body: JSON.stringify({
        action: 'sync_daily_hisab',
        sourceDeviceId: devBId,
        baseSyncVersion: 0,
        enforceConflictCheck: true,
        payload: { '2026-11': { '2026-11-19': { openingCash: 100 } } },
      }),
    });
    const conflictResPositiveBase = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devBHeaders,
      body: JSON.stringify({
        action: 'sync_daily_hisab',
        sourceDeviceId: devBId,
        baseSyncVersion: 1,
        enforceConflictCheck: true,
        payload: { '2026-11': { '2026-11-19': { openingCash: 100 } } },
      }),
    });
    assert.equal(conflictRes.status, 200);
    assert.equal(conflictResPositiveBase.status, 409, 'Stale baseSyncVersion must return 409 CONFLICT');
    assert.equal(conflictResPositiveBase.data.error, 'CONFLICT');

    console.log('5. Verifying SSE event delivery + Shop-Scoped Backup Export/Import round-trip...');
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(receivedSseTypes.includes('stock:updated'), 'SSE must deliver stock:updated');
    assert.ok(receivedSseTypes.includes('purchase:added'), 'SSE must deliver purchase:added');
    assert.ok(receivedSseTypes.includes('sale:completed'), 'SSE must deliver sale:completed');

    const expRes = await jsonReq('/api/shop/backup/export', { headers: ownerHeaders });
    assert.equal(expRes.status, 200);
    assert.ok(expRes.data.backup?.storeDb, 'Export must include shop storeDb snapshot');

    const impRes = await jsonReq('/api/shop/backup/import', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ data: expRes.data.backup.storeDb }),
    });
    assert.equal(impRes.status, 200, 'Shop backup import must succeed');

    console.log('6. Testing Device Revocation, Restore & Permanent Removal Enforcement...');
    const revRes = await jsonReq(`/api/devices/${devBId}/revoke`, {
      method: 'POST',
      headers: ownerHeaders,
      body: '{}',
    });
    assert.equal(revRes.status, 200);

    const blockedSync = await jsonReq('/api/store/sync', {
      method: 'POST',
      headers: devBHeaders,
      body: JSON.stringify({ action: 'sync_expenses', sourceDeviceId: devBId, payload: [] }),
    });
    assert.equal(blockedSync.status, 403, 'Revoked device must receive 403');
    assert.equal(blockedSync.data.error, 'DEVICE_REVOKED');

    const blockedSse = await fetch(
      `${BASE_URL}/api/sync/events?deviceId=${encodeURIComponent(devBId)}&deviceToken=${encodeURIComponent(devBToken)}`
    );
    assert.equal(blockedSse.status, 403, 'Revoked device SSE must be rejected with 403');

    const restRes = await jsonReq(`/api/devices/${devBId}/restore`, {
      method: 'POST',
      headers: ownerHeaders,
      body: '{}',
    });
    assert.equal(restRes.status, 200);

    const restoredState = await jsonReq('/api/store/state', { headers: devBHeaders });
    assert.equal(restoredState.status, 200, 'Restored device must regain access');

    const delB = await jsonReq(`/api/devices/${devBId}`, { method: 'DELETE', headers: ownerHeaders });
    const delA = await jsonReq(`/api/devices/${devAId}`, { method: 'DELETE', headers: ownerHeaders });
    assert.equal(delB.status, 200);
    assert.equal(delA.status, 200);

    const removedCheck = await jsonReq('/api/store/state', { headers: devAHeaders });
    assert.equal(removedCheck.status, 403, 'Removed device must be blocked immediately');

    sseController.abort();
    await pumpSse.catch(() => {});

    console.log('ALL MULTI-DEVICE LIVE SYNC TESTS PASSED SUCCESSFULLY!');
  } finally {
    try {
      sseController?.abort();
    } catch {}

    // Restore clean pre-test store state into running server AND disk files
    if (ownerToken) {
      try {
        await jsonReq('/api/shop/backup/import', {
          method: 'POST',
          headers: { Authorization: `Bearer ${ownerToken}` },
          body: JSON.stringify({ restoredData: { store: originalStore } }),
        });
      } catch {}
    }

    for (const [filePath, content] of fileBackups.entries()) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }

    // Remove temporary safety backup directories created during test restoration
    const backupsDir = path.join(DATA_DIR, 'backups');
    if (fs.existsSync(backupsDir)) {
      for (const name of fs.readdirSync(backupsDir)) {
        if (!existingBackupDirs.has(name) && name.startsWith('safety_')) {
          fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true });
        }
      }
    }
  }
}

runTests().catch((err) => {
  console.error('Multi-device live sync test failed:', err);
  process.exit(1);
});
