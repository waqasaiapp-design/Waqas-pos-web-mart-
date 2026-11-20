import {
  Product,
  PurchaseItem,
  PurchaseTransaction,
  StockTransaction,
  StockTransactionType,
  Supplier,
} from '../types/pos';

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Computes line amounts for a purchase item.
 * Supports BOTH positive quantities (+1, +10) and negative stock adjustment quantities (-1, -5).
 */
export function computePurchaseItemAmounts(
  quantity: number,
  purchaseCost: number,
  vatRatePercent: number = 0,
  discountAmount: number = 0
): {
  netAmount: number;
  vat: number;
  wvat: number;
  lineTotal: number;
} {
  const safeQty = Number.isFinite(quantity) ? quantity : 0;
  const safeCost = Math.max(0, Number.isFinite(purchaseCost) ? purchaseCost : 0);
  const rawNet = roundMoney(safeQty * safeCost);
  const netAfterDisc = roundMoney(rawNet - (Number(discountAmount) || 0));
  const vat = roundMoney((netAfterDisc * (Number(vatRatePercent) || 0)) / 100);
  const wvat = roundMoney(netAfterDisc + vat);
  return {
    netAmount: rawNet,
    vat,
    wvat,
    lineTotal: wvat,
  };
}

export interface PurchaseTotalsSummary {
  grossTotal: number;
  discount: number;
  vat: number;
  expensesAmount: number;
  roundoff: number;
  totalAmount: number;
  paid: number;
  outstanding: number;
  totalQty: number;
  hasNegativeItems: boolean;
  negativeItems: PurchaseItem[];
  totalNegativeUnits: number;
}

export function computePurchaseTotals(params: {
  items: PurchaseItem[];
  discountPercent?: number;
  discountAmount?: number;
  expensesAmount?: number;
  roundoff?: number;
  amountPaid?: number | '';
  paymentMethod?: string;
}): PurchaseTotalsSummary {
  const {
    items,
    discountPercent = 0,
    discountAmount = 0,
    expensesAmount = 0,
    roundoff = 0,
    amountPaid = '',
    paymentMethod = 'cash',
  } = params;

  let grossTotal = 0;
  let totalQty = 0;
  let totalVat = 0;
  let totalNegativeUnits = 0;
  const negativeItems: PurchaseItem[] = [];

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const cost = Math.max(0, Number(item.purchaseCost) || 0);
    const net = item.netAmount !== undefined ? Number(item.netAmount) : roundMoney(qty * cost);
    const vat = Number(item.vat) || 0;

    grossTotal += net;
    totalVat += vat;
    totalQty += qty;

    if (qty < 0) {
      negativeItems.push(item);
      totalNegativeUnits += Math.abs(qty);
    }
  }

  grossTotal = roundMoney(grossTotal);
  totalVat = roundMoney(totalVat);

  const safeDiscount =
    Number(discountAmount) > 0
      ? Number(discountAmount)
      : roundMoney((grossTotal * (Number(discountPercent) || 0)) / 100);

  const safeExpenses = Number(expensesAmount) || 0;
  const safeRoundoff = Number(roundoff) || 0;

  // Keep negative totalAmount exact when performing negative stock adjustments with non-zero unit cost
  const totalAmount = roundMoney(grossTotal - safeDiscount + totalVat + safeExpenses + safeRoundoff);

  const methodLower = (paymentMethod || 'cash').toLowerCase();
  const hasExplicitPaid = amountPaid !== '' && amountPaid !== undefined && amountPaid !== null;
  const paid = hasExplicitPaid
    ? Number(amountPaid) || 0
    : methodLower === 'cash' || methodLower === 'card'
    ? totalAmount
    : 0;

  const outstanding = roundMoney(totalAmount - paid);

  return {
    grossTotal,
    discount: roundMoney(safeDiscount),
    vat: totalVat,
    expensesAmount: roundMoney(safeExpenses),
    roundoff: roundMoney(safeRoundoff),
    totalAmount,
    paid: roundMoney(paid),
    outstanding,
    totalQty,
    hasNegativeItems: negativeItems.length > 0,
    negativeItems,
    totalNegativeUnits,
  };
}

/**
 * Formats date + time consistently for stock audit history.
 */
export function formatStockAuditTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Aggregates item quantities by productId so duplicate product rows in the same
 * invoice reconcile their net stock change cleanly.
 */
export function aggregatePurchaseQuantitiesByProduct(items: PurchaseItem[]): Map<
  string,
  {
    quantity: number;
    lastPositiveItem?: PurchaseItem;
    lastAnyItem: PurchaseItem;
  }
> {
  const map = new Map<
    string,
    {
      quantity: number;
      lastPositiveItem?: PurchaseItem;
      lastAnyItem: PurchaseItem;
    }
  >();

  for (const item of items || []) {
    if (!item.productId) continue;
    const prev = map.get(item.productId);
    const qty = Number(item.quantity) || 0;
    if (prev) {
      map.set(item.productId, {
        quantity: prev.quantity + qty,
        lastPositiveItem: qty > 0 ? item : prev.lastPositiveItem,
        lastAnyItem: item,
      });
    } else {
      map.set(item.productId, {
        quantity: qty,
        lastPositiveItem: qty > 0 ? item : undefined,
        lastAnyItem: item,
      });
    }
  }
  return map;
}

