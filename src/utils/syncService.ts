import {
  DeviceInfo,
  SyncEvent,
  SaleTransaction,
  PurchaseTransaction,
  SaleReturn,
  Product,
  Customer,
  CustomerLedgerEntry,
  HeldBill,
  StoreFullState,
  PurchaseReturn,
  ExpenseEntry,
  StaffMember,
  Supplier,
  SupplierLedgerEntry,
  PrinterSettings,
  StockTransaction,
  CategoryInfo,
  DailyHisabRow,
  ReceiptSettings,
  StoreBranding,
  QueuedMutation,
  SyncConflict,
  SyncStatusSnapshot,
  NetworkStatus,
} from '../types/pos';

export type SyncListener = (event: SyncEvent) => void;
export type SyncStatusListener = (snapshot: SyncStatusSnapshot) => void;

export {
  getApiBaseUrl,
  setCustomApiBaseUrl,
  testServerConnection,
  safeFetchJson,
  ApiConnectionError,
} from './apiClient';
import { getApiBaseUrl, safeFetchJson } from './apiClient';

class SyncService {
  private device: DeviceInfo;
  private sse: EventSource | null = null;
  private listeners: Set<SyncListener> = new Set();
  private statusListeners: Set<SyncStatusListener> = new Set();
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private sseConnected: boolean = false;
  private isSyncing: boolean = false;
  private reconnectTimeout: any = null;
  private offlineQueueKey = 'waqas_mart_offline_queue_v2';
  private lastSyncTime: string = 'Never';
  private syncVersion: number = 1;
  private conflicts: SyncConflict[] = [];
  private isFlushing: boolean = false;

