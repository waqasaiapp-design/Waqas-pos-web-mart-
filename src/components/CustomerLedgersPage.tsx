import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Users,
  Search,
  Plus,
  ArrowLeft,
  Phone,
  MapPin,
  Calendar,
  CreditCard,
  Banknote,
  DollarSign,
  TrendingDown,
  TrendingUp,
  FileText,
  Printer,
  Download,
  Trash2,
  Edit2,
  Camera,
  Image,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Filter,
  Share2,
  FileSpreadsheet,
  X,
} from 'lucide-react';
import { Customer, CustomerLedgerEntry, StoreBranding } from '../types/pos';
import { formatRs } from '../data/defaultProducts';
import { WaqasBrandingCard } from './WaqasBrandingCard';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import {
  printAllCustomersLedgerSummary,
  printCustomerLedgerReport,
} from '../utils/printerService';

interface CustomerLedgersPageProps {
  customers: Customer[];
  ledgerEntries: CustomerLedgerEntry[];
  branding?: StoreBranding;
  initialTab?: 'customers' | 'udhaar' | 'ledger';
  onSaveCustomer: (customer: Customer) => void;
  onDeleteCustomer: (customerId: string) => void;
  onSaveLedgerEntry: (entry: CustomerLedgerEntry) => void;
  onDeleteLedgerEntry: (entryId: string) => void;
  onDeleteAllCustomers?: () => void;
  initialSelectedCustomerId?: string | null;
  onBackToPos?: () => void;
  onNavigateToDailyHisab?: () => void;
  onBackToHome?: () => void;
}

