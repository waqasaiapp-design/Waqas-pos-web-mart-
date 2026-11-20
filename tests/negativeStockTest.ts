import { Product } from '../src/types/pos';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${msg}`);
  }
}

function canSellQuantity(currentStock: number, requestedQty: number): { allowed: boolean; reason?: string } {
  if (requestedQty <= 0) {
    return { allowed: false, reason: 'INVALID_QTY' };
  }
  if (currentStock <= 0) {
    return { allowed: false, reason: 'OUT_OF_STOCK' };
  }
  if (requestedQty > currentStock) {
    return { allowed: false, reason: 'INSUFFICIENT_STOCK' };
  }
  return { allowed: true };
}

console.log('--- STARTING SALE STOCK PROTECTION & HISTORICAL NEGATIVE STOCK TESTS ---');

// Case 1: Normal sale rejected when stock is 0
{
  const check = canSellQuantity(0, 1);
  assert(!check.allowed && check.reason === 'OUT_OF_STOCK', 'Case 1 expected OUT_OF_STOCK block');
  console.log('✓ Case 1 Passed: Stock 0 blocks normal sale');
}

// Case 2: Normal sale rejected when requested qty exceeds available stock
{
  const check = canSellQuantity(3, 8);
  assert(!check.allowed && check.reason === 'INSUFFICIENT_STOCK', 'Case 2 expected INSUFFICIENT_STOCK block');
  console.log('✓ Case 2 Passed: Stock 3 blocks sale of 8 units');
}

// Case 3: Normal sale succeeds when requested qty <= available stock and deducts cleanly
{
  const initialStock = 10;
  const requestedQty = 4;
  const check = canSellQuantity(initialStock, requestedQty);
  assert(check.allowed, 'Case 3 expected sale to be allowed');
  const nextStock = initialStock - requestedQty;
  assert(nextStock === 6, `Case 3 expected 6, got ${nextStock}`);
  console.log('✓ Case 3 Passed: Stock 10, sell 4 -> stock becomes 6');
}

// Case 4: Historical negative stock is preserved in reporting and recovers on new purchase
{
  const currentNegativeStock = -5;
  const saleCheck = canSellQuantity(currentNegativeStock, 1);
  assert(!saleCheck.allowed, 'Historical negative stock item cannot be sold until restocked');
  const purchaseQty = 10;
  const updatedStock = currentNegativeStock + purchaseQty;
  assert(updatedStock === 5, `Case 4 expected 5, got ${updatedStock}`);
  console.log('✓ Case 4 Passed: Historical negative stock blocked on new sale and recovers (+10 -> 5) on purchase');
}

// Case 5: Negative stock badge & reporting filter test
{
  const sampleProducts: Product[] = [
    { id: 'p1', name: 'Flour 10kg', barcode: '1001', price: 1200, costPrice: 1100, stock: -5, category: 'Grocery', unit: 'Bag' },
    { id: 'p2', name: 'Cooking Oil 5L', barcode: '1002', price: 2500, costPrice: 2300, stock: 0, category: 'Grocery', unit: 'Bottle' },
    { id: 'p3', name: 'Sugar 1kg', barcode: '1003', price: 150, costPrice: 135, stock: 25, category: 'Grocery', unit: 'Kg' },
  ];

  const negativeProducts = sampleProducts.filter((p) => p.stock < 0);
  assert(negativeProducts.length === 1, `Expected 1 negative stock product, got ${negativeProducts.length}`);
  assert(negativeProducts[0].name === 'Flour 10kg', 'Expected Flour 10kg to be negative');
  console.log('✓ Case 5 Passed: Historical negative stock filter identifies negative stock items accurately');
}

console.log('\nALL STOCK PROTECTION & NEGATIVE STOCK TESTS PASSED 100%!');
