import React, { useState, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileJson,
  ShieldCheck,
} from 'lucide-react';
import { StoreFullState } from '../types/pos';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import { syncService, safeFetchJson } from '../utils/syncService';

interface BackupRestorePageProps {
  currentStore: StoreFullState;
  onRestoreApplied: (restored: StoreFullState) => void;
  onBackToHome: () => void;
}

export const BackupRestorePage: React.FC<BackupRestorePageProps> = ({
  currentStore,
  onRestoreApplied,
  onBackToHome,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingRestoreData, setPendingRestoreData] = useState<Partial<StoreFullState> | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const handleDownloadFullBackup = async () => {
    setIsDownloading(true);
    setStatusMessage(null);
    try {
      let exportPayload: any = null;
      try {
        const res = await safeFetchJson('/api/shop/backup/export');
        if (res.ok && res.data?.backup) {
          exportPayload = res.data.backup;
        }
      } catch {
        // Fallback cleanly to current live client store snapshot when offline
      }

      if (!exportPayload) {
        exportPayload = {
          softwareName: 'WAQAS POS SOFTWARE',
          exportedAt: new Date().toISOString(),
          martName: currentStore.branding?.storeName || 'WAQAS MART',
          storeDb: currentStore,
        };
      }

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `WAQAS_POS_FULL_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMessage({
        text: 'Full system JSON backup downloaded safely.',
        type: 'success',
      });
    } catch (e: any) {
      setStatusMessage({
        text: e?.message || 'Failed to generate backup file.',
        type: 'error',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const candidate: Partial<StoreFullState> = parsed.storeDb || parsed.data || parsed;
        if (
          !candidate ||
          (typeof candidate !== 'object') ||
          (!Array.isArray(candidate.products) &&
            !Array.isArray(candidate.transactions) &&
            !Array.isArray(candidate.purchases) &&
            !Array.isArray(candidate.customers) &&
            !Array.isArray(candidate.suppliers))
        ) {
          setStatusMessage({
            text: 'Invalid backup file format. Expected a WAQAS POS JSON backup.',
            type: 'error',
          });
          setPendingRestoreData(null);
          return;
        }
        setPendingRestoreData(candidate);
        setPendingFileName(file.name);
        setStatusMessage({
          text: `Backup "${file.name}" verified and ready for review.`,
          type: 'info',
        });
      } catch {
        setStatusMessage({
          text: 'Could not parse JSON file. Ensure the selected file is a valid backup.',
          type: 'error',
        });
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestoreData) return;
    setIsRestoring(true);
    try {
      const result = await syncService.restoreBackup(pendingRestoreData);
      if (!result.ok) {
        setStatusMessage({
          text: result.message || 'Server restore failed. Please check server connection.',
          type: 'error',
        });
        return;
      }

      const appliedStore = (result.store || pendingRestoreData) as StoreFullState;
      onRestoreApplied(appliedStore);
      setPendingRestoreData(null);
      setPendingFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setStatusMessage({
        text: 'Backup restored successfully to server and synchronized across all connected devices!',
        type: 'success',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="h-full flex flex-col w-full bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      <FullScreenPageHeader
        title="Backup & Restore"
        urduTitle="بیک اپ اور بحالی"
        subtitle="Download verified business snapshots or restore database across all connected terminals"
        icon={<Database className="w-5 h-5" />}
        storeName={currentStore.branding?.storeName || 'WAQAS MART'}
        onBackToHome={onBackToHome}
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-5">
        {statusMessage && (
          <div
            className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : statusMessage.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Current Database Summary */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                Live Business Database Summary
              </h2>
              <p className="text-xs text-slate-500">Everything currently stored & synced in WAQAS MART</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold border border-emerald-200">
              v{currentStore.syncVersion || 1} Live Sync
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-slate-500 block">Products</span>
              <strong className="text-lg font-black text-slate-900">{currentStore.products.length}</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-slate-500 block">Sales Invoices</span>
              <strong className="text-lg font-black text-slate-900">{currentStore.transactions.length}</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-slate-500 block">Purchases</span>
              <strong className="text-lg font-black text-slate-900">{currentStore.purchases.length}</strong>
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-slate-500 block">Customers / Suppliers</span>
              <strong className="text-lg font-black text-slate-900">
                {currentStore.customers.length} / {currentStore.suppliers.length}
              </strong>
            </div>
          </div>
        </div>

        {/* Download & Restore Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Export / Download Backup */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <Download className="w-6 h-6" />
              </div>
              <h3 className="text-base font-black text-slate-900">Download Complete Backup</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Exports all products, stock ledger, sales, purchases, customer Udhaar, supplier ledgers, expenses, Daily Hisab, staff, and receipt settings into a safe JSON file.
              </p>
            </div>

            <button
              type="button"
              onClick={handleDownloadFullBackup}
              disabled={isDownloading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
            >
              {isDownloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>Download JSON Backup</span>
            </button>
          </div>

          {/* Upload & Restore Backup */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2">
              <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
                <Upload className="w-6 h-6" />
              </div>
              <h3 className="text-base font-black text-slate-900">Restore From JSON Backup</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Select a previously downloaded WAQAS POS backup file. All records will be previewed before applying and pushed to all connected devices.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <FileJson className="w-4 h-4 text-amber-400" />
              <span>Select Backup File (.json)</span>
            </button>
          </div>
        </div>

        {/* Pending Restore Confirmation Box */}
        {pendingRestoreData && (
          <div className="bg-amber-50 rounded-3xl border-2 border-amber-300 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-amber-950 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-amber-700" />
                  <span>Confirm Restore from "{pendingFileName}"</span>
                </h4>
                <p className="text-xs text-amber-900 mt-1">
                  Review record counts in this backup before replacing the current live store state:
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div className="bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-slate-500 block">Products</span>
                <strong className="font-black">{pendingRestoreData.products?.length ?? 0}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-slate-500 block">Sales</span>
                <strong className="font-black">{pendingRestoreData.transactions?.length ?? 0}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-slate-500 block">Purchases</span>
                <strong className="font-black">{pendingRestoreData.purchases?.length ?? 0}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-slate-500 block">Customers</span>
                <strong className="font-black">{pendingRestoreData.customers?.length ?? 0}</strong>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-amber-200">
                <span className="text-slate-500 block">Suppliers</span>
                <strong className="font-black">{pendingRestoreData.suppliers?.length ?? 0}</strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingRestoreData(null);
                  setPendingFileName('');
                }}
                className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
              >
                {isRestoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>Apply Restore & Sync All Devices</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
