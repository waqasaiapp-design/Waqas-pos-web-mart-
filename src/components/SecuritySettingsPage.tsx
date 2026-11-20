import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  Smartphone,
  RefreshCw,
  LogOut,
  CheckCircle2,
  QrCode,
  Activity,
  AlertCircle,
} from 'lucide-react';
import { AuditLogEntry, AuthUser, DeviceInfo, StoreBranding } from '../types/pos';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import { safeFetchJson } from '../utils/apiClient';
import { syncService } from '../utils/syncService';
import { changeAccountPassword } from '../utils/authClient';

interface SecuritySettingsPageProps {
  currentDevice?: DeviceInfo;
  authUser?: AuthUser | null;
  shopName?: string;
  branding?: StoreBranding;
  onSignOut?: () => void;
  onNavigate?: (page: string) => void;
  onBackToHome?: () => void;
}

export const SecuritySettingsPage: React.FC<SecuritySettingsPageProps> = ({
  currentDevice,
  authUser,
  shopName,
  branding,
  onSignOut,
  onNavigate,
  onBackToHome,
}) => {
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [activeDevicesCount, setActiveDevicesCount] = useState<number>(0);
  const [revokedDevicesCount, setRevokedDevicesCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);

  // Change password state (for Shop Owner)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMessage, setPwdMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dev = currentDevice || syncService.getDevice();

  const fetchOverview = async () => {
    setIsLoading(true);
    try {
      const res = await safeFetchJson<{
        success: boolean;
        activeDevicesCount: number;
        revokedDevicesCount: number;
        auditLogs: AuditLogEntry[];
      }>('/api/security/overview');
      if (res.ok && res.data?.success) {
        setActiveDevicesCount(res.data.activeDevicesCount || 0);
        setRevokedDevicesCount(res.data.revokedDevicesCount || 0);
        setAuditLogs(res.data.auditLogs || []);
      }
    } catch {
      // Offline mode preserves last fetched overview
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);
    if (newPassword.length < 6) {
      setPwdMessage({ type: 'error', text: 'New password must be at least 6 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMessage({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }
    setPwdSaving(true);
    try {
      const msg = await changeAccountPassword(currentPassword, newPassword);
      setPwdMessage({ type: 'success', text: msg });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwdMessage({ type: 'error', text: err?.message || 'Unable to change password.' });
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col w-full bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      <FullScreenPageHeader
        title="Security & Account Session"
        urduTitle="سیکیورٹی اور اکاؤنٹ"
        subtitle="Centralized shop-isolated authentication, terminal authorization, and activity logs"
        icon={<ShieldCheck className="w-5 h-5" />}
        storeName={shopName || branding?.storeName || 'WAQAS MART'}
        onBackToHome={onBackToHome}
        actions={
          onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-5xl mx-auto w-full space-y-5">
        {/* Summary Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
              <ShieldCheck className="w-4 h-4" />
              <span>Active Shop Session</span>
            </div>
            <p className="text-sm font-bold text-slate-900 truncate">
              {authUser?.fullName || 'Shop Account'}
            </p>
            <div className="text-xs text-slate-600 space-y-1">
              <div>
                Role: <strong className="text-slate-900">{authUser?.role || 'SHOP_OWNER'}</strong>
              </div>
              {authUser?.username && (
                <div>
                  Username: <span className="font-mono font-semibold">{authUser.username}</span>
                </div>
              )}
              {authUser?.shopId && (
                <div>
                  Shop ID: <span className="font-mono font-semibold">{authUser.shopId}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
            <div className="flex items-center gap-2 text-blue-700 font-bold text-xs">
              <Smartphone className="w-4 h-4" />
              <span>This Terminal Token</span>
            </div>
            <p className="text-sm font-bold text-slate-900 truncate">{dev.deviceName}</p>
            <div className="text-xs text-slate-600 space-y-1">
              <div className="font-mono">{dev.deviceId}</div>
              <div className="flex items-center gap-1 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{dev.sessionToken ? 'Signed Device Token Active' : 'Authenticated Browser Session'}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Shop Terminals</span>
              <button
                type="button"
                onClick={fetchOverview}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
                title="Refresh Security Status"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-slate-500 block">Authorized</span>
                <strong className="text-lg font-bold font-mono tabular-nums text-emerald-700">
                  {activeDevicesCount}
                </strong>
              </div>
              <div>
                <span className="text-slate-500 block">Revoked</span>
                <strong className="text-lg font-bold font-mono tabular-nums text-red-600">
                  {revokedDevicesCount}
                </strong>
              </div>
            </div>
            {onNavigate && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('Device Management')}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Manage Devices
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('QR Code Connection')}
                  className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>QR Connect</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Shop Owner Self-Service Password Update */}
        {authUser?.role === 'SHOP_OWNER' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <KeyRound className="w-4 h-4 text-emerald-700" />
              <span>Change Shop Owner Password</span>
            </div>

            {pwdMessage && (
              <div
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  pwdMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {pwdMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{pwdMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Current Password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">New Password (min 6 chars)</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div className="sm:col-span-3 flex justify-end">
                <button
                  type="submit"
                  disabled={pwdSaving}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {pwdSaving ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Security Audit Logs */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold text-slate-900">
                Recent Shop & Terminal Activity
              </h3>
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">{auditLogs.length} events</span>
          </div>

          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No device or account activity events recorded yet for this shop.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-slate-700">{log.action}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-slate-900">{log.details}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {log.actorEmail} · {log.actorRole}
                    </div>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                    {new Date(log.timestamp).toLocaleString('en-PK')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
