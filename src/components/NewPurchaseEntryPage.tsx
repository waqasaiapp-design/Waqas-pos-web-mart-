import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Truck,
  Search,
  ScanBarcode,
  Plus,
  Minus,
  Trash2,
  Printer,
  Save,
  RotateCcw,
  FileText,
  UserPlus,
  Building2,
  Phone,
  MapPin,
  Calendar,
  Package,
  AlertTriangle,
  CheckCircle2,
  X,
  Edit3,
  Eye,
  Lock,
  Banknote,
  CreditCard,
  Clock,
  ArrowRight,
} from 'lucide-react';
import {
  Product,
  Supplier,
  PurchaseTransaction,
  PurchaseItem,
  StoreBranding,
  UserProfile,
  DeviceInfo,
} from '../types/pos';
import { formatRs } from '../data/defaultProducts';
import { sounds } from '../utils/audio';
import {
  computePurchaseItemAmounts,
  computePurchaseTotals,
  roundMoney,
} from '../utils/purchaseHelpers';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import { AddSupplierModal } from './AddSupplierModal';
import { SearchPurchasesModal } from './SearchPurchasesModal';
import { PrintPurchaseModal } from './PrintPurchaseModal';
import { BarcodeScannerModal } from './BarcodeScannerModal';

interface NewPurchaseEntryPageProps {
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  branding: StoreBranding;
  currentUser: UserProfile;
  currentDevice: DeviceInfo;
  onSavePurchase: (purchase: PurchaseTransaction, isEdit?: boolean) => void;
  onDeletePurchase?: (purchaseId: string) => void;
  onAddSupplier: (supplier: Supplier) => void;
  onOpenAddProduct: () => void;
  onOpenScanner: () => void;
  onNavigate: (page: string) => void;
  onUpdateBranding?: (branding: StoreBranding) => void;
  scannedBarcode?: string | null;
  onClearScannedBarcode?: () => void;
}

const VAT_RATES = [
  { label: '0% (None)', value: 0 },
  { label: '5% VAT', value: 5 },
  { label: '18% GST', value: 18 },
];