export interface PurchaseReconciliationResult {
  duplicateBlocked: boolean;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  stockEntries: StockTransaction[];
}

/**
 * Pure, deterministic reconciliation for saving/updating a PurchaseTransaction
 * (both positive purchases and negative quantity stock adjustments).
 *
 * Guarantees:
 * - Duplicate non-edit saves (matching id or purchaseInvoiceNo) are blocked idempotently.
 * - New purchase: stock changes by +item.quantity (increases when > 0, decreases when < 0).
 * - Edit purchase: computes exact delta (newQty - oldQty) after reversing previous effect.
 * - Never double-adds or double-deducts stock.
 * - Negative quantity items with 0 purchase cost never erase existing product costPrice/salePrice.
 * - Records StockTransaction with date/time, product, quantityChange, userName, and invoiceNumber.
 */
export function applyPurchaseSaveToState(params: {
  purchase: PurchaseTransaction;
  isEdit: boolean;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  userName?: string;
  timestampStr?: string;
}): PurchaseReconciliationResult {
  const {
    purchase,
    isEdit,
    products,
    suppliers,
    purchases,
    userName = 'Admin',
    timestampStr = formatStockAuditTimestamp(),
  } = params;

  const existingById = purchases.find((p) => p.id === purchase.id);
  const existingByInv = purchases.find(
    (p) => p.purchaseInvoiceNo === purchase.purchaseInvoiceNo
  );

  // Duplicate guard for new purchases
  if (!isEdit && (existingById || existingByInv)) {
    return {
      duplicateBlocked: true,
      products,
      suppliers,
      purchases,
      stockEntries: [],
    };
  }

  const stockEntries: StockTransaction[] = [];
  const actorName = purchase.editBy || purchase.userName || userName;
  const newMap = aggregatePurchaseQuantitiesByProduct(purchase.items || []);

  let nextProducts = products;
  let nextSuppliers = suppliers;
  let nextPurchases = purchases;

  if (isEdit && existingById) {
    const oldPurchase = existingById;
    const oldMap = aggregatePurchaseQuantitiesByProduct(oldPurchase.items || []);

    nextProducts = products.map((prod) => {
      const oldEntry = oldMap.get(prod.id);
      const newEntry = newMap.get(prod.id);
      const oldQty = oldEntry ? oldEntry.quantity : 0;
      const newQty = newEntry ? newEntry.quantity : 0;
      const netDelta = newQty - oldQty;

      // Only update product costPrice if positive purchase item has cost > 0 (or non-zero adjustment cost)
      const refItem = newEntry?.lastPositiveItem || newEntry?.lastAnyItem;
      const shouldUpdateCost =
        refItem && refItem.purchaseCost > 0 && (refItem.quantity > 0 || prod.costPrice <= 0);
      const nextCost = shouldUpdateCost ? refItem!.purchaseCost : prod.costPrice;
      const nextSale =
        refItem?.salePrice && refItem.salePrice > 0 ? refItem.salePrice : prod.price;

      if (netDelta !== 0) {
        const prevStock = Number(prod.stock) || 0;
        const nextStock = prevStock + netDelta;
        const txType: StockTransactionType =
          newQty < 0 || netDelta < 0 ? 'Stock Adjustment' : 'Purchase Edit';

        stockEntries.push({
          id: `stk-ped-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          barcode: prod.barcode,
          previousStock: prevStock,
          quantityChange: netDelta,
          newStock: nextStock,
          transactionType: txType,
          invoiceNumber: purchase.purchaseInvoiceNo,
          dateTime: timestampStr,
          userName: actorName,
          notes:
            newQty < 0
              ? `Negative qty edit (${oldQty} -> ${newQty}, net ${netDelta}) by ${actorName}`
              : `Purchase invoice edited (${oldQty} -> ${newQty}, net ${netDelta >= 0 ? '+' : ''}${netDelta}) by ${actorName}`,
        });

        return {
          ...prod,
          stock: nextStock,
          costPrice: nextCost,
          price: nextSale,
        };
      }

      if (nextCost !== prod.costPrice || nextSale !== prod.price) {
        return {
          ...prod,
          costPrice: nextCost,
          price: nextSale,
        };
      }

      return prod;
    });

    const oldRemaining = Number(oldPurchase.remainingBalance) || 0;
    const newRemaining = Number(purchase.remainingBalance) || 0;
    const balanceDiff = newRemaining - oldRemaining;

    nextSuppliers = suppliers.map((sup) => {
      if (sup.id === purchase.supplierId) {
        return {
          ...sup,
          payableBalance: roundMoney((Number(sup.payableBalance) || 0) + balanceDiff),
        };
      }
      return sup;
    });

    nextPurchases = purchases.map((p) => (p.id === purchase.id ? purchase : p));
  } else {
    // Creating a new purchase (supports both positive and negative quantities)
    nextProducts = products.map((prod) => {
      const entry = newMap.get(prod.id);
      if (!entry || entry.quantity === 0) return prod;

      const prevStock = Number(prod.stock) || 0;
      const qtyDelta = entry.quantity;
      const nextStock = prevStock + qtyDelta;

      const refItem = entry.lastPositiveItem || entry.lastAnyItem;
      const shouldUpdateCost =
        refItem && refItem.purchaseCost > 0 && (refItem.quantity > 0 || prod.costPrice <= 0);
      const nextCost = shouldUpdateCost ? refItem!.purchaseCost : prod.costPrice;
      const nextSale =
        refItem?.salePrice && refItem.salePrice > 0 ? refItem.salePrice : prod.price;

      const isNegative = qtyDelta < 0;
      stockEntries.push({
        id: `stk-pur-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
        productId: prod.id,
        productName: prod.name,
        barcode: prod.barcode,
        previousStock: prevStock,
        quantityChange: qtyDelta,
        newStock: nextStock,
        transactionType: isNegative ? 'Stock Adjustment' : 'Purchase',
        invoiceNumber: purchase.purchaseInvoiceNo,
        dateTime: timestampStr,
        userName: actorName,
        notes: isNegative
          ? `Negative purchase qty stock deduction (${qtyDelta}) by ${actorName}`
          : `Purchase stock inflow (+${qtyDelta}) by ${actorName}`,
      });

      return {
        ...prod,
        stock: nextStock,
        costPrice: nextCost,
        price: nextSale,
      };
    });

    nextSuppliers = suppliers.map((sup) => {
      if (sup.id === purchase.supplierId) {
        return {
          ...sup,
          payableBalance: roundMoney(
            (Number(sup.payableBalance) || 0) + (Number(purchase.remainingBalance) || 0)
          ),
        };
      }
      return sup;
    });

    nextPurchases = [purchase, ...purchases];
  }

  return {
    duplicateBlocked: false,
    products: nextProducts,
    suppliers: nextSuppliers,
    purchases: nextPurchases,
    stockEntries,
  };
}

/**
 * Reverses a deleted purchase invoice cleanly (for both positive and negative quantities).
 */
export function applyPurchaseDeleteToState(params: {
  purchaseId: string;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  userName?: string;
  timestampStr?: string;
}): {
  deletedPurchase: PurchaseTransaction | null;
  products: Product[];
  suppliers: Supplier[];
  purchases: PurchaseTransaction[];
  stockEntries: StockTransaction[];
} {
  const {
    purchaseId,
    products,
    suppliers,
    purchases,
    userName = 'Admin',
    timestampStr = formatStockAuditTimestamp(),
  } = params;

  const toDelete = purchases.find(
    (p) => p.id === purchaseId || p.purchaseInvoiceNo === purchaseId
  );
  if (!toDelete) {
    return {
      deletedPurchase: null,
      products,
      suppliers,
      purchases,
      stockEntries: [],
    };
  }

  const aggMap = aggregatePurchaseQuantitiesByProduct(toDelete.items || []);
  const stockEntries: StockTransaction[] = [];

  const nextProducts = products.map((prod) => {
    const entry = aggMap.get(prod.id);
    if (!entry || entry.quantity === 0) return prod;
    const prevStock = Number(prod.stock) || 0;
    const reversalDelta = -entry.quantity; // If purchase was -5, deleting reverses by +5; if +10, reverses by -10
    const nextStock = prevStock + reversalDelta;

    stockEntries.push({
      id: `stk-pdel-${Date.now()}-${prod.id}-${Math.random().toString(36).slice(2, 6)}`,
      productId: prod.id,
      productName: prod.name,
      barcode: prod.barcode,
      previousStock: prevStock,
      quantityChange: reversalDelta,
      newStock: nextStock,
      transactionType: 'Purchase Cancel',
      invoiceNumber: toDelete.purchaseInvoiceNo,
      dateTime: timestampStr,
      userName,
      notes: `Reversed deleted purchase ${toDelete.purchaseInvoiceNo} (qty ${entry.quantity} -> ${reversalDelta >= 0 ? '+' : ''}${reversalDelta})`,
    });

    return { ...prod, stock: nextStock };
  });

  const nextSuppliers = suppliers.map((sup) => {
    if (sup.id === toDelete.supplierId) {
      return {
        ...sup,
        payableBalance: roundMoney(
          (Number(sup.payableBalance) || 0) - (Number(toDelete.remainingBalance) || 0)
        ),
      };
    }
    return sup;
  });

  return {
    deletedPurchase: toDelete,
    products: nextProducts,
    suppliers: nextSuppliers,
    purchases: purchases.filter((p) => p.id !== toDelete.id),
    stockEntries,
  };
}
