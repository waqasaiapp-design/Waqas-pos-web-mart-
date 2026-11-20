import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ScanBarcode,
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  Save,
  Edit,
  User,
  CheckCircle,
  AlertTriangle,
  X,
  ShoppingCart,
  Package,
  Minimize2,
  Maximize2,
  LogOut,
  Info,
  Barcode as BarcodeIcon,
  FileSpreadsheet,
  Upload,
  Building2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Check,
  Store,
  Lock,
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
} from '../utils/purchaseHelpers';
import { SearchPurchasesModal } from './SearchPurchasesModal';
import { PrintPurchaseModal } from './PrintPurchaseModal';
import { BarcodeScannerModal } from './BarcodeScannerModal';

export interface PurchaseWorkstationProps {
  variant: 'new' | 'old';
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  branding?: StoreBranding;
  currentUser?: UserProfile;
  currentDevice?: DeviceInfo;
  onSavePurchase: (purchase: PurchaseTransaction, isEdit: boolean) => void;
  onDeletePurchase?: (purchaseId: string) => void;
  onDeleteAllPurchases?: () => void;
  onAddSupplier: (supplier: Supplier) => void;
  onOpenAddProduct: () => void;
  onOpenScanner?: () => void;
  onNavigate?: (page: string) => void;
  onBackToHome?: () => void;
  scannedBarcode?: string | null;
  onClearScannedBarcode?: () => void;
}

const EXPENSE_OPTIONS = [
  { label: 'Expenses/Services', defaultCost: 0 },
  { label: 'Freight / کرایہ', defaultCost: 0 },
  { label: 'Loading / Unloading', defaultCost: 0 },
  { label: 'Packaging / Packing', defaultCost: 0 },
  { label: 'Delivery Charges', defaultCost: 0 },
];

const TAX_OPTIONS: Array<{ label: string; rate: number }> = [
  { label: 'Non', rate: 0 },
  { label: 'VAT 5%', rate: 5 },
  { label: 'GST 18%', rate: 18 },
  { label: 'Zero', rate: 0 },
];

const STORE_OPTIONS = ['Main Store', 'Warehouse 1', 'Godown A', 'Counter Store'];

