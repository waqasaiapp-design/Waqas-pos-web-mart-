import React, { useMemo, useState, useEffect } from 'react';
import {
  ScanBarcode,
  Search,
  Printer,
  Wand2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Check,
  Tag,
  Camera,
  RefreshCw,
} from 'lucide-react';
import { Product, StoreBranding } from '../types/pos';
import { formatRs } from '../data/defaultProducts';
import { FullScreenPageHeader } from './FullScreenPageHeader';
import { buildPrintableHtmlDocument, printHtmlDocument } from '../utils/printerService';

// Standard Code128B Encoding Table (codes 0..106)
const CODE128_PATTERNS: string[] = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

function encodeCode128B(text: string): { bars: Array<{ x: number; w: number }>; totalWidth: number } {
  const safe = (text || '000000').replace(/[^\x20-\x7E]/g, '').slice(0, 32) || '000000';
  const codes: number[] = [104]; // Start B
  let checksum = 104;
  for (let i = 0; i < safe.length; i++) {
    const val = safe.charCodeAt(i) - 32;
    const clamped = val >= 0 && val <= 94 ? val : 0;
    codes.push(clamped);
    checksum += clamped * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106); // Stop

  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 0;
  for (const code of codes) {
    const pat = CODE128_PATTERNS[code] || CODE128_PATTERNS[0];
    for (let i = 0; i < pat.length; i++) {
      const width = Number(pat[i]);
      if (i % 2 === 0) {
        bars.push({ x: cursor, w: width });
      }
      cursor += width;
    }
  }
  return { bars, totalWidth: cursor };
}

function buildCode128SvgString(value: string, height = 42): string {
  const { bars, totalWidth } = encodeCode128B(value);
  const rects = bars
    .map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="${height}" fill="#0f172a" />`)
    .join('');
  return `<svg viewBox="0 0 ${totalWidth} ${height}" width="100%" height="${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

const Code128Svg: React.FC<{ value: string; height?: number }> = ({ value, height = 40 }) => {
  const { bars, totalWidth } = useMemo(() => encodeCode128B(value), [value]);
  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      className="w-full h-10 bg-white"
      preserveAspectRatio="none"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#0f172a" />
      ))}
    </svg>
  );
};

interface BarcodeManagementPageProps {
  products: Product[];
  branding: StoreBranding;
  onSaveProduct: (product: Product) => { ok: boolean; message?: string } | void;
  onOpenScanner: () => void;
  onOpenAddProduct: () => void;
  onBackToHome: () => void;
  initialSearch?: string;
}