export const NewPurchaseEntryPage: React.FC<NewPurchaseEntryPageProps> = ({
  products,
  suppliers,
  purchases,
  branding,
  currentUser,
  onSavePurchase,
  onDeletePurchase,
  onAddSupplier,
  onOpenAddProduct,
  onNavigate,
  scannedBarcode = null,
  onClearScannedBarcode,
}) => {
  const userNameDisplay = currentUser?.displayName || 'Admin';

  const generateNextInvoiceNo = () => {
    const num = 3010 + purchases.length + 1;
    return `PUR-${num}`;
  };

  // Mode & Editing State
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [originalSavedPurchase, setOriginalSavedPurchase] =
    useState<PurchaseTransaction | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Invoice & Supplier Header Fields
  const [invoiceNo, setInvoiceNo] = useState<string>(() => generateNextInvoiceNo());
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(
    () => suppliers[0]?.id || ''
  );
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'card'>('cash');
  const [notes, setNotes] = useState<string>('');

  // Ensure a default supplier is selected when suppliers load
  useEffect(() => {
    if (suppliers.length > 0 && !selectedSupplierId && !isReadOnly) {
      setSelectedSupplierId(suppliers[0].id);
    }
  }, [suppliers, selectedSupplierId, isReadOnly]);

  const activeSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  // Items & Quantity Draft Strings (so typing "-" or "-5" works smoothly)
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  // Totals & Tax/Discount Controls
  const [vatRatePercent, setVatRatePercent] = useState<number>(0);
  const [discountType, setDiscountType] = useState<'rs' | 'percent'>('rs');
  const [discountInput, setDiscountInput] = useState<number>(0);
  const [expensesAmount, setExpensesAmount] = useState<number>(0);
  const [amountPaidInput, setAmountPaidInput] = useState<string>('');

  // Product Search / Barcode Autocomplete
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Modals
  const [isAddSupplierOpen, setIsAddSupplierOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [printModalPurchase, setPrintModalPurchase] =
    useState<PurchaseTransaction | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [pendingNegativeSave, setPendingNegativeSave] = useState<{
    tx: PurchaseTransaction;
    isEdit: boolean;
    printAfter: boolean;
  } | null>(null);

  // Toast Notification
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  // Close suggestions dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Live filtered product suggestions
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [products, searchQuery]);

  // Recompute line VAT when VAT rate changes (active draft or editing)
  useEffect(() => {
    if (isReadOnly && !isEditing) return;
    setPurchaseItems((prev) =>
      prev.map((item) => {
        const calc = computePurchaseItemAmounts(
          item.quantity,
          item.purchaseCost,
          vatRatePercent,
          item.discount || 0
        );
        return {
          ...item,
          vat: calc.vat,
          tax: calc.vat,
          netAmount: calc.netAmount,
          wvat: calc.wvat,
          lineTotal: calc.lineTotal,
        };
      })
    );
  }, [vatRatePercent, isReadOnly, isEditing]);

  // Live financial totals
  const totals = useMemo(() => {
    return computePurchaseTotals({
      items: purchaseItems,
      discountPercent: discountType === 'percent' ? discountInput : 0,
      discountAmount: discountType === 'rs' ? discountInput : 0,
      expensesAmount,
      roundoff: 0,
      amountPaid: amountPaidInput === '' ? '' : Number(amountPaidInput) || 0,
      paymentMethod,
    });
  }, [
    purchaseItems,
    discountType,
    discountInput,
    expensesAmount,
    amountPaidInput,
    paymentMethod,
  ]);

  // Add Product to Purchase List
  const handleAddProduct = (product: Product, qtyDelta = 1) => {
    if (isReadOnly && !isEditing) {
      showToast('Invoice is in Read-Only mode. Click "Edit Invoice" or "New Bill" first.', 'info');
      return;
    }

    sounds.playBarcodeBeep();

    setPurchaseItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.productId === product.id);
      if (existingIdx > -1) {
        return prev.map((it, idx) => {
          if (idx !== existingIdx) return it;
          const nextQty = it.quantity + qtyDelta;
          const calc = computePurchaseItemAmounts(
            nextQty,
            it.purchaseCost,
            vatRatePercent,
            it.discount || 0
          );
          setQtyDrafts((d) => ({ ...d, [it.id]: String(nextQty) }));
          return {
            ...it,
            quantity: nextQty,
            netAmount: calc.netAmount,
            vat: calc.vat,
            tax: calc.vat,
            wvat: calc.wvat,
            lineTotal: calc.lineTotal,
          };
        });
      }

      const cost = Number(product.costPrice) || 0;
      const sale = Number(product.price) || 0;
      const calc = computePurchaseItemAmounts(qtyDelta, cost, vatRatePercent, 0);
      const rowId = `npi-${Date.now()}-${product.id}-${Math.random().toString(36).slice(2, 5)}`;

      const newItem: PurchaseItem = {
        id: rowId,
        productId: product.id,
        productName: product.name,
        barcode: product.barcode || product.sku || '',
        currentStock: Number(product.stock) || 0,
        quantity: qtyDelta,
        purchaseCost: cost,
        salePrice: sale,
        discount: 0,
        tax: calc.vat,
        vat: calc.vat,
        wvat: calc.wvat,
        netAmount: calc.netAmount,
        lineTotal: calc.lineTotal,
        imageUrl: product.imageUrl,
      };
      setQtyDrafts((d) => ({ ...d, [rowId]: String(qtyDelta) }));
      return [...prev, newItem];
    });

    setSearchQuery('');
    setShowSuggestions(false);
    setHighlightedIdx(0);
  };

  // Barcode scan handler (camera modal or hardware scanner Enter key)
  const handleBarcodeLookupAndAdd = (rawCode: string) => {
    const clean = (rawCode || '').trim().toLowerCase();
    if (!clean) return;
    if (isReadOnly && !isEditing) {
      showToast('Invoice is in Read-Only mode. Click "Edit Invoice" or "New Bill" first.', 'info');
      return;
    }
    const exactMatch = products.find(
      (p) =>
        (p.barcode || '').trim().toLowerCase() === clean ||
        (p.sku || '').trim().toLowerCase() === clean ||
        (p.name || '').trim().toLowerCase() === clean
    );
    if (exactMatch) {
      handleAddProduct(exactMatch, 1);
      showToast(`Added "${exactMatch.name}"`, 'success');
    } else {
      sounds.playErrorTone();
      showToast(`No product found matching "${rawCode}". Try searching or add new product.`, 'error');
    }
  };

  useEffect(() => {
    if (scannedBarcode && scannedBarcode.trim()) {
      handleBarcodeLookupAndAdd(scannedBarcode.trim());
      onClearScannedBarcode?.();
    }
  }, [scannedBarcode]);

  // Update Item Quantity (supports positive +1, +10 AND negative -1, -5)
  const updateItemQuantity = (itemId: string, newQty: number) => {
    if (isReadOnly && !isEditing) return;
    setQtyDrafts((d) => ({ ...d, [itemId]: String(newQty) }));
    setPurchaseItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const calc = computePurchaseItemAmounts(
          newQty,
          it.purchaseCost,
          vatRatePercent,
          it.discount || 0
        );
        return {
          ...it,
          quantity: newQty,
          netAmount: calc.netAmount,
          vat: calc.vat,
          tax: calc.vat,
          wvat: calc.wvat,
          lineTotal: calc.lineTotal,
        };
      })
    );
  };

  const handleQtyTextChange = (itemId: string, rawText: string) => {
    if (isReadOnly && !isEditing) return;
    setQtyDrafts((d) => ({ ...d, [itemId]: rawText }));

    if (rawText === '' || rawText === '-' || rawText === '.' || rawText === '-.') {
      return;
    }
    const parsed = Number(rawText);
    if (Number.isFinite(parsed)) {
      setPurchaseItems((prev) =>
        prev.map((it) => {
          if (it.id !== itemId) return it;
          const calc = computePurchaseItemAmounts(
            parsed,
            it.purchaseCost,
            vatRatePercent,
            it.discount || 0
          );
          return {
            ...it,
            quantity: parsed,
            netAmount: calc.netAmount,
            vat: calc.vat,
            tax: calc.vat,
            wvat: calc.wvat,
            lineTotal: calc.lineTotal,
          };
        })
      );
    }
  };

  const handleQtyTextBlur = (itemId: string, currentQty: number) => {
    const draft = qtyDrafts[itemId];
    if (draft === '' || draft === '-' || draft === '.' || draft === '-.') {
      setQtyDrafts((d) => ({ ...d, [itemId]: String(currentQty) }));
    }
  };

  const updateItemCost = (itemId: string, newCost: number) => {
    if (isReadOnly && !isEditing) return;
    const safeCost = Math.max(0, Number.isFinite(newCost) ? newCost : 0);
    setPurchaseItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const calc = computePurchaseItemAmounts(
          it.quantity,
          safeCost,
          vatRatePercent,
          it.discount || 0
        );
        return {
          ...it,
          purchaseCost: safeCost,
          netAmount: calc.netAmount,
          vat: calc.vat,
          tax: calc.vat,
          wvat: calc.wvat,
          lineTotal: calc.lineTotal,
        };
      })
    );
  };

  const updateItemSalePrice = (itemId: string, newSale: number) => {
    if (isReadOnly && !isEditing) return;
    const safeSale = Math.max(0, Number.isFinite(newSale) ? newSale : 0);
    setPurchaseItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, salePrice: safeSale } : it))
    );
  };

  const removeItem = (itemId: string) => {
    if (isReadOnly && !isEditing) return;
    setPurchaseItems((prev) => prev.filter((it) => it.id !== itemId));
    setQtyDrafts((d) => {
      const next = { ...d };
      delete next[itemId];
      return next;
    });
  };

  // Reset Form for a Fresh New Purchase
  const handleNewBill = () => {
    setIsReadOnly(false);
    setIsEditing(false);
    setEditingPurchaseId(null);
    setOriginalSavedPurchase(null);
    setInvoiceNo(generateNextInvoiceNo());
    setSupplierInvoiceNo('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setSelectedSupplierId(suppliers[0]?.id || '');
    setPaymentMethod('cash');
    setNotes('');
    setPurchaseItems([]);
    setQtyDrafts({});
    setDiscountType('rs');
    setDiscountInput(0);
    setVatRatePercent(0);
    setExpensesAmount(0);
    setAmountPaidInput('');
    setSearchQuery('');
    setShowSuggestions(false);
    setTimeout(() => searchInputRef.current?.focus(), 60);
  };

  // Load a Saved Purchase in Read-Only or Edit Mode
  const loadSavedPurchase = (purchase: PurchaseTransaction, editMode: boolean) => {
    setOriginalSavedPurchase(purchase);
    setEditingPurchaseId(purchase.id);
    setIsEditing(editMode);
    setIsReadOnly(!editMode);
    setInvoiceNo(purchase.purchaseInvoiceNo);
    setSupplierInvoiceNo(purchase.supplierInvoiceNo || '');
    setPurchaseDate(purchase.purchaseDate || new Date().toISOString().split('T')[0]);
    setSelectedSupplierId(purchase.supplierId || suppliers[0]?.id || '');
    setPaymentMethod(
      (purchase.paymentMethod?.toLowerCase() as 'cash' | 'credit' | 'card') || 'cash'
    );
    setNotes(purchase.notes || '');

    const loadedItems = (purchase.items || []).map((it) => ({ ...it }));
    setPurchaseItems(loadedItems);
    const nextDrafts: Record<string, string> = {};
    loadedItems.forEach((it) => {
      nextDrafts[it.id] = String(it.quantity);
    });
    setQtyDrafts(nextDrafts);

    setDiscountType('rs');
    setDiscountInput(purchase.totalDiscount || 0);
    setExpensesAmount(purchase.expensesAmount || 0);
    setAmountPaidInput(
      purchase.amountPaid !== undefined ? String(purchase.amountPaid) : ''
    );

    if (purchase.totalTax > 0 && purchase.subtotal !== 0) {
      const approxPct = Math.round((purchase.totalTax / Math.abs(purchase.subtotal)) * 100);
      setVatRatePercent(approxPct >= 15 ? 18 : approxPct >= 4 ? 5 : 0);
    } else {
      setVatRatePercent(0);
    }
  };

  // Build Draft / Transaction Object
  const buildTransactionObject = (isEditSave: boolean): PurchaseTransaction | null => {
    const sup = activeSupplier || suppliers[0];
    if (!sup) return null;

    const nowIso = new Date().toISOString();
    const hasNeg = purchaseItems.some((it) => it.quantity < 0);
    const numericRef = invoiceNo.replace(/^PUR-/i, '');

    return {
      id:
        isEditSave && editingPurchaseId
          ? editingPurchaseId
          : `pur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      purchaseInvoiceNo: invoiceNo.trim() || generateNextInvoiceNo(),
      refNo: originalSavedPurchase?.refNo || numericRef,
      purchaseDate,
      entryDate: purchaseDate,
      supplierId: sup.id,
      supplierName: sup.name,
      supplierInvoiceNo: supplierInvoiceNo.trim(),
      items: purchaseItems.map((it) => ({ ...it })),
      subtotal: totals.grossTotal,
      grossTotal: totals.grossTotal,
      totalDiscount: totals.discount,
      totalTax: totals.vat,
      roundoff: 0,
      grandTotal: totals.totalAmount,
      amountPaid: totals.paid,
      remainingBalance: totals.outstanding,
      outstanding: totals.outstanding,
      totalQty: totals.totalQty,
      paymentMethod,
      expensesLabel: expensesAmount > 0 ? 'Freight / Extra Charges' : undefined,
      expensesAmount: expensesAmount > 0 ? expensesAmount : undefined,
      supplierPhone: sup.phone,
      supplierAddress: sup.address || sup.city,
      userName: originalSavedPurchase?.userName || userNameDisplay,
      editBy: isEditSave ? userNameDisplay : undefined,
      hasNegativeAdjustment: hasNeg,
      notes: notes.trim() || undefined,
      createdAt: originalSavedPurchase?.createdAt || nowIso,
      updatedAt: isEditSave ? nowIso : undefined,
      status: isEditSave ? 'edited' : 'saved',
    };
  };

  const commitSave = (
    tx: PurchaseTransaction,
    isEditSave: boolean,
    printAfter: boolean
  ) => {
    setIsSaving(true);
    try {
      onSavePurchase(tx, isEditSave);
      sounds.playSuccessChime();
      showToast(
        isEditSave
          ? `Purchase ${tx.purchaseInvoiceNo} updated & stock reconciled!`
          : tx.hasNegativeAdjustment
          ? `Stock Adjustment ${tx.purchaseInvoiceNo} saved & stock deducted!`
          : `Purchase ${tx.purchaseInvoiceNo} saved! Stock updated.`,
        'success'
      );

      if (printAfter) {
        setPrintModalPurchase(tx);
      }

      if (isEditSave) {
        loadSavedPurchase(tx, false);
      } else {
        // Fresh bill ready for next entry
        setIsReadOnly(false);
        setIsEditing(false);
        setEditingPurchaseId(null);
        setOriginalSavedPurchase(null);
        setInvoiceNo(`PUR-${3010 + purchases.length + 2}`);
        setSupplierInvoiceNo('');
        setNotes('');
        setPurchaseItems([]);
        setQtyDrafts({});
        setDiscountInput(0);
        setExpensesAmount(0);
        setAmountPaidInput('');
      }
    } catch (err) {
      console.error('[NewPurchaseEntryPage] Save error:', err);
      sounds.playErrorTone();
      showToast('Failed to save purchase. Your draft items are intact.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const triggerSave = (printAfter: boolean = false) => {
    if (isSaving) return;

    if (isReadOnly && !isEditing) {
      showToast('This invoice is in Read-Only view. Click "Edit Invoice" to modify.', 'info');
      return;
    }

    if (purchaseItems.length === 0) {
      sounds.playErrorTone();
      showToast('Please add at least one product before saving.', 'error');
      return;
    }

    const zeroItem = purchaseItems.find(
      (it) => !Number.isFinite(it.quantity) || it.quantity === 0
    );
    if (zeroItem) {
      sounds.playErrorTone();
      showToast(
        `Quantity for "${zeroItem.productName}" cannot be 0. Enter + or − quantity.`,
        'error'
      );
      return;
    }

    if (!activeSupplier && suppliers.length === 0) {
      sounds.playErrorTone();
      showToast('Please add a supplier before saving.', 'error');
      setIsAddSupplierOpen(true);
      return;
    }

    const isEditSave = Boolean(isEditing && editingPurchaseId);
    const tx = buildTransactionObject(isEditSave);
    if (!tx) return;

    if (tx.hasNegativeAdjustment) {
      setPendingNegativeSave({ tx, isEdit: isEditSave, printAfter });
      return;
    }

    commitSave(tx, isEditSave, printAfter);
  };

  const handleOpenPrintCurrent = () => {
    if (originalSavedPurchase && isReadOnly && !isEditing) {
      setPrintModalPurchase(originalSavedPurchase);
      return;
    }
    if (purchaseItems.length === 0) {
      showToast('Add items or select a saved purchase from History to print.', 'info');
      return;
    }
    const previewTx = buildTransactionObject(Boolean(isEditing && editingPurchaseId));
    if (previewTx) {
      setPrintModalPurchase(previewTx);
    }
  };

  // Keyboard shortcuts (F2 Save, F4 Search Focus, F10 Print)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        triggerSave(false);
      } else if (e.key === 'F4') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F10') {
        e.preventDefault();
        handleOpenPrintCurrent();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const negativeItemsList = useMemo(
    () => purchaseItems.filter((it) => it.quantity < 0),
    [purchaseItems]
  );

  return (
    <div className="flex-1 flex flex-col w-full h-full min-h-0 bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      {/* 1. ORIGINAL FULLSCREEN HEADER */}
      <FullScreenPageHeader
        title="New Purchase Entry"
        urduTitle="نئی خریداری کا اندراج"
        subtitle="Supplier Purchase Billing, Stock Receiving & Negative Qty Stock Adjustments"
        icon={<Truck className="w-5 h-5" />}
        storeName={branding?.storeName || 'WAQAS MART'}
        onBackToHome={() => onNavigate('Home')}
        badge={
          isEditing
            ? 'EDITING BILL'
            : isReadOnly
            ? 'READ-ONLY'
            : 'NEW ENTRY'
        }
        badgeColor={
          isEditing
            ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
            : isReadOnly
            ? 'bg-blue-500/20 text-blue-200 border-blue-400/40'
            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
        }
        actions={
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleNewBill}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
              title="Start a Fresh New Purchase Bill"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Bill</span>
            </button>

            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              title="Search Saved Purchase Invoices"
            >
              <FileText className="w-3.5 h-3.5 text-teal-400" />
              <span>History ({purchases.length})</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPrintCurrent}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              title="Print Purchase Invoice (F10)"
            >
              <Printer className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        }
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-16 right-4 z-50 max-w-sm animate-in fade-in slide-in-from-top-2">
          <div
            className={`px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-bold ${
              toast.type === 'success'
                ? 'bg-emerald-950 text-emerald-100 border-emerald-500/50'
                : toast.type === 'error'
                ? 'bg-red-950 text-red-100 border-red-500/50'
                : 'bg-slate-900 text-slate-100 border-slate-700'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <Clock className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <span className="flex-1">{toast.message}</span>
          </div>
        </div>
      )}

      {/* 2. SCROLLABLE WORKSPACE */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-5 space-y-4">
        {/* Read-Only / Edit Status Banner */}
        {(isReadOnly || isEditing) && originalSavedPurchase && (
          <div
            className={`rounded-2xl p-3.5 border flex flex-wrap items-center justify-between gap-3 shadow-xs ${
              isEditing
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-blue-50 border-blue-200 text-blue-950'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  isEditing
                    ? 'bg-amber-500 text-white'
                    : 'bg-blue-600 text-white'
                }`}
              >
                {isEditing ? (
                  <Edit3 className="w-4 h-4" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-black">
                    {isEditing
                      ? `Editing Purchase Invoice #${originalSavedPurchase.purchaseInvoiceNo}`
                      : `Viewing Saved Invoice #${originalSavedPurchase.purchaseInvoiceNo}`}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/80 border border-current/20">
                    {isEditing ? 'Edit Mode Active' : 'Read-Only Mode'}
                  </span>
                </div>
                <p className="text-[11px] opacity-80">
                  Supplier: <strong>{originalSavedPurchase.supplierName}</strong> • Date:{' '}
                  {originalSavedPurchase.purchaseDate} • Entry by:{' '}
                  {originalSavedPurchase.userName || 'Admin'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(true);
                      setIsReadOnly(false);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Invoice</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintModalPurchase(originalSavedPurchase)}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => loadSavedPurchase(originalSavedPurchase, false)}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="button"
                onClick={handleNewBill}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Back to New Purchase</span>
              </button>
            </div>
          </div>
        )}

        {/* Negative Stock Adjustment Banner (when any row has negative quantity) */}
        {negativeItemsList.length > 0 && (
          <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-red-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>
                <strong>Negative Quantity Stock Deduction Active:</strong>{' '}
                {negativeItemsList.length} item(s) will{' '}
                <strong>reduce stock</strong> by{' '}
                <strong>{totals.totalNegativeUnits} unit(s)</strong> upon saving.
              </span>
            </div>
            <span className="text-[11px] font-black bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full border border-red-200">
              Confirmation Required on Save
            </span>
          </div>
        )}

        {/* MAIN 2-COLUMN RESPONSIVE GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT COLUMN (8 cols on Desktop): Supplier/Invoice Card + Product Search + Items Table */}
          <div className="lg:col-span-8 space-y-4 min-w-0">
            {/* CARD 1: INVOICE & SUPPLIER DETAILS */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      Supplier &amp; Purchase Bill Details
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      سپلائر اور خریداری بل کی تفصیلات
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                  User: {userNameDisplay}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {/* Purchase Invoice # */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Purchase Invoice #
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-black bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none disabled:opacity-70"
                  />
                </div>

                {/* Supplier Bill / Ref # */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Supplier Bill # (Optional)
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="e.g. INV-4410"
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                  />
                </div>

                {/* Purchase Date */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Purchase Date (تاریخ)
                  </label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="date"
                      disabled={isReadOnly}
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                    />
                  </div>
                </div>

                {/* Payment Method */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Payment Type (ادائیگی)
                  </label>
                  <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                    {(['cash', 'credit', 'card'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => setPaymentMethod(m)}
                        className={`py-1.5 rounded-lg text-[11px] font-bold capitalize transition-all cursor-pointer disabled:cursor-default ${
                          paymentMethod === m
                            ? m === 'cash'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : m === 'credit'
                              ? 'bg-amber-600 text-white shadow-xs'
                              : 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Supplier Selector + Notes Row */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-7">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Supplier / Vendor (سپلائر منتخب کریں) *
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={isReadOnly}
                      value={selectedSupplierId}
                      onChange={(e) => setSelectedSupplierId(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                    >
                      {suppliers.length === 0 ? (
                        <option value="">No suppliers — click + Add</option>
                      ) : (
                        suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.city ? `(${s.city})` : ''}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => setIsAddSupplierOpen(true)}
                      className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1 shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                      title="Add New Supplier"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>+ Supplier</span>
                    </button>
                  </div>
                </div>

                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Remarks / Note (نوٹ)
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    placeholder="Optional delivery or invoice note..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                  />
                </div>
              </div>

              {/* Selected Supplier Summary Bar */}
              {activeSupplier && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                  <div className="flex flex-wrap items-center gap-3">
                    {activeSupplier.phone && (
                      <span className="flex items-center gap-1 font-medium">
                        <Phone className="w-3 h-3 text-emerald-600" />
                        {activeSupplier.phone}
                      </span>
                    )}
                    {(activeSupplier.address || activeSupplier.city) && (
                      <span className="flex items-center gap-1 font-medium">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {activeSupplier.address || activeSupplier.city}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500 mr-1">Current Payable:</span>
                    <span
                      className={`font-black tabular-nums ${
                        (activeSupplier.payableBalance || 0) > 0
                          ? 'text-red-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatRs(activeSupplier.payableBalance || 0)}
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* CARD 2: PRODUCT SEARCH, BARCODE SCANNER & ITEMS LIST */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
              {/* Search & Quick Action Toolbar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1" ref={searchContainerRef}>
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    disabled={isReadOnly}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                      setHighlightedIdx(0);
                    }}
                    onFocus={() => {
                      if (searchQuery.trim()) setShowSuggestions(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setShowSuggestions(true);
                        setHighlightedIdx((idx) =>
                          searchSuggestions.length > 0
                            ? (idx + 1) % searchSuggestions.length
                            : 0
                        );
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setHighlightedIdx((idx) =>
                          searchSuggestions.length > 0
                            ? (idx - 1 + searchSuggestions.length) %
                              searchSuggestions.length
                            : 0
                        );
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const q = searchQuery.trim();
                        if (!q) return;
                        // Check exact barcode match first (for USB/Bluetooth scanners)
                        const exact = products.find(
                          (p) =>
                            (p.barcode || '').trim().toLowerCase() ===
                              q.toLowerCase() ||
                            (p.sku || '').trim().toLowerCase() === q.toLowerCase()
                        );
                        if (exact) {
                          handleAddProduct(exact, 1);
                        } else if (searchSuggestions[highlightedIdx]) {
                          handleAddProduct(searchSuggestions[highlightedIdx], 1);
                        } else {
                          handleBarcodeLookupAndAdd(q);
                        }
                      } else if (e.key === 'Escape') {
                        setShowSuggestions(false);
                      }
                    }}
                    placeholder="Scan Barcode or Search Item Name / SKU (F4)..."
                    className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm font-semibold bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none disabled:opacity-60"
                  />

                  {/* Autocomplete Dropdown */}
                  {showSuggestions && searchQuery.trim() && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl shadow-2xl border border-slate-200 z-40 max-h-72 overflow-y-auto divide-y divide-slate-100">
                      {searchSuggestions.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500 space-y-2">
                          <p>No product matched "{searchQuery}"</p>
                          <button
                            type="button"
                            onClick={() => {
                              setShowSuggestions(false);
                              onOpenAddProduct();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Create New Product</span>
                          </button>
                        </div>
                      ) : (
                        searchSuggestions.map((prod, idx) => (
                          <button
                            key={prod.id}
                            type="button"
                            onClick={() => handleAddProduct(prod, 1)}
                            className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                              idx === highlightedIdx
                                ? 'bg-emerald-50'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {prod.imageUrl ? (
                                <img
                                  src={prod.imageUrl}
                                  alt=""
                                  className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                                  <Package className="w-4 h-4" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900 truncate">
                                  {prod.name}
                                </p>
                                <p className="text-[10px] text-slate-500 font-mono truncate">
                                  Barcode: {prod.barcode || prod.sku || 'N/A'} • Stock:{' '}
                                  <strong
                                    className={
                                      (prod.stock || 0) <= 0
                                        ? 'text-red-600'
                                        : 'text-emerald-700'
                                    }
                                  >
                                    {prod.stock} {prod.unit || ''}
                                  </strong>
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="block text-xs font-black text-emerald-700 tabular-nums">
                                Cost: {formatRs(prod.costPrice || 0)}
                              </span>
                              <span className="block text-[10px] text-slate-500 tabular-nums">
                                Sale: {formatRs(prod.price || 0)}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => setIsScannerOpen(true)}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                    title="Open Camera Barcode Scanner"
                  >
                    <ScanBarcode className="w-4 h-4 text-emerald-400" />
                    <span>Scan</span>
                  </button>

                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={onOpenAddProduct}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                    title="Add New Product to Catalog"
                  >
                    <Plus className="w-4 h-4" />
                    <span>New Item</span>
                  </button>
                </div>
              </div>

              {/* Helper Caption */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Tip: Enter positive Qty (<strong className="text-emerald-700">+1, +10</strong>) to add stock, or negative Qty (<strong className="text-red-600">-1, -5</strong>) to deduct stock.
                </span>
                {purchaseItems.length > 0 && !isReadOnly && (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    className="text-red-600 hover:text-red-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All ({purchaseItems.length})</span>
                  </button>
                )}
              </div>

              {/* ITEMS DISPLAY: Empty State vs Desktop Table vs Mobile Cards */}
              {purchaseItems.length === 0 ? (
                <div className="py-12 px-4 text-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70">
                  <Package className="w-10 h-10 text-slate-300 mx-auto mb-2.5" />
                  <p className="text-sm font-bold text-slate-700">
                    No products added to this purchase bill yet
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Search above by name/barcode or click Scan to add items.
                  </p>
                </div>
              ) : (
                <>
                  {/* DESKTOP TABLE (md and larger) */}
                  <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                          <th className="py-2.5 px-2.5 text-center w-9">#</th>
                          <th className="py-2.5 px-3">Product / Barcode</th>
                          <th className="py-2.5 px-2.5 text-center">Stock Effect</th>
                          <th className="py-2.5 px-2.5 text-center w-36">Qty (+ / −)</th>
                          <th className="py-2.5 px-2.5 text-right w-28">Cost Price</th>
                          <th className="py-2.5 px-2.5 text-right w-28">Sale Price</th>
                          <th className="py-2.5 px-3 text-right w-28">Line Total</th>
                          {!isReadOnly && (
                            <th className="py-2.5 px-2 text-center w-10">Del</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {purchaseItems.map((item, idx) => {
                          const liveProd = products.find(
                            (p) => p.id === item.productId
                          );
                          const currentStock =
                            liveProd !== undefined
                              ? Number(liveProd.stock) || 0
                              : item.currentStock;
                          const projectedStock = isEditing
                            ? currentStock +
                              (item.quantity -
                                (originalSavedPurchase?.items.find(
                                  (o) => o.productId === item.productId
                                )?.quantity || 0))
                            : currentStock + item.quantity;
                          const isNeg = item.quantity < 0;
                          const draftVal =
                            qtyDrafts[item.id] !== undefined
                              ? qtyDrafts[item.id]
                              : String(item.quantity);

                          return (
                            <tr
                              key={item.id}
                              className={
                                isNeg
                                  ? 'bg-red-50/70 hover:bg-red-50'
                                  : idx % 2 === 0
                                  ? 'bg-white hover:bg-slate-50/80'
                                  : 'bg-slate-50/40 hover:bg-slate-50'
                              }
                            >
                              <td className="py-2.5 px-2.5 text-center font-bold text-slate-400">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  {item.imageUrl ? (
                                    <img
                                      src={item.imageUrl}
                                      alt=""
                                      className="w-7 h-7 rounded-lg object-cover border border-slate-200 shrink-0"
                                    />
                                  ) : null}
                                  <div className="min-w-0">
                                    <p className="font-bold text-slate-900 truncate max-w-[200px] xl:max-w-[260px]">
                                      {item.productName}
                                    </p>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {item.barcode || 'No Barcode'}
                                      </span>
                                      {isNeg && (
                                        <span className="text-[9px] font-black uppercase bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">
                                          Deduct {item.quantity}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 text-center tabular-nums">
                                <span className="text-slate-500 font-semibold">
                                  {currentStock}
                                </span>
                                <ArrowRight className="w-3 h-3 inline mx-1 text-slate-400" />
                                <span
                                  className={`font-black ${
                                    isNeg ? 'text-red-700' : 'text-emerald-700'
                                  }`}
                                >
                                  {projectedStock}
                                </span>
                              </td>
                              <td className="py-2.5 px-2">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    disabled={isReadOnly}
                                    onClick={() =>
                                      updateItemQuantity(item.id, item.quantity - 1)
                                    }
                                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 hover:text-red-700 text-slate-700 flex items-center justify-center font-bold border border-slate-200 cursor-pointer disabled:opacity-40"
                                    title="Decrease Qty (-1)"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    disabled={isReadOnly}
                                    value={draftVal}
                                    onChange={(e) =>
                                      handleQtyTextChange(item.id, e.target.value)
                                    }
                                    onBlur={() =>
                                      handleQtyTextBlur(item.id, item.quantity)
                                    }
                                    className={`w-14 text-center py-1 rounded-lg border text-xs font-black tabular-nums focus:ring-2 focus:outline-none ${
                                      isNeg
                                        ? 'bg-red-50 border-red-300 text-red-700 focus:ring-red-400'
                                        : 'bg-white border-slate-300 text-slate-900 focus:ring-emerald-500'
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    disabled={isReadOnly}
                                    onClick={() =>
                                      updateItemQuantity(item.id, item.quantity + 1)
                                    }
                                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-emerald-100 hover:text-emerald-700 text-slate-700 flex items-center justify-center font-bold border border-slate-200 cursor-pointer disabled:opacity-40"
                                    title="Increase Qty (+1)"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 px-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  disabled={isReadOnly}
                                  value={item.purchaseCost}
                                  onChange={(e) =>
                                    updateItemCost(
                                      item.id,
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-24 text-right px-2 py-1 rounded-lg border border-slate-300 bg-white font-bold text-slate-900 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                                />
                              </td>
                              <td className="py-2.5 px-2 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  disabled={isReadOnly}
                                  value={item.salePrice ?? 0}
                                  onChange={(e) =>
                                    updateItemSalePrice(
                                      item.id,
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-24 text-right px-2 py-1 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                                />
                              </td>
                              <td
                                className={`py-2.5 px-3 text-right font-black tabular-nums ${
                                  isNeg ? 'text-red-700' : 'text-slate-900'
                                }`}
                              >
                                {formatRs(item.lineTotal)}
                              </td>
                              {!isReadOnly && (
                                <td className="py-2.5 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item.id)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                    title="Remove item"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* MOBILE CARDS (below md) — Zero horizontal overflow */}
                  <div className="md:hidden space-y-2.5">
                    {purchaseItems.map((item, idx) => {
                      const liveProd = products.find((p) => p.id === item.productId);
                      const currentStock =
                        liveProd !== undefined
                          ? Number(liveProd.stock) || 0
                          : item.currentStock;
                      const projectedStock = isEditing
                        ? currentStock +
                          (item.quantity -
                            (originalSavedPurchase?.items.find(
                              (o) => o.productId === item.productId
                            )?.quantity || 0))
                        : currentStock + item.quantity;
                      const isNeg = item.quantity < 0;
                      const draftVal =
                        qtyDrafts[item.id] !== undefined
                          ? qtyDrafts[item.id]
                          : String(item.quantity);

                      return (
                        <div
                          key={item.id}
                          className={`rounded-2xl border p-3 space-y-2.5 ${
                            isNeg
                              ? 'bg-red-50/80 border-red-200'
                              : 'bg-slate-50/70 border-slate-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-black text-slate-400">
                                  #{idx + 1}
                                </span>
                                <p className="text-xs font-black text-slate-900 truncate">
                                  {item.productName}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                                <span className="font-mono">
                                  {item.barcode || 'No Barcode'}
                                </span>
                                <span>
                                  Stock: <strong>{currentStock}</strong> →{' '}
                                  <strong
                                    className={
                                      isNeg ? 'text-red-700' : 'text-emerald-700'
                                    }
                                  >
                                    {projectedStock}
                                  </strong>
                                </span>
                                {isNeg && (
                                  <span className="font-black text-red-700 bg-red-100 px-1.5 py-0.5 rounded border border-red-200">
                                    Stock Deduct ({item.quantity})
                                  </span>
                                )}
                              </div>
                            </div>

                            {!isReadOnly && (
                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="p-1.5 text-red-500 hover:bg-red-100 rounded-lg shrink-0 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* Qty & Price Controls */}
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                Qty (+ / −)
                              </label>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isReadOnly}
                                  onClick={() =>
                                    updateItemQuantity(item.id, item.quantity - 1)
                                  }
                                  className="w-7 h-8 rounded-lg bg-white border border-slate-300 flex items-center justify-center font-black text-slate-700 cursor-pointer"
                                >
                                  −
                                </button>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  disabled={isReadOnly}
                                  value={draftVal}
                                  onChange={(e) =>
                                    handleQtyTextChange(item.id, e.target.value)
                                  }
                                  onBlur={() =>
                                    handleQtyTextBlur(item.id, item.quantity)
                                  }
                                  className={`w-full min-w-0 h-8 text-center rounded-lg border text-xs font-black tabular-nums ${
                                    isNeg
                                      ? 'bg-red-50 border-red-300 text-red-700'
                                      : 'bg-white border-slate-300 text-slate-900'
                                  }`}
                                />
                                <button
                                  type="button"
                                  disabled={isReadOnly}
                                  onClick={() =>
                                    updateItemQuantity(item.id, item.quantity + 1)
                                  }
                                  className="w-7 h-8 rounded-lg bg-white border border-slate-300 flex items-center justify-center font-black text-slate-700 cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                Cost (Rs.)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={isReadOnly}
                                value={item.purchaseCost}
                                onChange={(e) =>
                                  updateItemCost(
                                    item.id,
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="w-full h-8 px-2 text-right rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 tabular-nums"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-500 mb-1">
                                Sale Price
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                disabled={isReadOnly}
                                value={item.salePrice ?? 0}
                                onChange={(e) =>
                                  updateItemSalePrice(
                                    item.id,
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="w-full h-8 px-2 text-right rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 tabular-nums"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-200/80 text-xs">
                            <button
                              type="button"
                              disabled={isReadOnly}
                              onClick={() =>
                                updateItemQuantity(item.id, -item.quantity)
                              }
                              className="text-[10px] font-bold px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700 cursor-pointer disabled:opacity-40"
                            >
                              Flip Sign (±)
                            </button>
                            <div>
                              <span className="text-slate-500 mr-1.5">Line Total:</span>
                              <strong
                                className={`tabular-nums ${
                                  isNeg ? 'text-red-700' : 'text-slate-900'
                                }`}
                              >
                                {formatRs(item.lineTotal)}
                              </strong>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* RIGHT COLUMN (4 cols on Desktop): Totals, Tax, Discount, Payment & Save Actions */}
          <div className="lg:col-span-4 space-y-4">
            <section className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <h2 className="text-sm font-black text-slate-900">
                    Bill Summary &amp; Payment
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    مجموعی رقم، ٹیکس، ڈسکاؤنٹ اور ادائیگی
                  </p>
                </div>
                <span className="text-xs font-black bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-200 tabular-nums">
                  {totals.totalQty} QTY
                </span>
              </div>

              {/* Financial Breakdown Controls */}
              <div className="space-y-3 text-xs">
                {/* Subtotal */}
                <div className="flex items-center justify-between text-slate-600">
                  <span className="font-semibold">Gross / Subtotal ({purchaseItems.length} items)</span>
                  <span className="font-black text-slate-900 tabular-nums">
                    {formatRs(totals.grossTotal)}
                  </span>
                </div>

                {/* Discount */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-600">Discount</span>
                    <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-[10px]">
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => setDiscountType('rs')}
                        className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                          discountType === 'rs'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-500'
                        }`}
                      >
                        Rs
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => setDiscountType('percent')}
                        className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                          discountType === 'percent'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-500'
                        }`}
                      >
                        %
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={isReadOnly}
                    value={discountInput || ''}
                    onChange={(e) =>
                      setDiscountInput(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    placeholder="0"
                    className="w-28 text-right px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-emerald-700 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                  />
                </div>

                {/* VAT / Tax Rate */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-600">VAT / GST</span>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={isReadOnly}
                      value={vatRatePercent}
                      onChange={(e) => setVatRatePercent(Number(e.target.value))}
                      className="px-2 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                    >
                      {VAT_RATES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <span className="font-bold text-slate-700 tabular-nums min-w-[60px] text-right">
                      {formatRs(totals.vat)}
                    </span>
                  </div>
                </div>

                {/* Extra Expenses / Freight */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-600">Freight / Extra</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={isReadOnly}
                    value={expensesAmount || ''}
                    onChange={(e) =>
                      setExpensesAmount(Math.max(0, parseFloat(e.target.value) || 0))
                    }
                    placeholder="0"
                    className="w-28 text-right px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-800 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-50"
                  />
                </div>
              </div>

              {/* GRAND TOTAL BOX */}
              <div className="rounded-2xl bg-slate-900 text-white p-4 space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-bold uppercase tracking-wider">
                    Grand Total (کل رقم)
                  </span>
                  {totals.discount > 0 && (
                    <span className="text-emerald-400 font-bold">
                      Saved {formatRs(totals.discount)}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-black tracking-tight tabular-nums text-emerald-400">
                  {formatRs(totals.totalAmount)}
                </div>
              </div>

              {/* PAYMENT ENTRY */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">
                    Amount Paid (ادا شدہ رقم)
                  </label>
                  {!isReadOnly && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setAmountPaidInput(String(roundMoney(totals.totalAmount)))
                        }
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer"
                      >
                        Full Pay
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMethod('credit');
                          setAmountPaidInput('0');
                        }}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 cursor-pointer"
                      >
                        Credit (0)
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative">
                  {paymentMethod === 'card' ? (
                    <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  ) : (
                    <Banknote className="w-4 h-4 text-emerald-600 absolute left-3 top-2.5 pointer-events-none" />
                  )}
                  <input
                    type="number"
                    step="any"
                    disabled={isReadOnly}
                    value={amountPaidInput}
                    onChange={(e) => setAmountPaidInput(e.target.value)}
                    placeholder={`Auto: ${totals.paid.toFixed(0)}`}
                    className="w-full pl-9 pr-3 py-2 text-sm font-black text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-none tabular-nums disabled:opacity-70"
                  />
                </div>

                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <span className="font-semibold text-slate-600">
                    Remaining Payable (باقی):
                  </span>
                  <span
                    className={`font-black tabular-nums ${
                      totals.outstanding > 0
                        ? 'text-red-600'
                        : totals.outstanding < 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatRs(totals.outstanding)}
                  </span>
                </div>
              </div>

              {/* PRIMARY ACTION BUTTONS */}
              <div className="space-y-2 pt-2">
                {!isReadOnly ? (
                  <>
                    <button
                      type="button"
                      disabled={isSaving || purchaseItems.length === 0}
                      onClick={() => triggerSave(false)}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-98 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Save className="w-4 h-4" />
                      <span>
                        {isSaving
                          ? 'Saving...'
                          : isEditing
                          ? 'Save Changes (F2)'
                          : 'Save Purchase (F2)'}
                      </span>
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isSaving || purchaseItems.length === 0}
                        onClick={() => triggerSave(true)}
                        className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Printer className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Save &amp; Print</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleNewBill}
                        className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>New Bill</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(true);
                        setIsReadOnly(false);
                      }}
                      className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Invoice</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenPrintCurrent}
                      className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Print Bill</span>
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* MODALS */}
      <AddSupplierModal
        isOpen={isAddSupplierOpen}
        onClose={() => setIsAddSupplierOpen(false)}
        onAddSupplier={(sup) => {
          onAddSupplier(sup);
          setSelectedSupplierId(sup.id);
        }}
      />

      <SearchPurchasesModal
        isOpen={isHistoryOpen}
        purchases={purchases}
        onClose={() => setIsHistoryOpen(false)}
        onSelectToView={(p) => loadSavedPurchase(p, false)}
        onSelectToEdit={(p) => loadSavedPurchase(p, true)}
        onPrintPurchase={(p) => setPrintModalPurchase(p)}
        onDeletePurchase={(id) => {
          onDeletePurchase?.(id);
          if (editingPurchaseId === id) {
            handleNewBill();
          }
        }}
      />

      <PrintPurchaseModal
        isOpen={Boolean(printModalPurchase)}
        purchase={printModalPurchase}
        onClose={() => setPrintModalPurchase(null)}
        branding={branding}
      />

      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onBarcodeDetected={(code) => handleBarcodeLookupAndAdd(code)}
        totalItems={totals.totalQty}
        totalAmount={totals.totalAmount}
        pageContext="purchase"
      />

      {/* Confirm Clear All Draft Items Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
            <h3 className="text-base font-black text-slate-900 text-center">
              Clear All Entered Items?
            </h3>
            <p className="text-xs text-slate-600 text-center mt-1.5">
              Remove all {purchaseItems.length} item(s) from this draft purchase bill?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setPurchaseItems([]);
                  setQtyDrafts({});
                  setShowClearConfirm(false);
                }}
                className="py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black cursor-pointer"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Negative Quantity Stock Deduction Confirmation Modal */}
      {pendingNegativeSave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-red-200">
            <div className="bg-red-600 text-white px-5 py-3.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-black">
                  Confirm Negative Stock Adjustment
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingNegativeSave(null)}
                className="p-1 rounded-lg hover:bg-white/15 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-slate-700 leading-relaxed">
                This invoice contains <strong>negative quantity entries</strong>. Saving will{' '}
                <strong className="text-red-700">DEDUCT stock</strong> from your inventory:
              </p>

              <div className="max-h-44 overflow-y-auto rounded-xl border border-red-200 bg-red-50/70 divide-y divide-red-100">
                {pendingNegativeSave.tx.items
                  .filter((it) => it.quantity < 0)
                  .map((it) => {
                    const live = products.find((p) => p.id === it.productId);
                    const prevStk = live ? Number(live.stock) || 0 : it.currentStock;
                    const afterStk = prevStk + it.quantity;
                    return (
                      <div
                        key={it.id}
                        className="px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 truncate">
                            {it.productName}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Stock: {prevStk} →{' '}
                            <strong className="text-red-700">{afterStk}</strong>
                          </p>
                        </div>
                        <span className="font-black text-red-700 bg-red-100 px-2 py-0.5 rounded border border-red-200 shrink-0 tabular-nums">
                          {it.quantity}
                        </span>
                      </div>
                    );
                  })}
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-600 space-y-0.5">
                <div>
                  <strong>Invoice Ref:</strong> {pendingNegativeSave.tx.purchaseInvoiceNo}
                </div>
                <div>
                  <strong>Recorded By:</strong> {userNameDisplay}
                </div>
                <div>
                  <strong>Date / Time:</strong> {new Date().toLocaleString()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingNegativeSave(null)}
                  className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const payload = pendingNegativeSave;
                    setPendingNegativeSave(null);
                    commitSave(payload.tx, payload.isEdit, payload.printAfter);
                  }}
                  className="py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black shadow cursor-pointer"
                >
                  Confirm &amp; Deduct Stock
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
