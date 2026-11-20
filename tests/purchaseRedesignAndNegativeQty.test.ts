import assert from 'node:assert/strict';
import {
  applyPurchaseDeleteToState,
  applyPurchaseSaveToState,
  computePurchaseItemAmounts,
  computePurchaseTotals,
} from '../src/utils/purchaseHelpers';
import { Product, PurchaseItem, PurchaseTransaction, Supplier } from '../src/types/pos';

console.log('--- STARTING PURCHASE REDESIGN & NEGATIVE QUANTITY STOCK TESTS ---');

const initialProducts: Product[] = [
  {
    id: 'prod-cake',
    barcode: '7101',
    name: 'DAWN GOLE CAKE',
    category: 'BAKERY',
    price: 100,
    costPrice: 85,
    stock: 13,
    unit: 'Pcs',
  },
  {
    id: 'prod-car',
    barcode: '7118',
    name: 'POLICE REMOTE CAR',
    category: 'TOYS',
    price: 1200,
    costPrice: 925,
    stock: 20,
    unit: 'Pcs',
  },
];

const initialSuppliers: Supplier[] = [
  {
    id: 'SUP-71',
    name: 'Cash Purchase',
    phone: '0300-0000000',
    payableBalance: 5000,
  },
];

let products: Product[] = structuredClone(initialProducts);
let suppliers: Supplier[] = structuredClone(initialSuppliers);
let purchases: PurchaseTransaction[] = [];

// 1. New Purchase with Qty +10 (Stock increases by 10; draft edits don't mutate stock beforehand)
{
  const amounts = computePurchaseItemAmounts(10, 925, 0, 0);
  assert.equal(amounts.netAmount, 9250);
  assert.equal(amounts.lineTotal, 9250);

  const items: PurchaseItem[] = [
    {
      id: 'item-1',
      productId: 'prod-car',
      productName: 'POLICE REMOTE CAR',
      barcode: '7118',
      currentStock: 20,
      quantity: 10,
      purchaseCost: 925,
      salePrice: 1200,
      discount: 0,
      tax: 0,
      netAmount: amounts.netAmount,
      vat: amounts.vat,
      wvat: amounts.wvat,
      lineTotal: amounts.lineTotal,
    },
  ];

  const totals = computePurchaseTotals({ items, paymentMethod: 'cash' });
  assert.equal(totals.totalQty, 10);
  assert.equal(totals.totalAmount, 9250);
  assert.equal(totals.hasNegativeItems, false);

  const tx1: PurchaseTransaction = {
    id: 'pur-3019',
    purchaseInvoiceNo: 'PUR-3019',
    refNo: '3019',
    purchaseDate: '2026-11-18',
    supplierId: 'SUP-71',
    supplierName: 'Cash Purchase',
    supplierInvoiceNo: '12154',
    items,
    subtotal: totals.grossTotal,
    totalDiscount: 0,
    totalTax: 0,
    grandTotal: totals.totalAmount,
    amountPaid: totals.paid,
    remainingBalance: totals.outstanding,
    paymentMethod: 'cash',
    userName: 'Admin 102',
    createdAt: '2026-11-18T10:00:00.000Z',
    status: 'saved',
  };

  // Before saving, stock is untouched
  assert.equal(products.find((p) => p.id === 'prod-car')?.stock, 20);

  const res = applyPurchaseSaveToState({
    purchase: tx1,
    isEdit: false,
    products,
    suppliers,
    purchases,
    userName: 'Admin 102',
    timestampStr: '18 Nov 2026, 10:00:00 am',
  });

  assert.equal(res.duplicateBlocked, false);
  products = res.products;
  suppliers = res.suppliers;
  purchases = res.purchases;

  assert.equal(products.find((p) => p.id === 'prod-car')?.stock, 30, 'Stock should increase 20 -> 30');
  assert.equal(res.stockEntries.length, 1);
  assert.equal(res.stockEntries[0].quantityChange, 10);
  assert.equal(res.stockEntries[0].userName, 'Admin 102');
  assert.equal(res.stockEntries[0].invoiceNumber, 'PUR-3019');
  console.log('✓ Test 1 Passed: New Purchase Qty +10 increases stock (20 -> 30) and logs user/invoice/timestamp');
}

// 2. Duplicate Save Guard (must NOT add stock twice)
{
  const dupAttempt = applyPurchaseSaveToState({
    purchase: purchases[0],
    isEdit: false,
    products,
    suppliers,
    purchases,
    userName: 'Admin 102',
  });
  assert.equal(dupAttempt.duplicateBlocked, true);
  assert.equal(dupAttempt.products.find((p) => p.id === 'prod-car')?.stock, 30);
  assert.equal(dupAttempt.stockEntries.length, 0);
  console.log('✓ Test 2 Passed: Duplicate save blocked cleanly without double-adding stock');
}

