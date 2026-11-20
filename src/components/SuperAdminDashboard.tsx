import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Building2,
  CreditCard,
  Smartphone,
  Activity,
  Database,
  Plus,
  Search,
  RefreshCw,
  LogOut,
  KeyRound,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  Calendar,
  Ban,
  Play,
  Pause,
  ShieldCheck,
  X,
  Lock,
} from 'lucide-react';
import {
  AuditLogEntry,
  AuthUser,
  BootstrapAuthStatus,
  DeviceInfo,
  ShopAccount,
  SubscriptionPaymentRecord,
  SubscriptionPlanType,
  SuperAdminAccount,
} from '../types/pos';
import { safeFetchJson } from '../utils/apiClient';
import {
  changeAccountPassword,
  getBootstrapStatus,
  revokeOtherSuperAdminSessions,
} from '../utils/authClient';
import { formatRs } from '../data/defaultProducts';

interface SuperAdminDashboardProps {
  authUser: AuthUser;
  onSignOut: () => void;
}

type AdminTab = 'overview' | 'shops' | 'subscriptions' | 'devices' | 'security' | 'audit' | 'backup';

interface OverviewMetrics {
  totalIncome: number;
  amountReceived: number;
  outstandingBalance: number;
  thisMonthIncome: number;
  thisYearIncome: number;
  totalRenewals: number;
  totalShops: number;
  activeShops: number;
  inactiveShops: number;
  expiringSoon: number;
  expiredShops: number;
  suspendedShops: number;
  totalOwners: number;
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  revokedDevices: number;
}

interface EnrichedShop extends ShopAccount {
  ownerUsername?: string;
  deviceCount?: number;
  onlineDeviceCount?: number;
}