export const BarcodeManagementPage: React.FC<BarcodeManagementPageProps> = ({
  products,
  branding,
  onSaveProduct,
  onOpenScanner,
  onOpenAddProduct,
  onBackToHome,
  initialSearch = '',
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBarcode, setEditingBarcode] = useState('');
  const [selectedIds, setSelectedIds] = useState<Record<string, number>>({});
  const [labelPaper, setLabelPaper] = useState<'58mm' | '80mm' | 'a4'>('a4');
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (initialSearch) {
      setSearchQuery(initialSearch);
    }
  }, [initialSearch]);

  const showStatus = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Detect any duplicate barcodes across catalog
  const duplicateBarcodeMap = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((p) => {
      const b = (p.barcode || '').trim().toLowerCase();
      if (b) counts.set(b, (counts.get(b) || 0) + 1);
    });
    const dupes = new Set<string>();
    counts.forEach((c, k) => {
      if (c > 1) dupes.add(k);
    });
    return dupes;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const generateUniqueBarcode = (seedIdx = 0): string => {
    const existing = new Set(products.map((p) => (p.barcode || '').trim().toLowerCase()));
    let candidate = '';
    for (let attempt = 0; attempt < 25; attempt++) {
      const rnd = Math.floor(100000000 + Math.random() * 899999999);
      candidate = `896${rnd}${seedIdx % 10}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `896${Date.now().toString().slice(-10)}`;
  };

  const handleSaveBarcodeEdit = (product: Product) => {
    const clean = editingBarcode.trim();
    if (!clean) {
      showStatus('Barcode cannot be empty.', 'error');
      return;
    }
    const conflict = products.find(
      (p) => p.id !== product.id && (p.barcode || '').trim().toLowerCase() === clean.toLowerCase()
    );
    if (conflict) {
      showStatus(`Duplicate blocked! Barcode "${clean}" is already assigned to "${conflict.name}".`, 'error');
      return;
    }

    const res = onSaveProduct({ ...product, barcode: clean });
    if (res && res.ok === false) {
      showStatus(res.message || 'Could not update barcode.', 'error');
      return;
    }
    setEditingId(null);
    setEditingBarcode('');
    showStatus(`Barcode "${clean}" saved for ${product.name}.`, 'success');
  };

  const handleAssignAutoBarcode = (product: Product) => {
    const code = generateUniqueBarcode();
    const res = onSaveProduct({ ...product, barcode: code });
    if (res && res.ok === false) {
      showStatus(res.message || 'Could not assign barcode.', 'error');
      return;
    }
    showStatus(`Generated unique barcode ${code} for ${product.name}.`, 'success');
  };

  const toggleSelectLabel = (productId: string, copies = 1) => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (next[productId]) {
        delete next[productId];
      } else {
        next[productId] = copies;
      }
      return next;
    });
  };

  const updateLabelCopies = (productId: string, qty: number) => {
    const safeQty = Math.max(1, Math.min(100, Number(qty) || 1));
    setSelectedIds((prev) => ({ ...prev, [productId]: safeQty }));
  };

  const selectedLabelCount = Object.values(selectedIds).reduce((s, n) => s + n, 0);

  const handlePrintLabels = async (targetItems?: Array<{ product: Product; copies: number }>) => {
    const itemsToPrint =
      targetItems ||
      Object.entries(selectedIds)
        .map(([id, copies]) => {
          const prod = products.find((p) => p.id === id);
          return prod ? { product: prod, copies } : null;
        })
        .filter((x): x is { product: Product; copies: number } => Boolean(x));

    if (itemsToPrint.length === 0) {
      showStatus('Select at least one product to print barcode labels.', 'error');
      return;
    }

    const storeTitle = branding?.storeName || 'WAQAS MART';
    const labelsHtml: string[] = [];

    itemsToPrint.forEach(({ product, copies }) => {
      const code = product.barcode || product.sku || product.id;
      const svg = buildCode128SvgString(code, labelPaper === '58mm' ? 32 : 38);
      for (let c = 0; c < copies; c++) {
        labelsHtml.push(`
          <div class="avoid-break" style="border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;text-align:center;background:#fff;">
            <div style="font-size:8.5px;font-weight:900;color:#065f46;text-transform:uppercase;letter-spacing:0.5px;">${storeTitle}</div>
            <div style="font-size:10px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:2px 0;">${product.name}</div>
            <div style="margin:3px auto;max-width:160px;">${svg}</div>
            <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:1px;color:#334155;">${code}</div>
            <div style="font-size:11px;font-weight:900;color:#0f172a;margin-top:2px;">${formatRs(product.price)}</div>
          </div>
        `);
      }
    });

    const gridCols = labelPaper === 'a4' ? 'repeat(4, minmax(0, 1fr))' : '1fr';
    const body = `
      <div style="display:grid;grid-template-columns:${gridCols};gap:8px;">
        ${labelsHtml.join('')}
      </div>
    `;

    const html = buildPrintableHtmlDocument(body, {
      paperSize: labelPaper,
      title: `${storeTitle} - Barcode Labels`,
    });

    const result = await printHtmlDocument(html);
    showStatus(result.message, result.ok ? 'success' : 'error');
  };

  return (
    <div className="h-full flex flex-col w-full bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      <FullScreenPageHeader
        title="Barcode Management & Label Printing"
        urduTitle="بارکوڈ مینجمنٹ اور لیبل پرنٹنگ"
        subtitle="Unique barcode enforcement, camera lookup, and crisp Code128 label sheets"
        icon={<ScanBarcode className="w-5 h-5" />}
        storeName={branding?.storeName || 'WAQAS MART'}
        onBackToHome={onBackToHome}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenScanner}
              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan Barcode</span>
            </button>
            <button
              type="button"
              onClick={onOpenAddProduct}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Product</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
        {statusMsg && (
          <div
            className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
              statusMsg.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : statusMsg.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            <span>{statusMsg.text}</span>
          </div>
        )}

        {duplicateBarcodeMap.size > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-xs text-amber-900 flex items-center gap-2 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Warning: {duplicateBarcodeMap.size} duplicate barcode(s) detected in catalog. Reassign unique barcodes below to avoid checkout scanning confusion.
            </span>
          </div>
        )}

        {/* Controls Bar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by product name, barcode, SKU, or category..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
              {(['58mm', '80mm', 'a4'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setLabelPaper(sz)}
                  className={`px-2.5 py-1 rounded-lg uppercase cursor-pointer transition ${
                    labelPaper === sz ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => handlePrintLabels()}
              disabled={selectedLabelCount === 0}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>Print Selected ({selectedLabelCount} Labels)</span>
            </button>
          </div>
        </div>

        {/* Products Barcode Table / Grid */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
            <Tag className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No Products Matching Search</h3>
            <p className="text-xs text-slate-500">
              {products.length === 0
                ? 'Your inventory is empty. Add products or enter a Purchase Invoice to manage barcodes.'
                : 'Try a different barcode, item code, or product name.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredProducts.map((prod) => {
              const code = prod.barcode || prod.sku || prod.id;
              const isDupe = prod.barcode && duplicateBarcodeMap.has(prod.barcode.trim().toLowerCase());
              const isSelected = Boolean(selectedIds[prod.id]);
              const isEditing = editingId === prod.id;

              return (
                <div
                  key={prod.id}
                  className={`bg-white rounded-2xl border p-4 shadow-xs flex flex-col justify-between gap-3 transition ${
                    isDupe
                      ? 'border-amber-400 ring-2 ring-amber-200'
                      : isSelected
                      ? 'border-emerald-500 ring-2 ring-emerald-100'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 truncate">{prod.name}</h4>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="font-bold text-emerald-700">{formatRs(prod.price)}</span>
                        <span>•</span>
                        <span>Stock: {prod.stock}</span>
                        {prod.sku && (
                          <>
                            <span>•</span>
                            <span className="font-mono">SKU: {prod.sku}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleSelectLabel(prod.id, 1)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0 ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {isSelected ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      <span>{isSelected ? 'Selected' : 'Select'}</span>
                    </button>
                  </div>

                  {/* Crisp Code128 Preview */}
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-1">
                    <Code128Svg value={code} />
                    <div className="font-mono text-xs font-black tracking-widest text-slate-800">{code}</div>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={editingBarcode}
                        onChange={(e) => setEditingBarcode(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-white border border-emerald-400 rounded-lg font-mono text-xs focus:outline-hidden"
                        placeholder="Enter unique barcode..."
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveBarcodeEdit(prod)}
                        className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(prod.id);
                            setEditingBarcode(prod.barcode || '');
                          }}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold cursor-pointer"
                        >
                          Edit Barcode
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAssignAutoBarcode(prod)}
                          className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          title="Generate guaranteed unique barcode"
                        >
                          <Wand2 className="w-3 h-3" />
                          <span>Auto-Unique</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isSelected && (
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={selectedIds[prod.id] || 1}
                            onChange={(e) => updateLabelCopies(prod.id, Number(e.target.value))}
                            className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-xs font-bold text-center"
                            title="Number of copies"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => handlePrintLabels([{ product: prod, copies: selectedIds[prod.id] || 1 }])}
                          className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="w-3 h-3" />
                          <span>Print</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