// 3. New Purchase with Negative Qty -1 (Image 2: DAWN GOLE CAKE stock 13 -> 12, cost 0 preserves existing costPrice 85)
{
  const amounts = computePurchaseItemAmounts(-1, 0, 0, 0);
  assert.equal(amounts.netAmount, 0);
  assert.equal(amounts.lineTotal, 0);

  const items: PurchaseItem[] = [
    {
      id: 'item-neg-1',
      productId: 'prod-cake',
      productName: 'DAWN GOLE CAKE',
      barcode: '7101',
      currentStock: 13,
      quantity: -1,
      purchaseCost: 0,
      salePrice: 100,
      discount: 0,
      tax: 0,
      netAmount: amounts.netAmount,
      vat: 0,
      wvat: 0,
      lineTotal: amounts.lineTotal,
    },
  ];

  const totals = computePurchaseTotals({ items, paymentMethod: 'cash' });
  assert.equal(totals.hasNegativeItems, true, 'Must require negative quantity confirmation');
  assert.equal(totals.totalQty, -1);
  assert.equal(totals.totalNegativeUnits, 1);

  const txNeg1: PurchaseTransaction = {
    id: 'pur-3020',
    purchaseInvoiceNo: 'PUR-3020',
    refNo: '3020',
    purchaseDate: '2026-11-18',
    supplierId: 'SUP-71',
    supplierName: 'Cash Purchase',
    supplierInvoiceNo: '11',
    items,
    subtotal: totals.grossTotal,
    totalDiscount: 0,
    totalTax: 0,
    grandTotal: totals.totalAmount,
    amountPaid: totals.paid,
    remainingBalance: totals.outstanding,
    paymentMethod: 'cash',
    userName: 'Admin 102',
    hasNegativeAdjustment: true,
    createdAt: '2026-11-18T10:15:00.000Z',
    status: 'saved',
  };

  const res = applyPurchaseSaveToState({
    purchase: txNeg1,
    isEdit: false,
    products,
    suppliers,
    purchases,
    userName: 'Admin 102',
    timestampStr: '18 Nov 2026, 10:15:00 am',
  });

  products = res.products;
  suppliers = res.suppliers;
  purchases = res.purchases;

  const cake = products.find((p) => p.id === 'prod-cake')!;
  assert.equal(cake.stock, 12, 'Qty -1 must reduce DAWN GOLE CAKE stock from 13 to 12');
  assert.equal(cake.costPrice, 85, 'Zero cost in negative adjustment must preserve original costPrice 85');
  assert.equal(res.stockEntries[0].transactionType, 'Stock Adjustment');
  assert.equal(res.stockEntries[0].quantityChange, -1);
  console.log('✓ Test 3 Passed: Negative Qty -1 decreases stock (13 -> 12) & preserves costPrice');
}

// 4. New Purchase with Negative Qty -5 (with unit cost 85 -> -425 line total, stock 12 -> 7)
{
  const amounts = computePurchaseItemAmounts(-5, 85, 0, 0);
  assert.equal(amounts.netAmount, -425);
  assert.equal(amounts.lineTotal, -425);

  const items: PurchaseItem[] = [
    {
      id: 'item-neg-5',
      productId: 'prod-cake',
      productName: 'DAWN GOLE CAKE',
      barcode: '7101',
      currentStock: 12,
      quantity: -5,
      purchaseCost: 85,
      salePrice: 100,
      discount: 0,
      tax: 0,
      netAmount: amounts.netAmount,
      vat: 0,
      wvat: amounts.wvat,
      lineTotal: amounts.lineTotal,
    },
  ];

  const totals = computePurchaseTotals({ items, paymentMethod: 'cash' });
  assert.equal(totals.totalAmount, -425);
  assert.equal(totals.totalQty, -5);

  const txNeg5: PurchaseTransaction = {
    id: 'pur-3021',
    purchaseInvoiceNo: 'PUR-3021',
    refNo: '3021',
    purchaseDate: '2026-11-18',
    supplierId: 'SUP-71',
    supplierName: 'Cash Purchase',
    supplierInvoiceNo: '12',
    items,
    subtotal: totals.grossTotal,
    totalDiscount: 0,
    totalTax: 0,
    grandTotal: totals.totalAmount,
    amountPaid: totals.paid,
    remainingBalance: totals.outstanding,
    paymentMethod: 'cash',
    userName: 'Admin 102',
    hasNegativeAdjustment: true,
    createdAt: '2026-11-18T10:20:00.000Z',
    status: 'saved',
  };

  const res = applyPurchaseSaveToState({
    purchase: txNeg5,
    isEdit: false,
    products,
    suppliers,
    purchases,
    userName: 'Admin 102',
  });

  products = res.products;
  suppliers = res.suppliers;
  purchases = res.purchases;

  assert.equal(products.find((p) => p.id === 'prod-cake')?.stock, 7, 'Qty -5 reduces stock 12 -> 7');
  console.log('✓ Test 4 Passed: Negative Qty -5 decreases stock (12 -> 7) with exact -425 line total');
}

