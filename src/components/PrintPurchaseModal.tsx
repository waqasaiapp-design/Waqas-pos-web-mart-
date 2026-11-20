import React, { useState } from 'react';
import { X, Printer, CheckCircle2, AlertCircle } from 'lucide-react';
import { PurchaseTransaction, StoreBranding, PrinterPaperSize } from '../types/pos';
import { formatRs } from '../data/defaultProducts';
import { printPurchaseInvoice } from '../utils/printerService';

interface PrintPurchaseModalProps {
  isOpen: boolean;
  purchase: PurchaseTransaction | null;
  onClose: () => void;
  branding?: StoreBranding;
}

export const PrintPurchaseModal: React.FC<PrintPurchaseModalProps> = ({
  isOpen,
  purchase,
  onClose,
  branding,
}) => {
  const [paperSize, setPaperSize] = useState<PrinterPaperSize>('a4');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen || !purchase) return null;

  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintFeedback(null);
    const result = await printPurchaseInvoice(purchase, branding, paperSize);
    setIsPrinting(false);
    setPrintFeedback({
      type: result.ok ? 'success' : 'error',
      message: result.message,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm">Purchase Invoice Voucher</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Paper size bar */}
        <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="font-bold text-slate-600">Paper Format:</span>
          <div className="flex items-center gap-1 bg-white p-0.5 rounded-xl border border-slate-200">
            {(['a4', '80mm', '58mm'] as PrinterPaperSize[]).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => setPaperSize(sz)}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                  paperSize === sz ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sz.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Printable Area */}
        <div className="p-4 bg-slate-50 flex justify-center max-h-[65vh] overflow-y-auto">
          <div
            id="printable-receipt"
            className="w-full bg-white p-6 rounded-xl shadow-xs border border-slate-200 font-sans text-xs text-slate-900"
          >
            {/* Mart Header */}
            <div className="text-center pb-4 border-b border-slate-300">
              <h2 className="text-lg font-black tracking-wide text-slate-950 font-sans">
                {branding?.storeName || 'WAQAS MART'}
              </h2>
              <p className="font-urdu text-sm font-bold text-emerald-800">وقاص مارٹ سپر مارکیٹ</p>
              <p className="text-xs font-bold text-slate-700 uppercase tracking-widest mt-1">
                {purchase.items.some((it) => it.quantity < 0)
                  ? 'PURCHASE / STOCK ADJUSTMENT VOUCHER'
                  : 'PURCHASE INVENTORY VOUCHER'}
              </p>
              {purchase.items.some((it) => it.quantity < 0) && (
                <div className="mt-1.5 inline-block px-2.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-black border border-red-200">
                  INCLUDES NEGATIVE QUANTITY STOCK DEDUCTION
                </div>
              )}
            </div>

            {/* Voucher Meta */}
            <div className="py-3 border-b border-slate-200 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <p className="text-slate-500">Purchase Invoice #:</p>
                <p className="font-bold font-mono text-xs">{purchase.purchaseInvoiceNo}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-500">Date:</p>
                <p className="font-semibold">{purchase.purchaseDate}</p>
              </div>
              <div>
                <p className="text-slate-500">Supplier / Vendor:</p>
                <p className="font-bold text-slate-900">{purchase.supplierName}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-500">Supplier Bill Ref #:</p>
                <p className="font-semibold font-mono">{purchase.supplierInvoiceNo || 'N/A'}</p>
              </div>
              {purchase.userName && (
                <div>
                  <p className="text-slate-500">User:</p>
                  <p className="font-semibold">{purchase.userName}</p>
                </div>
              )}
              {purchase.editBy && (
                <div className="text-right">
                  <p className="text-slate-500">Edited By:</p>
                  <p className="font-semibold">{purchase.editBy}</p>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-3 border-b border-slate-200">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-300 text-[10px] text-slate-500 uppercase">
                    <th className="py-1">#</th>
                    <th className="py-1">Item</th>
                    <th className="py-1 text-center">Qty</th>
                    <th className="py-1 text-right">Cost</th>
                    <th className="py-1 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[11px]">
                  {purchase.items.map((item, idx) => {
                    const isNegative = item.quantity < 0;
                    return (
                      <tr key={item.id} className={isNegative ? 'bg-red-50/70' : ''}>
                        <td className="py-1.5 text-slate-400 font-bold">{idx + 1}</td>
                        <td className="py-1.5 font-medium">
                          <div className="flex items-center gap-1.5">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt=""
                                className="w-5 h-5 rounded object-cover border border-slate-200 shrink-0 inline-block"
                              />
                            ) : null}
                            <span>{item.productName}</span>
                          </div>
                          {isNegative && (
                            <span className="inline-block text-[9px] font-black text-red-700 uppercase">
                              Stock Deduct ({item.quantity})
                            </span>
                          )}
                        </td>
                        <td className={`py-1.5 text-center font-black tabular-nums ${isNegative ? 'text-red-700' : ''}`}>
                          {item.quantity}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{formatRs(item.purchaseCost)}</td>
                        <td className={`py-1.5 text-right font-bold tabular-nums ${isNegative ? 'text-red-700' : ''}`}>
                          {formatRs(item.lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div className="py-3 border-b border-slate-200 space-y-1 text-[11px]">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="tabular-nums font-semibold">{formatRs(purchase.subtotal)}</span>
              </div>
              {purchase.totalDiscount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Total Discount:</span>
                  <span className="tabular-nums font-semibold">-{formatRs(purchase.totalDiscount)}</span>
                </div>
              )}
              {purchase.totalTax > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Tax:</span>
                  <span className="tabular-nums">{formatRs(purchase.totalTax)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-slate-900 pt-1 border-t border-slate-200">
                <span>GRAND TOTAL:</span>
                <span className="tabular-nums">{formatRs(purchase.grandTotal)}</span>
              </div>
            </div>

            {/* Payment status */}
            <div className="py-2.5 text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Method:</span>
                <span className="font-bold uppercase text-slate-800">{purchase.paymentMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount Paid:</span>
                <span className="font-bold text-emerald-700">{formatRs(purchase.amountPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Remaining Due / Payable:</span>
                <span className="font-black text-red-600">{formatRs(purchase.remainingBalance)}</span>
              </div>
              {purchase.notes && (
                <div className="pt-1 text-slate-500 italic">
                  Note: {purchase.notes}
                </div>
              )}
            </div>

            <div className="text-center pt-3 text-[10px] text-slate-400 border-t border-dashed border-slate-200">
              Generated via WAQAS POS SOFTWARE · Stock reconciled automatically
            </div>
          </div>
        </div>

        {/* Buttons & Feedback */}
        <div className="p-3 bg-white border-t border-slate-200 space-y-2">
          {printFeedback && (
            <div
              className={`text-xs font-bold rounded-xl px-3 py-2 border flex items-center gap-2 ${
                printFeedback.type === 'success'
                  ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                  : 'text-red-800 bg-red-50 border-red-200'
              }`}
            >
              {printFeedback.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              )}
              <span>{printFeedback.message}</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={isPrinting}
              onClick={handlePrint}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{isPrinting ? 'Sending to Printer...' : 'Print Invoice'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