export const PurchaseWorkstation: React.FC<PurchaseWorkstationProps> = ({
  variant,
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
  onBackToHome,
  scannedBarcode = null,
  onClearScannedBarcode,
}) => {
  const userNameDisplay = currentUser?.displayName || 'Admin 102';

  const generateRefNo = (offset = 0) => {
    const base = variant === 'new' ? 3010 : 2810;
    return String(base + purchases.length + 1 + offset);
  };

  // Navigation & Edit Mode
  const [purchaseNavIndex, setPurchaseNavIndex] = useState<number>(-1);
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [originalSavedPurchase, setOriginalSavedPurchase] = useState<PurchaseTransaction | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [editByName, setEditByName] = useState<string>('');

  // Top Header Fields
  const [refNo, setRefNo] = useState<string>(() => generateRefNo());
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'card'>('cash');

  // Supplier State
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(() => suppliers[0]?.id || '');
  const activeSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  const [supplierPhone, setSupplierPhone] = useState<string>('');
  const [supplierAddress, setSupplierAddress] = useState<string>('');
  const [supplierTrn, setSupplierTrn] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');

  useEffect(() => {
    if (suppliers.length > 0 && !selectedSupplierId && !isReadOnly) {
      setSelectedSupplierId(suppliers[0].id);
    }
  }, [suppliers, selectedSupplierId, isReadOnly]);

  useEffect(() => {
    if (activeSupplier) {
      setSupplierPhone(activeSupplier.phone || '');
      setSupplierAddress(activeSupplier.address || activeSupplier.city || '');
      setSupplierTrn(activeSupplier.trn || '');
    } else {
      setSupplierPhone('');
      setSupplierAddress('');
      setSupplierTrn('');
    }
  }, [activeSupplier]);

  // VAT / Store / Search Controls
  const [vatType, setVatType] = useState<'Default VAT' | 'Out of Scope'>('Default VAT');
  const [selectedTaxLabel, setSelectedTaxLabel] = useState<string>('Non');
  const [selectedStore, setSelectedStore] = useState<string>('Main Store');
  const [storeList, setStoreList] = useState<string[]>(STORE_OPTIONS);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState<boolean>(false);
  const [customStoreName, setCustomStoreName] = useState<string>('');

  const [searchEntryNo, setSearchEntryNo] = useState<string>('');
  const [searchSupInvNo, setSearchSupInvNo] = useState<string>('');

  // Expense & Serial/IMEI Toolbar Controls
  const [serialImei, setSerialImei] = useState<string>('');
  const [expensesLabel, setExpensesLabel] = useState<string>('Expenses/Services');
  const [expensesAmount, setExpensesAmount] = useState<number>(0);

  // Items Table & Selection
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  // Discount / Roundoff / Payment
  const [costDiscountPercent, setCostDiscountPercent] = useState<number>(0);
  const [costDiscountAmount, setCostDiscountAmount] = useState<number>(0);
  const [roundoff, setRoundoff] = useState<number>(0);
  const [amountPaidInput, setAmountPaidInput] = useState<string>('');

  // Item Search & Scanner
  const [itemSearchQuery, setItemSearchQuery] = useState<string>('');
  const [itemSuggestions, setItemSuggestions] = useState<Product[]>([]);
  const [showItemSuggestions, setShowItemSuggestions] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);

  // Modals
  const [isPurchaseHistoryOpen, setIsPurchaseHistoryOpen] = useState<boolean>(false);
  const [currentPrintPurchase, setCurrentPrintPurchase] = useState<PurchaseTransaction | null>(null);
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState<boolean>(false);
  const [isNewSupplierModalOpen, setIsNewSupplierModalOpen] = useState<boolean>(false);
  const [isStockEnquiryOpen, setIsStockEnquiryOpen] = useState<boolean>(false);
  const [stockEnquiryQuery, setStockEnquiryQuery] = useState<string>('');
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [itemToDeleteIndex, setItemToDeleteIndex] = useState<number | null>(null);
  const [showConfirmClearPurchase, setShowConfirmClearPurchase] = useState<boolean>(false);
  const [showNegativeConfirmModal, setShowNegativeConfirmModal] = useState<boolean>(false);
  const [pendingSavePayload, setPendingSavePayload] = useState<{
    tx: PurchaseTransaction;
    isEdit: boolean;
  } | null>(null);

  // New Supplier Form State
  const [newSupName, setNewSupName] = useState<string>('');
  const [newSupPhone, setNewSupPhone] = useState<string>('');
  const [newSupAddress, setNewSupAddress] = useState<string>('');
  const [newSupBusiness, setNewSupBusiness] = useState<string>('');
  const [newSupTrn, setNewSupTrn] = useState<string>('');
  const [newSupBalance, setNewSupBalance] = useState<number>(0);
  const [newSupRemarks, setNewSupRemarks] = useState<string>('');

  // Mobile-specific collapsible metadata accordion & purchase/info tabs
  const [isMobileMetaExpanded, setIsMobileMetaExpanded] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Active VAT rate
  const activeVatRate = useMemo(() => {
    if (vatType === 'Out of Scope') return 0;
    const found = TAX_OPTIONS.find((t) => t.label === selectedTaxLabel);
    return found ? found.rate : 0;
  }, [vatType, selectedTaxLabel]);

  // Recompute line VAT when VAT mode changes
  useEffect(() => {
    if (isReadOnly && !isEditing) return;
    setPurchaseItems((prev) =>
      prev.map((item) => {
        const amounts = computePurchaseItemAmounts(
          item.quantity,
          item.purchaseCost,
          activeVatRate,
          item.discount || 0
        );
        return {
          ...item,
          vat: amounts.vat,
          tax: amounts.vat,
          netAmount: amounts.netAmount,
          wvat: amounts.wvat,
          lineTotal: amounts.lineTotal,
        };
      })
    );
  }, [activeVatRate]);

  // Live totals
  const totals = useMemo(() => {
    const parsedPaid = amountPaidInput.trim() === '' ? '' : Number(amountPaidInput) || 0;
    return computePurchaseTotals({
      items: purchaseItems,
      discountPercent: costDiscountPercent,
      discountAmount: costDiscountAmount,
      expensesAmount,
      roundoff,
      amountPaid: parsedPaid,
      paymentMethod,
    });
  }, [
    purchaseItems,
    costDiscountPercent,
    costDiscountAmount,
    expensesAmount,
    roundoff,
    amountPaidInput,
    paymentMethod,
  ]);

  // Selected row & product info for Stock Info card
  const selectedItem = useMemo(() => {
    if (selectedRowIndex !== null && purchaseItems[selectedRowIndex]) {
      return purchaseItems[selectedRowIndex];
    }
    return purchaseItems.length > 0 ? purchaseItems[purchaseItems.length - 1] : null;
  }, [purchaseItems, selectedRowIndex]);

  const selectedLiveProduct = useMemo(() => {
    if (!selectedItem) return null;
    return products.find((p) => p.id === selectedItem.productId) || null;
  }, [selectedItem, products]);

  // Fullscreen listener
  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch {}
  };

  // Click outside item search dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowItemSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter item suggestions
  useEffect(() => {
    const q = itemSearchQuery.toLowerCase().trim();
    if (q.length >= 1) {
      const matches = products.filter((p) => {
        const n = (p?.name || '').toLowerCase();
        const b = (p?.barcode || '').toLowerCase();
        const s = (p?.sku || '').toLowerCase();
        return n.includes(q) || b.includes(q) || s.includes(q);
      });
      setItemSuggestions(matches.slice(0, 10));
      setShowItemSuggestions(true);
    } else {
      setItemSuggestions([]);
      setShowItemSuggestions(false);
    }
  }, [itemSearchQuery, products]);

  // Add item to purchase table
  const handleAddItemToPurchase = (prod: Product) => {
    if (isReadOnly && !isEditing) {
      showToast('Invoice is in Read-Only Mode. Click Edit Invoice first.', 'error');
      return;
    }

    const existingIdx = purchaseItems.findIndex((it) => it.productId === prod.id);
    if (existingIdx !== -1) {
      const updated = [...purchaseItems];
      const cur = updated[existingIdx];
      const nextQty = cur.quantity === -1 ? 1 : cur.quantity + 1;
      const amounts = computePurchaseItemAmounts(
        nextQty,
        cur.purchaseCost,
        activeVatRate,
        cur.discount || 0
      );
      updated[existingIdx] = {
        ...cur,
        quantity: nextQty,
        ...amounts,
        serialImei: serialImei.trim() || cur.serialImei,
      };
      setPurchaseItems(updated);
      setQtyDrafts((prev) => ({ ...prev, [cur.id]: String(nextQty) }));
      setSelectedRowIndex(existingIdx);
    } else {
      const cost = prod.costPrice > 0 ? prod.costPrice : Math.round((prod.price || 0) * 0.8);
      const amounts = computePurchaseItemAmounts(1, cost, activeVatRate, 0);
      const newId = `pitem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newItem: PurchaseItem = {
        id: newId,
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode || prod.sku || '',
        currentStock: Number(prod.stock) || 0,
        quantity: 1,
        purchaseCost: cost,
        salePrice: prod.price || 0,
        discount: 0,
        tax: amounts.vat,
        vat: amounts.vat,
        netAmount: amounts.netAmount,
        wvat: amounts.wvat,
        lineTotal: amounts.lineTotal,
        fPrice: prod.price || 0,
        store: selectedStore,
        location: prod.category ? prod.category.slice(0, 8) : 'A-1',
        shelf: '1',
        wCost: cost,
        serialImei: serialImei.trim() || undefined,
        imageUrl: prod.imageUrl,
      };
      setPurchaseItems((prev) => [...prev, newItem]);
      setQtyDrafts((prev) => ({ ...prev, [newId]: '1' }));
      setSelectedRowIndex(purchaseItems.length);
    }

    sounds.playBarcodeBeep();
    setItemSearchQuery('');
    setShowItemSuggestions(false);
    setHighlightedIndex(null);
    showToast(`Added: ${prod.name}`, 'success');
    itemInputRef.current?.focus();
  };

  // Barcode scan handler
  const handleBarcodeDetected = (code: string) => {
    const clean = (code || '').trim().toLowerCase();
    if (!clean) return;
    if (isReadOnly && !isEditing) {
      showToast('Invoice is in Read-Only Mode. Click Edit Invoice first.', 'error');
      return;
    }
    const match =
      products.find((p) => (p?.barcode || '').toLowerCase() === clean) ||
      products.find((p) => (p?.sku || '').toLowerCase() === clean) ||
      products.find((p) => (p?.name || '').toLowerCase() === clean);

    if (match) {
      handleAddItemToPurchase(match);
      setIsCameraScannerOpen(false);
    } else {
      sounds.playErrorTone();
      showToast(`Product Not Found — "${code}"`, 'error');
    }
  };

  useEffect(() => {
    if (scannedBarcode && scannedBarcode.trim()) {
      handleBarcodeDetected(scannedBarcode.trim());
      onClearScannedBarcode?.();
    }
  }, [scannedBarcode]);

  // Hardware USB / Bluetooth barcode scanner
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') &&
        target !== itemInputRef.current
      ) {
        return;
      }
      const now = Date.now();
      if (now - lastKeyTime > 120) buffer = '';
      lastKeyTime = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          handleBarcodeDetected(buffer);
          buffer = '';
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [products, isReadOnly, isEditing, purchaseItems]);

  // Update numeric quantity (supports positive AND negative values like -1, -5)
  const applyItemQuantity = (index: number, nextQty: number) => {
    if (isReadOnly && !isEditing) return;
    setPurchaseItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const amounts = computePurchaseItemAmounts(
          nextQty,
          item.purchaseCost,
          activeVatRate,
          item.discount || 0
        );
        return {
          ...item,
          quantity: nextQty,
          ...amounts,
          tax: amounts.vat,
        };
      })
    );
  };

  const handleQtyTextChange = (index: number, itemId: string, raw: string) => {
    if (isReadOnly && !isEditing) return;
    // Allow '-', digits, decimal dot while typing
    if (!/^-?\d*\.?\d*$/.test(raw)) return;
    setQtyDrafts((prev) => ({ ...prev, [itemId]: raw }));

    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed)) {
      applyItemQuantity(index, parsed);
    }
  };

  const handleQtyBlur = (index: number, itemId: string) => {
    const item = purchaseItems[index];
    if (!item) return;
    const raw = qtyDrafts[itemId];
    if (raw === undefined) return;
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed) || parsed === 0) {
      // Restore last valid non-zero quantity (or 1)
      const fallback = item.quantity !== 0 ? item.quantity : 1;
      setQtyDrafts((prev) => ({ ...prev, [itemId]: String(fallback) }));
      applyItemQuantity(index, fallback);
    } else {
      setQtyDrafts((prev) => ({ ...prev, [itemId]: String(parsed) }));
      applyItemQuantity(index, parsed);
    }
  };

  const handleStepQuantity = (index: number, delta: -1 | 1) => {
    if (isReadOnly && !isEditing) return;
    const item = purchaseItems[index];
    if (!item) return;
    let nextQty = (Number(item.quantity) || 0) + delta;
    // Skip 0 cleanly so user can step 1 -> -1 and -1 -> 1 seamlessly
    if (nextQty === 0) {
      nextQty = delta < 0 ? -1 : 1;
    }
    setQtyDrafts((prev) => ({ ...prev, [item.id]: String(nextQty) }));
    applyItemQuantity(index, nextQty);
  };

  const handleToggleQtySign = (index: number) => {
    if (isReadOnly && !isEditing) return;
    const item = purchaseItems[index];
    if (!item) return;
    const base = item.quantity === 0 ? 1 : item.quantity;
    const flipped = -base;
    setQtyDrafts((prev) => ({ ...prev, [item.id]: String(flipped) }));
    applyItemQuantity(index, flipped);
  };

  const handleUpdateItemField = (index: number, field: keyof PurchaseItem, val: any) => {
    if (isReadOnly && !isEditing) return;
    setPurchaseItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item, [field]: val };
        if (field === 'purchaseCost') {
          const safeCost = Math.max(0, Number(val) || 0);
          updated.purchaseCost = safeCost;
          updated.wCost = safeCost;
          const amounts = computePurchaseItemAmounts(
            updated.quantity,
            safeCost,
            activeVatRate,
            updated.discount || 0
          );
          return { ...updated, ...amounts, tax: amounts.vat };
        }
        if (field === 'salePrice') {
          const safeSale = Math.max(0, Number(val) || 0);
          updated.salePrice = safeSale;
          updated.fPrice = safeSale;
        }
        return updated;
      })
    );
  };

  // Delete single row (with confirmation modal)
  const handleConfirmDeleteItem = () => {
    if (itemToDeleteIndex === null) return;
    const removed = purchaseItems[itemToDeleteIndex];
    setPurchaseItems((prev) => prev.filter((_, idx) => idx !== itemToDeleteIndex));
    if (removed) {
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[removed.id];
        return next;
      });
    }
    if (selectedRowIndex === itemToDeleteIndex) {
      setSelectedRowIndex(null);
    } else if (selectedRowIndex !== null && selectedRowIndex > itemToDeleteIndex) {
      setSelectedRowIndex(selectedRowIndex - 1);
    }
    setItemToDeleteIndex(null);
    sounds.playErrorTone();
    showToast('Item removed from current purchase.', 'info');
  };

  const handleConfirmClearPurchase = () => {
    const count = purchaseItems.length;
    setPurchaseItems([]);
    setQtyDrafts({});
    setSelectedRowIndex(null);
    setShowConfirmClearPurchase(false);
    sounds.playErrorTone();
    showToast(`Cleared ${count} items from purchase draft.`, 'info');
  };

  // Load saved purchase into Read-Only mode
  const handleLoadPurchaseToView = (purch: PurchaseTransaction) => {
    setOriginalSavedPurchase(purch);
    setEditingPurchaseId(purch.id);
    setRefNo(purch.refNo || purch.purchaseInvoiceNo.replace(/^PUR-/, ''));
    setSupplierInvoiceNo(purch.supplierInvoiceNo || '');
    setPurchaseDate(purch.purchaseDate || new Date().toISOString().split('T')[0]);
    setEntryDate(purch.entryDate || purch.purchaseDate || new Date().toISOString().split('T')[0]);
    setSelectedSupplierId(purch.supplierId || '');
    const loadedItems = purch.items || [];
    setPurchaseItems(loadedItems);
    const drafts: Record<string, string> = {};
    loadedItems.forEach((it) => {
      drafts[it.id] = String(it.quantity);
    });
    setQtyDrafts(drafts);
    setSelectedRowIndex(loadedItems.length > 0 ? 0 : null);
    setAmountPaidInput(String(purch.amountPaid ?? 0));
    const pm = (purch.paymentMethod || 'cash').toLowerCase();
    setPaymentMethod(pm === 'credit' ? 'credit' : pm === 'card' ? 'card' : 'cash');
    setVatType(purch.vatType || 'Default VAT');
    setSelectedStore(purch.store || 'Main Store');
    setCostDiscountAmount(purch.totalDiscount || 0);
    setCostDiscountPercent(0);
    setRoundoff(purch.roundoff || 0);
    setExpensesLabel(purch.expensesLabel || 'Expenses/Services');
    setExpensesAmount(purch.expensesAmount || 0);
    setRemarks(purch.notes || '');
    setSupplierPhone(purch.supplierPhone || '');
    setSupplierAddress(purch.supplierAddress || '');
    setSupplierTrn(purch.trn || '');
    setEditByName(purch.editBy || '');
    setIsReadOnly(true);
    setIsEditing(false);
    showToast(`Loaded ${purch.purchaseInvoiceNo} (Read-Only). Click Edit Invoice to modify.`, 'info');
  };

  // Auto-load latest saved invoice when opening Old Purchase Entry so it immediately renders populated ERP grid matching Image 1
  const hasAutoLoadedOldRef = useRef(false);
  useEffect(() => {
    if (
      variant === 'old' &&
      !hasAutoLoadedOldRef.current &&
      purchases.length > 0 &&
      !editingPurchaseId
    ) {
      hasAutoLoadedOldRef.current = true;
      setPurchaseNavIndex(0);
      handleLoadPurchaseToView(purchases[0]);
    }
  }, [variant, purchases.length]);

  const handleStartEditing = () => {
    if (!editingPurchaseId && !originalSavedPurchase) {
      if (purchases.length > 0) {
        handleLoadPurchaseToView(purchases[0]);
      } else {
        showToast('No saved invoice to edit.', 'info');
        return;
      }
    }
    setIsReadOnly(false);
    setIsEditing(true);
    setEditByName(userNameDisplay);
    showToast(`Editing enabled for #${refNo}. Stock & balance will reconcile on Save.`, 'info');
  };

  const handleCancelEdit = () => {
    if (originalSavedPurchase) {
      handleLoadPurchaseToView(originalSavedPurchase);
      showToast('Edit cancelled. Original invoice restored.', 'info');
    } else {
      handleNewPurchase();
    }
  };

  const handleNewPurchase = () => {
    setPurchaseItems([]);
    setQtyDrafts({});
    setSelectedRowIndex(null);
    setRefNo(generateRefNo());
    setSupplierInvoiceNo('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setEntryDate(new Date().toISOString().split('T')[0]);
    setAmountPaidInput('');
    setCostDiscountPercent(0);
    setCostDiscountAmount(0);
    setRoundoff(0);
    setExpensesLabel('Expenses/Services');
    setExpensesAmount(0);
    setSerialImei('');
    setRemarks('');
    setEditByName('');
    setEditingPurchaseId(null);
    setOriginalSavedPurchase(null);
    setIsReadOnly(false);
    setIsEditing(false);
    setPurchaseNavIndex(-1);
    if (!selectedSupplierId && suppliers.length > 0) {
      setSelectedSupplierId(suppliers[0].id);
    }
    sounds.playSuccessChime();
    showToast('Fresh purchase bill opened.', 'info');
  };

  // Actual Commit Save after validation & optional negative confirmation
  const commitSavePurchase = (purchaseTransaction: PurchaseTransaction, isEdit: boolean) => {
    setIsSaving(true);
    try {
      onSavePurchase(purchaseTransaction, isEdit);
      sounds.playSuccessChime();
      showToast(
        isEdit
          ? `Purchase ${purchaseTransaction.purchaseInvoiceNo} updated & stock reconciled!`
          : purchaseTransaction.hasNegativeAdjustment
          ? `Stock Adjustment ${purchaseTransaction.purchaseInvoiceNo} saved! Stock reduced.`
          : `Purchase ${purchaseTransaction.purchaseInvoiceNo} saved! Stock updated.`,
        'success'
      );

      if (isEdit) {
        handleLoadPurchaseToView(purchaseTransaction);
      } else {
        handleNewPurchase();
      }
    } catch (err) {
      console.error('[PurchaseWorkstation] Save error:', err);
      showToast('Failed to save purchase. Your entered items are preserved.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Validate & trigger save (or negative confirmation modal)
  const handleSavePurchaseAction = () => {
    if (isSaving) return;

    if (isReadOnly && !isEditing) {
      showToast('Invoice is Read-Only. Click Edit Invoice first.', 'info');
      return;
    }

    if (purchaseItems.length === 0) {
      sounds.playErrorTone();
      showToast('Please add at least one product before saving.', 'error');
      return;
    }

    const zeroQtyRow = purchaseItems.find((it) => !Number.isFinite(it.quantity) || it.quantity === 0);
    if (zeroQtyRow) {
      sounds.playErrorTone();
      showToast(`Quantity for "${zeroQtyRow.productName}" cannot be 0. Use + or − quantity.`, 'error');
      return;
    }

    const sup = activeSupplier || suppliers[0];
    if (!sup) {
      sounds.playErrorTone();
      showToast('Please select or add a supplier before saving.', 'error');
      return;
    }

    const isEdit = Boolean(editingPurchaseId);
    const invNo =
      isEdit && originalSavedPurchase?.purchaseInvoiceNo
        ? originalSavedPurchase.purchaseInvoiceNo
        : `PUR-${refNo}`;

    const hasNegative = purchaseItems.some((it) => it.quantity < 0);
    const nowIso = new Date().toISOString();

    const purchaseTransaction: PurchaseTransaction = {
      id: editingPurchaseId || `pur-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      purchaseInvoiceNo: invNo,
      refNo,
      purchaseDate,
      entryDate,
      supplierId: sup.id,
      supplierName: sup.name,
      supplierInvoiceNo: supplierInvoiceNo.trim(),
      items: purchaseItems.map((it) => ({
        ...it,
        store: it.store || selectedStore,
      })),
      subtotal: totals.grossTotal,
      totalDiscount: totals.discount,
      totalTax: totals.vat,
      roundoff: totals.roundoff,
      grandTotal: totals.totalAmount,
      amountPaid: totals.paid,
      remainingBalance: totals.outstanding,
      paymentMethod,
      vatType,
      store: selectedStore,
      grossTotal: totals.grossTotal,
      outstanding: totals.outstanding,
      totalQty: totals.totalQty,
      trn: supplierTrn,
      supplierPhone,
      supplierAddress,
      expensesLabel: expensesAmount > 0 ? expensesLabel : undefined,
      expensesAmount: expensesAmount > 0 ? expensesAmount : undefined,
      userName: originalSavedPurchase?.userName || userNameDisplay,
      editBy: isEdit ? editByName || userNameDisplay : undefined,
      hasNegativeAdjustment: hasNegative,
      notes: remarks.trim() || undefined,
      createdAt: originalSavedPurchase?.createdAt || nowIso,
      updatedAt: isEdit ? nowIso : undefined,
      status: isEdit ? 'edited' : 'saved',
    };

    if (hasNegative) {
      setPendingSavePayload({ tx: purchaseTransaction, isEdit });
      setShowNegativeConfirmModal(true);
      return;
    }

    commitSavePurchase(purchaseTransaction, isEdit);
  };

  // Build printable preview object from current draft or saved invoice
  const handleOpenPrint = () => {
    const savedMatch = editingPurchaseId
      ? purchases.find((p) => p.id === editingPurchaseId)
      : null;

    if (savedMatch && isReadOnly && !isEditing) {
      setCurrentPrintPurchase(savedMatch);
      return;
    }

    const previewTx: PurchaseTransaction = {
      id: editingPurchaseId || `pur-${refNo}`,
      purchaseInvoiceNo: savedMatch?.purchaseInvoiceNo || `PUR-${refNo}`,
      refNo,
      purchaseDate,
      entryDate,
      supplierId: activeSupplier?.id || selectedSupplierId,
      supplierName: activeSupplier?.name || 'Walk-in / Cash Supplier',
      supplierInvoiceNo,
      items: purchaseItems,
      subtotal: totals.grossTotal,
      totalDiscount: totals.discount,
      totalTax: totals.vat,
      roundoff: totals.roundoff,
      grandTotal: totals.totalAmount,
      amountPaid: totals.paid,
      remainingBalance: totals.outstanding,
      paymentMethod,
      userName: userNameDisplay,
      editBy: isEditing ? editByName || userNameDisplay : undefined,
      hasNegativeAdjustment: totals.hasNegativeItems,
      notes: remarks,
      createdAt: new Date().toISOString(),
      status: isEditing ? 'edited' : 'saved',
    };
    setCurrentPrintPurchase(previewTx);
  };

  // Navigate saved purchases
  const handleNavigatePurchase = (direction: 'first' | 'prev' | 'next' | 'last') => {
    if (purchases.length === 0) {
      showToast('No saved purchase invoices found.', 'info');
      return;
    }
    let idx = 0;
    if (direction === 'first') idx = 0;
    else if (direction === 'last') idx = purchases.length - 1;
    else if (direction === 'prev') {
      idx = purchaseNavIndex === -1 ? 0 : Math.max(0, purchaseNavIndex - 1);
    } else if (direction === 'next') {
      idx = purchaseNavIndex === -1 ? 0 : Math.min(purchases.length - 1, purchaseNavIndex + 1);
    }
    const target = purchases[idx];
    if (target) {
      setPurchaseNavIndex(idx);
      handleLoadPurchaseToView(target);
    }
  };

  // Search by Entry # or Sup Invoice
  const handleLookupInvoice = (mode: 'entry' | 'sup') => {
    const query = (mode === 'entry' ? searchEntryNo : searchSupInvNo).trim().toLowerCase();
    if (!query) {
      setIsPurchaseHistoryOpen(true);
      return;
    }
    const match = purchases.find((p) =>
      mode === 'entry'
        ? (p.refNo || '').toLowerCase() === query ||
          (p.purchaseInvoiceNo || '').toLowerCase().includes(query)
        : (p.supplierInvoiceNo || '').toLowerCase().includes(query)
    );
    if (match) {
      handleLoadPurchaseToView(match);
    } else {
      showToast(`No purchase matched "${query}". Opening Purchase List.`, 'info');
      setIsPurchaseHistoryOpen(true);
    }
  };

  // Apply Serial/IMEI to selected row
  const handleApplySerialImei = () => {
    if (isReadOnly && !isEditing) return;
    if (!serialImei.trim()) {
      showToast('Enter a Serial / IMEI value first.', 'info');
      return;
    }
    if (selectedRowIndex === null || !purchaseItems[selectedRowIndex]) {
      showToast('Select a product row in the table to attach Serial / IMEI.', 'info');
      return;
    }
    handleUpdateItemField(selectedRowIndex, 'serialImei', serialImei.trim());
    showToast(`Serial/IMEI "${serialImei.trim()}" attached to ${purchaseItems[selectedRowIndex].productName}.`, 'success');
  };

  // Import CSV/Lines handler
  const handleProcessImport = () => {
    if (isReadOnly && !isEditing) {
      showToast('Enable editing or start a new bill before importing items.', 'error');
      return;
    }
    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      showToast('Paste CSV lines (barcode/name, qty, cost) or choose a CSV file.', 'error');
      return;
    }

    let addedCount = 0;
    const importedRows: PurchaseItem[] = [];
    const newDrafts: Record<string, string> = {};

    for (const line of lines) {
      const parts = line.split(/[,\t;]+/).map((p) => p.trim());
      if (!parts[0] || parts[0].toLowerCase() === 'barcode') continue;
      const key = parts[0].toLowerCase();
      const prod = products.find(
        (p) =>
          (p.barcode || '').toLowerCase() === key ||
          (p.sku || '').toLowerCase() === key ||
          (p.name || '').toLowerCase().includes(key)
      );
      if (!prod) continue;

      const parsedQty = parts[1] !== undefined ? parseFloat(parts[1]) : 1;
      const qty = !Number.isNaN(parsedQty) && parsedQty !== 0 ? parsedQty : 1;
      const parsedCost = parts[2] !== undefined ? parseFloat(parts[2]) : prod.costPrice;
      const cost = !Number.isNaN(parsedCost) && parsedCost >= 0 ? parsedCost : prod.costPrice || 0;

      const amounts = computePurchaseItemAmounts(qty, cost, activeVatRate, 0);
      const id = `pitem-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      importedRows.push({
        id,
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        currentStock: Number(prod.stock) || 0,
        quantity: qty,
        purchaseCost: cost,
        salePrice: prod.price || 0,
        discount: 0,
        tax: amounts.vat,
        vat: amounts.vat,
        netAmount: amounts.netAmount,
        wvat: amounts.wvat,
        lineTotal: amounts.lineTotal,
        fPrice: prod.price || 0,
        store: selectedStore,
        location: prod.category ? prod.category.slice(0, 8) : 'A-1',
        shelf: '1',
        wCost: cost,
        imageUrl: prod.imageUrl,
      });
      newDrafts[id] = String(qty);
      addedCount++;
    }

    if (addedCount === 0) {
      showToast('No matching products found in imported lines.', 'error');
      return;
    }

    setPurchaseItems((prev) => [...prev, ...importedRows]);
    setQtyDrafts((prev) => ({ ...prev, ...newDrafts }));
    setIsImportModalOpen(false);
    setImportText('');
    sounds.playSuccessChime();
    showToast(`Imported ${addedCount} item line(s) into purchase.`, 'success');
  };

  // Create Supplier handler
  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim()) {
      showToast('Supplier name is required.', 'error');
      return;
    }
    const newId = `SUP-${100 + suppliers.length + 1}`;
    const newSupplier: Supplier = {
      id: newId,
      name: newSupName.trim(),
      phone: newSupPhone.trim(),
      address: newSupAddress.trim(),
      businessName: newSupBusiness.trim(),
      trn: newSupTrn.trim(),
      payableBalance: newSupBalance || 0,
      remarks: newSupRemarks.trim(),
      createdAt: new Date().toISOString(),
    };
    onAddSupplier(newSupplier);
    setSelectedSupplierId(newSupplier.id);
    setIsNewSupplierModalOpen(false);
    setNewSupName('');
    setNewSupPhone('');
    setNewSupAddress('');
    setNewSupBusiness('');
    setNewSupTrn('');
    setNewSupBalance(0);
    setNewSupRemarks('');
    sounds.playSuccessChime();
    showToast(`Supplier "${newSupplier.name}" created & selected.`, 'success');
  };

  // Keyboard shortcuts (F1, F2, F4, F10, F12)
  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        handleNewPurchase();
      } else if (e.key === 'F2') {
        e.preventDefault();
        handleSavePurchaseAction();
      } else if (e.key === 'F4') {
        e.preventDefault();
        onOpenAddProduct();
      } else if (e.key === 'F10') {
        e.preventDefault();
        handleOpenPrint();
      } else if (e.key === 'F12') {
        e.preventDefault();
        if (onBackToHome) onBackToHome();
        else onNavigate?.('Home');
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  });

  const handleExit = () => {
    if (onBackToHome) onBackToHome();
    else onNavigate?.('Home');
  };

  const filteredStockEnquiry = useMemo(() => {
    const q = stockEnquiryQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
    );
  }, [products, stockEnquiryQuery]);

  const supplierShortCode = useMemo(() => {
    if (!activeSupplier) return '';
    const digits = activeSupplier.id.replace(/\D/g, '');
    return digits || activeSupplier.id.slice(0, 6);
  }, [activeSupplier]);

  const selectedProjectedStock = useMemo(() => {
    if (!selectedItem) return 0;
    const base = selectedLiveProduct ? Number(selectedLiveProduct.stock) || 0 : selectedItem.currentStock;
    const origQty =
      isEditing && originalSavedPurchase
        ? originalSavedPurchase.items
            .filter((i) => i.productId === selectedItem.productId)
            .reduce((s, i) => s + i.quantity, 0)
        : 0;
    if (isReadOnly && !isEditing) return base;
    return base + (Number(selectedItem.quantity) || 0) - origQty;
  }, [selectedItem, selectedLiveProduct, isEditing, isReadOnly, originalSavedPurchase]);

  const rowsDisabled = isReadOnly && !isEditing;

  return (
    <div className="flex-1 w-full h-full min-h-0 flex flex-col bg-[#d7e5f5] text-slate-900 font-sans overflow-hidden select-none">
      {/* Toast Feedback */}
      {toastMessage && (
        <div
          className={`fixed top-3 right-3 z-50 px-3.5 py-2 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-bold border ${
            toastMessage.type === 'success'
              ? 'bg-emerald-700 text-white border-emerald-400'
              : toastMessage.type === 'error'
              ? 'bg-red-700 text-white border-red-400'
              : 'bg-[#0b3b7a] text-white border-blue-400'
          }`}
        >
          {toastMessage.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
          {toastMessage.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {toastMessage.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* =================================================================== */}
      {/* DESKTOP & LAPTOP VIEW (100% IMAGE 1 ERP WORKSTATION DESIGN)         */}
      {/* =================================================================== */}
      <div className="hidden md:flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-gradient-to-b from-[#dceaf9] to-[#c9dcf3]">
        {/* 1. TOP WINDOW TITLE BAR (EXACT IMAGE 1: Gold Cart + Purchase Invoice + Window Controls) */}
        <header className="bg-gradient-to-b from-[#1e55b5] via-[#0f3885] to-[#071f52] text-white px-3 py-1 flex items-center justify-between border-b border-[#041438] shadow-sm shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-400 drop-shadow-xs shrink-0" />
            <h1 className="font-bold text-[15px] tracking-tight text-white drop-shadow-xs">
              Purchase Invoice
            </h1>
            {isEditing && (
              <span className="ml-2 px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-black">
                Editing #{refNo}
              </span>
            )}
            {totals.hasNegativeItems && (
              <span className="ml-1 px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black border border-red-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>Stock Deduction (−{totals.totalNegativeUnits})</span>
              </span>
            )}
          </div>

          {/* Right Classic Window Controls: Minimize / Maximize / Close */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExit}
              className="w-7 h-6 rounded hover:bg-white/15 text-white flex items-center justify-center cursor-pointer"
              title="Minimize / Back"
            >
              <Minus className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="w-7 h-6 rounded hover:bg-white/15 text-white flex items-center justify-center cursor-pointer"
              title={isFullscreen ? 'Restore Window' : 'Maximize Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleExit}
              className="w-7 h-6 rounded hover:bg-red-600 text-white flex items-center justify-center cursor-pointer"
              title="Exit to Dashboard (F12)"
            >
              <X className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </header>

        {/* MAIN FULL-SCREEN WORKSPACE BODY */}
        <div className="flex-1 min-h-0 flex flex-col px-2 py-1.5 gap-1.5 overflow-hidden">
          {/* 2. TOP 3-PANEL ROW (100% IMAGE 1 PROPORTIONS & STYLING) */}
          <div className="grid grid-cols-12 gap-1.5 shrink-0">
            {/* LEFT PANEL: Invoice & Supplier Details (6 cols) */}
            <div className="col-span-12 lg:col-span-6 bg-gradient-to-b from-[#eef5fd] to-[#d9e8fa] border border-[#8baed8] rounded-md p-2 shadow-2xs space-y-1 text-xs">
              {/* Row 1: Ref No | Supplier Invoice # (Exact Image 1 Row 1) */}
              <div className="grid grid-cols-12 gap-1.5 items-center">
                <label className="col-span-2 font-bold text-[#0a3073] text-[12px] truncate">
                  Ref No:
                </label>
                <input
                  type="text"
                  disabled={rowsDisabled}
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                  className="col-span-3 h-6 px-2 bg-white border border-[#96b4d8] rounded-[4px] text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100 tabular-nums"
                />
                <label className="col-span-3 font-bold text-[#0a3073] text-[12px] truncate pl-2">
                  Supplier Invoice #:
                </label>
                <input
                  type="text"
                  disabled={rowsDisabled}
                  value={supplierInvoiceNo}
                  onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                  placeholder="Bill #"
                  className="col-span-4 h-6 px-2 bg-white border border-[#96b4d8] rounded-[4px] text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100 tabular-nums"
                />
              </div>

              {/* Row 2: Date | Entry Date */}
              <div className="grid grid-cols-12 gap-1.5 items-center">
                <label className="col-span-2 font-bold text-[#0a3073] text-[12px]">Date:</label>
                <input
                  type="date"
                  disabled={rowsDisabled}
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="col-span-3 h-6 px-1.5 bg-white border border-[#96b4d8] rounded-[4px] text-[11px] font-bold text-slate-900 focus:outline-none disabled:bg-slate-100"
                />
                <label className="col-span-3 font-bold text-[#0a3073] text-[12px] pl-2">
                  Entry Date:
                </label>
                <input
                  type="date"
                  disabled={rowsDisabled}
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="col-span-4 h-6 px-1.5 bg-white border border-[#96b4d8] rounded-[4px] text-[11px] font-bold text-slate-900 focus:outline-none disabled:bg-slate-100"
                />
              </div>

              {/* Row 3: Glossy Capsule Supplier Button + ID + Dropdown + Clear X */}
              <div className="flex items-center gap-1 pt-0.5">
                <button
                  type="button"
                  disabled={rowsDisabled}
                  onClick={() => setIsNewSupplierModalOpen(true)}
                  className="h-6 px-3 rounded-full bg-gradient-to-b from-[#60a5fa] via-[#2563eb] to-[#1e40af] hover:brightness-110 text-white text-[11px] font-black flex items-center gap-1 border border-[#1d4ed8] shadow-2xs shrink-0 cursor-pointer disabled:opacity-50"
                  title="Add New Supplier"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Supplier</span>
                </button>
                <input
                  type="text"
                  readOnly
                  value={supplierShortCode}
                  placeholder="ID"
                  className="w-14 h-6 px-1.5 bg-white border border-[#96b4d8] rounded-[4px] text-xs font-mono font-bold text-center text-slate-900"
                />
                <select
                  disabled={rowsDisabled}
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="flex-1 min-w-0 h-6 px-2 bg-white border border-[#96b4d8] rounded-[4px] text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100"
                >
                  {suppliers.length === 0 && <option value="">No suppliers — click Supplier</option>}
                  {suppliers.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={rowsDisabled}
                  onClick={() => setSelectedSupplierId('')}
                  className="w-6 h-6 rounded-[4px] bg-gradient-to-b from-white to-[#dbeafe] hover:to-red-100 border border-[#8baed8] text-[#0a3073] hover:text-red-700 flex items-center justify-center font-black text-xs shrink-0 cursor-pointer disabled:opacity-40"
                  title="Clear Selected Supplier"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>

              {/* Lower 2-Column Split: Phone/Address/TRN/Remarks + VAT Type Groupbox & Store */}
              <div className="grid grid-cols-12 gap-2 pt-0.5 items-end">
                <div className="col-span-7 space-y-1">
                  <div className="grid grid-cols-12 items-center gap-1">
                    <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">Phone:</span>
                    <input
                      type="text"
                      disabled={rowsDisabled}
                      value={supplierPhone}
                      onChange={(e) => setSupplierPhone(e.target.value)}
                      className="col-span-8 h-[21px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-semibold text-slate-900 disabled:bg-slate-100"
                    />
                  </div>
                  <div className="grid grid-cols-12 items-center gap-1">
                    <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">Address:</span>
                    <input
                      type="text"
                      disabled={rowsDisabled}
                      value={supplierAddress}
                      onChange={(e) => setSupplierAddress(e.target.value)}
                      className="col-span-8 h-[21px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-semibold text-slate-900 disabled:bg-slate-100"
                    />
                  </div>
                  <div className="grid grid-cols-12 items-center gap-1">
                    <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">TRN #:</span>
                    <input
                      type="text"
                      disabled={rowsDisabled}
                      value={supplierTrn}
                      onChange={(e) => setSupplierTrn(e.target.value)}
                      className="col-span-8 h-[21px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-semibold text-slate-900 disabled:bg-slate-100"
                    />
                  </div>
                  <div className="grid grid-cols-12 items-center gap-1">
                    <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">Remarks:</span>
                    <input
                      type="text"
                      disabled={rowsDisabled}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className="col-span-8 h-[21px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-semibold text-slate-900 disabled:bg-slate-100"
                    />
                  </div>
                </div>

                {/* VAT Type Fieldset + Select Store */}
                <div className="col-span-5 flex flex-col justify-end gap-2">
                  <fieldset className="border border-[#9ab8dc] rounded-[5px] px-2 pb-1.5 pt-0.5 bg-[#e6f0fc]/80">
                    <legend className="px-1 text-[11px] font-bold text-[#0a3073]">VAT Type</legend>
                    <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-slate-900">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="vatTypeRadio"
                          disabled={rowsDisabled}
                          checked={vatType === 'Default VAT'}
                          onChange={() => setVatType('Default VAT')}
                          className="accent-[#0b4ea2]"
                        />
                        <span>Default VAT</span>
                      </label>
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="vatTypeRadio"
                          disabled={rowsDisabled}
                          checked={vatType === 'Out of Scope'}
                          onChange={() => setVatType('Out of Scope')}
                          className="accent-[#0b4ea2]"
                        />
                        <span>Out of Scope</span>
                      </label>
                    </div>
                  </fieldset>

                  <div className="flex items-center gap-1">
                    <select
                      disabled={rowsDisabled}
                      value={selectedStore}
                      onChange={(e) => setSelectedStore(e.target.value)}
                      className="flex-1 min-w-0 h-7 px-1.5 bg-white border border-[#96b4d8] rounded-[4px] text-[11px] font-bold text-slate-900 disabled:bg-slate-100"
                    >
                      {storeList.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsStoreModalOpen(true)}
                      className="h-7 px-2.5 rounded-[5px] bg-gradient-to-b from-[#e8f2ff] to-[#c7ddfa] hover:brightness-95 border border-[#7ea3d1] text-[#0a3073] text-[11px] font-black flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
                    >
                      <Store className="w-3.5 h-3.5 text-[#1d4ed8]" />
                      <span>Select Store</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* MIDDLE PANEL: Search Groupbox (3 cols) */}
            <fieldset className="col-span-12 lg:col-span-3 bg-gradient-to-b from-[#eef5fd] to-[#d9e8fa] border border-[#8baed8] rounded-md px-2 pb-1.5 pt-0.5 shadow-2xs flex flex-col justify-between text-xs min-w-0">
              <legend className="px-1 text-[11px] font-black text-[#0a3073]">Search</legend>

              {/* Nav Buttons Row */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleNavigatePurchase('first')}
                  className="flex-1 h-6 rounded-[4px] bg-gradient-to-b from-[#2f6ce0] to-[#0d3a8a] hover:brightness-110 text-white flex items-center justify-center cursor-pointer border border-[#092966] shadow-2xs"
                  title="First Invoice"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigatePurchase('prev')}
                  className="flex-1 h-6 rounded-[4px] bg-gradient-to-b from-[#2f6ce0] to-[#0d3a8a] hover:brightness-110 text-white flex items-center justify-center cursor-pointer border border-[#092966] shadow-2xs"
                  title="Previous Invoice"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigatePurchase('next')}
                  className="flex-1 h-6 rounded-[4px] bg-gradient-to-b from-[#2f6ce0] to-[#0d3a8a] hover:brightness-110 text-white flex items-center justify-center cursor-pointer border border-[#092966] shadow-2xs"
                  title="Next Invoice"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigatePurchase('last')}
                  className="flex-1 h-6 rounded-[4px] bg-gradient-to-b from-[#2f6ce0] to-[#0d3a8a] hover:brightness-110 text-white flex items-center justify-center cursor-pointer border border-[#092966] shadow-2xs"
                  title="Last Invoice"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsPurchaseHistoryOpen(true)}
                  className="w-8 h-6 rounded-[4px] bg-gradient-to-b from-[#2f6ce0] to-[#0d3a8a] hover:brightness-110 text-white flex items-center justify-center cursor-pointer border border-[#092966] shadow-2xs shrink-0"
                  title="Open Purchase List"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Entry # Search */}
              <div className="grid grid-cols-12 items-center gap-1 mt-1">
                <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">Entry #</span>
                <input
                  type="text"
                  value={searchEntryNo}
                  onChange={(e) => setSearchEntryNo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLookupInvoice('entry');
                  }}
                  className="col-span-6 h-[22px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-bold text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => handleLookupInvoice('entry')}
                  className="col-span-2 h-[22px] rounded-[4px] bg-gradient-to-b from-[#2f6ce0] to-[#0d3a8a] hover:brightness-110 text-white flex items-center justify-center cursor-pointer border border-[#092966]"
                  title="Search Entry #"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Sup Invoice */}
              <div className="grid grid-cols-12 items-center gap-1">
                <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">Sup Invoice</span>
                <input
                  type="text"
                  value={searchSupInvNo}
                  onChange={(e) => setSearchSupInvNo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLookupInvoice('sup');
                  }}
                  className="col-span-8 h-[22px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-bold text-slate-900"
                />
              </div>

              {/* User Name */}
              <div className="grid grid-cols-12 items-center gap-1">
                <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">User Name</span>
                <input
                  type="text"
                  readOnly
                  value={originalSavedPurchase?.userName || userNameDisplay}
                  className="col-span-8 h-[22px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-bold text-slate-900"
                />
              </div>

              {/* Edit by (plus clean Read-Only/Edit toggle when viewing saved Old Purchase) */}
              <div className="grid grid-cols-12 items-center gap-1">
                <span className="col-span-4 text-[11px] font-bold text-[#0a3073]">Edit by</span>
                {isReadOnly && !isEditing ? (
                  <div className="col-span-8 flex items-center gap-1">
                    <input
                      type="text"
                      readOnly
                      value={editByName}
                      placeholder="Read-Only"
                      className="flex-1 min-w-0 h-[22px] px-2 bg-slate-100 border border-[#96b4d8] rounded-[3px] text-[11px] font-bold text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={handleStartEditing}
                      className="h-[22px] px-2 rounded bg-amber-400 hover:bg-amber-300 border border-amber-600 text-slate-950 text-[10px] font-black shrink-0 cursor-pointer flex items-center gap-0.5"
                      title="Unlock Invoice for Editing"
                    >
                      <Lock className="w-2.5 h-2.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                ) : (
                  <div className="col-span-8 flex items-center gap-1">
                    <input
                      type="text"
                      disabled={!isEditing}
                      value={editByName}
                      onChange={(e) => setEditByName(e.target.value)}
                      placeholder={isEditing ? userNameDisplay : ''}
                      className="flex-1 min-w-0 h-[22px] px-2 bg-white border border-[#96b4d8] rounded-[3px] text-[11px] font-bold text-slate-900 disabled:bg-white"
                    />
                    {isEditing && (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="h-[22px] px-2 rounded bg-slate-200 hover:bg-slate-300 border border-slate-400 text-slate-900 text-[10px] font-bold shrink-0 cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            </fieldset>

            {/* RIGHT PANEL: Vivid Green Purchase Invoice Graphic Card (3 cols — 100% Image 1) */}
            <div className="col-span-12 lg:col-span-3 bg-gradient-to-b from-[#c0fd9e] via-[#4be048] to-[#0ca222] border-2 border-[#158026] rounded-xl p-2 flex flex-col items-center justify-center shadow-sm relative overflow-hidden">
              <div className="absolute inset-x-2 top-1 h-5 rounded-full bg-white/35 pointer-events-none" />
              <div className="text-[22px] xl:text-[25px] font-black text-[#e61919] tracking-tight leading-none drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">
                Purchase Invoice
              </div>
              <div className="mt-1 flex items-center justify-center">
                <svg viewBox="0 0 135 80" className="w-32 h-[68px] drop-shadow-sm" aria-hidden="true">
                  <path
                    d="M14 14 H30 L45 52 H102 L114 22 H35"
                    fill="none"
                    stroke="#0d3f94"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M36 24 H110 L101 49 H46 Z"
                    fill="none"
                    stroke="#1e6ee6"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M42 32 H106 M44 41 H103 M60 23 V50 M78 23 V50 M94 23 V50"
                    stroke="#1e6ee6"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx="52" cy="63" r="6.5" fill="#0d3f94" stroke="#ffffff" strokeWidth="1.5" />
                  <circle cx="95" cy="63" r="6.5" fill="#0d3f94" stroke="#ffffff" strokeWidth="1.5" />
                  <path
                    d="M32 69 C68 78, 108 62, 120 26"
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* 3. ITEM SEARCH / SERIAL-IMEI / EXPENSES TOOLBAR (100% IMAGE 1 CAPSULE BAR) */}
          <div className="bg-gradient-to-b from-[#e4effc] to-[#cbdff6] border border-[#8baed8] rounded-md px-1.5 py-1 flex items-center gap-2 shrink-0">
            {/* Blue Item Search Capsule */}
            <div
              ref={searchBoxRef}
              className="relative flex-1 min-w-[260px] bg-gradient-to-b from-[#235dc2] via-[#134296] to-[#0a2763] rounded-md p-1 flex items-center gap-2 border border-[#071f52] shadow-2xs"
            >
              <span className="text-white text-[13px] font-black pl-2 whitespace-nowrap shrink-0">
                Item Search
              </span>
              <div className="flex-1 flex items-center bg-white rounded-full px-2.5 h-7 border border-[#7ea3d1] shadow-inner overflow-hidden">
                <input
                  ref={itemInputRef}
                  type="text"
                  disabled={rowsDisabled}
                  value={itemSearchQuery}
                  onChange={(e) => {
                    setItemSearchQuery(e.target.value);
                    setHighlightedIndex(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && itemSuggestions.length > 0) {
                      e.preventDefault();
                      setHighlightedIndex((prev) =>
                        prev === null || prev >= itemSuggestions.length - 1 ? 0 : prev + 1
                      );
                    } else if (e.key === 'ArrowUp' && itemSuggestions.length > 0) {
                      e.preventDefault();
                      setHighlightedIndex((prev) =>
                        prev === null || prev <= 0 ? itemSuggestions.length - 1 : prev - 1
                      );
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (highlightedIndex !== null && itemSuggestions[highlightedIndex]) {
                        handleAddItemToPurchase(itemSuggestions[highlightedIndex]);
                      } else if (itemSearchQuery.trim()) {
                        const q = itemSearchQuery.trim().toLowerCase();
                        const exact =
                          products.find((p) => (p.barcode || '').toLowerCase() === q) ||
                          products.find((p) => (p.sku || '').toLowerCase() === q) ||
                          itemSuggestions[0];
                        if (exact) handleAddItemToPurchase(exact);
                        else showToast('Product Not Found — click F4 Create Item.', 'error');
                      }
                    } else if (e.key === 'Escape') {
                      setShowItemSuggestions(false);
                    }
                  }}
                  placeholder="Search Item..."
                  className="w-full text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:bg-slate-100"
                />
                <button
                  type="button"
                  disabled={rowsDisabled}
                  onClick={() => setIsCameraScannerOpen(true)}
                  className="text-[#0b4ea2] hover:text-blue-700 pl-1.5 cursor-pointer disabled:opacity-40 shrink-0"
                  title="Scan Barcode Camera"
                >
                  <BarcodeIcon className="w-4 h-4" />
                </button>
              </div>
              <button
                type="button"
                disabled={rowsDisabled}
                onClick={() => {
                  if (itemSuggestions[0]) handleAddItemToPurchase(itemSuggestions[0]);
                }}
                className="w-7 h-7 rounded-full bg-gradient-to-b from-[#3b82f6] to-[#0f3d91] hover:brightness-110 text-white border border-blue-300/40 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-50 shadow-xs"
                title="Search & Add Item"
              >
                <Search className="w-4 h-4" />
              </button>

              {/* Autocomplete Dropdown */}
              {showItemSuggestions && itemSuggestions.length > 0 && !rowsDisabled && (
                <div className="absolute top-full left-24 right-0 mt-1 bg-white rounded-lg shadow-2xl border border-slate-300 z-50 max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {itemSuggestions.map((prod, idx) => (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => handleAddItemToPurchase(prod)}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between cursor-pointer ${
                        highlightedIndex === idx ? 'bg-blue-100 font-bold' : 'hover:bg-blue-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{prod.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {prod.barcode} • Stock: {prod.stock} {prod.unit}
                        </p>
                      </div>
                      <span className="text-xs font-black text-emerald-700 shrink-0 ml-2 tabular-nums">
                        Cost: {formatRs(prod.costPrice)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Vivid Green Serial/IMEI Pill Input + Round Green Refresh/Apply Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center rounded-full bg-gradient-to-b from-[#5ce06b] via-[#22b53b] to-[#0f7d22] border border-[#0f6b1e] px-3 h-8 shadow-2xs">
                <input
                  type="text"
                  disabled={rowsDisabled}
                  value={serialImei}
                  onChange={(e) => setSerialImei(e.target.value)}
                  placeholder="Serial/IMEI"
                  className="w-28 bg-transparent text-white placeholder:text-white text-xs font-black text-center focus:outline-none disabled:opacity-60"
                />
                <ChevronDown className="w-3.5 h-3.5 text-white shrink-0" />
              </div>
              <button
                type="button"
                disabled={rowsDisabled}
                onClick={handleApplySerialImei}
                className="w-8 h-8 rounded-full bg-gradient-to-b from-[#5ce06b] via-[#22b53b] to-[#0f7d22] hover:brightness-110 text-white flex items-center justify-center border border-[#0f6b1e] shadow-2xs cursor-pointer disabled:opacity-40"
                title="Attach Serial / IMEI to Selected Item Row"
              >
                <RefreshCw className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            {/* Expenses/Services + Amount */}
            <div className="flex items-center gap-1 shrink-0">
              <select
                disabled={rowsDisabled}
                value={expensesLabel}
                onChange={(e) => setExpensesLabel(e.target.value)}
                className="h-8 px-2.5 rounded-md bg-gradient-to-b from-white to-[#e2ecf8] border border-[#8baed8] text-xs font-bold text-slate-900 disabled:bg-slate-100"
              >
                {EXPENSE_OPTIONS.map((op) => (
                  <option key={op.label} value={op.label}>
                    {op.label}
                  </option>
                ))}
              </select>
              {expensesLabel !== 'Expenses/Services' && (
                <input
                  type="number"
                  min="0"
                  disabled={rowsDisabled}
                  value={expensesAmount || ''}
                  onChange={(e) => setExpensesAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="Fee"
                  className="w-20 h-8 px-2 rounded-md bg-white border border-[#8baed8] text-xs font-bold text-right tabular-nums"
                  title="Expense / Service Amount"
                />
              )}
            </div>

            {/* Tax / Non Selector */}
            <select
              disabled={rowsDisabled || vatType === 'Out of Scope'}
              value={vatType === 'Out of Scope' ? 'Non' : selectedTaxLabel}
              onChange={(e) => setSelectedTaxLabel(e.target.value)}
              className="w-28 h-8 px-2.5 rounded-md bg-gradient-to-b from-white to-[#e2ecf8] border border-[#8baed8] text-xs font-bold text-slate-900 disabled:bg-slate-100 shrink-0"
              title="Tax Rate"
            >
              {TAX_OPTIONS.map((tx) => (
                <option key={tx.label} value={tx.label}>
                  {tx.label}
                </option>
              ))}
            </select>
          </div>

          {/* 4. CENTRAL PRODUCT ENTRY TABLE + RIGHT SUMMARY STACK */}
          <div className="flex-1 min-h-0 flex gap-1.5 overflow-hidden">
            {/* LEFT: PRODUCT TABLE (Golden-yellow Item Name column + clean ERP white grid) */}
            <div className="flex-1 min-w-0 bg-white border border-[#7ea3d1] rounded-[4px] flex flex-col overflow-hidden shadow-2xs">
              <div className="flex-1 overflow-auto bg-white">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10 bg-gradient-to-b from-[#1a55a8] via-[#0e397a] to-[#062252] text-white text-[11px] font-bold">
                    <tr>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-center w-9">No</th>
                      <th className="py-1.5 px-2 border-r border-blue-400/30 text-left w-24">Barcode</th>
                      <th className="py-1.5 px-2 border-r border-blue-400/30 text-left min-w-[185px]">Item Name</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-center w-24">Qty</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-right w-20">Price</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-right w-24">Net Amount</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-center w-14">VAT</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-right w-24">WWAT</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-right w-20">F.Price</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-right w-20">Sale Price</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-center w-16">Store</th>
                      <th className="py-1.5 px-1.5 border-r border-blue-400/30 text-center w-18">Location</th>
                      <th className="py-1.5 px-1.5 text-right w-16">W.Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {purchaseItems.length === 0 ? (
                      <>
                        <tr>
                          <td colSpan={13} className="py-8 text-center bg-white">
                            <p className="text-xs font-bold text-slate-600">
                              Search Item or Scan Barcode above — Enter Qty like 1, 10 or Negative (−1, −5) for stock deduction
                            </p>
                          </td>
                        </tr>
                        {Array.from({ length: 8 }).map((_, emptyIdx) => (
                          <tr key={`empty-row-${emptyIdx}`} className="h-[26px] bg-white">
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100 bg-[#fdf3b0]/35" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td className="border-r border-slate-100" />
                            <td />
                          </tr>
                        ))}
                      </>
                    ) : (
                      <>
                        {purchaseItems.map((item, idx) => {
                          const isSelected = selectedRowIndex === idx;
                          const isNegative = item.quantity < 0;
                          const draftQty =
                            qtyDrafts[item.id] !== undefined ? qtyDrafts[item.id] : String(item.quantity);

                          return (
                            <tr
                              key={item.id}
                              onClick={() => setSelectedRowIndex(idx)}
                              className={`cursor-pointer transition-colors h-[26px] ${
                                isSelected
                                  ? 'bg-[#eff6ff] ring-1 ring-inset ring-blue-400'
                                  : isNegative
                                  ? 'bg-red-50/40 hover:bg-red-50'
                                  : 'bg-white hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-0.5 px-1.5 text-center font-semibold text-slate-800 border-r border-slate-200 tabular-nums">
                                {idx + 1}
                              </td>
                              <td className="py-0.5 px-2 font-mono text-[11px] text-slate-800 border-r border-slate-200 truncate">
                                {item.barcode || '-'}
                              </td>
                              {/* GOLDEN-YELLOW ITEM NAME COLUMN (100% IMAGE 1) */}
                              <td
                                className={`py-0.5 px-2 font-semibold border-r border-slate-200 ${
                                  isSelected ? 'bg-[#facc15] text-slate-950 font-bold' : 'bg-[#fbe360] text-slate-900'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="truncate uppercase">{item.productName}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {item.serialImei && (
                                      <span className="px-1 py-0.2 rounded bg-emerald-700 text-white text-[9px] font-mono">
                                        {item.serialImei}
                                      </span>
                                    )}
                                    {isNegative && (
                                      <span className="px-1 py-0.2 rounded bg-red-600 text-white text-[9px] font-black">
                                        {item.quantity}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Qty Cell: supports +1, +10 AND -1, -5 */}
                              <td
                                className="py-0.5 px-1 border-r border-slate-200"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-center gap-0.5">
                                  <button
                                    type="button"
                                    disabled={rowsDisabled}
                                    onClick={() => handleStepQuantity(idx, -1)}
                                    className="w-5 h-5 rounded bg-slate-100 hover:bg-red-600 hover:text-white text-slate-700 border border-slate-300 flex items-center justify-center font-black cursor-pointer disabled:opacity-40"
                                    title="Decrease Qty (can step to -1, -2...)"
                                  >
                                    <Minus className="w-2.5 h-2.5" />
                                  </button>
                                  <input
                                    type="text"
                                    inputMode="text"
                                    disabled={rowsDisabled}
                                    value={draftQty}
                                    onChange={(e) => handleQtyTextChange(idx, item.id, e.target.value)}
                                    onBlur={() => handleQtyBlur(idx, item.id)}
                                    aria-label={`Quantity for ${item.productName}`}
                                    className={`w-11 text-center font-bold border rounded px-1 py-0.2 text-xs tabular-nums focus:outline-none focus:ring-1 ${
                                      isNegative
                                        ? 'bg-red-50 border-red-500 text-red-700 font-black focus:ring-red-500'
                                        : 'bg-white border-slate-300 text-slate-900 focus:ring-blue-500'
                                    } disabled:bg-transparent disabled:border-transparent`}
                                  />
                                  <button
                                    type="button"
                                    disabled={rowsDisabled}
                                    onClick={() => handleStepQuantity(idx, 1)}
                                    className="w-5 h-5 rounded bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-700 border border-emerald-300 flex items-center justify-center font-black cursor-pointer disabled:opacity-40"
                                    title="Increase Qty"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </td>

                              {/* Price (Unit Cost) */}
                              <td
                                className="py-0.5 px-1 border-r border-slate-200 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rowsDisabled}
                                  value={item.purchaseCost}
                                  onChange={(e) =>
                                    handleUpdateItemField(idx, 'purchaseCost', parseFloat(e.target.value) || 0)
                                  }
                                  className="w-full text-right font-semibold text-slate-900 bg-white border border-slate-200 rounded px-1 py-0.2 text-xs tabular-nums focus:outline-none focus:border-blue-500 disabled:bg-transparent disabled:border-transparent"
                                />
                              </td>

                              {/* Net Amount */}
                              <td
                                className={`py-0.5 px-1.5 text-right font-semibold border-r border-slate-200 tabular-nums ${
                                  isNegative ? 'text-red-700 font-bold' : 'text-slate-900'
                                }`}
                              >
                                {(item.netAmount ?? item.lineTotal).toFixed(3)}
                              </td>

                              {/* VAT (Vivid red cell on negative qty matching Image 2!) */}
                              <td
                                className={`py-0.5 px-1.5 text-center font-semibold border-r border-slate-200 tabular-nums ${
                                  isNegative
                                    ? 'bg-[#ef4444] text-white font-black'
                                    : 'text-slate-800'
                                }`}
                                title={isNegative ? 'Negative Quantity Stock Deduction' : 'VAT'}
                              >
                                {(item.vat || 0) === 0 ? '.00' : (item.vat || 0).toFixed(2)}
                              </td>

                              {/* WWAT */}
                              <td
                                className={`py-0.5 px-1.5 text-right font-semibold border-r border-slate-200 tabular-nums ${
                                  isNegative ? 'text-red-700 font-bold' : 'text-slate-900'
                                }`}
                              >
                                {(item.wvat ?? item.lineTotal).toFixed(3)}
                              </td>

                              {/* F.Price */}
                              <td className="py-0.5 px-1.5 text-right text-slate-800 border-r border-slate-200 tabular-nums">
                                {(item.fPrice ?? item.salePrice ?? 0).toFixed(3)}
                              </td>

                              {/* Sale Price */}
                              <td
                                className="py-0.5 px-1 border-r border-slate-200 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  disabled={rowsDisabled}
                                  value={item.salePrice ?? 0}
                                  onChange={(e) =>
                                    handleUpdateItemField(idx, 'salePrice', parseFloat(e.target.value) || 0)
                                  }
                                  className="w-full text-right font-semibold text-slate-900 bg-white border border-slate-200 rounded px-1 py-0.2 text-xs tabular-nums focus:outline-none focus:border-blue-500 disabled:bg-transparent disabled:border-transparent"
                                />
                              </td>

                              {/* Store */}
                              <td className="py-0.5 px-1 text-center text-[10px] text-slate-600 border-r border-slate-200 truncate">
                                {item.store || selectedStore}
                              </td>

                              {/* Location */}
                              <td
                                className="py-0.5 px-1 border-r border-slate-200 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  disabled={rowsDisabled}
                                  value={item.location || ''}
                                  onChange={(e) => handleUpdateItemField(idx, 'location', e.target.value)}
                                  className="w-full text-center text-[10px] font-semibold text-slate-700 bg-white border border-slate-200 rounded px-1 py-0.2 disabled:bg-transparent disabled:border-transparent"
                                />
                              </td>

                              {/* W.Cost */}
                              <td className="py-0.5 px-1.5 text-right font-semibold text-slate-800 tabular-nums">
                                {(item.wCost ?? item.purchaseCost).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Fill remaining height up to 10 visual rows cleanly like desktop ERP grid */}
                        {purchaseItems.length < 10 &&
                          Array.from({ length: 10 - purchaseItems.length }).map((_, fillerIdx) => (
                            <tr key={`filler-${fillerIdx}`} className="h-[26px] bg-white">
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100 bg-[#fdf3b0]/30" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td className="border-r border-slate-100" />
                              <td />
                            </tr>
                          ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT: VERTICAL SUMMARY STACK + Total QTY BELOW (100% IMAGE 1) */}
            <div className="w-56 xl:w-64 flex flex-col gap-1.5 shrink-0">
              <div className="flex-1 bg-gradient-to-b from-[#134696] to-[#082457] border border-[#06183a] rounded-md p-1.5 flex flex-col justify-between gap-1 text-white shadow-sm">
                {/* Gross Total */}
                <div className="grid grid-cols-12 items-center gap-1">
                  <span className="col-span-5 text-[11px] font-bold text-white pl-1">Gross Total</span>
                  <div className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 flex items-center justify-end rounded-[3px] text-[13px] tabular-nums shadow-inner">
                    {totals.grossTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                {/* Discount */}
                <div className="grid grid-cols-12 items-center gap-1">
                  <span className="col-span-5 text-[11px] font-bold text-white pl-1">Discount</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={rowsDisabled}
                    value={costDiscountAmount || ''}
                    onChange={(e) => {
                      setCostDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0));
                      setCostDiscountPercent(0);
                    }}
                    placeholder="0.00"
                    className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 rounded-[3px] text-[13px] tabular-nums focus:outline-none disabled:bg-slate-100 shadow-inner"
                  />
                </div>

                {/* VAT */}
                <div className="grid grid-cols-12 items-center gap-1">
                  <span className="col-span-5 text-[11px] font-bold text-white pl-1">VAT</span>
                  <div className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 flex items-center justify-end rounded-[3px] text-[13px] tabular-nums shadow-inner">
                    {totals.vat.toFixed(2)}
                  </div>
                </div>

                {/* Roundoff */}
                <div className="grid grid-cols-12 items-center gap-1">
                  <span className="col-span-5 text-[11px] font-bold text-white pl-1">Roundoff</span>
                  <input
                    type="number"
                    step="any"
                    disabled={rowsDisabled}
                    value={roundoff || ''}
                    onChange={(e) => setRoundoff(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 rounded-[3px] text-[13px] tabular-nums focus:outline-none disabled:bg-slate-100 shadow-inner"
                  />
                </div>

                {/* Total Amount (Vivid Magenta/Purple Highlight Bar matching Image 1) */}
                <div className="grid grid-cols-12 items-center gap-1 bg-gradient-to-r from-[#d926eb] via-[#b81ee0] to-[#9314c7] p-1 rounded-[4px] border border-fuchsia-300/60 shadow-xs">
                  <span className="col-span-5 text-[11px] font-black text-white pl-1">Total Amount</span>
                  <div className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 flex items-center justify-end rounded-[3px] text-[13px] tabular-nums">
                    {totals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                {/* Payment */}
                <div className="grid grid-cols-12 items-center gap-1">
                  <span className="col-span-5 text-[11px] font-bold text-white pl-1">Payment</span>
                  <input
                    type="number"
                    step="any"
                    disabled={rowsDisabled}
                    value={amountPaidInput}
                    onChange={(e) => setAmountPaidInput(e.target.value)}
                    placeholder={totals.paid.toFixed(2)}
                    className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 rounded-[3px] text-[13px] tabular-nums focus:outline-none disabled:bg-slate-100 shadow-inner"
                  />
                </div>

                {/* Outstanding */}
                <div className="grid grid-cols-12 items-center gap-1">
                  <span className="col-span-5 text-[11px] font-bold text-white pl-1">Outstanding</span>
                  <div className="col-span-7 h-7 bg-white text-slate-950 font-black text-right px-2 flex items-center justify-end rounded-[3px] text-[13px] tabular-nums shadow-inner">
                    {totals.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Total QTY row sitting cleanly OUTSIDE & BELOW the Navy Stack (100% Image 1) */}
              <div className="grid grid-cols-12 items-center gap-1 px-1">
                <span className="col-span-5 text-[12px] font-black text-[#0a3073]">Total QTY:</span>
                <div
                  className={`col-span-7 h-7 font-black text-right px-2 flex items-center justify-end rounded-[4px] border text-[13px] tabular-nums shadow-inner ${
                    totals.totalQty < 0
                      ? 'bg-red-100 border-red-400 text-red-800'
                      : 'bg-[#c5f7cb] border-[#65a30d] text-slate-950'
                  }`}
                >
                  {totals.totalQty}
                </div>
              </div>
            </div>
          </div>

          {/* 5. BOTTOM 4 PANELS (Stock Info | Purchase/Order | Totals Card | Payment Information) */}
          <div className="grid grid-cols-12 gap-1.5 shrink-0 h-36">
            {/* Panel 1: Stock Info (Green Glossy Header + Product/Red Car Visual) */}
            <div className="col-span-3 bg-gradient-to-b from-[#f5f9ff] to-[#e4effc] border border-[#8baed8] rounded-lg overflow-hidden flex flex-col shadow-2xs">
              <div className="bg-gradient-to-b from-[#25be4a] to-[#0f7d22] text-white px-2.5 py-1 text-xs font-black flex items-center justify-between border-b border-[#0c661a]">
                <span>Stock Info</span>
                {selectedItem && (
                  <span className="text-[10px] font-bold bg-black/20 px-1.5 py-0.2 rounded truncate max-w-[115px]">
                    {selectedItem.productName}
                  </span>
                )}
              </div>
              <div className="flex-1 px-2 py-1.5 flex items-center gap-2 min-h-0">
                <div className="w-18 h-18 rounded-md bg-white/80 border border-[#b9d0ec] flex items-center justify-center overflow-hidden shrink-0">
                  {selectedLiveProduct?.imageUrl || selectedItem?.imageUrl ? (
                    <img
                      src={selectedLiveProduct?.imageUrl || selectedItem?.imageUrl}
                      alt={selectedItem?.productName || 'Product'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    /* Glossy Red Car Icon matching Reference Image 1 */
                    <svg viewBox="0 0 80 54" className="w-16 h-12" aria-hidden="true">
                      <path
                        d="M8 34 L15 20 L31 13 H53 L68 23 L74 33 L72 40 H8 Z"
                        fill="#dc2626"
                        stroke="#7f1d1d"
                        strokeWidth="2"
                      />
                      <path d="M24 21 L34 15 H50 L60 22 Z" fill="#1e293b" />
                      <circle cx="22" cy="40" r="7" fill="#111827" stroke="#9ca3af" strokeWidth="2" />
                      <circle cx="58" cy="40" r="7" fill="#111827" stroke="#9ca3af" strokeWidth="2" />
                      <ellipse cx="69" cy="29" rx="3" ry="2" fill="#fde047" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 grid grid-cols-2 gap-x-1.5 gap-y-0.5 text-[11px]">
                  <span className="font-bold text-slate-700">Stock Qty:</span>
                  <span className="font-black text-right tabular-nums text-slate-950">
                    {selectedLiveProduct?.stock ?? selectedItem?.currentStock ?? 0}
                    {selectedItem && !rowsDisabled && (
                      <span
                        className={`ml-1 text-[10px] ${
                          selectedItem.quantity < 0 ? 'text-red-600' : 'text-emerald-700'
                        }`}
                      >
                        → {selectedProjectedStock}
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-slate-700">Cost Price:</span>
                  <span className="font-black text-right tabular-nums text-slate-950">
                    {selectedItem?.purchaseCost ?? selectedLiveProduct?.costPrice ?? 0}
                  </span>
                  <span className="font-bold text-slate-700">Sales Price:</span>
                  <span className="font-black text-right tabular-nums text-slate-950">
                    {selectedItem?.salePrice ?? selectedLiveProduct?.price ?? 0}
                  </span>
                  <span className="font-bold text-slate-700">Location:</span>
                  <span className="font-semibold text-right truncate text-slate-800">
                    {selectedItem?.location || ''}
                  </span>
                  <span className="font-bold text-slate-700">Shelf:</span>
                  <span className="font-black text-right text-slate-950">
                    {selectedItem?.shelf || '1'}
                  </span>
                </div>
              </div>
            </div>

            {/* Panel 2: Purchase/Order (Blue Glossy Header — clickable rows load invoice!) */}
            <div className="col-span-3 bg-[#e2eefb] border border-[#8baed8] rounded-lg overflow-hidden flex flex-col shadow-2xs">
              <div className="bg-gradient-to-b from-[#2566cb] to-[#0a3880] text-white px-2.5 py-1 text-xs font-black flex items-center justify-between">
                <span>Purchase/Order</span>
                <span className="text-[10px] font-bold text-blue-100">{purchases.length} Saved</span>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#dce9f9]">
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-gradient-to-b from-[#1e5cb8] to-[#0e428c] text-white text-[10px] font-bold">
                    <tr>
                      <th className="py-1 px-1.5 text-left">Purchase#</th>
                      <th className="py-1 px-1.5 text-left">Date</th>
                      <th className="py-1 px-1.5 text-left">Ref #</th>
                      <th className="py-1 px-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-200/70">
                    {purchases.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500 text-[11px]">
                          No saved invoices
                        </td>
                      </tr>
                    ) : (
                      purchases.slice(0, 25).map((p) => (
                        <tr
                          key={p.id}
                          onClick={() => handleLoadPurchaseToView(p)}
                          className={`cursor-pointer hover:bg-blue-100 ${
                            editingPurchaseId === p.id ? 'bg-[#fde68a] font-bold' : 'bg-white/75'
                          }`}
                        >
                          <td className="py-1 px-1.5 font-mono font-bold text-[#0b4ea2] truncate">
                            {p.purchaseInvoiceNo}
                          </td>
                          <td className="py-1 px-1.5 text-slate-700">{p.purchaseDate}</td>
                          <td className="py-1 px-1.5 font-mono text-slate-700">{p.refNo || '-'}</td>
                          <td
                            className={`py-1 px-1.5 text-right font-bold tabular-nums ${
                              p.grandTotal < 0 ? 'text-red-700' : 'text-slate-900'
                            }`}
                          >
                            {p.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panel 3: Sub Total / Discount / Tax / Grand Total Card (100% Image 1 Coins + Green Grand Total Bar) */}
            <div className="col-span-3 bg-gradient-to-b from-[#f0fdf4] to-[#dcfce7] border border-[#72c488] rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs relative">
              <div className="p-2 space-y-1 text-xs relative">
                {/* Gold Coins Badge Top-Left matching Image 1 */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex w-5 h-5 rounded-full bg-amber-400 border border-amber-600 items-center justify-center text-[10px] font-black text-amber-950 shadow-2xs">
                      $
                    </span>
                    <span className="font-bold text-slate-800">Sub Total:</span>
                  </div>
                  <span className="font-black text-slate-950 bg-white/85 px-2 py-0.5 rounded tabular-nums min-w-[84px] text-right">
                    {totals.grossTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between pl-6">
                  <span className="font-bold text-slate-800">Discount:</span>
                  <span className="font-black text-red-600 bg-white/85 px-2 py-0.5 rounded tabular-nums min-w-[84px] text-right">
                    {totals.discount.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between pl-6">
                  <span className="font-bold text-slate-800">Tax ({activeVatRate}%):</span>
                  <span className="font-black text-slate-950 bg-white/85 px-2 py-0.5 rounded tabular-nums min-w-[84px] text-right">
                    {totals.vat.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="bg-gradient-to-b from-[#1db025] to-[#0a6b11] text-white px-3 py-1.5 flex items-center justify-between border-t border-[#15803d]">
                <span className="text-xs font-black text-[#fde047]">Grand Total:</span>
                <span className="text-base font-black text-[#fde047] tabular-nums">
                  {totals.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Panel 4: Payment Information Card (Green Glossy Header + Payment Complete Checkmark) */}
            <div className="col-span-3 bg-gradient-to-b from-[#f0fdf4] to-[#ffffff] border border-[#72c488] rounded-lg overflow-hidden flex flex-col justify-between shadow-2xs">
              <div className="bg-gradient-to-b from-[#25be4a] to-[#0f7d22] text-white px-2.5 py-1 text-xs font-black flex items-center justify-between border-b border-[#0c661a]">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex w-4 h-4 rounded-full bg-amber-400 border border-amber-700 items-center justify-center text-[9px] font-black text-amber-950">
                    $
                  </span>
                  <span>Payment Information</span>
                </div>
                {/* Compact Payment Type Toggle (Cash / Credit / Card) */}
                <div className="flex items-center gap-0.5 bg-black/20 rounded p-0.5">
                  {(['cash', 'credit', 'card'] as const).map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      disabled={rowsDisabled}
                      onClick={() => setPaymentMethod(pm)}
                      className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase cursor-pointer ${
                        paymentMethod === pm
                          ? 'bg-white text-[#0f7d22]'
                          : 'text-white/85 hover:text-white'
                      }`}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              </div>
              <div className="px-2.5 py-1.5 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Paid Amount:</span>
                  <span className="font-black text-[#15803d] text-sm tabular-nums">
                    {totals.paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Due Amount:</span>
                  <span className="font-black text-red-600 text-sm tabular-nums">
                    {totals.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <div
                className={`px-2.5 py-1 text-xs font-black flex items-center justify-center gap-1.5 border-t ${
                  totals.hasNegativeItems
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : totals.outstanding <= 0
                    ? 'bg-[#e8f8ed] text-[#14532d] border-[#b7ebc9]'
                    : 'bg-amber-50 text-amber-900 border-amber-200'
                }`}
              >
                {totals.hasNegativeItems ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                    <span>Stock Deduction Adjustment</span>
                  </>
                ) : totals.outstanding <= 0 ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-[#16a34a]" />
                    <span>Payment Complete</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Credit Payable Due</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 6. BOTTOM 10-BUTTON GLOSSY TOOLBAR (100% IMAGE 1 MATCH) */}
          <div className="grid grid-cols-10 gap-1.5 shrink-0 pt-0.5">
            {/* 1. F1 New Purchase */}
            <button
              type="button"
              onClick={handleNewPurchase}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#e9fceb] to-[#bbf7c6] hover:brightness-95 border border-[#72c488] text-[#0f5132] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <span className="w-6 h-6 rounded-full bg-[#16a34a] text-white flex items-center justify-center shadow-2xs">
                <Plus className="w-4 h-4 stroke-[3]" />
              </span>
              <span className="text-[11px] font-black leading-tight text-center">F1 New Purchase</span>
            </button>

            {/* 2. Import */}
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#ebf4ff] to-[#c4defc] hover:brightness-95 border border-[#7ea3d1] text-[#0b3b7a] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <Upload className="w-6 h-6 text-[#1d4ed8]" />
              <span className="text-[11px] font-black leading-tight text-center">Import</span>
            </button>

            {/* 3. Stock Enquiry */}
            <button
              type="button"
              onClick={() => setIsStockEnquiryOpen(true)}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#fef0c7] via-[#fdcf72] to-[#f59e0b] hover:brightness-95 border border-[#d97706] text-[#5c2b05] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <Search className="w-6 h-6 text-[#78350f] stroke-[2.5]" />
              <span className="text-[11px] font-black leading-tight text-center">Stock Enquiry</span>
            </button>

            {/* 4. F4 Create Item */}
            <button
              type="button"
              onClick={onOpenAddProduct}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#f3e8ff] via-[#d8b4fe] to-[#a855f7] hover:brightness-95 border border-[#7e22ce] text-[#3b0764] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <Package className="w-6 h-6 text-[#4c1d95]" />
              <span className="text-[11px] font-black leading-tight text-center">F4 Create Item</span>
            </button>

            {/* 5. One (Delete Selected Row) */}
            <button
              type="button"
              disabled={rowsDisabled}
              onClick={() => {
                if (selectedRowIndex !== null && purchaseItems[selectedRowIndex]) {
                  setItemToDeleteIndex(selectedRowIndex);
                } else if (purchaseItems.length > 0) {
                  setItemToDeleteIndex(purchaseItems.length - 1);
                } else {
                  showToast('No row selected to delete.', 'info');
                }
              }}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#ffeef0] to-[#fecdd3] hover:brightness-95 border border-[#fda4af] text-[#881337] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95 disabled:opacity-45"
            >
              <Trash2 className="w-6 h-6 text-[#e11d48]" />
              <span className="text-[11px] font-black leading-tight text-center">One</span>
            </button>

            {/* 6. All (Delete All Rows) */}
            <button
              type="button"
              disabled={rowsDisabled || purchaseItems.length === 0}
              onClick={() => setShowConfirmClearPurchase(true)}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#fee2e2] to-[#fecaca] hover:brightness-95 border border-[#fca5a5] text-[#7f1d1d] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95 disabled:opacity-45"
            >
              <Trash2 className="w-6 h-6 text-[#dc2626]" />
              <span className="text-[11px] font-black leading-tight text-center">All</span>
            </button>

            {/* 7. F2 Save / Edit Invoice / Save Changes */}
            {isReadOnly && !isEditing ? (
              <button
                type="button"
                onClick={handleStartEditing}
                className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#fef3c7] via-[#fde68a] to-[#f59e0b] hover:brightness-95 border border-[#d97706] text-slate-950 flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
              >
                <Edit className="w-6 h-6 text-amber-900" />
                <span className="text-[11px] font-black leading-tight text-center">Edit Invoice</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isSaving || purchaseItems.length === 0}
                onClick={handleSavePurchaseAction}
                className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#e8f2ff] to-[#bfdbfe] hover:brightness-95 border border-[#7ea3d1] text-[#1e3a8a] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95 disabled:opacity-45"
              >
                <Save className="w-6 h-6 text-[#1d4ed8]" />
                <span className="text-[11px] font-black leading-tight text-center">
                  {isEditing ? 'Save Changes' : 'F2 Save'}
                </span>
              </button>
            )}

            {/* 8. F10 Print */}
            <button
              type="button"
              onClick={handleOpenPrint}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#e8f6ff] to-[#bae6fd] hover:brightness-95 border border-[#7dd3fc] text-[#0c4a6e] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <Printer className="w-6 h-6 text-[#0284c7]" />
              <span className="text-[11px] font-black leading-tight text-center">F10 Print</span>
            </button>

            {/* 9. Purchase List */}
            <button
              type="button"
              onClick={() => setIsPurchaseHistoryOpen(true)}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#eafcf0] to-[#bbf7d0] hover:brightness-95 border border-[#86efac] text-[#064e3b] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <FileSpreadsheet className="w-6 h-6 text-[#16a34a]" />
              <span className="text-[11px] font-black leading-tight text-center">Purchase List</span>
            </button>

            {/* 10. F12 Exit */}
            <button
              type="button"
              onClick={handleExit}
              className="py-1.5 px-1 rounded-lg bg-gradient-to-b from-[#ffffff] via-[#fee2e2] to-[#fecaca] hover:brightness-95 border border-[#fca5a5] text-[#7f1d1d] flex flex-col items-center justify-center gap-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)] cursor-pointer active:scale-95"
            >
              <LogOut className="w-6 h-6 text-[#dc2626]" />
              <span className="text-[11px] font-black leading-tight text-center">F12 Exit</span>
            </button>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* ANDROID MOBILE PORTRAIT LAYOUT (< md, COMPLETELY DEDICATED DESIGN)  */}
      {/* =================================================================== */}
      <div className="flex md:hidden flex-col flex-1 min-h-0 w-full bg-[#eaf1f9] overflow-hidden">
        {/* Compact Sticky Mobile Top App Bar (<= 52px) */}
        <header className="h-12 shrink-0 bg-gradient-to-r from-[#0e397a] to-[#082452] text-white px-2.5 flex items-center justify-between shadow-sm">
          <button
            type="button"
            onClick={handleExit}
            className="min-w-[44px] min-h-[40px] px-2 rounded-xl bg-white/10 flex items-center justify-center gap-1 text-xs font-bold cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="text-center min-w-0 px-2">
            <h1 className="text-sm font-black truncate">
              {variant === 'old' ? 'Old Purchase' : 'New Purchase'} #{refNo}
            </h1>
            <p className="text-[10px] text-blue-200 truncate">
              {isReadOnly ? 'Read-Only' : isEditing ? 'Editing Invoice' : `${purchaseItems.length} Items • Qty: ${totals.totalQty}`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsPurchaseHistoryOpen(true)}
            className="min-w-[44px] min-h-[40px] px-2.5 rounded-xl bg-emerald-500 text-white text-xs font-black flex items-center justify-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>List</span>
          </button>
        </header>

        {/* Scrollable Vertical Portrait Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-3 pb-20">
          {/* Mobile Read-Only / Edit / Negative Adjustment Status Strip */}
          {isReadOnly && !isEditing && (
            <div className="bg-blue-900 text-white rounded-2xl p-2.5 flex items-center justify-between gap-2">
              <span className="text-xs font-bold">Saved Invoice (Read-Only)</span>
              <button
                type="button"
                onClick={handleStartEditing}
                className="min-h-[38px] px-3 rounded-xl bg-amber-400 text-slate-950 font-black text-xs cursor-pointer"
              >
                Edit Invoice
              </button>
            </div>
          )}

          {totals.hasNegativeItems && (
            <div className="bg-red-600 text-white rounded-2xl p-2.5 flex items-center gap-2 shadow-xs">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div className="text-xs">
                <p className="font-black">Negative Stock Adjustment Active</p>
                <p className="text-[11px] text-red-100">
                  Saving will deduct {totals.totalNegativeUnits} unit(s) from inventory.
                </p>
              </div>
            </div>
          )}

          {/* 1. Supplier & Invoice Card */}
          <section className="bg-white rounded-2xl border border-[#96b4d8] p-3 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-[#0a2b5e]">Invoice & Supplier</span>
              <button
                type="button"
                onClick={() => setIsMobileMetaExpanded((v) => !v)}
                className="text-[11px] font-bold text-blue-700 flex items-center gap-1 cursor-pointer"
              >
                <span>{isMobileMetaExpanded ? 'Hide Details' : 'More Fields'}</span>
                {isMobileMetaExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>

            {/* Payment Mode Pills */}
            <div className="grid grid-cols-3 gap-1.5">
              {(['cash', 'credit', 'card'] as const).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  disabled={rowsDisabled}
                  onClick={() => setPaymentMethod(pm)}
                  className={`min-h-[40px] rounded-xl text-xs font-black uppercase border cursor-pointer ${
                    paymentMethod === pm
                      ? 'bg-[#0e397a] text-white border-[#0e397a]'
                      : 'bg-slate-50 text-slate-700 border-slate-300'
                  }`}
                >
                  {pm}
                </button>
              ))}
            </div>

            {/* Supplier Selector + Quick Add */}
            <div className="flex items-center gap-1.5">
              <select
                disabled={rowsDisabled}
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="flex-1 min-w-0 min-h-[44px] px-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900"
              >
                {suppliers.length === 0 && <option value="">Select Supplier</option>}
                {suppliers.map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={rowsDisabled}
                onClick={() => setIsNewSupplierModalOpen(true)}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 cursor-pointer"
                title="Add Supplier"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {/* Collapsible Invoice Metadata */}
            {isMobileMetaExpanded && (
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500">Ref No</label>
                  <input
                    type="text"
                    disabled={rowsDisabled}
                    value={refNo}
                    onChange={(e) => setRefNo(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500">Supplier Inv #</label>
                  <input
                    type="text"
                    disabled={rowsDisabled}
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500">Date</label>
                  <input
                    type="date"
                    disabled={rowsDisabled}
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full mt-0.5 px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500">Store</label>
                  <select
                    disabled={rowsDisabled}
                    value={selectedStore}
                    onChange={(e) => setSelectedStore(e.target.value)}
                    className="w-full mt-0.5 px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold"
                  >
                    {storeList.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-500">Remarks / Notes</label>
                  <input
                    type="text"
                    disabled={rowsDisabled}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Reason for purchase or negative adjustment..."
                    className="w-full mt-0.5 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium"
                  />
                </div>
              </div>
            )}
          </section>

          {/* 2. Mobile Search + Barcode Scan + Create Item */}
          <section className="bg-white rounded-2xl border border-[#96b4d8] p-3 shadow-2xs space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  disabled={rowsDisabled}
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  placeholder="Search product or barcode..."
                  className="w-full min-h-[44px] pl-3 pr-9 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900"
                />
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <button
                type="button"
                disabled={rowsDisabled}
                onClick={() => setIsCameraScannerOpen(true)}
                className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 cursor-pointer"
                title="Scan Barcode"
              >
                <ScanBarcode className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={onOpenAddProduct}
                className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0 cursor-pointer"
                title="Create New Product"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>

            {showItemSuggestions && itemSuggestions.length > 0 && !rowsDisabled && (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-52 overflow-y-auto bg-white">
                {itemSuggestions.map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => handleAddItemToPurchase(prod)}
                    className="w-full px-3 py-2.5 text-left flex items-center justify-between active:bg-blue-50 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">{prod.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono">
                        Stock: {prod.stock} • {prod.barcode}
                      </p>
                    </div>
                    <span className="text-xs font-black text-emerald-700 ml-2 shrink-0">
                      {formatRs(prod.costPrice)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 3. Mobile Readable Product Cards (Easy Positive & Negative Qty Editing) */}
          <section className="space-y-2.5">
            {purchaseItems.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-400">
                <Package className="w-9 h-9 mx-auto mb-1.5 text-slate-300" />
                <p className="text-xs font-bold text-slate-600">No items added yet</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Search or scan above. Supports +Qty and −Qty stock adjustment.
                </p>
              </div>
            ) : (
              purchaseItems.map((item, idx) => {
                const isNegative = item.quantity < 0;
                const draftQty =
                  qtyDrafts[item.id] !== undefined ? qtyDrafts[item.id] : String(item.quantity);
                const liveProd = products.find((p) => p.id === item.productId);
                const currentStock = liveProd ? Number(liveProd.stock) || 0 : item.currentStock;

                return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-2xl p-3 border shadow-2xs space-y-2.5 ${
                      isNegative ? 'border-red-400 bg-red-50/40' : 'border-[#96b4d8]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-[#0e397a] text-white text-[10px] font-black">
                            #{idx + 1}
                          </span>
                          <h3 className="text-sm font-black text-slate-900 truncate">{item.productName}</h3>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {item.barcode} • Stock: {currentStock} →{' '}
                          <strong className={isNegative ? 'text-red-700' : 'text-emerald-700'}>
                            {currentStock + item.quantity}
                          </strong>
                        </p>
                        {isNegative && (
                          <span className="mt-1 inline-block px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">
                            Stock Deduction ({item.quantity})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={rowsDisabled}
                        onClick={() => setItemToDeleteIndex(idx)}
                        className="min-w-[44px] min-h-[44px] rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40"
                        title="Remove Item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Quantity Row with − / Editable Input / + / Quick ± Sign Toggle */}
                    <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                      <span className="text-xs font-black text-slate-700">Qty:</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={rowsDisabled}
                          onClick={() => handleStepQuantity(idx, -1)}
                          className="min-w-[44px] min-h-[44px] rounded-xl bg-white border border-slate-300 text-slate-800 flex items-center justify-center font-black active:scale-95 cursor-pointer disabled:opacity-40"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="text"
                          inputMode="text"
                          disabled={rowsDisabled}
                          value={draftQty}
                          onChange={(e) => handleQtyTextChange(idx, item.id, e.target.value)}
                          onBlur={() => handleQtyBlur(idx, item.id)}
                          className={`w-16 min-h-[44px] text-center font-black text-base rounded-xl border tabular-nums ${
                            isNegative
                              ? 'bg-red-50 border-red-500 text-red-700'
                              : 'bg-white border-slate-300 text-slate-900'
                          }`}
                        />
                        <button
                          type="button"
                          disabled={rowsDisabled}
                          onClick={() => handleStepQuantity(idx, 1)}
                          className="min-w-[44px] min-h-[44px] rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black active:scale-95 cursor-pointer disabled:opacity-40"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={rowsDisabled}
                          onClick={() => handleToggleQtySign(idx)}
                          className={`min-w-[44px] min-h-[44px] px-2 rounded-xl border text-xs font-black cursor-pointer disabled:opacity-40 ${
                            isNegative
                              ? 'bg-red-600 text-white border-red-700'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                          title="Switch Positive / Negative Qty"
                        >
                          ±
                        </button>
                      </div>
                    </div>

                    {/* Cost, Sale & Total Row */}
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Cost Price</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          disabled={rowsDisabled}
                          value={item.purchaseCost}
                          onChange={(e) =>
                            handleUpdateItemField(idx, 'purchaseCost', parseFloat(e.target.value) || 0)
                          }
                          className="w-full mt-0.5 px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-right tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500">Sale Price</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          disabled={rowsDisabled}
                          value={item.salePrice ?? 0}
                          onChange={(e) =>
                            handleUpdateItemField(idx, 'salePrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-full mt-0.5 px-2 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-right text-emerald-700 tabular-nums"
                        />
                      </div>
                      <div className="flex flex-col justify-end text-right">
                        <span className="text-[10px] font-bold text-slate-500">Line Total</span>
                        <span
                          className={`text-sm font-black tabular-nums py-2 ${
                            isNegative ? 'text-red-700' : 'text-slate-900'
                          }`}
                        >
                          {formatRs(item.lineTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* 4. Mobile Totals & Payment Card */}
          <section className="bg-[#0e397a] text-white rounded-2xl p-3.5 shadow-sm space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-blue-200 font-bold">Gross Total:</span>
              <span className="font-black tabular-nums">{formatRs(totals.grossTotal)}</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-blue-200 font-bold">Discount:</span>
              <input
                type="number"
                min="0"
                disabled={rowsDisabled}
                value={costDiscountAmount || ''}
                onChange={(e) => setCostDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0"
                className="w-28 px-2 py-1 rounded-lg bg-white text-slate-900 font-bold text-right tabular-nums"
              />
            </div>
            <div className="flex justify-between items-center pt-1.5 border-t border-white/20">
              <span className="text-sm font-black">Total Amount:</span>
              <span className="text-lg font-black text-yellow-300 tabular-nums">
                {formatRs(totals.totalAmount)}
              </span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-blue-200 font-bold">Payment:</span>
              <input
                type="number"
                step="any"
                disabled={rowsDisabled}
                value={amountPaidInput}
                onChange={(e) => setAmountPaidInput(e.target.value)}
                placeholder={totals.paid.toFixed(0)}
                className="w-28 px-2 py-1 rounded-lg bg-white text-slate-900 font-bold text-right tabular-nums"
              />
            </div>
            <div className="flex justify-between">
              <span className="text-blue-200 font-bold">Outstanding:</span>
              <span className="font-black text-amber-300 tabular-nums">{formatRs(totals.outstanding)}</span>
            </div>
          </section>
        </div>

        {/* Sticky Compact Mobile Bottom Action Bar (<= 56px, accessible thumb zone) */}
        <footer className="h-14 shrink-0 bg-white border-t border-slate-300 px-2 py-1.5 grid grid-cols-5 gap-1.5 shadow-lg">
          <button
            type="button"
            onClick={handleNewPurchase}
            className="rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-[11px] font-black flex flex-col items-center justify-center cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New</span>
          </button>

          {isReadOnly && !isEditing ? (
            <button
              type="button"
              onClick={handleStartEditing}
              className="col-span-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black flex items-center justify-center gap-1 cursor-pointer"
            >
              <Edit className="w-4 h-4" />
              <span>Edit Invoice</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isSaving || purchaseItems.length === 0}
              onClick={handleSavePurchaseAction}
              className="col-span-2 rounded-xl bg-[#0e397a] text-white text-xs font-black flex items-center justify-center gap-1 cursor-pointer disabled:bg-slate-400"
            >
              <Save className="w-4 h-4" />
              <span>{isEditing ? 'Save Changes' : 'Save'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenPrint}
            className="rounded-xl bg-sky-50 border border-sky-300 text-sky-800 text-[11px] font-black flex flex-col items-center justify-center cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>

          <button
            type="button"
            onClick={handleExit}
            className="rounded-xl bg-red-50 border border-red-300 text-red-700 text-[11px] font-black flex flex-col items-center justify-center cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Back</span>
          </button>
        </footer>
      </div>

      {/* =================================================================== */}
      {/* IN-UI NEGATIVE QUANTITY STOCK DEDUCTION CONFIRMATION MODAL          */}
      {/* =================================================================== */}
      {showNegativeConfirmModal && pendingSavePayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-red-300 overflow-hidden">
            <div className="p-4 bg-red-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-black text-sm">Confirm Negative Quantity Stock Adjustment</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowNegativeConfirmModal(false);
                  setPendingSavePayload(null);
                }}
                className="p-1 text-red-100 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs text-slate-700">
              <p className="font-bold text-slate-900">
                This invoice contains negative quantities. Saving will REDUCE actual inventory stock for the items below:
              </p>

              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-[11px]">
                <div>
                  <span className="text-slate-500">Invoice Ref:</span>{' '}
                  <strong className="font-mono text-slate-900">{pendingSavePayload.tx.purchaseInvoiceNo}</strong>
                </div>
                <div>
                  <span className="text-slate-500">User:</span>{' '}
                  <strong className="text-slate-900">{pendingSavePayload.tx.editBy || pendingSavePayload.tx.userName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Date:</span>{' '}
                  <strong className="text-slate-900">{pendingSavePayload.tx.purchaseDate}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Action:</span>{' '}
                  <strong className="text-red-700">
                    {pendingSavePayload.isEdit ? 'Edit & Reconcile Stock' : 'Stock Deduction'}
                  </strong>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto border border-red-200 rounded-xl divide-y divide-red-100">
                {pendingSavePayload.tx.items
                  .filter((it) => it.quantity < 0)
                  .map((it) => {
                    const live = products.find((p) => p.id === it.productId);
                    const curStock = live ? Number(live.stock) || 0 : it.currentStock;
                    const oldQty =
                      pendingSavePayload.isEdit && originalSavedPurchase
                        ? originalSavedPurchase.items
                            .filter((o) => o.productId === it.productId)
                            .reduce((s, o) => s + o.quantity, 0)
                        : 0;
                    const projected = curStock + (it.quantity - oldQty);

                    return (
                      <div key={it.id} className="p-2.5 flex items-center justify-between bg-red-50/60">
                        <div className="min-w-0">
                          <p className="font-black text-slate-900 truncate">{it.productName}</p>
                          <p className="text-[11px] text-slate-600">
                            Current Stock: <strong>{curStock}</strong> → After Save:{' '}
                            <strong className="text-red-700">{projected}</strong>
                          </p>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-black tabular-nums shrink-0">
                          Qty: {it.quantity}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowNegativeConfirmModal(false);
                  setPendingSavePayload(null);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const payload = pendingSavePayload;
                  setShowNegativeConfirmModal(false);
                  setPendingSavePayload(null);
                  commitSavePurchase(payload.tx, payload.isEdit);
                }}
                className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Confirm & Update Stock</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: Delete Single Row Confirmation                               */}
      {/* =================================================================== */}
      {itemToDeleteIndex !== null && purchaseItems[itemToDeleteIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 bg-red-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-sm">Remove Item Row?</h3>
              </div>
              <button type="button" onClick={() => setItemToDeleteIndex(null)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 text-xs text-slate-700 space-y-2">
              <p className="font-bold text-slate-900">
                Remove <strong>{purchaseItems[itemToDeleteIndex].productName}</strong> (Qty:{' '}
                {purchaseItems[itemToDeleteIndex].quantity}) from this invoice?
              </p>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToDeleteIndex(null)}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteItem}
                className="px-4 py-1.5 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: Clear All Draft Items Confirmation                           */}
      {/* =================================================================== */}
      {showConfirmClearPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 text-center">
            <Trash2 className="w-10 h-10 text-red-600 mx-auto mb-2" />
            <h3 className="text-sm font-black text-slate-900">Clear All {purchaseItems.length} Items?</h3>
            <p className="text-xs text-slate-600 mt-1">
              This removes all entered rows from this draft invoice.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmClearPurchase(false)}
                className="py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearPurchase}
                className="py-2 rounded-xl text-xs font-black bg-red-600 text-white cursor-pointer"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: Add New Supplier                                             */}
      {/* =================================================================== */}
      {isNewSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 bg-[#0e397a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-300" />
                <h3 className="font-bold text-sm">Add New Supplier / نیا سپلائر</h3>
              </div>
              <button type="button" onClick={() => setIsNewSupplierModalOpen(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSupplier} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700">Supplier Name *</label>
                  <input
                    type="text"
                    required
                    value={newSupName}
                    onChange={(e) => setNewSupName(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Business Name</label>
                  <input
                    type="text"
                    value={newSupBusiness}
                    onChange={(e) => setNewSupBusiness(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Phone</label>
                  <input
                    type="text"
                    value={newSupPhone}
                    onChange={(e) => setNewSupPhone(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">TRN #</label>
                  <input
                    type="text"
                    value={newSupTrn}
                    onChange={(e) => setNewSupTrn(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Address</label>
                  <input
                    type="text"
                    value={newSupAddress}
                    onChange={(e) => setNewSupAddress(e.target.value)}
                    className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Opening Payable (Rs.)</label>
                  <input
                    type="number"
                    value={newSupBalance || ''}
                    onChange={(e) => setNewSupBalance(parseFloat(e.target.value) || 0)}
                    className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
              </div>
              <div>
                <label className="font-bold text-slate-700">Remarks</label>
                <input
                  type="text"
                  value={newSupRemarks}
                  onChange={(e) => setNewSupRemarks(e.target.value)}
                  className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewSupplierModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-100 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-black cursor-pointer"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: Select / Add Store                                           */}
      {/* =================================================================== */}
      {isStoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-3.5 bg-[#0e397a] text-white flex items-center justify-between">
              <span className="font-bold text-sm">Select Purchase Store / Location</span>
              <button type="button" onClick={() => setIsStoreModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2.5 text-xs">
              <div className="space-y-1.5">
                {storeList.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setSelectedStore(st);
                      setIsStoreModalOpen(false);
                    }}
                    className={`w-full px-3 py-2 rounded-xl border text-left font-bold flex items-center justify-between cursor-pointer ${
                      selectedStore === st
                        ? 'bg-blue-50 border-blue-500 text-blue-900'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{st}</span>
                    {selectedStore === st && <Check className="w-4 h-4 text-blue-600" />}
                  </button>
                ))}
              </div>
              <div className="pt-2 border-t border-slate-100 flex gap-1.5">
                <input
                  type="text"
                  value={customStoreName}
                  onChange={(e) => setCustomStoreName(e.target.value)}
                  placeholder="Add custom store..."
                  className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = customStoreName.trim();
                    if (!clean) return;
                    if (!storeList.includes(clean)) setStoreList((prev) => [...prev, clean]);
                    setSelectedStore(clean);
                    setCustomStoreName('');
                    setIsStoreModalOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: Import CSV / Lines                                           */}
      {/* =================================================================== */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 bg-[#0e397a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-300" />
                <h3 className="font-bold text-sm">Import Purchase Items (CSV / Excel Paste)</h3>
              </div>
              <button type="button" onClick={() => setIsImportModalOpen(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <p className="text-slate-600">
                Enter one item per line as <code className="font-mono bg-slate-100 px-1 rounded">barcode_or_name, qty, cost</code>{' '}
                (negative quantities like <code className="font-mono bg-red-50 text-red-700 px-1 rounded">-5</code> are supported) or choose a CSV file:
              </p>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setImportText(String(reader.result || ''));
                  reader.readAsText(file);
                }}
                className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-bold"
              />
              <textarea
                rows={6}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'8964000234567, 10, 180\nDAWN GOLE CAKE, -1, 85'}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg bg-slate-100 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleProcessImport}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black cursor-pointer"
                >
                  Import Rows
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: Live Stock Enquiry                                           */}
      {/* =================================================================== */}
      {isStockEnquiryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 bg-[#0e397a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-300" />
                <h3 className="font-bold text-sm">Stock Enquiry (Click item to add to invoice)</h3>
              </div>
              <button type="button" onClick={() => setIsStockEnquiryOpen(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 bg-slate-50 border-b border-slate-200">
              <input
                type="text"
                autoFocus
                value={stockEnquiryQuery}
                onChange={(e) => setStockEnquiryQuery(e.target.value)}
                placeholder="Filter stock by product name, barcode, or SKU..."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3 divide-y divide-slate-100">
              {filteredStockEnquiry.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">No matching products found.</div>
              ) : (
                filteredStockEnquiry.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (!rowsDisabled) {
                        handleAddItemToPurchase(p);
                        setIsStockEnquiryOpen(false);
                      }
                    }}
                    className="w-full py-2 px-2 flex items-center justify-between text-xs hover:bg-blue-50 rounded-lg text-left cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono">Barcode: {p.barcode || '-'}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold text-slate-600 tabular-nums">Cost: {formatRs(p.costPrice)}</span>
                      <span className="font-bold text-emerald-700 tabular-nums">Sale: {formatRs(p.price)}</span>
                      <span
                        className={`px-2 py-0.5 rounded font-black text-xs tabular-nums ${
                          p.stock < 0
                            ? 'bg-red-100 text-red-800'
                            : p.stock === 0
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-900'
                        }`}
                      >
                        {p.stock} {p.unit}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setIsStockEnquiryOpen(false)}
                className="px-4 py-1.5 text-xs font-bold bg-slate-800 text-white rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase List / History Modal */}
      {isPurchaseHistoryOpen && (
        <SearchPurchasesModal
          isOpen={isPurchaseHistoryOpen}
          purchases={purchases}
          onClose={() => setIsPurchaseHistoryOpen(false)}
          onSelectToView={handleLoadPurchaseToView}
          onSelectToEdit={(p) => {
            handleLoadPurchaseToView(p);
            setIsReadOnly(false);
            setIsEditing(true);
            setEditByName(userNameDisplay);
          }}
          onPrintPurchase={(p) => setCurrentPrintPurchase(p)}
          onDeletePurchase={onDeletePurchase}
        />
      )}

      {/* Print Purchase Modal */}
      {currentPrintPurchase && (
        <PrintPurchaseModal
          isOpen={Boolean(currentPrintPurchase)}
          purchase={currentPrintPurchase}
          branding={branding}
          onClose={() => setCurrentPrintPurchase(null)}
        />
      )}

      {/* Camera Barcode Scanner Modal */}
      {isCameraScannerOpen && (
        <BarcodeScannerModal
          isOpen={isCameraScannerOpen}
          onClose={() => setIsCameraScannerOpen(false)}
          onBarcodeDetected={handleBarcodeDetected}
          pageContext="purchase"
          totalItems={totals.totalQty}
          totalAmount={totals.totalAmount}
        />
      )}
    </div>
  );
};