// 5. Old Purchase Edit with Positive Qty (+10 -> +14, net delta +4 -> car stock 30 -> 34)
{
  const orig = purchases.find((p) => p.id === 'pur-3019')!;
  const editedItems = orig.items.map((it) => ({
    ...it,
    quantity: 14,
    lineTotal: 14 * it.purchaseCost,
    netAmount: 14 * it.purchaseCost,
    wvat: 14 * it.purchaseCost,
  }));
  const editedTx: PurchaseTransaction = {
    ...orig,
    items: editedItems,
    subtotal: 14 * 925,
    grandTotal: 14 * 925,
    amountPaid: 14 * 925,
    editBy: 'Manager Waqas',
    status: 'edited',
  };

  const res = applyPurchaseSaveToState({
    purchase: editedTx,
    isEdit: true,
    products,
    suppliers,
    purchases,
    userName: 'Manager Waqas',
  });

  products = res.products;
  suppliers = res.suppliers;
  purchases = res.purchases;

  assert.equal(products.find((p) => p.id === 'prod-car')?.stock, 34, 'Edit +10 -> +14 updates stock 30 -> 34');
  assert.equal(purchases.filter((p) => p.id === 'pur-3019').length, 1, 'Must not duplicate edited invoice');
  assert.equal(res.stockEntries[0].quantityChange, 4);
  assert.equal(res.stockEntries[0].userName, 'Manager Waqas');
  console.log('✓ Test 5 Passed: Old Purchase positive qty edit applies exact +4 delta without duplication');
}

// 6. Old Purchase Edit transitioning Positive -> Negative (+14 -> -3, net delta -17 -> car stock 34 -> 17)
{
  const orig = purchases.find((p) => p.id === 'pur-3019')!;
  const editedItems = orig.items.map((it) => ({
    ...it,
    quantity: -3,
    lineTotal: -3 * it.purchaseCost,
    netAmount: -3 * it.purchaseCost,
    wvat: -3 * it.purchaseCost,
  }));
  const editedTx: PurchaseTransaction = {
    ...orig,
    items: editedItems,
    subtotal: -3 * 925,
    grandTotal: -3 * 925,
    amountPaid: -3 * 925,
    hasNegativeAdjustment: true,
    editBy: 'Manager Waqas',
    status: 'edited',
  };

  const res = applyPurchaseSaveToState({
    purchase: editedTx,
    isEdit: true,
    products,
    suppliers,
    purchases,
    userName: 'Manager Waqas',
  });

  products = res.products;
  suppliers = res.suppliers;
  purchases = res.purchases;

  assert.equal(
    products.find((p) => p.id === 'prod-car')?.stock,
    17,
    'Reversing +14 (34 -> 20) and applying -3 must yield exactly 17'
  );
  assert.equal(res.stockEntries[0].quantityChange, -17);
  assert.equal(res.stockEntries[0].transactionType, 'Stock Adjustment');
  console.log('✓ Test 6 Passed: Old Purchase edit +14 -> -3 reverses +14 and deducts 3 cleanly (34 -> 17)');
}

// 7. Delete Negative Purchase Reversal (deleting PUR-3021 of -5 restores cake stock 7 -> 12)
{
  const reversed = applyPurchaseDeleteToState({
    purchaseId: 'pur-3021',
    products,
    suppliers,
    purchases,
    userName: 'Admin 102',
  });
  products = reversed.products;
  purchases = reversed.purchases;
  assert.equal(products.find((p) => p.id === 'prod-cake')?.stock, 12, 'Deleting -5 purchase restores +5 stock');
  console.log('✓ Test 7 Passed: Deleting negative qty purchase reverses deduction cleanly (7 -> 12)');
}

// 8. Non-edited existing product & invoice history preservation check
{
  assert.equal(purchases.length, 2, 'Remaining invoices preserved');
  assert.equal(products.length, initialProducts.length, 'Product catalog intact');
  console.log('✓ Test 8 Passed: Existing products and invoice history preserved intact');
}

console.log('\nALL 8 PURCHASE REDESIGN & NEGATIVE QUANTITY STOCK TESTS PASSED 100%!');
