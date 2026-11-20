import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar,
  Save,
  Download,
  Printer,
  RotateCcw,
  Plus,
  HelpCircle,
  FileSpreadsheet,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  DailyHisabRow,
  SaleTransaction,
  PurchaseTransaction,
  CustomerLedgerEntry,
  ExpenseEntry,
  StoreBranding,
} from '../types/pos';
import { WaqasBrandingCard } from './WaqasBrandingCard';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import { printDailyHisabReport } from '../utils/printerService';

interface DailyHisabExcelPageProps {
  transactions: SaleTransaction[];
  purchases: PurchaseTransaction[];
  customerLedgerEntries: CustomerLedgerEntry[];
  expenses?: ExpenseEntry[];
  serverDailyHisab?: Record<string, Record<string, Partial<DailyHisabRow>>>;
  onSyncDailyHisab?: (data: Record<string, Record<string, Partial<DailyHisabRow>>>) => void;
  branding?: StoreBranding;
  onNavigateToSummary?: () => void;
  onNavigateToLedgers?: () => void;
  onRecordRecovery?: (dateIso: string) => void;
  onBackToHome?: () => void;
}

const STORAGE_KEY_HISAB = 'waqas_mart_daily_hisab_v2';

export const DailyHisabExcelPage: React.FC<DailyHisabExcelPageProps> = ({
  transactions,
  purchases,
  customerLedgerEntries,
  expenses = [],
  serverDailyHisab,
  onSyncDailyHisab,
  branding,
  onNavigateToSummary,
  onNavigateToLedgers,
  onBackToHome,
}) => {
  // Current active year and month (default to October 2026 to match reference or current year/month)
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedMonth, setSelectedMonth] = useState<number>(10); // 1-12 (10 = October)
  const [initialOpeningCash, setInitialOpeningCash] = useState<number>(25320); // First day initial opening cash default from screenshot

  const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  // Month navigation labels
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const activeMonthName = monthNames[selectedMonth - 1];

  // Saved overrides from server + localStorage
  const [savedRecords, setSavedRecords] = useState<Record<string, Record<string, Partial<DailyHisabRow>>>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISAB);
      const localParsed = raw ? JSON.parse(raw) : {};
      if (serverDailyHisab && Object.keys(serverDailyHisab).length > 0) {
        return { ...localParsed, ...serverDailyHisab };
      }
      return localParsed;
    } catch (e) {
      console.error('Failed to load Daily Hisab data:', e);
    }
    return serverDailyHisab || {};
  });

  useEffect(() => {
    if (serverDailyHisab && Object.keys(serverDailyHisab).length > 0) {
      setSavedRecords((prev) => {
        const merged = { ...prev, ...serverDailyHisab };
        try {
          localStorage.setItem(STORAGE_KEY_HISAB, JSON.stringify(merged));
        } catch {
          // ignore
        }
        return merged;
      });
    }
  }, [serverDailyHisab]);

  // Cell currently being edited: { dateIso, field }
  const [, setActiveCell] = useState<{ dateIso: string; field: keyof DailyHisabRow } | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [selectedRowDate, setSelectedRowDate] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printFeedback, setPrintFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);

  // Quick save to localStorage + live sync to server
  const persistChanges = (updated: Record<string, Record<string, Partial<DailyHisabRow>>>) => {
    setSavedRecords(updated);
    try {
      localStorage.setItem(STORAGE_KEY_HISAB, JSON.stringify(updated));
      onSyncDailyHisab?.(updated);
      setSaveSuccessMsg('All spreadsheet rows saved & synced!');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (e) {
      console.error('Failed to save Daily Hisab:', e);
    }
  };

  // Days in selected month
  const daysInMonth = useMemo(() => {
    return new Date(selectedYear, selectedMonth, 0).getDate();
  }, [selectedYear, selectedMonth]);

  // Aggregate automated values from real business transactions & expenses
  const autoDataByDate = useMemo(() => {
    const map: Record<string, {
      dailySale: number;
      dailyPurchase: number;
      dailyCredit: number;
      dailyRecovery: number;
      dailyExpenses: number;
    }> = {};

    const ensure = (dIso: string) => {
      if (!map[dIso]) {
        map[dIso] = { dailySale: 0, dailyPurchase: 0, dailyCredit: 0, dailyRecovery: 0, dailyExpenses: 0 };
      }
    };

    // 1. Sales
    for (const tx of transactions) {
      let dIso = '';
      try {
        const parsed = new Date(tx.dateTime);
        if (!isNaN(parsed.getTime())) {
          dIso = parsed.toISOString().split('T')[0];
        }
      } catch {
        // fallback
      }

      if (!dIso) {
        const parts = tx.dateTime.split(',')[0].trim().split(' ');
        if (parts.length >= 3) {
          const day = parts[0].padStart(2, '0');
          const mIdx = monthNames.findIndex((m) => m.toLowerCase().startsWith(parts[1].toLowerCase().slice(0, 3)));
          const yr = parts[2];
          if (mIdx >= 0) {
            dIso = `${yr}-${String(mIdx + 1).padStart(2, '0')}-${day}`;
          }
        }
      }

      if (dIso) {
        ensure(dIso);
        map[dIso].dailySale += tx.grandTotal || 0;
        if (tx.paymentMethod === 'credit') {
          const paidCash = tx.cashTendered || 0;
          const unpaid = Math.max(0, tx.grandTotal - paidCash);
          map[dIso].dailyCredit += unpaid;
        }
      }
    }

    // 2. Purchases
    for (const p of purchases) {
      const dIso = p.purchaseDate; // YYYY-MM-DD
      if (dIso) {
        ensure(dIso);
        map[dIso].dailyPurchase += p.grandTotal || 0;
      }
    }

    // 3. Customer recovery entries
    for (const le of customerLedgerEntries) {
      if (le.debit > 0) {
        const dIso = le.date.includes('-') ? le.date : (() => {
          const parts = le.date.split('/');
          if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
          return '';
        })();
        if (dIso) {
          ensure(dIso);
          map[dIso].dailyRecovery += le.debit;
        }
      }
    }

    // 4. Expenses
    for (const exp of expenses) {
      const raw = exp.date || '';
      const dIso = raw.includes('/')
        ? (() => {
            const parts = raw.split('/');
            return parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : '';
          })()
        : raw.split('T')[0];
      if (dIso) {
        ensure(dIso);
        map[dIso].dailyExpenses += Number(exp.amount) || 0;
      }
    }

    return map;
  }, [transactions, purchases, customerLedgerEntries, expenses]);

  // Compute all rows for the month with sequential Opening & Closing Cash
  const computedRows: DailyHisabRow[] = useMemo(() => {
    const rows: DailyHisabRow[] = [];
    const monthOverrides = savedRecords[monthKey] || {};

    let runningClosingCash = initialOpeningCash;

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const mStr = String(selectedMonth).padStart(2, '0');
      const dateDisplay = `${dayStr}/${mStr}/${selectedYear}`;
      const dateIso = `${selectedYear}-${mStr}-${dayStr}`;

      const saved = monthOverrides[dateIso] || {};
      const auto = autoDataByDate[dateIso] || {
        dailySale: 0,
        dailyPurchase: 0,
        dailyCredit: 0,
        dailyRecovery: 0,
        dailyExpenses: 0,
      };

      // 1. Opening Cash
      let openingCash = runningClosingCash;
      let isOpeningCashManual = false;

      if (day === 1) {
        if (saved.openingCash !== undefined) {
          openingCash = Number(saved.openingCash) || 0;
          isOpeningCashManual = true;
        } else {
          openingCash = initialOpeningCash;
        }
      } else {
        if (saved.openingCash !== undefined && saved.isOpeningCashManual) {
          openingCash = Number(saved.openingCash) || 0;
          isOpeningCashManual = true;
        } else {
          openingCash = runningClosingCash;
        }
      }

      // 2. Financial columns (Use manual user input if entered, else auto from DB)
      const dailySale = saved.dailySale !== undefined ? Number(saved.dailySale) : auto.dailySale;
      const dailyPurchase = saved.dailyPurchase !== undefined ? Number(saved.dailyPurchase) : auto.dailyPurchase;
      const dailyExtra = saved.dailyExtra !== undefined ? Number(saved.dailyExtra) : 0;
      const dailyCredit = saved.dailyCredit !== undefined ? Number(saved.dailyCredit) : auto.dailyCredit;
      const dailyRecovery = saved.dailyRecovery !== undefined ? Number(saved.dailyRecovery) : auto.dailyRecovery;
      const dailyKitchen = saved.dailyKitchen !== undefined ? Number(saved.dailyKitchen) : 0;
      const dailyExpenses = saved.dailyExpenses !== undefined ? Number(saved.dailyExpenses) : auto.dailyExpenses;
      const details = saved.details !== undefined ? String(saved.details) : '';

      // 3. Closing Cash Accounting Formula specified by user:
      // Closing Cash = Opening Cash + Cash Sales + Daily Extra + Daily Recovery − Daily Purchase − Daily Kitchen − Daily Expenses
      // Cash Sales = Daily Sale − Daily Credit
      const cashSale = Math.max(0, dailySale - dailyCredit);
      const calculatedClosing =
        openingCash +
        cashSale +
        dailyExtra +
        dailyRecovery -
        dailyPurchase -
        dailyKitchen -
        dailyExpenses;

      const closingCash = saved.closingCash !== undefined && saved.isEditedByUser
        ? Number(saved.closingCash)
        : calculatedClosing;

      // Update running closing cash for next day's opening
      runningClosingCash = closingCash;

      rows.push({
        date: dateDisplay,
        dateIso,
        openingCash,
        isOpeningCashManual,
        dailySale,
        dailyPurchase,
        dailyExtra,
        dailyCredit,
        dailyRecovery,
        dailyKitchen,
        dailyExpenses,
        details,
        closingCash,
        isEditedByUser: saved.isEditedByUser || false,
      });
    }

    return rows;
  }, [selectedYear, selectedMonth, daysInMonth, initialOpeningCash, savedRecords, monthKey, autoDataByDate]);

  // Compute Totals for the bottom Purple/Blue row
  const totals = useMemo(() => {
    let totalSale = 0;
    let totalPurchase = 0;
    let totalExtra = 0;
    let totalCredit = 0;
    let totalRecovery = 0;
    let totalKitchen = 0;
    let totalExpenses = 0;

    for (const r of computedRows) {
      totalSale += r.dailySale;
      totalPurchase += r.dailyPurchase;
      totalExtra += r.dailyExtra;
      totalCredit += r.dailyCredit;
      totalRecovery += r.dailyRecovery;
      totalKitchen += r.dailyKitchen;
      totalExpenses += r.dailyExpenses;
    }

    const firstOpening = computedRows.length > 0 ? computedRows[0].openingCash : 0;
    const finalClosing = computedRows.length > 0 ? computedRows[computedRows.length - 1].closingCash : 0;

    return {
      totalSale,
      totalPurchase,
      totalExtra,
      totalCredit,
      totalRecovery,
      totalKitchen,
      totalExpenses,
      firstOpening,
      finalClosing,
    };
  }, [computedRows]);

  // Handle cell edit
  const handleCellChange = (dateIso: string, field: keyof DailyHisabRow, value: string) => {
    const monthOverrides = { ...(savedRecords[monthKey] || {}) };
    const rowOverride = { ...(monthOverrides[dateIso] || {}) };

    if (field === 'details') {
      rowOverride.details = value;
    } else {
      const num = value.trim() === '' ? 0 : parseFloat(value) || 0;
      (rowOverride as any)[field] = num;

      if (field === 'openingCash') {
        rowOverride.isOpeningCashManual = true;
      }
    }

    rowOverride.isEditedByUser = true;
    monthOverrides[dateIso] = rowOverride;

    const nextSaved = {
      ...savedRecords,
      [monthKey]: monthOverrides,
    };

    persistChanges(nextSaved);
  };

  // Reset current month overrides back to purely automated state
  const handleConfirmResetMonth = () => {
    const nextSaved = { ...savedRecords };
    delete nextSaved[monthKey];
    persistChanges(nextSaved);
    setShowResetConfirm(false);
  };

  // Export to Excel CSV
  const handleExportCSV = () => {
    const headers = [
      'Date',
      'Opening Cash',
      'Daily Sale',
      'Daily Purchase',
      'Daily Extra',
      'Daily Credit',
      'Daily Recovery',
      'Daily Kitchen',
      'Daily Expenses',
      'Details',
      'Closing Cash',
    ];

    const rows = computedRows.map((r) => [
      r.date,
      r.openingCash,
      r.dailySale,
      r.dailyPurchase,
      r.dailyExtra,
      r.dailyCredit,
      r.dailyRecovery,
      r.dailyKitchen,
      r.dailyExpenses,
      `"${(r.details || '').replace(/"/g, '""')}"`,
      r.closingCash,
    ]);

    const totalRow = [
      'TOTAL',
      totals.firstOpening,
      totals.totalSale,
      totals.totalPurchase,
      totals.totalExtra,
      totals.totalCredit,
      totals.totalRecovery,
      totals.totalKitchen,
      totals.totalExpenses,
      `"Final Closing: ${totals.finalClosing}"`,
      totals.finalClosing,
    ];

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(',')), totalRow.join(',')].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Waqas_Mart_Daily_Hisab_${monthKey}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Month navigation
  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  // Generate wide array of years up to 3000
  const availableYears = useMemo(() => {
    const list: number[] = [];
    // Standard years 2020 through 2050
    for (let y = 2020; y <= 2050; y++) {
      list.push(y);
    }
    // Milestone decades and centuries up to year 3000
    const milestones = [
      2060, 2070, 2080, 2090, 2100, 2150, 2200, 2250, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000,
    ];
    for (const m of milestones) {
      if (!list.includes(m)) list.push(m);
    }
    // Ensure selectedYear is always in the dropdown list if set by user
    if (!list.includes(selectedYear) && selectedYear >= 1900 && selectedYear <= 3000) {
      list.push(selectedYear);
      list.sort((a, b) => a - b);
    }
    return list;
  }, [selectedYear]);

  // Clean print handler via centralized printerService (A4 landscape Daily Hisab)
  const handlePrintDailyHisab = async () => {
    setIsPrinting(true);
    setPrintFeedback(null);
    const result = await printDailyHisabReport(
      `${activeMonthName} ${selectedYear}`,
      computedRows,
      {
        sale: totals.totalSale,
        purchase: totals.totalPurchase,
        extra: totals.totalExtra,
        credit: totals.totalCredit,
        recovery: totals.totalRecovery,
        kitchen: totals.totalKitchen,
        expenses: totals.totalExpenses,
        closingCash: totals.finalClosing,
      },
      branding
    );
    setIsPrinting(false);
    setPrintFeedback({ type: result.ok ? 'success' : 'error', message: result.message });
  };

  return (
    <div className="flex-1 w-full min-h-full bg-[#f1f5f9] text-slate-900 font-sans flex flex-col">
      {/* Universal Fullscreen Header with Back/Exit & Fullscreen Toggle */}
      <FullScreenPageHeader
        title="Daily Hisab Register"
        urduTitle="روزانہ حساب کھاتہ رجسٹر"
        icon={<FileSpreadsheet className="w-5 h-5 text-white" />}
        onBackToHome={() => {
          if (onBackToHome) onBackToHome();
          else if (onNavigateToSummary) onNavigateToSummary();
        }}
        badge={`${activeMonthName} ${selectedYear}`}
        badgeColor="bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
        actions={
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handlePrintDailyHisab}
              className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-white" />
              <span>Print Month Bill (پرنٹ ماہانہ بل)</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold rounded-xl text-xs flex items-center gap-1 shadow-sm transition active:scale-95 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">CSV Export</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 p-3 sm:p-4 lg:p-5 w-full space-y-3 overflow-y-auto">
        {printFeedback && (
          <div
            className={`px-4 py-2.5 rounded-2xl border flex items-center justify-between gap-2 text-xs font-bold ${
              printFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {printFeedback.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
              <span>{printFeedback.message}</span>
            </div>
            <button type="button" onClick={() => setPrintFeedback(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Top Summary KPI Strip (Green / Blue / White / Light Grey) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase block">1st Opening Cash</span>
            <span className="text-base sm:text-lg font-black text-slate-900 tabular-nums">Rs. {totals.firstOpening.toLocaleString('en-PK')}</span>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-emerald-800 uppercase block">Monthly Sales</span>
            <span className="text-base sm:text-lg font-black text-emerald-700 tabular-nums">Rs. {totals.totalSale.toLocaleString('en-PK')}</span>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-blue-800 uppercase block">Monthly Purchase</span>
            <span className="text-base sm:text-lg font-black text-blue-700 tabular-nums">Rs. {totals.totalPurchase.toLocaleString('en-PK')}</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase block">Credit / Recovery</span>
            <span className="text-sm sm:text-base font-black text-slate-800 tabular-nums">
              {totals.totalCredit.toLocaleString()} / <span className="text-emerald-700">{totals.totalRecovery.toLocaleString()}</span>
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-600 uppercase block">Kitchen + Expenses</span>
            <span className="text-base sm:text-lg font-black text-slate-800 tabular-nums">
              Rs. {(totals.totalKitchen + totals.totalExpenses).toLocaleString('en-PK')}
            </span>
          </div>
          <div className="bg-gradient-to-br from-emerald-700 to-blue-800 text-white rounded-2xl p-3 shadow-sm">
            <span className="text-[11px] font-bold text-emerald-100 uppercase block">Final Closing Cash</span>
            <span className="text-base sm:text-xl font-black text-white tabular-nums">Rs. {totals.finalClosing.toLocaleString('en-PK')}</span>
          </div>
        </div>

      {/* 1. CLEAN CONTROL RIBBON */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Page Title */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <FileSpreadsheet className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                  Daily Hisab (روزانہ حساب کھاتہ)
                </h1>
                <span className="bg-blue-50 text-blue-800 text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full border border-blue-200">
                  {activeMonthName} {selectedYear}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Closing Cash = Opening + (Sale − Credit) + Extra + Recovery − Purchase − Kitchen − Expenses
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {onNavigateToSummary && (
              <button
                type="button"
                onClick={onNavigateToSummary}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-xl font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <TrendingUp className="w-4 h-4" />
                <span>Reports</span>
              </button>
            )}

            {onNavigateToLedgers && (
              <button
                type="button"
                onClick={onNavigateToLedgers}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Customer Ledgers</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              title="Download Excel CSV Spreadsheet"
            >
              <Download className="w-4 h-4" />
              <span>Export Excel</span>
            </button>

            <button
              type="button"
              disabled={isPrinting}
              onClick={handlePrintDailyHisab}
              className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white rounded-xl font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Print Daily Hisab Register Sheet"
            >
              <Printer className="w-4 h-4" />
              <span>{isPrinting ? 'Printing...' : 'Print Daily Report'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold flex items-center gap-1 transition-colors cursor-pointer"
              title="Open Printable Preview Modal"
            >
              <span>Preview</span>
            </button>

            {showResetConfirm ? (
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-2.5 py-1.5">
                <span className="text-[11px] font-bold text-red-800">Reset {activeMonthName}?</span>
                <button
                  type="button"
                  onClick={handleConfirmResetMonth}
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold cursor-pointer"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="px-2 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg font-bold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="px-3 py-2 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Reset any manual cell overrides for this month"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Auto</span>
              </button>
            )}
          </div>
        </div>

        {/* Month Selector & Initial Opening Cash Setup */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 font-black text-sm text-slate-800 bg-slate-50 px-3.5 py-1.5 rounded-xl border border-slate-200">
              <Calendar className="w-4 h-4 text-emerald-600" />
              <span>{activeMonthName} {selectedYear}</span>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-bold cursor-pointer"
            >
              {monthNames.map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1">
              <span className="text-[11px] uppercase font-bold text-slate-500">Year:</span>
              <input
                type="number"
                min="1990"
                max="3000"
                value={selectedYear}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1990 && val <= 3000) {
                    setSelectedYear(val);
                  }
                }}
                className="w-16 font-mono font-bold text-sm text-slate-900 text-center bg-slate-50 border border-slate-200 rounded-lg px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                title="Enter Any Year up to 3000"
              />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-white text-xs sm:text-sm font-bold text-slate-700 border-l border-slate-200 pl-2 cursor-pointer focus:outline-none"
                title="Select Year from list (up to 3000)"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-emerald-50 px-3.5 py-1.5 rounded-xl border border-emerald-200 text-xs sm:text-sm">
            <span className="font-bold text-emerald-900">1st Day Opening Cash:</span>
            <input
              type="number"
              value={initialOpeningCash}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                setInitialOpeningCash(val);
                handleCellChange(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`, 'openingCash', String(val));
              }}
              className="w-28 px-2.5 py-1 bg-white border border-emerald-300 rounded-lg font-mono font-black text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-right tabular-nums"
            />
            <span className="text-xs text-emerald-700 font-bold">Rs.</span>
          </div>

          {saveSuccessMsg && (
            <div className="flex items-center gap-1.5 text-emerald-800 font-bold bg-emerald-100 px-3 py-1.5 rounded-xl animate-fade-in text-xs">
              <CheckCircle2 className="w-4 h-4" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. LARGE DESKTOP-OPTIMIZED DAILY HISAB REGISTER TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        <div className="lg:hidden px-3 py-2 bg-blue-50 border-b border-blue-200 text-blue-900 text-xs font-bold flex items-center justify-between">
          <span>👉 دائیں طرف اسکرول کریں اور کسی بھی سیل میں رقم درج کریں</span>
          <span className="font-mono text-blue-700 text-[11px]">Swipe horizontally</span>
        </div>

        <div className="overflow-x-auto max-h-[78vh] overflow-y-auto">
          <table className="w-full min-w-[1260px] text-xs sm:text-sm border-collapse font-sans">
            <thead className="sticky top-0 z-20 select-none">
              <tr className="bg-gradient-to-r from-emerald-800 via-emerald-700 to-blue-800 text-white font-black text-xs sm:text-[13px] tracking-wide border-b-2 border-emerald-900">
                <th className="border-r border-white/15 py-3.5 px-3 text-center w-12 bg-emerald-900/50">#</th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[125px] bg-emerald-900/30">
                  1. Opening Cash
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-center whitespace-nowrap min-w-[115px]">
                  2. Date
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[120px]">
                  3. Daily Sale
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[120px]">
                  4. Daily Purchase
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[110px]">
                  5. Daily Extra
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[115px]">
                  6. Daily Credit
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[120px]">
                  7. Daily Recovery
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[110px]">
                  8. Daily Kitchen
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-right whitespace-nowrap min-w-[120px]">
                  9. Daily Expenses
                </th>
                <th className="border-r border-white/15 py-3.5 px-3.5 text-left whitespace-nowrap min-w-[210px]">
                  10. Details
                </th>
                <th className="py-3.5 px-3.5 text-right whitespace-nowrap min-w-[135px] bg-blue-900/50">
                  11. Closing Cash
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
              {computedRows.map((row, idx) => {
                const dayIndex = idx + 1;
                const isSelected = selectedRowDate === row.dateIso;

                return (
                  <tr
                    key={row.dateIso}
                    onClick={() => setSelectedRowDate(row.dateIso)}
                    className={`transition-colors min-h-[46px] ${
                      isSelected
                        ? 'bg-blue-50/95 ring-1 ring-inset ring-blue-300'
                        : idx % 2 === 0
                        ? 'bg-white hover:bg-emerald-50/40'
                        : 'bg-slate-50/90 hover:bg-emerald-50/40'
                    }`}
                  >
                    <td className="border-r border-slate-200 py-2.5 px-2.5 text-center text-slate-500 bg-slate-100/70 font-bold select-none tabular-nums">
                      {dayIndex}
                    </td>

                    {/* 1. Opening Cash */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right bg-emerald-50/35">
                      <input
                        type="number"
                        value={row.openingCash === 0 ? '' : row.openingCash}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'openingCash' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'openingCash', e.target.value)}
                        className={`w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums font-bold ${
                          row.isOpeningCashManual ? 'text-blue-800' : 'text-slate-800'
                        }`}
                        title={row.isOpeningCashManual ? 'Manually edited opening cash' : "Carried forward from yesterday's closing cash"}
                      />
                    </td>

                    {/* 2. Date */}
                    <td className="border-r border-slate-200 py-2.5 px-3 text-slate-900 font-bold whitespace-nowrap text-center font-mono">
                      {row.date}
                    </td>

                    {/* 3. Daily Sale */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailySale === 0 ? '' : row.dailySale}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailySale' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailySale', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-emerald-800 font-black"
                      />
                    </td>

                    {/* 4. Daily Purchase */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailyPurchase === 0 ? '' : row.dailyPurchase}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailyPurchase' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailyPurchase', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-blue-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-blue-800 font-bold"
                      />
                    </td>

                    {/* 5. Daily Extra */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailyExtra === 0 ? '' : row.dailyExtra}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailyExtra' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailyExtra', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-slate-700 font-semibold"
                      />
                    </td>

                    {/* 6. Daily Credit */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailyCredit === 0 ? '' : row.dailyCredit}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailyCredit' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailyCredit', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-blue-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-amber-800 font-bold"
                        title="Credit sales (Udhar given to customers)"
                      />
                    </td>

                    {/* 7. Daily Recovery */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailyRecovery === 0 ? '' : row.dailyRecovery}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailyRecovery' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailyRecovery', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-emerald-700 font-bold"
                        title="Cash recovery collected against previous customer credit"
                      />
                    </td>

                    {/* 8. Daily Kitchen */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailyKitchen === 0 ? '' : row.dailyKitchen}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailyKitchen' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailyKitchen', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-blue-500 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-slate-700 font-semibold"
                      />
                    </td>

                    {/* 9. Daily Expenses */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-right">
                      <input
                        type="number"
                        value={row.dailyExpenses === 0 ? '' : row.dailyExpenses}
                        placeholder="0"
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'dailyExpenses' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'dailyExpenses', e.target.value)}
                        className="w-full py-1.5 px-2 text-right bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-red-400 focus:outline-none rounded-lg font-mono text-xs sm:text-sm tabular-nums text-red-700 font-bold"
                      />
                    </td>

                    {/* 10. Details */}
                    <td className="border-r border-slate-200 py-1.5 px-2 text-left font-sans">
                      <input
                        type="text"
                        value={row.details || ''}
                        placeholder="Details / تفصیل..."
                        onFocus={() => setActiveCell({ dateIso: row.dateIso, field: 'details' })}
                        onBlur={() => setActiveCell(null)}
                        onChange={(e) => handleCellChange(row.dateIso, 'details', e.target.value)}
                        className="w-full py-1.5 px-2.5 text-left bg-transparent border border-transparent hover:border-slate-300 focus:bg-white focus:border-blue-500 focus:outline-none rounded-lg text-xs sm:text-sm text-slate-800"
                      />
                    </td>

                    {/* 11. Closing / Remaining Cash */}
                    <td className="py-2.5 px-3.5 text-right font-black font-mono text-sm sm:text-base text-blue-950 bg-blue-50/70 tabular-nums">
                      {row.closingCash.toLocaleString('en-PK')}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* TOTAL FOOTER IN DEEP BLUE & EMERALD */}
            <tfoot className="sticky bottom-0 z-20 bg-[#1e3a8a] text-white font-mono font-black text-xs sm:text-sm border-t-2 border-emerald-400 select-none">
              <tr>
                <td className="border-r border-blue-700 py-3 px-2.5 text-center bg-[#172554]">
                  Σ
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-blue-100" title="Initial Month Opening Cash">
                  {totals.firstOpening.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-center uppercase tracking-wider text-emerald-300">
                  TOTAL
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-emerald-200">
                  {totals.totalSale.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-blue-100">
                  {totals.totalPurchase.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-blue-100">
                  {totals.totalExtra.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-amber-300">
                  {totals.totalCredit.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-emerald-300">
                  {totals.totalRecovery.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-blue-100">
                  {totals.totalKitchen.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-right tabular-nums text-red-300">
                  {totals.totalExpenses.toLocaleString('en-PK')}
                </td>
                <td className="border-r border-blue-700 py-3 px-3.5 text-left font-sans text-xs text-blue-200">
                  Net Period Closing
                </td>
                <td className="py-3 px-3.5 text-right tabular-nums text-emerald-300 text-sm sm:text-base bg-emerald-900/60">
                  Rs. {totals.finalClosing.toLocaleString('en-PK')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* BOTTOM STATUS STRIP */}
        <div className="bg-slate-100 px-4 py-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-slate-700">
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <span className="font-bold text-slate-500 uppercase text-[11px]">Sheets:</span>
            <span className="bg-white px-3 py-1 rounded-lg shadow-2xs font-bold text-emerald-800 border border-slate-200">
              Daily Hisab ({activeMonthName})
            </span>
            {onNavigateToLedgers && (
              <button
                type="button"
                onClick={onNavigateToLedgers}
                className="bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-lg font-bold text-blue-800 border border-blue-200 cursor-pointer"
              >
                Customer Udhar Ledgers
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm font-bold">
            <span>Opening: <strong className="font-mono text-slate-900">Rs. {totals.firstOpening.toLocaleString('en-PK')}</strong></span>
            <span>·</span>
            <span>Sales: <strong className="font-mono text-emerald-700">Rs. {totals.totalSale.toLocaleString('en-PK')}</strong></span>
            <span>·</span>
            <span>Purchases: <strong className="font-mono text-blue-800">Rs. {totals.totalPurchase.toLocaleString('en-PK')}</strong></span>
            <span>·</span>
            <span>Closing Cash: <strong className="font-mono text-emerald-800">Rs. {totals.finalClosing.toLocaleString('en-PK')}</strong></span>
          </div>
        </div>
      </div>

      {/* PRINT PREVIEW MODAL */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-fade-in">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base tracking-tight">
                    Print Daily Hisab Register (روزانہ کھاتہ پرنٹ پیش نظارہ)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {activeMonthName} {selectedYear} · Complete Landscape A4 Spreadsheet
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintDailyHisab}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Now (پرنٹ کریں)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Scrollable Printable Document Preview */}
            <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-100">
              <div className="bg-white p-6 rounded-xl border border-slate-300 shadow-sm text-slate-900 max-w-full overflow-x-auto text-[11px] font-sans">
                {/* Official Sheet Header */}
                <div className="flex items-end justify-between border-b-2 border-slate-900 pb-3 mb-3">
                  <div>
                    <h1 className="text-2xl font-black text-emerald-700 tracking-tight">WAQAS MART (وقاص مارٹ)</h1>
                    <h2 className="text-sm font-bold text-slate-800">
                      Monthly Business Hisab Bill & Register (ماہانہ کاروباری حساب بل برائے اونر / مالک) — {activeMonthName} {selectedYear}
                    </h2>
                    <p className="text-[10px] text-slate-500">Supermarket Retail POS & Ledger Management System</p>
                  </div>
                  <div className="text-right text-[10px] text-slate-600 space-y-0.5">
                    <div><strong>Printed On:</strong> {new Date().toLocaleDateString('en-GB')} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div><strong>Initial Month Cash:</strong> Rs. {totals.firstOpening.toFixed(0)}</div>
                    <div><strong>Final Month Closing:</strong> Rs. {totals.finalClosing.toFixed(0)}</div>
                  </div>
                </div>

                {/* Printable Stats Cards */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3 text-center">
                  <div className="border border-slate-200 rounded p-1.5 bg-slate-50">
                    <span className="text-[9px] uppercase text-slate-500 font-bold block">Opening Cash</span>
                    <span className="font-mono font-bold text-slate-900 text-xs">{totals.firstOpening.toFixed(0)}</span>
                  </div>
                  <div className="border border-emerald-200 rounded p-1.5 bg-emerald-50/50">
                    <span className="text-[9px] uppercase text-emerald-800 font-bold block">Total Sales</span>
                    <span className="font-mono font-bold text-emerald-700 text-xs">{totals.totalSale.toFixed(0)}</span>
                  </div>
                  <div className="border border-blue-200 rounded p-1.5 bg-blue-50/50">
                    <span className="text-[9px] uppercase text-blue-800 font-bold block">Total Purchases</span>
                    <span className="font-mono font-bold text-blue-700 text-xs">{totals.totalPurchase.toFixed(0)}</span>
                  </div>
                  <div className="border border-red-200 rounded p-1.5 bg-red-50/50">
                    <span className="text-[9px] uppercase text-red-800 font-bold block">Total Udhar</span>
                    <span className="font-mono font-bold text-red-700 text-xs">{totals.totalCredit.toFixed(0)}</span>
                  </div>
                  <div className="border border-green-200 rounded p-1.5 bg-green-50/50">
                    <span className="text-[9px] uppercase text-green-800 font-bold block">Total Recovery</span>
                    <span className="font-mono font-bold text-green-700 text-xs">{totals.totalRecovery.toFixed(0)}</span>
                  </div>
                  <div className="border border-indigo-200 rounded p-1.5 bg-indigo-50/50">
                    <span className="text-[9px] uppercase text-indigo-900 font-bold block">Closing Cash</span>
                    <span className="font-mono font-bold text-indigo-900 text-xs">{totals.finalClosing.toFixed(0)}</span>
                  </div>
                </div>

                {/* Full Printable Table */}
                <table className="w-full border-collapse border border-slate-400 text-[10.5px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800 font-bold text-center">
                      <th className="border border-slate-400 p-1">Date</th>
                      <th className="border border-slate-400 p-1">Opening</th>
                      <th className="border border-slate-400 p-1">Daily Sale</th>
                      <th className="border border-slate-400 p-1">Purchase</th>
                      <th className="border border-slate-400 p-1">Extra</th>
                      <th className="border border-slate-400 p-1">Credit</th>
                      <th className="border border-slate-400 p-1">Recovery</th>
                      <th className="border border-slate-400 p-1">Kitchen</th>
                      <th className="border border-slate-400 p-1">Expenses</th>
                      <th className="border border-slate-400 p-1">Details</th>
                      <th className="border border-slate-400 p-1">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computedRows.map((r, idx) => (
                      <tr key={r.dateIso} className={idx % 2 === 1 ? 'bg-slate-50/80' : 'bg-white'}>
                        <td className="border border-slate-400 p-1 text-center font-medium font-mono">{r.date}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono">{r.openingCash.toFixed(0)}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono font-bold">{r.dailySale > 0 ? r.dailySale.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono">{r.dailyPurchase > 0 ? r.dailyPurchase.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono">{r.dailyExtra > 0 ? r.dailyExtra.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono text-red-700 font-semibold">{r.dailyCredit > 0 ? r.dailyCredit.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono text-emerald-700 font-semibold">{r.dailyRecovery > 0 ? r.dailyRecovery.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono">{r.dailyKitchen > 0 ? r.dailyKitchen.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono text-slate-700">{r.dailyExpenses > 0 ? r.dailyExpenses.toFixed(0) : '-'}</td>
                        <td className="border border-slate-400 p-1 text-left text-[9.5px] max-w-[140px] truncate">{r.details || '-'}</td>
                        <td className="border border-slate-400 p-1 text-right font-mono font-bold bg-emerald-50/30">{r.closingCash.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#3730a3] text-white font-mono font-bold">
                      <td className="border border-indigo-400 p-1 text-center">TOTAL</td>
                      <td className="border border-indigo-400 p-1 text-right">{totals.firstOpening.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right text-amber-200">{totals.totalSale.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right">{totals.totalPurchase.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right">{totals.totalExtra.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right text-amber-300">{totals.totalCredit.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right text-emerald-300">{totals.totalRecovery.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right">{totals.totalKitchen.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-right text-red-200">{totals.totalExpenses.toFixed(0)}</td>
                      <td className="border border-indigo-400 p-1 text-left text-[9.5px]">Net Period Flow</td>
                      <td className="border border-indigo-400 p-1 text-right text-emerald-200 text-xs">{totals.finalClosing.toFixed(0)}</td>
                    </tr>
                  </tfoot>
                </table>

                {/* Formula Footer */}
                <div className="mt-2 text-[9px] text-slate-500 italic">
                  * Accounting Formula: Closing Cash = Opening Cash + (Daily Sale − Daily Credit) + Extra + Recovery − Purchase − Kitchen − Expenses
                </div>

                {/* Signatures */}
                <div className="flex justify-between items-center mt-8 px-6 pt-2">
                  <div className="w-36 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                    Prepared By (Cashier)
                  </div>
                  <div className="w-36 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                    Verified By (Accountant)
                  </div>
                  <div className="w-36 border-t border-slate-700 text-center text-[10px] font-bold pt-1">
                    Approved By (Owner)
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Bottom Action Bar */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 text-xs shrink-0">
              <span className="text-slate-500 font-medium">
                💡 Click "Print Now" to generate print dialog with landscape A4 formatting.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Close (بند کریں)
                </button>
                <button
                  type="button"
                  onClick={handlePrintDailyHisab}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Now (پرنٹ کریں)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