export const CustomerLedgersPage: React.FC<CustomerLedgersPageProps> = ({
  customers,
  ledgerEntries,
  branding,
  initialTab = 'udhaar',
  onSaveCustomer,
  onDeleteCustomer,
  onSaveLedgerEntry,
  onDeleteLedgerEntry,
  onDeleteAllCustomers,
  initialSelectedCustomerId = null,
  onBackToPos,
  onNavigateToDailyHisab,
  onBackToHome,
}) => {
  // Selected customer for Individual Ledger View (null = All Customers Grand Ledger)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialSelectedCustomerId);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'balance' | 'name' | 'recent'>('balance');
  const [onlyWithUdhaar, setOnlyWithUdhaar] = useState<boolean>(initialTab === 'udhaar');

  useEffect(() => {
    setOnlyWithUdhaar(initialTab === 'udhaar');
  }, [initialTab]);

  // Modals state
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [entryType, setEntryType] = useState<'credit' | 'debit'>('credit'); // credit = udhar given, debit = recovery received
  const [editingEntry, setEditingEntry] = useState<CustomerLedgerEntry | null>(null);

  // Print Modals
  const [isCustomerBillModalOpen, setIsCustomerBillModalOpen] = useState(false);
  const [isAllUdharModalOpen, setIsAllUdharModalOpen] = useState(false);
  const [customerToPreview, setCustomerToPreview] = useState<Customer | null>(null);

  // Customer Form state
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custPrevBalance, setCustPrevBalance] = useState<number | ''>(0);
  const [custPhotoUrl, setCustPhotoUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ledger Entry Form state
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [entryDetails, setEntryDetails] = useState('');
  const [entryAmount, setEntryAmount] = useState<number | ''>('');
  const [entryPaymentMethod, setEntryPaymentMethod] = useState('Cash');

  // Success Feedback & Printing & Inline Confirmation State
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [entryToDeleteId, setEntryToDeleteId] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  // Compute calculated statistics for all customers
  const customersWithStats = useMemo(() => {
    return customers.map((c) => {
      const cEntries = ledgerEntries.filter((e) => e.customerId === c.id);
      let totalCredit = 0;
      let totalDebit = 0;
      let lastDate = c.createdAt ? c.createdAt.split(',')[0] : '';

      for (const e of cEntries) {
        totalCredit += Number(e.credit) || 0;
        totalDebit += Number(e.debit) || 0;
        if (e.date) lastDate = e.date;
      }

      const currentBalance = (Number(c.previousBalance) || 0) + totalCredit - totalDebit;

      return {
        ...c,
        totalCredit,
        totalDebit,
        currentBalance,
        lastDate,
        entriesCount: cEntries.length,
      };
    });
  }, [customers, ledgerEntries]);

  // Grand summary figures for Page 2 Header Cards
  const grandSummary = useMemo(() => {
    let totalOutstanding = 0;
    let totalGiven = 0;
    let totalReceived = 0;
    let totalPreviousBalance = 0;

    for (const c of customersWithStats) {
      totalOutstanding += c.currentBalance;
      totalGiven += c.totalCredit;
      totalReceived += c.totalDebit;
      totalPreviousBalance += Number(c.previousBalance) || 0;
    }

    return {
      totalCustomers: customers.length,
      totalOutstanding,
      totalGiven,
      totalReceived,
      totalPreviousBalance,
    };
  }, [customersWithStats, customers]);

  // Filtered and sorted customers list
  const filteredCustomers = useMemo(() => {
    return customersWithStats
      .filter((c) => {
        if (onlyWithUdhaar && c.currentBalance <= 0 && c.entriesCount === 0 && customersWithStats.some((x) => x.currentBalance > 0)) {
          return false;
        }
        const q = searchQuery.toLowerCase().trim();
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)) ||
          (c.address && c.address.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'balance') return b.currentBalance - a.currentBalance;
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        return 0;
      });
  }, [customersWithStats, searchQuery, sortBy, onlyWithUdhaar]);

  // Active selected customer details
  const activeCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customersWithStats.find((c) => c.id === selectedCustomerId) || null;
  }, [selectedCustomerId, customersWithStats]);

  // Entries for the active customer with calculated running balance
  const activeCustomerEntries = useMemo(() => {
    if (!activeCustomer) return [];

    const rawEntries = ledgerEntries
      .filter((e) => e.customerId === activeCustomer.id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = Number(activeCustomer.previousBalance) || 0;

    return rawEntries.map((e) => {
      const credit = Number(e.credit) || 0;
      const debit = Number(e.debit) || 0;
      running = running + credit - debit;
      return {
        ...e,
        runningBalance: running,
      };
    });
  }, [activeCustomer, ledgerEntries]);

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setFormError('Photo size is too large (max 2MB).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const dataUrl = uploadEvent.target?.result as string;
      setCustPhotoUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Open Create Customer Modal
  const openNewCustomerModal = () => {
    setFormError(null);
    setEditingCustomer(null);
    setCustName('');
    setCustPhone('');
    setCustAddress('');
    setCustPrevBalance(0);
    setCustPhotoUrl('');
    setIsCustomerModalOpen(true);
  };

  // Open Edit Customer Modal
  const openEditCustomerModal = (customer: Customer) => {
    setFormError(null);
    setEditingCustomer(customer);
    setCustName(customer.name);
    setCustPhone(customer.phone || '');
    setCustAddress(customer.address || '');
    setCustPrevBalance(customer.previousBalance || 0);
    setCustPhotoUrl(customer.photoUrl || '');
    setIsCustomerModalOpen(true);
  };

  // Save Customer Handler
  const handleSaveCustomerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) {
      setFormError('Customer Name is required!');
      return;
    }

    const prevBal = typeof custPrevBalance === 'number' ? custPrevBalance : 0;
    const customerObj: Customer = {
      id: editingCustomer ? editingCustomer.id : `cust-${Date.now()}`,
      name: custName.trim(),
      phone: custPhone.trim() || undefined,
      address: custAddress.trim() || undefined,
      previousBalance: prevBal,
      photoUrl: custPhotoUrl || undefined,
      createdAt: editingCustomer ? editingCustomer.createdAt : new Date().toLocaleDateString('en-GB'),
    };

    onSaveCustomer(customerObj);
    setIsCustomerModalOpen(false);
    showToast(editingCustomer ? 'Customer profile updated successfully' : 'New customer added successfully');
  };

  // Open Entry Modal (Credit or Recovery)
  const openNewEntryModal = (type: 'credit' | 'debit') => {
    setEditingEntry(null);
    setEntryType(type);
    setEntryDate(new Date().toISOString().split('T')[0]);
    setEntryDetails(type === 'credit' ? 'Udhar Sale / ادھار سامان' : 'Cash Recovery / رقم وصولی');
    setEntryAmount('');
    setEntryPaymentMethod('Cash');
    setIsEntryModalOpen(true);
  };

  // Open Edit Entry Modal
  const openEditEntryModal = (entry: CustomerLedgerEntry) => {
    setEditingEntry(entry);
    setEntryType(entry.credit > 0 ? 'credit' : 'debit');
    setEntryDate(entry.date.includes('/') ? (() => {
      const p = entry.date.split('/');
      return `${p[2]}-${p[1]}-${p[0]}`;
    })() : entry.date);
    setEntryDetails(entry.details);
    setEntryAmount(entry.credit > 0 ? entry.credit : entry.debit);
    setEntryPaymentMethod(entry.paymentMethod || 'Cash');
    setIsEntryModalOpen(true);
  };

  // Save Entry Handler
  const handleSaveEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer) return;

    const amt = typeof entryAmount === 'number' ? entryAmount : parseFloat(entryAmount) || 0;
    if (amt <= 0) {
      setFormError('Please enter a valid positive amount.');
      return;
    }
    setFormError(null);

    // Convert date to DD/MM/YYYY
    let dFormatted = entryDate;
    if (entryDate.includes('-')) {
      const parts = entryDate.split('-');
      if (parts.length === 3) {
        dFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    const entryObj: CustomerLedgerEntry = {
      id: editingEntry ? editingEntry.id : `entry-${Date.now()}`,
      customerId: activeCustomer.id,
      date: dFormatted,
      details: entryDetails.trim() || (entryType === 'credit' ? 'Udhar Given' : 'Recovery Received'),
      credit: entryType === 'credit' ? amt : 0,
      debit: entryType === 'debit' ? amt : 0,
      runningBalance: 0, // Calculated dynamically
      paymentMethod: entryPaymentMethod,
      createdAt: editingEntry ? editingEntry.createdAt : new Date().toISOString(),
    };

    onSaveLedgerEntry(entryObj);
    setIsEntryModalOpen(false);
    showToast(entryType === 'credit' ? 'New credit (udhar) recorded' : 'Customer recovery recorded successfully');
  };

  // Delete Customer Handler (opens inline confirmation modal)
  const handleDeleteCustomerClick = (customer: Customer) => {
    setCustomerToDelete(customer);
  };

  // Delete Ledger Entry Handler (uses inline row confirmation)
  const handleDeleteEntryClick = (entryId: string) => {
    setEntryToDeleteId(entryId);
  };

  // Export Customer Statement CSV
  const handleExportCustomerCSV = () => {
    if (!activeCustomer) return;

    const headers = ['Date', 'Details', 'Credit (Udhar)', 'Debit (Received)', 'Running Balance'];
    const rows = [
      ['-', 'Previous Balance', '-', '-', activeCustomer.previousBalance],
      ...activeCustomerEntries.map((e) => [
        e.date,
        `"${e.details.replace(/"/g, '""')}"`,
        e.credit,
        e.debit,
        e.runningBalance,
      ]),
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(',')), `Final Balance,,,,${activeCustomer.currentBalance}`].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Waqas_Mart_Ledger_${activeCustomer.name.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 1. PRINT INDIVIDUAL CUSTOMER DETAIL UDHAR BILL / STATEMENT
  const handlePrintCustomerBill = async (targetCust?: Customer | null) => {
    const custBase = targetCust || activeCustomer;
    if (!custBase) return;

    const cEntries = ledgerEntries
      .filter((e) => e.customerId === custBase.id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setIsPrinting(true);
    setPrintFeedback(null);
    const res = await printCustomerLedgerReport(custBase, cEntries, branding);
    setPrintFeedback({ ok: res.ok, text: res.message });
    setIsPrinting(false);
  };

  // 2. PRINT ALL CUSTOMERS MASTER UDHAR GRAND BILL FOR OWNER
  const handlePrintAllCustomersUdhar = async () => {
    setIsPrinting(true);
    setPrintFeedback(null);
    const res = await printAllCustomersLedgerSummary(customersWithStats, branding);
    setPrintFeedback({ ok: res.ok, text: res.message });
    setIsPrinting(false);
  };

  return (
    <div className="flex-1 w-full min-h-full bg-[#f8fafc] text-slate-900 font-sans flex flex-col">
      {/* Universal Fullscreen Header with Back/Exit & Fullscreen Toggle */}
      <FullScreenPageHeader
        title="Customer Udhar & Ledgers"
        urduTitle="گاہک ادھار کھاتہ رجسٹر"
        icon={<Users className="w-5 h-5 text-white" />}
        onBackToHome={() => {
          if (onBackToHome) onBackToHome();
          else if (onBackToPos) onBackToPos();
        }}
        badge={`${customers.length} Customers`}
        badgeColor="bg-red-500/20 text-red-300 border-red-500/30"
        actions={
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setIsCustomerModalOpen(true)}
              className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Customer</span>
            </button>
            <button
              type="button"
              onClick={handlePrintAllCustomersUdhar}
              className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold rounded-xl text-xs flex items-center gap-1 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Print All Udhar</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 p-3 sm:p-5 lg:p-6 w-full space-y-4 overflow-y-auto">
        {printFeedback && (
          <div
            className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
              printFeedback.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <span>{printFeedback.text}</span>
            <button type="button" onClick={() => setPrintFeedback(null)} className="font-black cursor-pointer">×</button>
          </div>
        )}

        {/* Toast Feedback */}
        {feedbackMsg && (
          <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold animate-fade-in border border-slate-700">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {/* WAQAS MART Dual Profile Cards */}
        <WaqasBrandingCard variant="banner" />

      {/* ============================================================== */}
      {/* VIEW 1: INDIVIDUAL CUSTOMER UDHAR LEDGER (WHEN CUSTOMER SELECTED) */}
      {/* ============================================================== */}
      {selectedCustomerId && activeCustomer ? (
        <div className="space-y-4">
          {/* Top Bar with Back Button */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <button
              type="button"
              onClick={() => setSelectedCustomerId(null)}
              className="flex items-center gap-2 text-slate-700 hover:text-slate-900 font-bold text-xs bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to All Customer Udhar (تمام کھاتے)</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openEditCustomerModal(activeCustomer)}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Customer</span>
              </button>

              <button
                type="button"
                onClick={handleExportCustomerCSV}
                className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintCustomerBill(activeCustomer)}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                title="Print Official Customer Detailed Udhar Bill"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Bill (بل پرنٹ کریں)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCustomerToPreview(activeCustomer);
                  setIsCustomerBillModalOpen(true);
                }}
                className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Preview Customer Bill on screen"
              >
                <span>Preview Bill</span>
              </button>
            </div>
          </div>

          {/* Customer Header Box Inspired by Excel Red Headings */}
          <div className="bg-gradient-to-r from-red-600 to-rose-700 text-white rounded-2xl p-4 sm:p-5 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Profile Photo & Info */}
              <div className="flex items-center gap-3.5">
                <div className="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/40 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                  {activeCustomer.photoUrl ? (
                    <img
                      src={activeCustomer.photoUrl}
                      alt={activeCustomer.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Users className="w-8 h-8 text-white/80" />
                  )}
                </div>

                <div>
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
                    <span>{activeCustomer.name}</span>
                    <span className="text-[11px] font-bold bg-white/25 px-2 py-0.5 rounded-full uppercase">
                      Udhar Ledger
                    </span>
                  </h1>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-rose-100 mt-1">
                    {activeCustomer.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{activeCustomer.phone}</span>
                      </span>
                    )}
                    {activeCustomer.address && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{activeCustomer.address}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-white/80 font-mono">
                      <span>Since: {activeCustomer.createdAt}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Big Outstanding Balance Box */}
              <div className="bg-white/15 backdrop-blur-md rounded-2xl p-3 sm:p-4 border border-white/25 text-right sm:min-w-[200px]">
                <span className="text-[10px] uppercase font-bold text-rose-200 block tracking-wider">
                  Current Outstanding Udhar
                </span>
                <span className="text-2xl sm:text-3xl font-black text-white tabular-nums block">
                  {formatRs(activeCustomer.currentBalance)}
                </span>
                <span className="text-[11px] text-rose-100 font-medium">
                  {activeCustomer.currentBalance > 0
                    ? 'باقی ادھار رقم'
                    : activeCustomer.currentBalance === 0
                    ? 'حساب صاف ہے (No Balance)'
                    : 'ایڈوانس رقم (Advance)'}
                </span>
              </div>
            </div>

            {/* Action Buttons: Add Udhar vs Record Recovery */}
            <div className="pt-2 border-t border-white/20 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-4 text-xs font-semibold text-rose-100">
                <span>Previous Balance: <strong className="text-white font-mono">{formatRs(activeCustomer.previousBalance)}</strong></span>
                <span>·</span>
                <span>Total Given: <strong className="text-white font-mono">{formatRs(activeCustomer.totalCredit)}</strong></span>
                <span>·</span>
                <span>Total Received: <strong className="text-white font-mono">{formatRs(activeCustomer.totalDebit)}</strong></span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openNewEntryModal('credit')}
                  className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>+ Record Udhar (ادھار دیں)</span>
                </button>

                <button
                  type="button"
                  onClick={() => openNewEntryModal('debit')}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-black rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Banknote className="w-4 h-4 stroke-[2.5]" />
                  <span>+ Record Recovery (رقم وصولی)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Ledger Spreadsheet Table */}
          <div className="bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden">
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-red-600" />
                <span>Transaction Ledger / تفصیلی کھاتہ</span>
                <span className="bg-slate-200 text-slate-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                  {activeCustomerEntries.length} entries
                </span>
              </h2>
              <span className="text-[11px] text-slate-500 font-mono">
                Formula: Running Balance = Previous + Credit − Debit
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse font-sans">
                <thead className="bg-[#f8fafc] text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider whitespace-nowrap">
                  <tr>
                    <th className="py-3 px-3.5 border-r border-slate-200">Date</th>
                    <th className="py-3 px-4 border-r border-slate-200">Details / تفصیل</th>
                    <th className="py-3 px-3 text-right border-r border-slate-200 text-amber-800 bg-amber-50/40">
                      Credit (ادھار دیا)
                    </th>
                    <th className="py-3 px-3 text-right border-r border-slate-200 text-emerald-800 bg-emerald-50/40">
                      Debit (وصول کیا)
                    </th>
                    <th className="py-3 px-3.5 text-right font-black text-slate-900 bg-slate-50 border-r border-slate-200">
                      Running Balance (بقایا)
                    </th>
                    <th className="py-3 px-3 text-center">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {/* Previous Balance Row */}
                  <tr className="bg-slate-50/80 font-bold text-slate-600">
                    <td className="py-2.5 px-3.5 border-r border-slate-200 text-slate-400">-</td>
                    <td className="py-2.5 px-4 border-r border-slate-200 font-sans text-slate-700">
                      Previous Balance / پچھلا بقایا کھاتہ
                    </td>
                    <td className="py-2.5 px-3 text-right border-r border-slate-200 text-slate-400">-</td>
                    <td className="py-2.5 px-3 text-right border-r border-slate-200 text-slate-400">-</td>
                    <td className="py-2.5 px-3.5 text-right font-black text-slate-900 border-r border-slate-200 tabular-nums">
                      {activeCustomer.previousBalance.toFixed(0)}
                    </td>
                    <td className="py-2.5 px-3 text-center text-slate-400 font-sans text-[10px]">Opening</td>
                  </tr>

                  {activeCustomerEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-sans">
                        <FileText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-slate-600">No transactions recorded yet</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Use the "+ Record Udhar" or "+ Record Recovery" buttons above to add entries.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    activeCustomerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3.5 border-r border-slate-200 whitespace-nowrap text-slate-700">
                          {entry.date}
                        </td>
                        <td className="py-2.5 px-4 border-r border-slate-200 font-sans text-slate-800">
                          <span className="font-medium">{entry.details}</span>
                          {entry.paymentMethod && entry.debit > 0 && (
                            <span className="ml-2 text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-bold">
                              {entry.paymentMethod}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right border-r border-slate-200 tabular-nums font-bold text-amber-700 bg-amber-50/20">
                          {entry.credit > 0 ? entry.credit.toFixed(0) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right border-r border-slate-200 tabular-nums font-bold text-emerald-700 bg-emerald-50/20">
                          {entry.debit > 0 ? entry.debit.toFixed(0) : '-'}
                        </td>
                        <td className="py-2.5 px-3.5 text-right border-r border-slate-200 tabular-nums font-black text-slate-900 bg-slate-50/50">
                          {entry.runningBalance.toFixed(0)}
                        </td>
                        <td className="py-2.5 px-3 text-center whitespace-nowrap font-sans">
                          {entryToDeleteId === entry.id ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteLedgerEntry(entry.id);
                                  setEntryToDeleteId(null);
                                  showToast('Ledger entry removed');
                                }}
                                className="px-2 py-0.5 bg-red-600 text-white rounded text-[10px] font-bold cursor-pointer"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setEntryToDeleteId(null)}
                                className="px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-bold cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditEntryModal(entry)}
                                className="p-1 hover:bg-slate-200 text-slate-500 rounded cursor-pointer"
                                title="Edit entry"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteEntryClick(entry.id)}
                                className="p-1 hover:bg-red-50 text-red-500 rounded cursor-pointer"
                                title="Delete entry"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                {/* Ledger Footer Total */}
                <tfoot className="bg-[#3730a3] text-white font-mono font-black border-t-2 border-indigo-400">
                  <tr>
                    <td className="py-2.5 px-3.5 uppercase font-sans text-amber-200">TOTALS</td>
                    <td className="py-2.5 px-4 font-sans text-indigo-200 text-[11px]">
                      {activeCustomerEntries.length} Transactions
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-amber-300">
                      {activeCustomer.totalCredit.toFixed(0)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-emerald-300">
                      {activeCustomer.totalDebit.toFixed(0)}
                    </td>
                    <td className="py-2.5 px-3.5 text-right tabular-nums text-emerald-200 text-sm">
                      {activeCustomer.currentBalance.toFixed(0)}
                    </td>
                    <td className="py-2.5 px-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* ============================================================== */
        /* VIEW 2: ALL CUSTOMERS UDHAR / GRAND LEDGER (TOTAL GRAND)       */
        /* ============================================================== */
        <div className="space-y-4">
          {/* Top Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md shadow-red-600/20 shrink-0">
                <Users className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  All Customer Udhar (تمام ادھار کھاتے)
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  Grand Ledger of all customer credits, previous balances and recoveries
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePrintAllCustomersUdhar}
                className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                title="Print All Customers Master Udhar Register for Owner"
              >
                <Printer className="w-4 h-4" />
                <span>Print All Udhar Bill (تمام ادھار بل برائے اونر)</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAllUdharModalOpen(true)}
                className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Preview All Customers Master Register"
              >
                <span>Preview Master</span>
              </button>

              <button
                type="button"
                onClick={openNewCustomerModal}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>+ Add New Customer (نیا گاہک)</span>
              </button>

              {customers.length > 0 && onDeleteAllCustomers && (
                showDeleteAllConfirm ? (
                  <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-2.5 py-1.5">
                    <span className="text-[11px] font-bold text-red-800">Delete all {customers.length}?</span>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteAllCustomers();
                        setShowDeleteAllConfirm(false);
                      }}
                      className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteAllConfirm(false)}
                      className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDeleteAllConfirm(true)}
                    className="px-3.5 py-2 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                    title="Delete all customers and their ledgers"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>All Delete ({customers.length})</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* TOP 4 SUMMARY CARDS MATCHING REQUIREMENTS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Total Customers */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Customers</span>
                <span className="text-xl font-black text-slate-900 tabular-nums">
                  {grandSummary.totalCustomers}
                </span>
              </div>
            </div>

            {/* 2. Total Outstanding Udhar */}
            <div className="bg-red-50/70 border border-red-200 rounded-2xl p-4 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold shrink-0 shadow-sm shadow-red-600/30">
                <DollarSign className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-red-700 block">Total Outstanding Udhar</span>
                <span className="text-xl font-black text-red-950 tabular-nums">
                  {formatRs(grandSummary.totalOutstanding)}
                </span>
              </div>
            </div>

            {/* 3. Total Udhar Given */}
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shrink-0">
                <TrendingUp className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-amber-800 block">Total Udhar Given</span>
                <span className="text-xl font-black text-amber-950 tabular-nums">
                  {formatRs(grandSummary.totalGiven)}
                </span>
              </div>
            </div>

            {/* 4. Total Received */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 shadow-xs flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shrink-0">
                <Banknote className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-emerald-800 block">Total Received</span>
                <span className="text-xl font-black text-emerald-950 tabular-nums">
                  {formatRs(grandSummary.totalReceived)}
                </span>
              </div>
            </div>
          </div>

          {/* Search, Sort and Filters */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by customer name, phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-bold text-[11px]">Sort By:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <option value="balance">Highest Balance (زیادہ ادھار)</option>
                <option value="name">Customer Name (نام)</option>
                <option value="recent">Recent Activity (حالیہ)</option>
              </select>
            </div>
          </div>

          {/* Customers Grand Table / List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#f8fafc] text-slate-700 font-bold border-b border-slate-200 text-[11px] uppercase tracking-wider whitespace-nowrap">
                  <tr>
                    <th className="py-3 px-3.5">Customer</th>
                    <th className="py-3 px-3">Phone</th>
                    <th className="py-3 px-3 text-right">Previous Balance</th>
                    <th className="py-3 px-3 text-right text-amber-800">Total Udhar Given</th>
                    <th className="py-3 px-3 text-right text-emerald-800">Total Received</th>
                    <th className="py-3 px-3.5 text-right font-black text-slate-900 bg-red-50/50">
                      Current Balance
                    </th>
                    <th className="py-3 px-3 text-center">Last Transaction</th>
                    <th className="py-3 px-3.5 text-center">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-14 text-center text-slate-400">
                        <Users className="w-12 h-12 mx-auto text-slate-300 mb-2" />
                        <p className="font-bold text-slate-700">No customers found</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Click "+ Add New Customer" above to register your first customer udhar ledger.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((cust) => (
                      <tr
                        key={cust.id}
                        onClick={() => setSelectedCustomerId(cust.id)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer text-slate-700"
                      >
                        {/* Customer Photo & Name */}
                        <td className="py-3 px-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                              {cust.photoUrl ? (
                                <img src={cust.photoUrl} alt={cust.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="font-bold text-slate-600 text-xs uppercase">
                                  {cust.name.slice(0, 2)}
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block leading-tight">
                                {cust.name}
                              </span>
                              {cust.address && (
                                <span className="text-[10px] text-slate-400 block leading-tight">
                                  {cust.address}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Phone */}
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-600">
                          {cust.phone || '-'}
                        </td>

                        {/* Previous Balance */}
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                          {cust.previousBalance.toFixed(0)}
                        </td>

                        {/* Total Udhar Given */}
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-amber-700 bg-amber-50/10">
                          {cust.totalCredit.toFixed(0)}
                        </td>

                        {/* Total Received */}
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700 bg-emerald-50/10">
                          {cust.totalDebit.toFixed(0)}
                        </td>

                        {/* Current Outstanding Balance */}
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums font-black text-sm bg-red-50/40">
                          <span
                            className={
                              cust.currentBalance > 0
                                ? 'text-red-700'
                                : cust.currentBalance === 0
                                ? 'text-emerald-700'
                                : 'text-blue-700'
                            }
                          >
                            {cust.currentBalance.toFixed(0)}
                          </span>
                        </td>

                        {/* Last Date */}
                        <td className="py-3 px-3 text-center whitespace-nowrap font-mono text-[11px] text-slate-500">
                          {cust.lastDate || '-'}
                        </td>

                        {/* Action: View Ledger Button */}
                        <td className="py-3 px-3.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrintCustomerBill(cust);
                              }}
                              className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                              title="Print Customer Udhar Bill (گاہک ادھار بل پرنٹ کریں)"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Print Bill</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCustomerId(cust.id);
                              }}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                            >
                              <span>View Ledger</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCustomerClick(cust);
                              }}
                              className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                              title="Delete customer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: ADD / EDIT CUSTOMER                                   */}
      {/* ============================================================== */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-red-600" />
                <span>{editingCustomer ? 'Edit Customer Profile' : 'Add New Customer (نیا گاہک)'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCustomerModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCustomerSubmit} className="space-y-3.5 text-xs">
              {/* Photo Upload */}
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden shrink-0">
                  {custPhotoUrl ? (
                    <img src={custPhotoUrl} alt="Customer" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-6 h-6 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <span className="font-bold text-slate-700 block">Customer Photo (اختیاری)</span>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Choose Photo / Camera
                    </button>
                    {custPhotoUrl && (
                      <button
                        type="button"
                        onClick={() => setCustPhotoUrl('')}
                        className="px-2 py-1 text-red-600 hover:bg-red-50 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Full Name */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Customer Full Name (مکمل نام) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Haji Sahib / Baqala Pump / Ali Khan"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Phone Number (موبائل نمبر)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 0300-1234567"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              {/* Address / Shop Name */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Address / City (پتہ / شہر)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Main Bazar Swabi / Shop #4"
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              {/* Previous Balance */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Previous Balance / پچھلا بقایا (Rs.)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={custPrevBalance === 0 ? '' : custPrevBalance}
                  onChange={(e) => setCustPrevBalance(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-red-500 focus:outline-none text-right font-bold text-slate-900"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  اگر گاہک کا پرانا بقایا ہے تو یہاں درج کریں، ورنہ 0 رہنے دیں۔
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-xs cursor-pointer"
                >
                  {editingCustomer ? 'Update Customer' : 'Save Customer (محفوظ کریں)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: RECORD UDHAR (CREDIT) OR RECOVERY (DEBIT)              */}
      {/* ============================================================== */}
      {isEntryModalOpen && activeCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-black text-base text-slate-900 flex items-center gap-2">
                {entryType === 'credit' ? (
                  <>
                    <CreditCard className="w-5 h-5 text-amber-600" />
                    <span>Record Udhar (ادھار دیں)</span>
                  </>
                ) : (
                  <>
                    <Banknote className="w-5 h-5 text-emerald-600" />
                    <span>Record Customer Recovery (رقم وصولی)</span>
                  </>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setIsEntryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-900 block">{activeCustomer.name}</span>
                <span className="text-[11px] text-slate-500">Current Balance:</span>
              </div>
              <span className="font-mono font-black text-base text-red-700">
                {formatRs(activeCustomer.currentBalance)}
              </span>
            </div>

            <form onSubmit={handleSaveEntrySubmit} className="space-y-3.5 text-xs">
              {/* Date */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Date (تاریخ) *</label>
                <input
                  type="date"
                  required
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {entryType === 'credit' ? 'Udhar Amount / ادھار رقم (Rs.) *' : 'Amount Received / وصول شدہ رقم (Rs.) *'}
                </label>
                <input
                  type="number"
                  required
                  autoFocus
                  placeholder="0"
                  value={entryAmount}
                  onChange={(e) => setEntryAmount(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                  className={`w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-base font-black focus:ring-2 focus:outline-none text-right ${
                    entryType === 'credit'
                      ? 'text-amber-800 focus:ring-amber-500'
                      : 'text-emerald-800 focus:ring-emerald-500'
                  }`}
                />
              </div>

              {/* Details / Description */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">Details / نوٹ / سامان کی تفصیل</label>
                <input
                  type="text"
                  placeholder="e.g. Rice & Cooking Oil / یا کاؤنٹر کیش وصولی"
                  value={entryDetails}
                  onChange={(e) => setEntryDetails(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>

              {/* Payment Method for Recovery */}
              {entryType === 'debit' && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Payment Method (وصولی کا ذریعہ)</label>
                  <select
                    value={entryPaymentMethod}
                    onChange={(e) => setEntryPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold bg-white cursor-pointer"
                  >
                    <option value="Cash">Cash (نقد کاؤنٹر)</option>
                    <option value="Bank / Online">Bank / EasyPaisa / JazzCash</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEntryModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-white rounded-xl font-bold shadow-xs cursor-pointer ${
                    entryType === 'credit'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {entryType === 'credit' ? 'Save Udhar (محفوظ کریں)' : 'Confirm Recovery (وصولی محفوظ کریں)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: INDIVIDUAL CUSTOMER DETAIL UDHAR BILL PREVIEW */}
      {isCustomerBillModalOpen && (customerToPreview || activeCustomer) && (() => {
        const custBase = (customerToPreview || activeCustomer)!;
        const cust = customersWithStats.find((c) => c.id === custBase.id) || {
          ...custBase,
          totalCredit: 0,
          totalDebit: 0,
          currentBalance: Number(custBase.previousBalance) || 0,
          entriesCount: 0,
          lastDate: '',
        };
        const cEntries = ledgerEntries.filter((e) => e.customerId === cust.id);
        let runBal = Number(cust.previousBalance) || 0;
        const computed = cEntries.map((e) => {
          runBal = runBal + (Number(e.credit) || 0) - (Number(e.debit) || 0);
          return { ...e, calculatedRunningBalance: runBal };
        });

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-fade-in">
              {/* Header */}
              <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center text-white font-bold">
                    <Printer className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm sm:text-base tracking-tight">
                      Customer Udhar Bill Preview (گاہک تفصیلی ادھار بل)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      {cust.name} · Official Statement of Accounts
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintCustomerBill(cust)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Bill (بل پرنٹ کریں)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomerBillModalOpen(false);
                      setCustomerToPreview(null);
                    }}
                    className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Bill Preview */}
              <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-100">
                <div className="bg-white p-6 rounded-xl border border-slate-300 shadow-sm text-slate-900 text-[11px] font-sans">
                  {/* Bill Top Header */}
                  <div className="flex justify-between items-start border-b-2 border-red-600 pb-3 mb-3">
                    <div>
                      <h1 className="text-2xl font-black text-emerald-700 tracking-tight">WAQAS MART (وقاص مارٹ)</h1>
                      <h2 className="text-sm font-bold text-red-700">Customer Udhar Statement & Detailed Bill (گاہک تفصیلی ادھار بل)</h2>
                      <p className="text-[10px] text-slate-500">Retail Supermarket POS & Customer Accounts</p>
                    </div>
                    <div className="text-right text-[10px] text-slate-600 bg-red-50 p-2 rounded-lg border border-red-200">
                      <div className="font-bold text-red-900 uppercase">Official Udhar Bill</div>
                      <div><strong>Date:</strong> {new Date().toLocaleDateString('en-GB')} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div><strong>Bill No:</strong> BILL-{cust.id.slice(-6).toUpperCase()}</div>
                    </div>
                  </div>

                  {/* Customer Card */}
                  <div className="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
                    <div>
                      <div className="text-base font-black text-slate-900">{cust.name}</div>
                      <div className="text-[11px] text-slate-600"><strong>Phone:</strong> {cust.phone || 'N/A'}</div>
                      <div className="text-[11px] text-slate-600"><strong>Address:</strong> {cust.address || 'Local Market'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-500 uppercase">Account Status</div>
                      <div className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        cust.currentBalance > 0 ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      }`}>
                        {cust.currentBalance > 0 ? '⚠️ Udhar Due (بقایا واجب الادا)' : '✅ Account Cleared (کھاتہ بے باق)'}
                      </div>
                    </div>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-center">
                    <div className="border border-slate-200 rounded p-2 bg-slate-50">
                      <span className="text-[9px] uppercase text-slate-500 font-bold block">Previous Balance (سابقہ)</span>
                      <span className="font-mono font-bold text-slate-700 text-sm">Rs. {(cust.previousBalance || 0).toFixed(0)}</span>
                    </div>
                    <div className="border border-red-200 rounded p-2 bg-red-50/50">
                      <span className="text-[9px] uppercase text-red-800 font-bold block">Total Udhar (کل ادھار)</span>
                      <span className="font-mono font-bold text-red-700 text-sm">Rs. {(cust.totalCredit || 0).toFixed(0)}</span>
                    </div>
                    <div className="border border-emerald-200 rounded p-2 bg-emerald-50/50">
                      <span className="text-[9px] uppercase text-emerald-800 font-bold block">Total Paid (کل وصولی)</span>
                      <span className="font-mono font-bold text-emerald-700 text-sm">Rs. {(cust.totalDebit || 0).toFixed(0)}</span>
                    </div>
                    <div className="border-2 border-red-500 rounded p-2 bg-red-50 text-red-950">
                      <span className="text-[9px] uppercase text-red-900 font-black block">Net Payable Due (کل واجب الادا)</span>
                      <span className="font-mono font-black text-red-700 text-base">Rs. {(cust.currentBalance || 0).toFixed(0)}</span>
                    </div>
                  </div>

                  {/* Ledger Table */}
                  <table className="w-full border-collapse border border-slate-300 text-[10.5px]">
                    <thead>
                      <tr className="bg-slate-800 text-white font-bold text-center">
                        <th className="border border-slate-400 p-1.5 w-8">#</th>
                        <th className="border border-slate-400 p-1.5 w-20">Date</th>
                        <th className="border border-slate-400 p-1.5 text-left">Details</th>
                        <th className="border border-slate-400 p-1.5 w-16">Payment</th>
                        <th className="border border-slate-400 p-1.5 w-24 text-right">Udhar (ادھار)</th>
                        <th className="border border-slate-400 p-1.5 w-24 text-right">Recovery (وصولی)</th>
                        <th className="border border-slate-400 p-1.5 w-24 text-right">Balance (بقایا)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-slate-100 font-bold">
                        <td className="border border-slate-300 p-1 text-center">-</td>
                        <td className="border border-slate-300 p-1 text-center">-</td>
                        <td className="border border-slate-300 p-1 text-left">Previous Opening Balance (سابقہ پرانا بقایا کھاتہ)</td>
                        <td className="border border-slate-300 p-1 text-center">-</td>
                        <td className="border border-slate-300 p-1 text-right">-</td>
                        <td className="border border-slate-300 p-1 text-right">-</td>
                        <td className="border border-slate-300 p-1 text-right font-mono text-red-700 font-bold">Rs. {(cust.previousBalance || 0).toFixed(0)}</td>
                      </tr>
                      {computed.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="border border-slate-300 p-3 text-center text-slate-400">
                            No additional transactions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        computed.map((e, idx) => (
                          <tr key={e.id} className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                            <td className="border border-slate-300 p-1 text-center">{idx + 1}</td>
                            <td className="border border-slate-300 p-1 text-center font-mono">{e.date}</td>
                            <td className="border border-slate-300 p-1 text-left">{e.details}</td>
                            <td className="border border-slate-300 p-1 text-center text-[9.5px]">{e.paymentMethod || 'Cash'}</td>
                            <td className="border border-slate-300 p-1 text-right font-mono text-red-700 font-semibold">{e.credit > 0 ? 'Rs. ' + e.credit.toFixed(0) : '-'}</td>
                            <td className="border border-slate-300 p-1 text-right font-mono text-emerald-700 font-semibold">{e.debit > 0 ? 'Rs. ' + e.debit.toFixed(0) : '-'}</td>
                            <td className="border border-slate-300 p-1 text-right font-mono font-bold">Rs. {e.calculatedRunningBalance.toFixed(0)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-red-700 text-white font-mono font-bold text-xs">
                        <td colSpan={4} className="border border-red-800 p-1.5 text-right uppercase">GRAND TOTALS (ٹوٹل)</td>
                        <td className="border border-red-800 p-1.5 text-right">Rs. {(cust.totalCredit || 0).toFixed(0)}</td>
                        <td className="border border-red-800 p-1.5 text-right">Rs. {(cust.totalDebit || 0).toFixed(0)}</td>
                        <td className="border border-red-800 p-1.5 text-right font-black">Rs. {(cust.currentBalance || 0).toFixed(0)}</td>
                      </tr>
                    </tfoot>
                  </table>

                  {/* Urdu Notice */}
                  <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-center text-amber-900 text-[11px] font-bold">
                    معزز گاہک! برائے مہربانی اپنا سابقہ و موجودہ واجب الادا ادھار بل (Rs. {(cust.currentBalance || 0).toFixed(0)}) جلد از جلد وقاص مارٹ پر ادا فرما کر تعاون فرمائیں۔ شکریہ!
                  </div>

                  {/* Signatures */}
                  <div className="flex justify-between items-center mt-8 px-6 pt-2">
                    <div className="w-40 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                      Customer Signature (دستخط گاہک)
                    </div>
                    <div className="w-40 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                      Waqas Mart Signature (مہر و دستخط وقاص مارٹ)
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 text-xs shrink-0">
                <span className="text-slate-500 font-medium">
                  💡 Ready to print individual customer bill on thermal or A4 printer.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomerBillModalOpen(false);
                      setCustomerToPreview(null);
                    }}
                    className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold cursor-pointer transition-colors"
                  >
                    Close (بند کریں)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrintCustomerBill(cust)}
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Bill (بل پرنٹ کریں)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 4: ALL CUSTOMERS MASTER UDHAR GRAND BILL PREVIEW FOR OWNER */}
      {isAllUdharModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center text-white font-bold">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base tracking-tight">
                    All Customers Master Udhar Register & Bill (تمام گاہکوں کا مجموعی ادھار بل برائے اونر / مالک)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Grand Statement of Accounts · Complete Market Outstanding Receivables
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintAllCustomersUdhar}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Grand Bill (پرنٹ کریں)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAllUdharModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Master Preview */}
            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-100">
              <div className="bg-white p-6 rounded-xl border border-slate-300 shadow-sm text-slate-900 text-[11px] font-sans">
                {/* Official Title */}
                <div className="flex justify-between items-end border-b-2 border-red-600 pb-3 mb-3">
                  <div>
                    <h1 className="text-2xl font-black text-emerald-700 tracking-tight">WAQAS MART (وقاص مارٹ)</h1>
                    <h2 className="text-sm font-bold text-slate-800">
                      All Customers Master Udhar Register & Bill (تمام گاہکوں کا مجموعی ادھار بل برائے اونر / مالک)
                    </h2>
                    <p className="text-[10px] text-slate-500">Supermarket Retail Management System</p>
                  </div>
                  <div className="text-right text-[10px] text-slate-600">
                    <div><strong>Printed:</strong> {new Date().toLocaleDateString('en-GB')} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div><strong>Total Customers:</strong> {grandSummary.totalCustomers}</div>
                  </div>
                </div>

                {/* Grand Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-center">
                  <div className="border border-slate-200 rounded p-1.5 bg-slate-50">
                    <span className="text-[9px] uppercase text-slate-500 font-bold block">Total Customers</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">{grandSummary.totalCustomers}</span>
                  </div>
                  <div className="border border-slate-200 rounded p-1.5 bg-slate-50">
                    <span className="text-[9px] uppercase text-slate-500 font-bold block">Total Prev Balance</span>
                    <span className="font-mono font-bold text-slate-700 text-xs">{grandSummary.totalPreviousBalance.toFixed(0)}</span>
                  </div>
                  <div className="border border-red-200 rounded p-1.5 bg-red-50/50">
                    <span className="text-[9px] uppercase text-red-800 font-bold block">Total Udhar Given</span>
                    <span className="font-mono font-bold text-red-700 text-xs">Rs. {grandSummary.totalGiven.toFixed(0)}</span>
                  </div>
                  <div className="border border-emerald-200 rounded p-1.5 bg-emerald-50/50">
                    <span className="text-[9px] uppercase text-emerald-800 font-bold block">Total Recovered</span>
                    <span className="font-mono font-bold text-emerald-700 text-xs">Rs. {grandSummary.totalReceived.toFixed(0)}</span>
                  </div>
                  <div className="border-2 border-red-500 rounded p-1.5 bg-red-50">
                    <span className="text-[9px] uppercase text-red-900 font-black block">Grand Market Udhar Due</span>
                    <span className="font-mono font-black text-red-700 text-sm">Rs. {grandSummary.totalOutstanding.toFixed(0)}</span>
                  </div>
                </div>

                {/* Table */}
                <table className="w-full border-collapse border border-slate-300 text-[10px]">
                  <thead>
                    <tr className="bg-slate-800 text-white font-bold text-center">
                      <th className="border border-slate-400 p-1 w-8">#</th>
                      <th className="border border-slate-400 p-1 text-left">Customer Name</th>
                      <th className="border border-slate-400 p-1">Phone</th>
                      <th className="border border-slate-400 p-1 text-left">Address</th>
                      <th className="border border-slate-400 p-1 text-right">Prev Balance</th>
                      <th className="border border-slate-400 p-1 text-right">Total Udhar</th>
                      <th className="border border-slate-400 p-1 text-right">Total Paid</th>
                      <th className="border border-slate-400 p-1 text-right">Net Due Balance</th>
                      <th className="border border-slate-400 p-1 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customersWithStats.map((c, idx) => (
                      <tr key={c.id} className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                        <td className="border border-slate-300 p-1 text-center">{idx + 1}</td>
                        <td className="border border-slate-300 p-1 text-left font-bold">{c.name}</td>
                        <td className="border border-slate-300 p-1 text-center font-mono">{c.phone || '-'}</td>
                        <td className="border border-slate-300 p-1 text-left text-[9px] truncate max-w-[120px]">{c.address || '-'}</td>
                        <td className="border border-slate-300 p-1 text-right font-mono">{c.previousBalance.toFixed(0)}</td>
                        <td className="border border-slate-300 p-1 text-right font-mono text-red-700">{c.totalCredit.toFixed(0)}</td>
                        <td className="border border-slate-300 p-1 text-right font-mono text-emerald-700">{c.totalDebit.toFixed(0)}</td>
                        <td className="border border-slate-300 p-1 text-right font-mono font-bold text-red-700 bg-red-50/40">Rs. {c.currentBalance.toFixed(0)}</td>
                        <td className="border border-slate-300 p-1 text-center font-bold text-[9px]">
                          {c.currentBalance > 0 ? <span className="text-red-700">Due</span> : <span className="text-emerald-700">Clear</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-red-800 text-white font-mono font-bold text-xs">
                      <td colSpan={4} className="border border-red-900 p-1.5 text-center uppercase">GRAND TOTALS (تمام گاہکوں کا مجموعی ٹوٹل)</td>
                      <td className="border border-red-900 p-1.5 text-right">{grandSummary.totalPreviousBalance.toFixed(0)}</td>
                      <td className="border border-red-900 p-1.5 text-right">Rs. {grandSummary.totalGiven.toFixed(0)}</td>
                      <td className="border border-red-900 p-1.5 text-right">Rs. {grandSummary.totalReceived.toFixed(0)}</td>
                      <td className="border border-red-900 p-1.5 text-right font-black">Rs. {grandSummary.totalOutstanding.toFixed(0)}</td>
                      <td className="border border-red-900 p-1.5 text-center">-</td>
                    </tr>
                  </tfoot>
                </table>

                {/* Signatures */}
                <div className="flex justify-between items-center mt-8 px-6 pt-2">
                  <div className="w-36 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                    Prepared By (Cashier)
                  </div>
                  <div className="w-36 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                    Verified By (Accountant)
                  </div>
                  <div className="w-36 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                    Approved By Owner (دستخط مالک)
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 text-xs shrink-0">
              <span className="text-slate-500 font-medium">
                💡 Master register contains complete list of all debtor customers for business records.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAllUdharModalOpen(false)}
                  className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Close (بند کریں)
                </button>
                <button
                  type="button"
                  onClick={handlePrintAllCustomersUdhar}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Grand Bill (پرنٹ کریں)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {customerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-2xl border border-red-200 space-y-4">
            <h4 className="font-black text-slate-900 text-sm">Delete Customer "{customerToDelete.name}"?</h4>
            <p className="text-xs text-slate-600">
              This will permanently remove this customer and all financial history for this account.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCustomerToDelete(null)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteCustomer(customerToDelete.id);
                  if (selectedCustomerId === customerToDelete.id) setSelectedCustomerId(null);
                  setCustomerToDelete(null);
                  showToast('Customer deleted');
                }}
                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {formError && (
        <div className="fixed bottom-4 right-4 z-[60] bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-bold flex items-center gap-2">
          <span>{formError}</span>
          <button type="button" onClick={() => setFormError(null)} className="font-black cursor-pointer">×</button>
        </div>
      )}
      </div>
    </div>
  );
};