interface EnrichedDevice extends DeviceInfo {
  shopName?: string;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  authUser,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [shops, setShops] = useState<EnrichedShop[]>([]);
  const [payments, setPayments] = useState<SubscriptionPaymentRecord[]>([]);
  const [devices, setDevices] = useState<EnrichedDevice[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [superAdminInfo, setSuperAdminInfo] = useState<SuperAdminAccount | null>(null);
  const [bootstrapInfo, setBootstrapInfo] = useState<BootstrapAuthStatus | null>(null);

  // Filters
  const [shopSearch, setShopSearch] = useState('');
  const [shopStatusFilter, setShopStatusFilter] = useState<string>('all');
  const [auditSearch, setAuditSearch] = useState('');

  // Feedback banner
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Modals
  const [isCreateShopOpen, setIsCreateShopOpen] = useState(false);
  const [createdShopSummary, setCreatedShopSummary] = useState<{
    shopId: string;
    shopName: string;
    ownerName: string;
    ownerUsername: string;
  } | null>(null);
  const [editingShop, setEditingShop] = useState<EnrichedShop | null>(null);
  const [resetPwdShop, setResetPwdShop] = useState<EnrichedShop | null>(null);
  const [extendShop, setExtendShop] = useState<EnrichedShop | null>(null);
  const [paymentShop, setPaymentShop] = useState<EnrichedShop | null>(null);
  const [deleteShop, setDeleteShop] = useState<EnrichedShop | null>(null);
  const [isChangeOwnPwdOpen, setIsChangeOwnPwdOpen] = useState(false);

  // Create / Edit Shop Form State
  const [formShopName, setFormShopName] = useState('');
  const [formOwnerName, setFormOwnerName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formConfirmPassword, setFormConfirmPassword] = useState('');
  const [formEditUsername, setFormEditUsername] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPlan, setFormPlan] = useState<SubscriptionPlanType>('12_months');
  const [formStatus, setFormStatus] = useState<'active' | 'inactive' | 'suspended'>('active');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formInitialPayment, setFormInitialPayment] = useState('0');
  const [formBusy, setFormBusy] = useState(false);

  // Action Modals Form State
  const [newOwnerPwd, setNewOwnerPwd] = useState('');
  const [extendPlan, setExtendPlan] = useState<SubscriptionPlanType>('1_month');
  const [extendDays, setExtendDays] = useState('30');
  const [extendAmount, setExtendAmount] = useState('1500');
  const [extendMethod, setExtendMethod] = useState<'Cash' | 'Easypaisa' | 'JazzCash' | 'Bank Transfer'>('Cash');

  const [payPlan, setPayPlan] = useState<SubscriptionPlanType>('1_month');
  const [payTotal, setPayTotal] = useState('1500');
  const [payPaid, setPayPaid] = useState('1500');
  const [payMethod, setPayMethod] = useState<'Cash' | 'Easypaisa' | 'JazzCash' | 'Bank Transfer'>('Cash');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Own Super Admin password update
  const [ownCurrPwd, setOwnCurrPwd] = useState('');
  const [ownNewPwd, setOwnNewPwd] = useState('');
  const [ownConfirmPwd, setOwnConfirmPwd] = useState('');

  // Backup file upload ref
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingBackupData, setPendingBackupData] = useState<any>(null);
  const [backupFileName, setBackupFileName] = useState('');

  const fetchOverview = async () => {
    setIsLoading(true);
    try {
      const [res, boot] = await Promise.all([
        safeFetchJson('/api/super-admin/overview'),
        getBootstrapStatus().catch(() => null),
      ]);
      if (res.ok && res.data?.success) {
        setMetrics(res.data.metrics);
        setShops(res.data.shops || []);
        setPayments(res.data.payments || []);
        setDevices(res.data.devices || []);
        setAuditLogs(res.data.auditLogs || []);
        setSuperAdminInfo(res.data.superAdmin || null);
      }
      if (boot) setBootstrapInfo(boot);
    } catch (err: any) {
      notify(err?.message || 'Failed to load Super Admin console data.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const filteredShops = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    return shops.filter((s) => {
      if (shopStatusFilter !== 'all' && s.status !== shopStatusFilter) return false;
      if (!q) return true;
      return (
        s.shopName.toLowerCase().includes(q) ||
        s.ownerName.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.ownerUsername || '').toLowerCase().includes(q) ||
        (s.phone || '').includes(q)
      );
    });
  }, [shops, shopSearch, shopStatusFilter]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        (l.shopId || '').toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const openCreateShop = () => {
    setFormShopName('');
    setFormOwnerName('');
    setFormUsername('');
    setFormPassword('');
    setFormConfirmPassword('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormPlan('12_months');
    setFormStatus('active');
    setFormInitialPayment('0');
    setFormBusy(false);
    setIsCreateShopOpen(true);
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formBusy) return;
    if (formPassword.length < 6) {
      notify('Shop Password must be at least 6 characters long.', 'error');
      return;
    }
    if (formPassword !== formConfirmPassword) {
      notify('Shop Password and Confirm Shop Password do not match.', 'error');
      return;
    }
    setFormBusy(true);
    try {
      const res = await safeFetchJson('/api/super-admin/shops', {
        method: 'POST',
        body: JSON.stringify({
          shopName: formShopName.trim(),
          ownerName: formOwnerName.trim(),
          username: formUsername.trim(),
          password: formPassword,
          confirmPassword: formConfirmPassword,
          mobile: formPhone.trim(),
          email: formEmail.trim(),
          address: formAddress.trim(),
          plan: formPlan,
          status: formStatus,
          initialPayment: Number(formInitialPayment) || 0,
        }),
      });
      if (res.ok && res.data?.success) {
        setIsCreateShopOpen(false);
        const createdId = res.data.shopId || res.data.shop?.id || '';
        const createdUser = res.data.ownerUsername || formUsername.trim();
        setCreatedShopSummary({
          shopId: createdId,
          shopName: formShopName.trim(),
          ownerName: formOwnerName.trim(),
          ownerUsername: createdUser,
        });
        notify(`Mart "${formShopName.trim()}" created (${createdId} / Username: ${createdUser}).`);
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'Unable to create mart account.', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const openEditShop = (shop: EnrichedShop) => {
    setEditingShop(shop);
    setFormShopName(shop.shopName);
    setFormOwnerName(shop.ownerName);
    setFormEditUsername(shop.ownerUsername || '');
    setFormPhone(shop.phone || '');
    setFormEmail(shop.email || '');
    setFormAddress(shop.address || '');
    setFormPlan(shop.plan);
    setFormExpiryDate(shop.expiryDate || '');
    setFormBusy(false);
  };

  const handleSaveEditShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShop || formBusy) return;
    setFormBusy(true);
    try {
      const res = await safeFetchJson(`/api/super-admin/shops/${editingShop.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          shopName: formShopName.trim(),
          ownerName: formOwnerName.trim(),
          ownerUsername: formEditUsername.trim() || undefined,
          phone: formPhone.trim(),
          email: formEmail.trim(),
          address: formAddress.trim(),
          plan: formPlan,
          expiryDate: formExpiryDate,
        }),
      });
      if (res.ok) {
        setEditingShop(null);
        notify('Mart account and Shop Owner details updated.');
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to update mart account.', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const handleSetShopStatus = async (shop: EnrichedShop, status: 'active' | 'inactive' | 'suspended' | 'blocked') => {
    try {
      const res = await safeFetchJson(`/api/super-admin/shops/${shop.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        notify(`${shop.shopName} is now ${status}.`);
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'Status update failed.', 'error');
    }
  };

  const handleResetShopPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdShop || formBusy) return;
    setFormBusy(true);
    try {
      const res = await safeFetchJson(`/api/super-admin/shops/${resetPwdShop.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newOwnerPwd }),
      });
      if (res.ok) {
        setResetPwdShop(null);
        setNewOwnerPwd('');
        notify(`Password updated for ${resetPwdShop.shopName}.`);
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to reset password.', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const handleExtendSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendShop || formBusy) return;
    setFormBusy(true);
    try {
      const res = await safeFetchJson(`/api/super-admin/shops/${extendShop.id}/extend-subscription`, {
        method: 'POST',
        body: JSON.stringify({
          plan: extendPlan,
          additionalDays: Number(extendDays) || 30,
          amount: Number(extendAmount) || 0,
          paymentMethod: extendMethod,
        }),
      });
      if (res.ok) {
        setExtendShop(null);
        notify(`Subscription extended for ${extendShop.shopName}.`);
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to extend subscription.', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentShop || formBusy) return;
    setFormBusy(true);
    try {
      const totalAmt = Number(payTotal) || 0;
      const paidAmt = Number(payPaid) || 0;
      const res = await safeFetchJson('/api/super-admin/payments', {
        method: 'POST',
        body: JSON.stringify({
          shopId: paymentShop.id,
          plan: payPlan,
          durationLabel: payPlan.replace('_', ' ').toUpperCase(),
          totalAmount: totalAmt,
          finalAmount: totalAmt,
          amountPaid: paidAmt,
          paymentMethod: payMethod,
          transactionReference: payRef.trim(),
          notes: payNotes.trim(),
        }),
      });
      if (res.ok) {
        setPaymentShop(null);
        setPayRef('');
        setPayNotes('');
        notify(`Recorded payment of ${formatRs(paidAmt)} for ${paymentShop.shopName}.`);
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to record payment.', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const handleDeleteShopConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteShop || formBusy) return;
    setFormBusy(true);
    try {
      const res = await safeFetchJson(`/api/super-admin/shops/${deleteShop.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmText: deleteConfirmText.trim() }),
      });
      if (res.ok) {
        setDeleteShop(null);
        setDeleteConfirmText('');
        notify(`Deleted shop "${deleteShop.shopName}" with pre-delete archive.`);
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'Failed to delete shop.', 'error');
    } finally {
      setFormBusy(false);
    }
  };

  const handleDeviceAction = async (deviceId: string, action: 'revoke' | 'restore' | 'delete') => {
    try {
      if (action === 'delete') {
        await safeFetchJson(`/api/super-admin/devices/${deviceId}`, { method: 'DELETE' });
        notify('Unauthorized device removed.');
      } else {
        await safeFetchJson(`/api/super-admin/devices/${deviceId}/${action}`, { method: 'POST', body: '{}' });
        notify(action === 'revoke' ? 'Device access revoked.' : 'Device access restored.');
      }
      await fetchOverview();
    } catch (err: any) {
      notify(err?.message || 'Device operation failed.', 'error');
    }
  };

  const handleDownloadSystemBackup = async () => {
    try {
      const res = await safeFetchJson('/api/super-admin/backup/export');
      if (res.ok && res.data) {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `WAQAS_POS_SUPERADMIN_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify('Full multi-shop system backup downloaded.');
      }
    } catch (err: any) {
      notify(err?.message || 'Backup export failed.', 'error');
    }
  };

  const handleSelectBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        if (!parsed || (!Array.isArray(parsed.shops) && !parsed.shopDatabases)) {
          notify('Invalid multi-shop Super Admin backup file.', 'error');
          return;
        }
        setPendingBackupData(parsed);
        setBackupFileName(file.name);
      } catch {
        notify('Could not parse JSON backup file.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleApplySystemRestore = async () => {
    if (!pendingBackupData) return;
    try {
      const res = await safeFetchJson('/api/super-admin/backup/import', {
        method: 'POST',
        body: JSON.stringify({ restoredData: pendingBackupData }),
      });
      if (res.ok) {
        setPendingBackupData(null);
        setBackupFileName('');
        if (backupInputRef.current) backupInputRef.current.value = '';
        notify('Multi-shop system backup restored cleanly.');
        await fetchOverview();
      }
    } catch (err: any) {
      notify(err?.message || 'System restore failed.', 'error');
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ownNewPwd.length < 8) {
      notify('WAQAS POS Password must be at least 8 characters long.', 'error');
      return;
    }
    if (ownNewPwd !== ownConfirmPwd) {
      notify('New Password and Confirm Password do not match.', 'error');
      return;
    }
    try {
      const msg = await changeAccountPassword(ownCurrPwd, ownNewPwd);
      setOwnCurrPwd('');
      setOwnNewPwd('');
      setOwnConfirmPwd('');
      setIsChangeOwnPwdOpen(false);
      notify(msg);
      await fetchOverview();
    } catch (err: any) {
      notify(err?.message || 'Password update failed.', 'error');
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      const msg = await revokeOtherSuperAdminSessions();
      notify(msg);
      await fetchOverview();
    } catch (err: any) {
      notify(err?.message || 'Failed to revoke other sessions.', 'error');
    }
  };

  const statusTextColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-emerald-700 font-semibold';
      case 'expiring_soon':
        return 'text-amber-700 font-semibold';
      case 'suspended':
      case 'blocked':
      case 'expired':
        return 'text-red-700 font-semibold';
      default:
        return 'text-slate-600 font-semibold';
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Bar: Clean 3-zone contract */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-6 shrink-0 sticky top-0 z-30">
        <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          WAQAS POS SOFTWARE
        </span>

        <nav className="hidden lg:flex items-center gap-5 text-sm font-medium text-slate-600 overflow-x-auto">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'shops', label: 'Mart Accounts' },
              { id: 'subscriptions', label: 'Subscriptions' },
              { id: 'devices', label: 'Devices' },
              { id: 'security', label: 'Security Settings' },
              { id: 'audit', label: 'Audit Logs' },
              { id: 'backup', label: 'Backup' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className="min-h-[40px] px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Security</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Mobile Navigation Tabs */}
      <div className="lg:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2 overflow-x-auto">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'shops', label: 'Mart Accounts' },
            { id: 'subscriptions', label: 'Subscriptions' },
            { id: 'devices', label: 'Devices' },
            { id: 'security', label: 'Security Settings' },
            { id: 'audit', label: 'Audit Logs' },
            { id: 'backup', label: 'Backup' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Subheader Metadata Strip (Zero-Pill Discipline) */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">
            Super Admin Authority Console
          </span>
          <span aria-hidden="true">·</span>
          <span>{superAdminInfo?.fullName || authUser.fullName}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{superAdminInfo?.gmail || authUser.gmail || authUser.email}</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-700 font-semibold">Google OAuth Verified · Single-Admin Locked</span>
        </div>

        <button
          type="button"
          onClick={fetchOverview}
          className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 font-semibold cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-8 py-6 space-y-6">
        {toast && (
          <div
            role="status"
            className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 ${
              toast.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              )}
              <span>{toast.text}</span>
            </div>
            <button type="button" onClick={() => setToast(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {createdShopSummary && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="font-bold text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>New Mart Account Provisioned: {createdShopSummary.shopName}</span>
              </div>
              <div className="font-mono text-xs text-emerald-900">
                Shop ID: <strong>{createdShopSummary.shopId}</strong> · Shop Owner Username:{' '}
                <strong>{createdShopSummary.ownerUsername}</strong> · Owner: {createdShopSummary.ownerName}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCreatedShopSummary(null)}
              className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 font-semibold text-emerald-900 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">System Overview</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live database metrics across all isolated shops, connected terminals, and PKR subscriptions.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateShop}
                className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Shop</span>
              </button>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Total Shops</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                  {metrics?.totalShops ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {metrics?.totalOwners ?? 0} Registered Owners
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Active Shops</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                  {metrics?.activeShops ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {metrics?.expiringSoon ?? 0} Expiring soon
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Inactive / Suspended</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
                  {(metrics?.inactiveShops ?? 0) + (metrics?.suspendedShops ?? 0) + (metrics?.expiredShops ?? 0)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {metrics?.expiredShops ?? 0} Expired
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Connected Devices</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                  {metrics?.onlineDevices ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {metrics?.offlineDevices ?? 0} Offline · {metrics?.revokedDevices ?? 0} Revoked
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Received (PKR)</div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1 truncate">
                  {formatRs(metrics?.amountReceived ?? 0)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {metrics?.totalRenewals ?? 0} Renewals
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs text-slate-500">Outstanding Due</div>
                <div className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-1 truncate">
                  {formatRs(metrics?.outstandingBalance ?? 0)}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  All shops balance
                </div>
              </div>
            </div>

            {/* Recent Shops & Recent Security Logs Split */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Registered Shops Summary</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('shops')}
                    className="text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
                  >
                    Manage All
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {shops.slice(0, 6).map((s) => (
                    <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          {s.shopName} <span className="font-mono text-slate-500">({s.id})</span>
                        </div>
                        <div className="text-slate-500 truncate">
                          {s.ownerName} · User: {s.ownerUsername || s.email} · {s.onlineDeviceCount || 0}/{s.deviceCount || 0} online
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={statusTextColor(s.status)}>{s.status.toUpperCase()}</div>
                        <div className="font-mono tabular-nums text-slate-500">{s.expiryDate}</div>
                      </div>
                    </div>
                  ))}
                  {shops.length === 0 && (
                    <div className="p-8 text-center text-xs text-slate-500">
                      No shops registered yet. Create your first shop account above.
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Recent Account Activity</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('audit')}
                    className="text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
                  >
                    View Full Log
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {auditLogs.slice(0, 6).map((log) => (
                    <div key={log.id} className="px-5 py-3 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{log.details}</div>
                        <div className="text-slate-500 font-mono truncate">
                          {log.action} · {log.actorEmail}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                        {new Date(log.timestamp).toLocaleDateString('en-PK')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SHOPS & OWNERS */}
        {activeTab === 'shops' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Shop Owner Accounts</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Each shop operates on a strictly isolated database partition.
                </p>
              </div>
              <button
                type="button"
                onClick={openCreateShop}
                className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Shop Account</span>
              </button>
            </div>

            {/* Search & Status Filter */}
            <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={shopSearch}
                  onChange={(e) => setShopSearch(e.target.value)}
                  placeholder="Search shop name, Shop ID, owner, username, or mobile..."
                  className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-slate-900"
                />
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                {['all', 'active', 'inactive', 'suspended', 'expired'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setShopStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize whitespace-nowrap cursor-pointer ${
                      shopStatusFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Shops Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Shop ID & Name</th>
                      <th className="py-3 px-4">Owner & Login</th>
                      <th className="py-3 px-4">Plan & Expiry</th>
                      <th className="py-3 px-4 text-right">Due (PKR)</th>
                      <th className="py-3 px-4">Devices</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredShops.map((shop) => (
                      <tr key={shop.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{shop.shopName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{shop.id}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-800">{shop.ownerName}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {shop.ownerUsername || shop.email} · {shop.phone || 'No Phone'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-800">{shop.plan.replace('_', ' ')}</div>
                          <div className="font-mono tabular-nums text-[11px] text-slate-500">
                            Exp: {shop.expiryDate}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {formatRs(shop.remainingBalance || 0)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                          {shop.onlineDeviceCount || 0} online / {shop.deviceCount || 0} active
                        </td>
                        <td className="py-3 px-4">
                          <span className={statusTextColor(shop.status)}>{shop.status.toUpperCase()}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openEditShop(shop)}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1"
                              title="Edit Shop"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>

                            {shop.status === 'active' || shop.status === 'expiring_soon' ? (
                              <button
                                type="button"
                                onClick={() => handleSetShopStatus(shop, 'suspended')}
                                className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1"
                              >
                                <Pause className="w-3 h-3" />
                                <span>Suspend</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetShopStatus(shop, 'active')}
                                className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1"
                              >
                                <Play className="w-3 h-3" />
                                <span>Activate</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setResetPwdShop(shop);
                                setNewOwnerPwd('');
                              }}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1"
                            >
                              <KeyRound className="w-3 h-3" />
                              <span>Reset Pwd</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setExtendShop(shop);
                                setExtendPlan(shop.plan);
                                setExtendDays('30');
                                setExtendAmount('1500');
                              }}
                              className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1"
                            >
                              <Calendar className="w-3 h-3" />
                              <span>Extend</span>
                            </button>

                            {shop.id !== 'SHOP-WM-001' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteShop(shop);
                                  setDeleteConfirmText('');
                                }}
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                                title="Delete Shop"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredShops.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-500">
                          No shops match your search criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SUBSCRIPTIONS & PAYMENTS (PKR) */}
        {activeTab === 'subscriptions' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Subscriptions & Payment Records (PKR)</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verified payment tracking and expiry management per shop.
                </p>
              </div>
            </div>

            {/* Shop Subscriptions Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h2 className="text-sm font-bold text-slate-900">Shop Subscription Billing</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Shop</th>
                      <th className="py-3 px-4">Plan</th>
                      <th className="py-3 px-4">Start · Expiry</th>
                      <th className="py-3 px-4 text-right">Paid (PKR)</th>
                      <th className="py-3 px-4 text-right">Remaining (PKR)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Billing Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shops.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{s.shopName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{s.id}</div>
                        </td>
                        <td className="py-3 px-4 font-medium">{s.plan.replace('_', ' ')}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600">
                          {s.startDate} → {s.expiryDate}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                          {formatRs(s.totalPaid || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700 font-semibold">
                          {formatRs(s.remainingBalance || 0)}
                        </td>
                        <td className="py-3 px-4">
                          <span className={statusTextColor(s.status)}>{s.status.toUpperCase()}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentShop(s);
                                setPayPlan(s.plan);
                                setPayTotal('1500');
                                setPayPaid('1500');
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold cursor-pointer"
                            >
                              Record Payment
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setExtendShop(s);
                                setExtendPlan(s.plan);
                                setExtendDays('30');
                                setExtendAmount('1500');
                              }}
                              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold cursor-pointer"
                            >
                              Extend Expiry
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Verified Payment Receipts */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h2 className="text-sm font-bold text-slate-900">Confirmed PKR Payment Receipts</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Receipt #</th>
                      <th className="py-3 px-4">Shop</th>
                      <th className="py-3 px-4">Method & Date</th>
                      <th className="py-3 px-4 text-right">Amount Paid</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-semibold text-slate-900">{p.receiptNumber}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{p.shopName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{p.shopId}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {p.paymentMethod} · <span className="font-mono">{p.paymentDate}</span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                          {formatRs(p.amountPaid)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">{p.status}</td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No subscription payments recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: DEVICES MONITOR */}
        {activeTab === 'devices' && (
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Registered Terminals Across All Shops</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Monitor live SSE connections, revoke unauthorized phones/PCs, or permanently remove terminals.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-3 px-4">Shop</th>
                      <th className="py-3 px-4">Device Name & ID</th>
                      <th className="py-3 px-4">Platform / Browser</th>
                      <th className="py-3 px-4">Connection</th>
                      <th className="py-3 px-4">Authorization</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {devices.map((d) => (
                      <tr key={d.deviceId} className="hover:bg-slate-50">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{d.shopName || 'WAQAS MART'}</div>
                          <div className="font-mono text-[11px] text-slate-500">{d.shopId || 'SHOP-WM-001'}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{d.deviceName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{d.deviceId}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {d.deviceType} · {d.os} · {d.browser}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={
                              d.connectionState === 'online'
                                ? 'text-emerald-700 font-semibold'
                                : 'text-slate-500'
                            }
                          >
                            {d.connectionState === 'online' ? 'Connected' : 'Offline'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={statusTextColor(d.status)}>{d.status.toUpperCase()}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex gap-1.5">
                            {d.status === 'active' ? (
                              <button
                                type="button"
                                onClick={() => handleDeviceAction(d.deviceId, 'revoke')}
                                className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-semibold cursor-pointer"
                              >
                                Revoke
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDeviceAction(d.deviceId, 'restore')}
                                className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-semibold cursor-pointer"
                              >
                                Restore
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeviceAction(d.deviceId, 'delete')}
                              className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-semibold cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {devices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          No registered terminals found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SECURITY SETTINGS */}
        {activeTab === 'security' && (
          <div className="space-y-6 max-w-4xl">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Super Admin Security Settings</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Single-Admin protection lock, verified Google OAuth binding, and separate WAQAS POS Password management.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 text-xs">
                <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span>Permanent Google Identity Lock</span>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100">
                    <span className="text-slate-500">Registered Gmail</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {superAdminInfo?.gmail || authUser.gmail}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100">
                    <span className="text-slate-500">Google OAuth Status</span>
                    <span className="font-semibold text-emerald-700">Verified & Enforced</span>
                  </div>
                  <div className="flex justify-between gap-2 py-1.5 border-b border-slate-100">
                    <span className="text-slate-500">Public Registration</span>
                    <span className="font-semibold text-emerald-700">Permanently Locked</span>
                  </div>
                  <div className="flex justify-between gap-2 py-1.5">
                    <span className="text-slate-500">Account Created</span>
                    <span className="font-mono text-slate-700">
                      {superAdminInfo?.createdAt
                        ? new Date(superAdminInfo.createdAt).toLocaleDateString('en-PK')
                        : 'Active'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRevokeOtherSessions}
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 font-bold text-xs cursor-pointer"
                >
                  Terminate All Other Active Super Admin Sessions
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-900" />
                  <span>Change Separate WAQAS POS Password</span>
                </div>
                <form onSubmit={handleChangeOwnPassword} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Current WAQAS POS Password</label>
                    <input
                      type="password"
                      required
                      value={ownCurrPwd}
                      onChange={(e) => setOwnCurrPwd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">New Password (min 8 chars)</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={ownNewPwd}
                      onChange={(e) => setOwnNewPwd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={ownConfirmPwd}
                      onChange={(e) => setOwnConfirmPwd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold cursor-pointer"
                  >
                    Update WAQAS POS Password
                  </button>
                </form>
              </div>
            </div>

            {bootstrapInfo?.googleRedirectUris && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2 text-xs">
                <div className="font-bold text-slate-900">Google OAuth Authorized Redirect URIs</div>
                <div className="font-mono text-slate-700 break-all">{bootstrapInfo.googleRedirectUris.dev}</div>
                <div className="font-mono text-slate-700 break-all">{bootstrapInfo.googleRedirectUris.shared}</div>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Security & Activity Audit Logs</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chronological log of Super Admin actions, shop logins, device pairings, and revocations.
                </p>
              </div>
              <div className="relative min-w-[260px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Filter by action, actor, or shop ID..."
                  className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                {filteredAuditLogs.map((log) => (
                  <div key={log.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900">{log.details}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {log.action} · {log.actorEmail} ({log.actorRole})
                        {log.shopId ? ` · ${log.shopId}` : ''}
                      </div>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                      {new Date(log.timestamp).toLocaleString('en-PK')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: SYSTEM BACKUP */}
        {activeTab === 'backup' && (
          <div className="space-y-5 max-w-4xl">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Multi-Shop System Backup & Restore</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Export or restore all shop accounts, shop databases, subscriptions, and payment receipts. Automatic safety snapshots are created before any restore.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-700" />
                  <span>Export Full System Snapshot</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Downloads a single verified JSON archive containing all {shops.length} shop databases, subscription plans, and payment logs.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadSystemBackup}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Full System JSON</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-slate-800" />
                  <span>Restore From System Backup</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Upload a previously exported Super Admin system backup JSON to restore shop accounts and isolated store files.
                </p>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleSelectBackupFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>Select System Backup File</span>
                </button>
              </div>
            </div>

            {pendingBackupData && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3 text-xs">
                <div className="font-bold text-amber-950">
                  Ready to restore "{backupFileName}" ({pendingBackupData.shops?.length || 0} shops included)
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingBackupData(null);
                      setBackupFileName('');
                    }}
                    className="px-4 py-2 bg-white border border-slate-300 rounded-lg font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApplySystemRestore}
                    className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
                  >
                    Confirm & Restore System
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL: CREATE MART ACCOUNT */}
      {isCreateShopOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-slate-200 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-slate-900 text-base">Create New Mart Account</h3>
              <button type="button" onClick={() => setIsCreateShopOpen(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateShop} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mart Name *</label>
                  <input
                    type="text"
                    required
                    value={formShopName}
                    onChange={(e) => setFormShopName(e.target.value)}
                    placeholder="e.g. MART 2"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mart Owner Name *</label>
                  <input
                    type="text"
                    required
                    value={formOwnerName}
                    onChange={(e) => setFormOwnerName(e.target.value)}
                    placeholder="e.g. Ali Raza"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shop Username *</label>
                  <input
                    type="text"
                    required
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="e.g. mart2owner"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mobile Number (Optional)</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="03001234567"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shop Password (min 6) *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Shop owner password"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Confirm Shop Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={formConfirmPassword}
                    onChange={(e) => setFormConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Plan</label>
                  <select
                    value={formPlan}
                    onChange={(e) => setFormPlan(e.target.value as SubscriptionPlanType)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                  >
                    <option value="1_month">1 Month (Rs. 1,500)</option>
                    <option value="3_months">3 Months (Rs. 4,000)</option>
                    <option value="6_months">6 Months (Rs. 7,500)</option>
                    <option value="12_months">12 Months (Rs. 14,000)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Paid (PKR)</label>
                  <input
                    type="number"
                    min={0}
                    value={formInitialPayment}
                    onChange={(e) => setFormInitialPayment(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Shop Address</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="Market, City"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCreateShopOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formBusy}
                  className="px-5 py-2 rounded-lg bg-slate-900 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {formBusy ? 'Creating...' : 'Create Mart Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT MART ACCOUNT */}
      {editingShop && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-slate-900 text-base">Edit Mart: {editingShop.shopName}</h3>
              <button type="button" onClick={() => setEditingShop(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEditShop} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mart Name *</label>
                <input type="text" required value={formShopName} onChange={(e) => setFormShopName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Owner Name *</label>
                  <input type="text" required value={formOwnerName} onChange={(e) => setFormOwnerName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Shop Username *</label>
                  <input type="text" required value={formEditUsername} onChange={(e) => setFormEditUsername(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mobile</label>
                  <input type="tel" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Expiry Date</label>
                  <input type="date" value={formExpiryDate} onChange={(e) => setFormExpiryDate(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input type="text" value={formAddress} onChange={(e) => setFormAddress(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setEditingShop(null)} className="px-4 py-2 rounded-lg border border-slate-200 font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={formBusy} className="px-5 py-2 rounded-lg bg-slate-900 text-white font-bold cursor-pointer">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET SHOP OWNER PASSWORD */}
      {resetPwdShop && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-slate-900 text-sm">Reset Password — {resetPwdShop.shopName}</h3>
              <button type="button" onClick={() => setResetPwdShop(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleResetShopPassword} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">New Owner Password (min 6 chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newOwnerPwd}
                  onChange={(e) => setNewOwnerPwd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setResetPwdShop(null)} className="px-4 py-2 border border-slate-200 rounded-lg font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={formBusy} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold cursor-pointer">
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXTEND SUBSCRIPTION */}
      {extendShop && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-slate-900 text-sm">Extend Plan — {extendShop.shopName}</h3>
              <button type="button" onClick={() => setExtendShop(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleExtendSubscription} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Plan</label>
                <select value={extendPlan} onChange={(e) => setExtendPlan(e.target.value as SubscriptionPlanType)} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white">
                  <option value="1_month">1 Month (30 days)</option>
                  <option value="3_months">3 Months (90 days)</option>
                  <option value="6_months">6 Months (180 days)</option>
                  <option value="12_months">12 Months (365 days)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Additional Days</label>
                  <input type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Paid Amount (PKR)</label>
                  <input type="number" min={0} value={extendAmount} onChange={(e) => setExtendAmount(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                <select value={extendMethod} onChange={(e) => setExtendMethod(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white">
                  <option value="Cash">Cash</option>
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setExtendShop(null)} className="px-4 py-2 border border-slate-200 rounded-lg font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={formBusy} className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer">
                  Confirm Renewal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECORD PAYMENT */}
      {paymentShop && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-slate-900 text-sm">Record Payment — {paymentShop.shopName}</h3>
              <button type="button" onClick={() => setPaymentShop(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Total Fee (PKR)</label>
                  <input type="number" min={0} required value={payTotal} onChange={(e) => setPayTotal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Received (PKR)</label>
                  <input type="number" min={0} required value={payPaid} onChange={(e) => setPayPaid(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)} className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white">
                  <option value="Cash">Cash</option>
                  <option value="Easypaisa">Easypaisa</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transaction Reference</label>
                <input type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Optional TRX ID" className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setPaymentShop(null)} className="px-4 py-2 border border-slate-200 rounded-lg font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={formBusy} className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer">
                  Save Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: STRONG CONFIRMATION SHOP DELETE */}
      {deleteShop && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl border border-red-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-red-700 text-base">Delete Shop Account</h3>
              <button type="button" onClick={() => setDeleteShop(null)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleDeleteShopConfirm} className="space-y-4 text-xs">
              <p className="text-slate-700 leading-relaxed">
                This will remove shop <strong>{deleteShop.shopName}</strong> (<span className="font-mono">{deleteShop.id}</span>), disconnect all its devices, and archive its database snapshot. Type <strong className="font-mono text-red-700">{deleteShop.id}</strong> to confirm deletion:
              </p>
              <input
                type="text"
                required
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteShop.id}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDeleteShop(null)} className="px-4 py-2 border border-slate-200 rounded-lg font-semibold cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formBusy || deleteConfirmText.trim() !== deleteShop.id}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold cursor-pointer disabled:opacity-40"
                >
                  Permanently Delete Shop
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CHANGE SUPER ADMIN OWN PASSWORD */}
      {isChangeOwnPwdOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-bold text-slate-900 text-sm">Change Super Admin Password</h3>
              <button type="button" onClick={() => setIsChangeOwnPwdOpen(false)} className="text-slate-400 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleChangeOwnPassword} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Current Password</label>
                <input type="password" required value={ownCurrPwd} onChange={(e) => setOwnCurrPwd(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">New Password (min 8 chars)</label>
                <input type="password" required minLength={8} value={ownNewPwd} onChange={(e) => setOwnNewPwd(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Confirm New Password</label>
                <input type="password" required minLength={8} value={ownConfirmPwd} onChange={(e) => setOwnConfirmPwd(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsChangeOwnPwdOpen(false)} className="px-4 py-2 border border-slate-200 rounded-lg font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold cursor-pointer">
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