  constructor() {
    this.device = this.initDevice();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.emitStatus();
        this.connectSse();
        this.flushOfflineQueue().then(() => {
          this.forceFullSync();
        });
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.sseConnected = false;
        this.closeSse();
        this.emitStatus();
        this.notifyListeners({
          type: 'device:updated',
          timestamp: Date.now(),
          payload: { offline: true },
        });
      });

      // Connect SSE only if already authenticated or paired
      if (this.hasAuthCredentials()) {
        this.connectSse();
      }
    }
  }

  private getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('waqas_pos_session_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.token ? String(parsed.token) : null;
    } catch {
      return null;
    }
  }

  private hasAuthCredentials(): boolean {
    return Boolean(this.getAuthToken() || this.device.sessionToken);
  }

  public clearOfflineQueueForSwitch(): void {
    try {
      localStorage.removeItem(this.offlineQueueKey);
    } catch {}
    this.conflicts = [];
    this.syncVersion = 1;
    this.emitStatus();
  }

  private initDevice(): DeviceInfo {
    const STORAGE_KEY = 'waqas_mart_device_info_v2';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: DeviceInfo = JSON.parse(saved);
        parsed.isCurrentDevice = true;
        return parsed;
      }
    } catch {}

    const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isTablet = typeof navigator !== 'undefined' && /iPad|Tablet/i.test(navigator.userAgent);
    const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);

    const devId = `DEV-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const newDev: DeviceInfo = {
      deviceId: devId,
      deviceName: isTablet
        ? 'Counter Tablet'
        : isMobile
        ? 'Cashier Android Phone'
        : isWindows
        ? 'Windows 11 Main POS'
        : 'Web Workstation',
      deviceType: isTablet
        ? 'Tablet / iPad'
        : isMobile
        ? 'Android Mobile'
        : isWindows
        ? 'Windows PC'
        : 'Web Browser',
      browser:
        typeof navigator !== 'undefined'
          ? navigator.userAgent.includes('Chrome')
            ? 'Chrome Desktop'
            : navigator.userAgent.includes('Edge')
            ? 'Microsoft Edge'
            : navigator.userAgent.includes('Safari')
            ? 'Safari'
            : 'Web Browser'
          : 'Browser',
      os: isMobile
        ? typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? 'iOS'
          : 'Android'
        : isWindows
        ? 'Windows 11'
        : 'Desktop OS',
      isCurrentDevice: true,
      firstRegistered: new Date().toLocaleDateString('en-GB'),
      lastActive: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      status: 'active',
      connectionState: 'online',
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newDev));
    } catch {}

    return newDev;
  }

  private persistDevice() {
    try {
      localStorage.setItem('waqas_mart_device_info_v2', JSON.stringify(this.device));
    } catch {}
  }

  public getDevice(): DeviceInfo {
    return this.device;
  }

  public updateDeviceName(name: string) {
    this.device.deviceName = name;
    this.persistDevice();
  }

  public setSessionToken(token: string) {
    this.device.sessionToken = token;
    this.device.status = 'active';
    this.persistDevice();
    this.emitStatus();
  }

  public getSessionToken(): string | undefined {
    return this.device.sessionToken;
  }

  public getOnlineStatus(): boolean {
    return this.isOnline;
  }

  public getLastSyncTime(): string {
    return this.lastSyncTime;
  }

  public getSyncVersion(): number {
    return this.syncVersion;
  }

  public getStatusSnapshot(): SyncStatusSnapshot {
    const pendingCount = this.getOfflineQueue().length;
    let networkStatus: NetworkStatus = 'online';
    if (!this.isOnline) {
      networkStatus = 'offline';
    } else if (this.device.status === 'revoked' || this.conflicts.length > 0) {
      networkStatus = 'error';
    } else if (this.isSyncing || this.isFlushing) {
      networkStatus = 'syncing';
    }
    return {
      networkStatus,
      isOnline: this.isOnline,
      sseConnected: this.sseConnected,
      pendingCount,
      conflicts: [...this.conflicts],
      lastSyncTime: this.lastSyncTime,
      syncVersion: this.syncVersion,
      isRevoked: this.device.status === 'revoked',
    };
  }

  public subscribeStatus(listener: SyncStatusListener): () => void {
    this.statusListeners.add(listener);
    try {
      listener(this.getStatusSnapshot());
    } catch {}
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus() {
    const snap = this.getStatusSnapshot();
    this.statusListeners.forEach((l) => {
      try {
        l(snap);
      } catch (e) {
        console.error('Status listener error', e);
      }
    });
  }

  public resolveConflict(conflictId: string) {
    this.conflicts = this.conflicts.filter((c) => c.id !== conflictId);
    this.emitStatus();
  }

  public clearConflicts() {
    this.conflicts = [];
    this.emitStatus();
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(event: SyncEvent) {
    this.lastSyncTime = new Date().toLocaleTimeString('en-PK', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    if (event.payload && typeof event.payload.syncVersion === 'number') {
      this.syncVersion = Math.max(this.syncVersion, event.payload.syncVersion);
    }
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in sync listener', err);
      }
    });
    this.emitStatus();
  }

  public async registerPrimaryDevice(): Promise<DeviceInfo | null> {
    if (!this.isOnline || !this.hasAuthCredentials()) return null;
    try {
      const base = getApiBaseUrl();
      const authToken = this.getAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${base}/api/devices/register-primary`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ device: this.device }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data?.error === 'DEVICE_REVOKED') {
        this.device.status = 'revoked';
        this.persistDevice();
        this.emitStatus();
        this.notifyListeners({
          type: 'device:revoked',
          timestamp: Date.now(),
          payload: { deviceId: this.device.deviceId },
        });
        return null;
      }
      if (res.ok && data?.success && data?.device) {
        this.device = {
          ...this.device,
          ...data.device,
          isCurrentDevice: true,
          sessionToken: data.sessionToken || data.device.sessionToken || this.device.sessionToken,
          status: 'active',
        };
        this.persistDevice();
        this.connectSse();
        this.emitStatus();
        return this.device;
      }
    } catch (e) {
      console.warn('Could not register primary device cleanly:', e);
    }
    return null;
  }

  public connectSse() {
    if (typeof window === 'undefined' || !this.isOnline) return;
    if (this.device.status === 'revoked') return;
    if (!this.hasAuthCredentials()) return;
    this.closeSse();

    try {
      const base = getApiBaseUrl();
      const params = new URLSearchParams({ deviceId: this.device.deviceId });
      if (this.device.sessionToken) {
        params.set('deviceToken', this.device.sessionToken);
      }
      const authToken = this.getAuthToken();
      if (authToken) {
        params.set('token', authToken);
      }
      const url = `${base}/api/sync/events?${params.toString()}`;
      this.sse = new EventSource(url);

      this.sse.onopen = () => {
        this.sseConnected = true;
        this.emitStatus();
        // Flush pending offline items once live stream is connected
        this.flushOfflineQueue();
      };

      this.sse.onmessage = (messageEvent) => {
        try {
          const syncEvent: SyncEvent & { syncVersion?: number } = JSON.parse(messageEvent.data);
          if (typeof syncEvent.syncVersion === 'number') {
            this.syncVersion = Math.max(this.syncVersion, syncEvent.syncVersion);
          }

          // If this device was revoked, handle immediate lockout
          if (
            syncEvent.type === 'device:revoked' &&
            syncEvent.payload?.deviceId === this.device.deviceId
          ) {
            this.device.status = 'revoked';
            this.sseConnected = false;
            this.persistDevice();
            this.closeSse();
          }

          this.notifyListeners(syncEvent);
        } catch (e) {
          console.warn('Failed to parse SSE payload', e);
        }
      };

      this.sse.onerror = () => {
        this.sseConnected = false;
        this.closeSse();
        this.emitStatus();
        // Exponential/steady reconnect
        if (!this.reconnectTimeout && this.device.status !== 'revoked') {
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (this.isOnline) this.connectSse();
          }, 4000);
        }
      };
    } catch (e) {
      console.warn('Could not establish SSE connection', e);
    }
  }

  public closeSse() {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    this.sseConnected = false;
  }

  private buildMutationHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-device-id': this.device.deviceId,
    };
    const authToken = this.getAuthToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    if (this.device.sessionToken) {
      headers['x-device-token'] = this.device.sessionToken;
    }
    return headers;
  }

  // -------------------------------------------------------------
  // MUTATION SYNC METHODS (WITH OFFLINE BUFFERING & CONFLICT CHECK)
  // -------------------------------------------------------------
  public async postMutation(
    action: string,
    payload: any,
    options?: { enforceConflictCheck?: boolean }
  ): Promise<any> {
    const baseSyncVersion = this.syncVersion;

    if (!this.isOnline) {
      this.queueOfflineMutation(action, payload, baseSyncVersion);
      return { success: true, offline: true };
    }

    this.isSyncing = true;
    this.emitStatus();

    try {
      const base = getApiBaseUrl();
      const response = await fetch(`${base}/api/store/sync`, {
        method: 'POST',
        headers: this.buildMutationHeaders(),
        body: JSON.stringify({
          action,
          payload,
          sourceDeviceId: this.device.deviceId,
          baseSyncVersion,
          enforceConflictCheck: options?.enforceConflictCheck ?? false,
        }),
      });

      const raw = await response.text();
      let data: any = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {}

      if (!response.ok) {
        if (response.status === 403 && data?.error === 'DEVICE_REVOKED') {
          this.device.status = 'revoked';
          this.persistDevice();
          this.closeSse();
          this.emitStatus();
          this.notifyListeners({
            type: 'device:revoked',
            timestamp: Date.now(),
            payload: { deviceId: this.device.deviceId },
          });
          return {
            success: false,
            error: data?.error || 'DEVICE_REVOKED',
            message: data?.message || 'Device access has been revoked by administrator.',
          };
        }
        if (response.status === 401 || response.status === 403) {
          this.emitStatus();
          return {
            success: false,
            error: data?.error || 'FORBIDDEN',
            message: data?.message || 'Access restricted.',
          };
        }

        if (response.status === 409) {
          const conflict: SyncConflict = {
            id: `CONF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            action,
            message: data?.message || 'Record conflict detected with newer server data.',
            timestamp: Date.now(),
            localPayload: payload,
            serverVersion: data?.serverVersion,
          };
          this.conflicts = [conflict, ...this.conflicts].slice(0, 20);
          if (data?.store) {
            this.notifyListeners({
              type: 'store:sync',
              timestamp: Date.now(),
              payload: data.store,
            });
          } else {
            this.emitStatus();
          }
          return {
            success: false,
            error: 'CONFLICT',
            conflict,
            message: conflict.message,
            store: data?.store,
          };
        }

        if (response.status === 400) {
          this.emitStatus();
          return {
            success: false,
            error: data?.error || 'VALIDATION_ERROR',
            message: data?.message || 'Validation error from server.',
          };
        }

        throw new Error(`Sync request failed with status ${response.status}`);
      }

      if (typeof data?.syncVersion === 'number') {
        this.syncVersion = Math.max(this.syncVersion, data.syncVersion);
      }
      this.lastSyncTime = new Date().toLocaleTimeString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      this.isSyncing = false;
      this.emitStatus();
      return Object.keys(data).length > 0 ? data : { success: true };
    } catch (err) {
      console.warn(`Sync mutation [${action}] failed, saving to offline outbox`, err);
      this.isSyncing = false;
      this.queueOfflineMutation(action, payload, baseSyncVersion);
      return { success: true, offline: true };
    }
  }

  private queueOfflineMutation(action: string, payload: any, baseSyncVersion?: number) {
    try {
      const queue = this.getOfflineQueue();
      const op: QueuedMutation = {
        opId: `OP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action,
        payload,
        timestamp: Date.now(),
        baseSyncVersion,
        retryCount: 0,
      };
      queue.push(op);
      localStorage.setItem(this.offlineQueueKey, JSON.stringify(queue));
      this.emitStatus();
    } catch (e) {
      console.error('Error queuing offline mutation', e);
    }
  }

  public getOfflineQueue(): QueuedMutation[] {
    try {
      const data = localStorage.getItem(this.offlineQueueKey);
      const parsed = data ? JSON.parse(data) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public async flushOfflineQueue(): Promise<{ synced: number; remaining: number; conflicts: number }> {
    const queue = this.getOfflineQueue();
    if (queue.length === 0 || !this.isOnline || this.isFlushing) {
      return { synced: 0, remaining: queue.length, conflicts: this.conflicts.length };
    }

    this.isFlushing = true;
    this.emitStatus();

    const remaining: QueuedMutation[] = [];
    let synced = 0;
    const base = getApiBaseUrl();

    for (const item of queue) {
      try {
        const res = await fetch(`${base}/api/store/sync`, {
          method: 'POST',
          headers: this.buildMutationHeaders(),
          body: JSON.stringify({
            action: item.action,
            payload: item.payload,
            sourceDeviceId: this.device.deviceId,
            baseSyncVersion: item.baseSyncVersion,
            enforceConflictCheck:
              item.action === 'update_purchase' ||
              item.action === 'sync_daily_hisab' ||
              item.action === 'update_stock',
          }),
        });

        const raw = await res.text();
        let data: any = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {}

        if (res.ok) {
          synced++;
          if (typeof data?.syncVersion === 'number') {
            this.syncVersion = Math.max(this.syncVersion, data.syncVersion);
          }
        } else if (res.status === 403) {
          this.device.status = 'revoked';
          this.persistDevice();
          remaining.push({ ...item, retryCount: (item.retryCount || 0) + 1, lastError: data?.message || 'Device revoked' });
        } else if (res.status === 409) {
          // Do not keep retrying conflicting stale mutation forever — surface conflict + pull server state
          this.conflicts = [
            {
              id: `CONF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              action: item.action,
              message: data?.message || `Offline change "${item.action}" conflicted with newer server record.`,
              timestamp: Date.now(),
              localPayload: item.payload,
              serverVersion: data?.serverVersion,
            },
            ...this.conflicts,
          ].slice(0, 20);
          if (data?.store) {
            this.notifyListeners({
              type: 'store:sync',
              timestamp: Date.now(),
              payload: data.store,
            });
          }
        } else if (res.status === 400) {
          // Deterministic business/validation rejection (e.g. duplicate barcode, insufficient stock)
          this.conflicts = [
            {
              id: `CONF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              action: item.action,
              message: data?.message || `Offline change "${item.action}" rejected: validation error.`,
              timestamp: Date.now(),
              localPayload: item.payload,
            },
            ...this.conflicts,
          ].slice(0, 20);
        } else {
          remaining.push({ ...item, retryCount: (item.retryCount || 0) + 1, lastError: `HTTP ${res.status}` });
        }
      } catch (e: any) {
        remaining.push({ ...item, retryCount: (item.retryCount || 0) + 1, lastError: e?.message || 'Network error' });
      }
    }

    try {
      localStorage.setItem(this.offlineQueueKey, JSON.stringify(remaining));
    } catch {}

    this.isFlushing = false;
    this.emitStatus();

    return { synced, remaining: remaining.length, conflicts: this.conflicts.length };
  }

  public async forceFullSync(): Promise<StoreFullState | null> {
    if (!this.isOnline) return null;
    this.isSyncing = true;
    this.emitStatus();
    await this.flushOfflineQueue();
    const store = await this.fetchServerStore();
    this.isSyncing = false;
    if (store) {
      this.notifyListeners({
        type: 'store:sync',
        timestamp: Date.now(),
        payload: store,
      });
    } else {
      this.emitStatus();
    }
    return store;
  }

  // Convenient wrappers for POS actions
  public syncSale(tx: SaleTransaction) {
    return this.postMutation('create_sale', tx);
  }

  public syncPurchase(purchase: PurchaseTransaction) {
    return this.postMutation('create_purchase', purchase);
  }

  public syncPurchaseUpdate(purchase: PurchaseTransaction) {
    return this.postMutation('update_purchase', purchase);
  }

  public syncPurchaseDelete(purchaseId: string) {
    return this.postMutation('delete_purchase', { purchaseId });
  }

  public syncReturn(ret: SaleReturn) {
    return this.postMutation('process_return', ret);
  }

  public syncPurchaseReturn(ret: PurchaseReturn) {
    return this.postMutation('create_purchase_return', ret);
  }

  public syncStock(products: Product[]) {
    return this.postMutation('update_stock', products);
  }

  public syncStockHistory(history: StockTransaction[]) {
    return this.postMutation('sync_stock_history', history);
  }

  public syncCategories(categories: CategoryInfo[]) {
    return this.postMutation('sync_categories', categories);
  }

  public syncDailyHisab(
    dailyHisab: Record<string, Record<string, Partial<DailyHisabRow>>>,
    enforceConflictCheck = false
  ) {
    return this.postMutation('sync_daily_hisab', dailyHisab, { enforceConflictCheck });
  }

  public syncStaff(staffList: StaffMember[]) {
    return this.postMutation('sync_staff', staffList);
  }

  public syncExpenses(expenses: ExpenseEntry[]) {
    return this.postMutation('sync_expenses', expenses);
  }

  public syncSupplierLedgers(suppliers: Supplier[], ledgerEntries: SupplierLedgerEntry[]) {
    return this.postMutation('sync_supplier_ledgers', { suppliers, ledgerEntries });
  }

  public syncPrinterSettings(settings: PrinterSettings) {
    return this.postMutation('sync_printer_settings', settings);
  }

  public syncReceiptSettings(settings: ReceiptSettings) {
    return this.postMutation('sync_receipt_settings', settings);
  }

  public updateBranding(branding: StoreBranding) {
    return this.postMutation('update_branding', branding);
  }

  public syncLedgers(customers: Customer[], ledgerEntries: CustomerLedgerEntry[]) {
    return this.postMutation('update_customer_ledger', { customers, ledgerEntries });
  }

  public syncHeldBills(heldBills: HeldBill[]) {
    return this.postMutation('update_held_bills', heldBills);
  }

  public deleteHeldBill(billId: string) {
    return this.postMutation('delete_held_bill', { billId });
  }

  public async restoreBackup(restoredData: Partial<StoreFullState>): Promise<{ ok: boolean; store?: StoreFullState; message?: string }> {
    try {
      const res = await safeFetchJson<{ success: boolean; store?: StoreFullState; message?: string }>(
        '/api/shop/backup/import',
        {
          method: 'POST',
          body: JSON.stringify({ data: restoredData }),
        }
      );
      if (res.ok && res.data?.success) {
        return { ok: true, store: res.data.store, message: res.data.message };
      }
      return { ok: false, message: res.data?.message || 'Backup restore failed' };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Backup restore failed' };
    }
  }

  public async fetchServerStore(): Promise<StoreFullState | null> {
    if (!this.isOnline || !this.hasAuthCredentials()) return null;
    try {
      const res = await safeFetchJson<{ store: StoreFullState; syncVersion?: number }>('/api/store/state');
      if (res.ok && res.data?.store) {
        if (typeof res.data.syncVersion === 'number') {
          this.syncVersion = Math.max(this.syncVersion, res.data.syncVersion);
        } else if (typeof res.data.store.syncVersion === 'number') {
          this.syncVersion = Math.max(this.syncVersion, res.data.store.syncVersion);
        }
        this.lastSyncTime = new Date().toLocaleTimeString('en-PK', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        this.emitStatus();
        return res.data.store;
      }
    } catch (e: any) {
      if (e?.status === 403 && e?.data?.error === 'DEVICE_REVOKED') {
        this.device.status = 'revoked';
        this.persistDevice();
        this.closeSse();
        this.emitStatus();
        this.notifyListeners({
          type: 'device:revoked',
          timestamp: Date.now(),
          payload: { deviceId: this.device.deviceId },
        });
      } else {
        console.warn('Failed to fetch server store state', e);
      }
    }
    return null;
  }
}

export const syncService = new SyncService();
