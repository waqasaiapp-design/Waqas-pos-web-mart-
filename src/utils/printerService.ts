import {
  Customer,
  CustomerLedgerEntry,
  DailyHisabRow,
  DEFAULT_PRINTER_SETTINGS,
  DEFAULT_RECEIPT_SETTINGS,
  ExpenseEntry,
  PrinterPaperSize,
  PrinterSettings,
  Product,
  PurchaseReturn,
  PurchaseTransaction,
  ReceiptSettings,
  SaleReturn,
  SaleTransaction,
  StaffMember,
  StoreBranding,
  Supplier,
  SupplierLedgerEntry,
} from '../types/pos';
import { formatRs } from '../data/defaultProducts';

const PRINTER_SETTINGS_KEY = 'waqas_mart_printer_settings_v1';

export interface PrintExecutionResult {
  ok: boolean;
  method: 'bluetooth' | 'usb' | 'system' | 'network';
  message: string;
}

export interface DocumentRenderOptions {
  paperSize?: PrinterPaperSize;
  orientation?: 'portrait' | 'landscape';
  title?: string;
}

// Active hardware device handles kept in session memory
let activeBtDevice: any = null;
let activeBtCharacteristic: any = null;
let activeUsbDevice: any = null;
let activeSerialPort: any = null;

export function loadPrinterSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_PRINTER_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_PRINTER_SETTINGS };
}

export function savePrinterSettings(settings: PrinterSettings): void {
  try {
    localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function getPrinterHardwareStatus() {
  return {
    bluetoothSupported: typeof navigator !== 'undefined' && !!(navigator as any).bluetooth,
    usbSupported: typeof navigator !== 'undefined' && !!(navigator as any).usb,
    serialSupported: typeof navigator !== 'undefined' && !!(navigator as any).serial,
    bluetoothConnected: Boolean(activeBtDevice?.gatt?.connected && activeBtCharacteristic),
    bluetoothDeviceName: activeBtDevice?.name || null,
    usbConnected: Boolean(activeUsbDevice?.opened || activeSerialPort?.writable),
    usbDeviceName: activeUsbDevice?.productName || (activeSerialPort ? 'USB/Serial Printer' : null),
  };
}

export async function connectBluetoothThermalPrinter(): Promise<{ ok: boolean; deviceName?: string; message: string }> {
  if (typeof navigator === 'undefined' || !(navigator as any).bluetooth) {
    return {
      ok: false,
      message:
        'Web Bluetooth is not available in this browser. Use Chrome on Android/Desktop or select System/Wi-Fi Printer.',
    };
  }
  try {
    const bt = (navigator as any).bluetooth;
    const device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      ],
    });
    if (!device?.gatt) {
      return { ok: false, message: 'Selected Bluetooth device does not support GATT printing.' };
    }
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let writableChar: any = null;
    for (const svc of services) {
      try {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties?.write || ch.properties?.writeWithoutResponse) {
            writableChar = ch;
            break;
          }
        }
        if (writableChar) break;
      } catch {}
    }

    if (!writableChar) {
      device.gatt.disconnect?.();
      return {
        ok: false,
        message: 'Bluetooth printer connected, but no writable print service was found on this device.',
      };
    }

    activeBtDevice = device;
    activeBtCharacteristic = writableChar;
    device.addEventListener?.('gattserverdisconnected', () => {
      activeBtCharacteristic = null;
    });

    const settings = loadPrinterSettings();
    savePrinterSettings({
      ...settings,
      connectionType: 'bluetooth',
      printerName: device.name || 'Bluetooth Thermal Printer',
      bluetoothDeviceName: device.name || 'Bluetooth Thermal Printer',
    });

    return {
      ok: true,
      deviceName: device.name || 'Bluetooth Thermal Printer',
      message: `Connected to Bluetooth printer "${device.name || 'Thermal Printer'}".`,
    };
  } catch (err: any) {
    if (err?.name === 'NotFoundError') {
      return { ok: false, message: 'No Bluetooth printer selected. Pairing was cancelled.' };
    }
    return {
      ok: false,
      message: err?.message || 'Failed to connect to Bluetooth printer.',
    };
  }
}

export async function disconnectBluetoothPrinter(): Promise<void> {
  try {
    activeBtDevice?.gatt?.disconnect?.();
  } catch {}
  activeBtDevice = null;
  activeBtCharacteristic = null;
}

export async function connectUsbOrSerialPrinter(): Promise<{ ok: boolean; deviceName?: string; message: string }> {
  if (typeof navigator === 'undefined') {
    return { ok: false, message: 'USB/Serial API unavailable in non-browser environment.' };
  }
  // Prefer WebSerial first (most USB POS thermal printers expose a virtual COM/Serial port or USB interface)
  if ((navigator as any).serial) {
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      activeSerialPort = port;
      const settings = loadPrinterSettings();
      savePrinterSettings({
        ...settings,
        connectionType: 'usb',
        printerName: 'USB / Serial Thermal Printer',
        usbDeviceName: 'USB Serial Printer',
      });
      return {
        ok: true,
        deviceName: 'USB Serial Printer',
        message: 'Connected to USB/Serial thermal printer.',
      };
    } catch (err: any) {
      if (err?.name !== 'NotFoundError' && !(navigator as any).usb) {
        return { ok: false, message: err?.message || 'Could not open USB Serial printer.' };
      }
    }
  }

  if ((navigator as any).usb) {
    try {
      const dev = await (navigator as any).usb.requestDevice({ filters: [{ classCode: 7 }] }).catch(() =>
        (navigator as any).usb.requestDevice({ filters: [] })
      );
      await dev.open();
      if (dev.configuration === null) {
        await dev.selectConfiguration(1);
      }
      const iface = dev.configuration?.interfaces?.[0];
      if (iface) {
        await dev.claimInterface(iface.interfaceNumber);
      }
      activeUsbDevice = dev;
      const name = dev.productName || 'USB Thermal Printer';
      const settings = loadPrinterSettings();
      savePrinterSettings({
        ...settings,
        connectionType: 'usb',
        printerName: name,
        usbDeviceName: name,
      });
      return {
        ok: true,
        deviceName: name,
        message: `Connected to USB printer "${name}".`,
      };
    } catch (err: any) {
      if (err?.name === 'NotFoundError') {
        return { ok: false, message: 'No USB printer selected.' };
      }
      return { ok: false, message: err?.message || 'USB printer connection failed.' };
    }
  }

  return {
    ok: false,
    message: 'WebUSB/WebSerial is not supported in this browser. Use System / Wi-Fi Printer instead.',
  };
}

export async function disconnectUsbOrSerialPrinter(): Promise<void> {
  try {
    if (activeUsbDevice?.opened) await activeUsbDevice.close();
  } catch {}
  try {
    if (activeSerialPort) await activeSerialPort.close();
  } catch {}
  activeUsbDevice = null;
  activeSerialPort = null;
}

// ============================================================================
// ESC/POS ENCODER FOR 58MM / 80MM THERMAL PRINTERS
// ============================================================================
function buildEscPosBytes(lines: string[], autoCut = true): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: number[] = [];
  // Initialize printer ESC @
  chunks.push(0x1b, 0x40);
  // UTF-8 / text lines
  for (const line of lines) {
    const clean = (line || '').replace(/[^\x20-\x7E\n\r]/g, ' ');
    const bytes = encoder.encode(clean + '\n');
    for (let i = 0; i < bytes.length; i++) chunks.push(bytes[i]);
  }
  chunks.push(0x0a, 0x0a, 0x0a);
  if (autoCut) {
    chunks.push(0x1d, 0x56, 0x41, 0x03); // GS V A 3 partial cut
  }
  return new Uint8Array(chunks);
}

async function sendEscPosToBluetooth(bytes: Uint8Array): Promise<PrintExecutionResult> {
  if (!activeBtDevice?.gatt?.connected || !activeBtCharacteristic) {
    return {
      ok: false,
      method: 'bluetooth',
      message: 'Bluetooth printer is disconnected. Please connect it in Printer Settings or switch to System Printer.',
    };
  }
  try {
    const chunkSize = 100;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.slice(i, i + chunkSize);
      if (activeBtCharacteristic.properties?.writeWithoutResponse) {
        await activeBtCharacteristic.writeValueWithoutResponse(slice);
      } else {
        await activeBtCharacteristic.writeValue(slice);
      }
    }
    return { ok: true, method: 'bluetooth', message: 'Sent to Bluetooth thermal printer.' };
  } catch (err: any) {
    return {
      ok: false,
      method: 'bluetooth',
      message: err?.message || 'Bluetooth transfer failed. Check printer power & range.',
    };
  }
}

async function sendEscPosToUsbOrSerial(bytes: Uint8Array): Promise<PrintExecutionResult> {
  if (activeSerialPort?.writable) {
    try {
      const writer = activeSerialPort.writable.getWriter();
      await writer.write(bytes);
      writer.releaseLock();
      return { ok: true, method: 'usb', message: 'Sent to USB/Serial thermal printer.' };
    } catch (err: any) {
      return { ok: false, method: 'usb', message: err?.message || 'USB/Serial write error.' };
    }
  }
  if (activeUsbDevice?.opened) {
    try {
      const iface = activeUsbDevice.configuration?.interfaces?.[0];
      const ep = iface?.alternate?.endpoints?.find((e: any) => e.direction === 'out');
      if (!ep) {
        return { ok: false, method: 'usb', message: 'USB printer endpoint unavailable.' };
      }
      await activeUsbDevice.transferOut(ep.endpointNumber, bytes);
      return { ok: true, method: 'usb', message: 'Sent to USB thermal printer.' };
    } catch (err: any) {
      return { ok: false, method: 'usb', message: err?.message || 'USB print transfer failed.' };
    }
  }
  return {
    ok: false,
    method: 'usb',
    message: 'USB printer is not connected. Connect it in Printer Settings or switch to System Printer.',
  };
}

// ============================================================================
// ISOLATED HIDDEN-IFRAME HTML PRINT ENGINE (ANDROID PWA + DESKTOP + WI-FI)
// ============================================================================
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPrintableHtmlDocument(
  bodyHtml: string,
  options: DocumentRenderOptions = {}
): string {
  const paperSize = options.paperSize || 'a4';
  const orientation = options.orientation || 'portrait';
  const title = options.title || 'WAQAS POS Print Document';

  const pageSizeRule =
    paperSize === '58mm'
      ? '58mm auto'
      : paperSize === '80mm'
      ? '80mm auto'
      : `A4 ${orientation}`;

  const pageMargin = paperSize === 'a4' ? '10mm' : '2mm';
  const containerMaxWidth =
    paperSize === '58mm' ? '54mm' : paperSize === '80mm' ? '74mm' : '100%';
  const baseFontSize =
    paperSize === '58mm' ? '10px' : paperSize === '80mm' ? '11.5px' : '12px';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: ${pageSizeRule};
      margin: ${pageMargin};
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: ${baseFontSize};
      line-height: 1.4;
    }
    .print-sheet {
      width: 100%;
      max-width: ${containerMaxWidth};
      margin: 0 auto;
      padding: ${paperSize === 'a4' ? '0' : '4px'};
    }
    .font-urdu {
      font-family: 'Noto Nastaliq Urdu', 'Segoe UI', sans-serif;
      line-height: 1.8;
    }
    .header-box {
      text-align: center;
      padding-bottom: 8px;
      margin-bottom: 10px;
      border-bottom: 2px solid #047857;
    }
    .store-title {
      margin: 0;
      font-size: ${paperSize === '58mm' ? '14px' : paperSize === '80mm' ? '16px' : '20px'};
      font-weight: 900;
      color: #064e3b;
      letter-spacing: 0.4px;
    }
    .doc-badge {
      display: inline-block;
      margin-top: 4px;
      padding: 2px 10px;
      border-radius: 4px;
      background: #047857;
      color: #ffffff;
      font-weight: 800;
      font-size: ${paperSize === '58mm' ? '9px' : '10.5px'};
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: ${paperSize === 'a4' ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))'};
      gap: 6px;
      margin-bottom: 10px;
      padding: 8px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
    }
    .meta-label {
      font-size: 9.5px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 700;
    }
    .meta-value {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-variant-numeric: tabular-nums;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: ${paperSize === 'a4' ? '6px 8px' : '4px 3px'};
      text-align: left;
      vertical-align: middle;
      word-break: break-word;
    }
    th {
      background: #064e3b;
      color: #ffffff;
      font-weight: 800;
      font-size: ${paperSize === 'a4' ? '10.5px' : '9.5px'};
      text-transform: uppercase;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    tfoot td {
      background: #ecfdf5;
      font-weight: 900;
      color: #064e3b;
      border-top: 2px solid #047857;
    }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .num { font-variant-numeric: tabular-nums; font-weight: 700; }
    .summary-box {
      margin-top: 8px;
      padding: 8px 10px;
      background: #f0fdf4;
      border: 1.5px solid #047857;
      border-radius: 6px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
    }
    .grand-row {
      margin-top: 4px;
      padding-top: 5px;
      border-top: 1.5px dashed #047857;
      font-size: ${paperSize === '58mm' ? '12px' : '14px'};
      font-weight: 900;
      color: #064e3b;
    }
    .footer-note {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px dashed #94a3b8;
      text-align: center;
      font-size: 9.5px;
      color: #475569;
    }
    .thermal-line {
      border-top: 1px dashed #334155;
      margin: 5px 0;
    }
    .avoid-break {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="print-sheet">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

export async function printHtmlDocument(
  fullHtml: string
): Promise<PrintExecutionResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, method: 'system', message: 'Print engine requires a browser environment.' };
  }

  if (typeof window.print !== 'function') {
    return {
      ok: false,
      method: 'system',
      message: 'This device or WebView does not support system printing.',
    };
  }

  return new Promise<PrintExecutionResult>((resolve) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.opacity = '0';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!doc || !iframe.contentWindow) {
        iframe.remove();
        resolve({
          ok: false,
          method: 'system',
          message: 'Could not initialize isolated print frame.',
        });
        return;
      }

      doc.open();
      doc.write(fullHtml);
      doc.close();

      let printed = false;
      const cleanup = () => {
        setTimeout(() => {
          try {
            iframe.remove();
          } catch {}
        }, 1200);
      };

      const triggerPrint = () => {
        if (printed) return;
        printed = true;
        try {
          const win = iframe.contentWindow!;
          win.focus();
          win.print();
          cleanup();
          resolve({
            ok: true,
            method: 'system',
            message: 'Print dialog opened cleanly.',
          });
        } catch (err: any) {
          cleanup();
          resolve({
            ok: false,
            method: 'system',
            message: err?.message || 'Printer unavailable or print dialog blocked.',
          });
        }
      };

      // Wait for embedded images before printing (max 1200ms)
      const images = Array.from(doc.images || []);
      if (images.length === 0) {
        setTimeout(triggerPrint, 120);
      } else {
        let settled = 0;
        const onImgDone = () => {
          settled += 1;
          if (settled >= images.length) triggerPrint();
        };
        images.forEach((img) => {
          if (img.complete) onImgDone();
          else {
            img.addEventListener('load', onImgDone, { once: true });
            img.addEventListener('error', onImgDone, { once: true });
          }
        });
        setTimeout(triggerPrint, 1200);
      }
    } catch (err: any) {
      resolve({
        ok: false,
        method: 'system',
        message: err?.message || 'Unexpected error while preparing print job.',
      });
    }
  });
}

async function executeThermalOrHtmlPrint(
  htmlDoc: string,
  escPosLines: string[],
  preferredMethod?: PrinterSettings['connectionType']
): Promise<PrintExecutionResult> {
  const settings = loadPrinterSettings();
  const mode = preferredMethod || settings.connectionType || 'system';

  if (mode === 'bluetooth') {
    const bytes = buildEscPosBytes(escPosLines, settings.autoCut);
    return sendEscPosToBluetooth(bytes);
  }
  if (mode === 'usb') {
    const bytes = buildEscPosBytes(escPosLines, settings.autoCut);
    return sendEscPosToUsbOrSerial(bytes);
  }
  if (mode === 'network') {
    // Browsers cannot open raw TCP port 9100 directly without local bridge; check if host configured and fall back honestly if unavailable
    if (!settings.networkPrinterHost?.trim()) {
      return {
        ok: false,
        method: 'network',
        message: 'Wi-Fi / Network printer IP is not configured. Open Printer Settings or use System Printer.',
      };
    }
    return printHtmlDocument(htmlDoc);
  }

  return printHtmlDocument(htmlDoc);
}

// ============================================================================
// 1. SALE RECEIPT (58MM / 80MM / A4) — NEW SALE & OLD SALE REPRINT
// ============================================================================
export function buildSaleReceiptHtml(
  tx: SaleTransaction,
  branding?: StoreBranding,
  receiptSettings: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS,
  paperOverride?: PrinterPaperSize
): string {
  const settings = loadPrinterSettings();
  const paper = paperOverride || receiptSettings.paperSize || settings.defaultReceiptSize || '80mm';
  const storeName = receiptSettings.storeName || branding?.storeName || 'WAQAS MART';
  const storeUrdu = receiptSettings.storeUrduName || 'وقاص مارٹ سپر مارکیٹ';
  const isThermal = paper === '58mm' || paper === '80mm';

  const ownerPhotoBlock =
    receiptSettings.showOwnerPhoto && receiptSettings.ownerPhotoUrl
      ? `<div style="margin-bottom:6px;text-align:center;">
           <img src="${escapeHtml(receiptSettings.ownerPhotoUrl)}" alt="Owner" style="width:${
             paper === '58mm' ? '48px' : '64px'
           };height:${paper === '58mm' ? '48px' : '64px'};object-fit:cover;border-radius:${
             receiptSettings.ownerPhotoShape === 'square'
               ? '6px'
               : receiptSettings.ownerPhotoShape === 'rounded'
               ? '14px'
               : '9999px'
           };border:2px solid ${escapeHtml(receiptSettings.accentColor || '#d97706')};" />
           ${
             receiptSettings.ownerName
               ? `<div style="font-size:10px;font-weight:800;color:${escapeHtml(
                   receiptSettings.primaryColor || '#047857'
                 )};margin-top:2px;">${escapeHtml(receiptSettings.ownerName)}</div>`
               : ''
           }
         </div>`
      : '';

  const rowsHtml = tx.items
    .map(
      (it, idx) => `
      <tr>
        ${!isThermal ? `<td class="text-center">${idx + 1}</td>` : ''}
        <td>
          <div style="font-weight:700;">${escapeHtml(it.product.name)}</div>
          ${it.product.urduName ? `<div class="font-urdu" style="font-size:9px;color:#475569;">${escapeHtml(it.product.urduName)}</div>` : ''}
        </td>
        <td class="text-center num">${it.quantity}</td>
        <td class="text-right num">${formatRs(it.unitPrice)}</td>
        <td class="text-right num">${formatRs(it.lineTotal)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      ${ownerPhotoBlock}
      <h1 class="store-title">${escapeHtml(storeName)}</h1>
      ${storeUrdu ? `<div class="font-urdu" style="font-weight:700;font-size:12px;">${escapeHtml(storeUrdu)}</div>` : ''}
      ${receiptSettings.tagline ? `<div style="font-size:9.5px;color:#475569;">${escapeHtml(receiptSettings.tagline)}</div>` : ''}
      ${receiptSettings.phone ? `<div style="font-size:10px;font-weight:700;">Ph: ${escapeHtml(receiptSettings.phone)}</div>` : ''}
      ${receiptSettings.address ? `<div style="font-size:9px;color:#475569;">${escapeHtml(receiptSettings.address)}</div>` : ''}
      <span class="doc-badge">${escapeHtml(receiptSettings.receiptTitle || 'OFFICIAL CASH RECEIPT')}</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px;font-size:10.5px;">
      <div><strong>Invoice:</strong> ${escapeHtml(tx.invoiceNumber)}</div>
      <div class="text-right"><strong>Date:</strong> ${escapeHtml(tx.dateTime)}</div>
      ${receiptSettings.showCashierName ? `<div><strong>Cashier:</strong> ${escapeHtml(tx.cashierName)}</div>` : '<div></div>'}
      <div class="text-right"><strong>Pay:</strong> ${escapeHtml(tx.paymentMethod.toUpperCase())}</div>
      ${
        receiptSettings.showCustomerDetails && tx.customerName
          ? `<div style="grid-column:1 / -1;"><strong>Customer:</strong> ${escapeHtml(tx.customerName)}${
              tx.customerPhone ? ` (${escapeHtml(tx.customerPhone)})` : ''
            }</div>`
          : ''
      }
    </div>

    <table>
      <thead>
        <tr>
          ${!isThermal ? '<th class="text-center" style="width:28px;">#</th>' : ''}
          <th>Item Description</th>
          <th class="text-center">Qty</th>
          <th class="text-right">Rate</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="summary-box avoid-break">
      <div class="summary-row"><span>Subtotal:</span><span class="num">${formatRs(tx.subtotal)}</span></div>
      ${
        receiptSettings.showItemizedDiscount && tx.discount > 0
          ? `<div class="summary-row"><span>Discount:</span><span class="num">-${formatRs(tx.discount)}</span></div>`
          : ''
      }
      ${
        tx.taxAmount > 0
          ? `<div class="summary-row"><span>Tax / GST:</span><span class="num">${formatRs(tx.taxAmount)}</span></div>`
          : ''
      }
      <div class="summary-row grand-row"><span>GRAND TOTAL:</span><span>${formatRs(tx.grandTotal)}</span></div>
      ${
        tx.paymentMethod === 'cash' && receiptSettings.showChangeDue
          ? `<div class="summary-row"><span>Cash Tendered:</span><span class="num">${formatRs(
              tx.cashTendered ?? tx.grandTotal
            )}</span></div>
             <div class="summary-row"><span>Change Returned:</span><span class="num">${formatRs(tx.changeDue || 0)}</span></div>`
          : ''
      }
    </div>

    <div class="footer-note avoid-break">
      ${receiptSettings.thankYouMessage ? `<div style="font-weight:700;">${escapeHtml(receiptSettings.thankYouMessage)}</div>` : ''}
      ${receiptSettings.thankYouUrduMessage ? `<div class="font-urdu" style="font-weight:700;color:#047857;">${escapeHtml(receiptSettings.thankYouUrduMessage)}</div>` : ''}
      ${receiptSettings.footerPromo ? `<div class="font-urdu">${escapeHtml(receiptSettings.footerPromo)}</div>` : ''}
      <div style="margin-top:4px;font-family:monospace;font-size:10px;">*${escapeHtml(tx.invoiceNumber)}*</div>
      <div style="margin-top:2px;font-size:8.5px;color:#64748b;">${escapeHtml(receiptSettings.softwareCredit || 'WAQAS POS SOFTWARE')}</div>
    </div>
  `;

  return buildPrintableHtmlDocument(body, {
    paperSize: paper,
    title: `Invoice ${tx.invoiceNumber}`,
  });
}

export async function printSaleReceipt(
  tx: SaleTransaction,
  branding?: StoreBranding,
  receiptSettings: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS,
  paperOverride?: PrinterPaperSize
): Promise<PrintExecutionResult> {
  const settings = loadPrinterSettings();
  const paper = paperOverride || receiptSettings.paperSize || settings.defaultReceiptSize || '80mm';
  const widthChars = paper === '58mm' ? 32 : 46;
  const divider = '-'.repeat(widthChars);

  const escLines = [
    (receiptSettings.storeName || branding?.storeName || 'WAQAS MART').toUpperCase(),
    receiptSettings.phone ? `Ph: ${receiptSettings.phone}` : '',
    divider,
    `Invoice: ${tx.invoiceNumber}`,
    `Date: ${tx.dateTime}`,
    `Pay: ${tx.paymentMethod.toUpperCase()}`,
    tx.customerName ? `Customer: ${tx.customerName}` : '',
    divider,
    'ITEM                QTY   TOTAL',
    divider,
    ...tx.items.map((it) => {
      const nm = it.product.name.slice(0, widthChars - 14).padEnd(widthChars - 14, ' ');
      const qt = String(it.quantity).padStart(4, ' ');
      const tot = Number(it.lineTotal).toFixed(0).padStart(9, ' ');
      return `${nm} ${qt} ${tot}`;
    }),
    divider,
    `Subtotal:    Rs. ${tx.subtotal.toFixed(0)}`,
    tx.discount > 0 ? `Discount:   -Rs. ${tx.discount.toFixed(0)}` : '',
    tx.taxAmount > 0 ? `Tax:         Rs. ${tx.taxAmount.toFixed(0)}` : '',
    `GRAND TOTAL: Rs. ${tx.grandTotal.toFixed(0)}`,
    tx.paymentMethod === 'cash' ? `Tendered:    Rs. ${(tx.cashTendered ?? tx.grandTotal).toFixed(0)}` : '',
    tx.paymentMethod === 'cash' ? `Change:      Rs. ${(tx.changeDue || 0).toFixed(0)}` : '',
    divider,
    receiptSettings.thankYouMessage || 'Thank you for shopping with us!',
  ].filter(Boolean);

  const html = buildSaleReceiptHtml(tx, branding, receiptSettings, paper);
  return executeThermalOrHtmlPrint(html, escLines);
}

// ============================================================================
// 2. PURCHASE INVOICE (NEW PURCHASE & OLD PURCHASE REPRINT)
// ============================================================================
export async function printPurchaseInvoice(
  purchase: PurchaseTransaction,
  branding?: StoreBranding,
  paperOverride?: PrinterPaperSize
): Promise<PrintExecutionResult> {
  const settings = loadPrinterSettings();
  const paper = paperOverride || settings.defaultReportSize || 'a4';
  const hasNegative = purchase.items.some((it) => it.quantity < 0);
  const rows = purchase.items
    .map((it, idx) => {
      const isNeg = it.quantity < 0;
      return `
      <tr style="${isNeg ? 'background:#fef2f2;' : ''}">
        <td class="text-center">${idx + 1}</td>
        <td>
          <strong>${escapeHtml(it.productName)}</strong>
          <div style="font-size:9px;color:#64748b;">${escapeHtml(it.barcode || '')}</div>
          ${isNeg ? `<div style="font-size:9px;font-weight:800;color:#b91c1c;">STOCK DEDUCTION (${it.quantity})</div>` : ''}
        </td>
        <td class="text-center num" style="${isNeg ? 'color:#b91c1c;font-weight:800;' : ''}">${it.quantity}</td>
        <td class="text-right num">${formatRs(it.purchaseCost)}</td>
        <td class="text-right num">${formatRs(it.discount || 0)}</td>
        <td class="text-right num" style="text-align:right;">${formatRs(it.vat ?? it.tax ?? 0)}</td>
        <td class="text-right num" style="${isNeg ? 'color:#b91c1c;font-weight:800;' : ''}">${formatRs(it.lineTotal)}</td>
      </tr>`;
    })
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">${hasNegative ? 'PURCHASE / STOCK ADJUSTMENT VOUCHER' : 'PURCHASE INVOICE VOUCHER'}</span>
    </div>

    <div class="meta-grid">
      <div><div class="meta-label">Purchase Invoice #</div><div class="meta-value">${escapeHtml(purchase.purchaseInvoiceNo)}</div></div>
      <div><div class="meta-label">Purchase Date</div><div class="meta-value">${escapeHtml(purchase.purchaseDate)}</div></div>
      <div><div class="meta-label">Supplier Name</div><div class="meta-value">${escapeHtml(purchase.supplierName)}</div></div>
      <div><div class="meta-label">Supplier Ref #</div><div class="meta-value">${escapeHtml(purchase.supplierInvoiceNo || purchase.refNo || 'N/A')}</div></div>
      ${purchase.userName ? `<div><div class="meta-label">Entered By</div><div class="meta-value">${escapeHtml(purchase.userName)}</div></div>` : ''}
      ${purchase.editBy ? `<div><div class="meta-label">Edited By</div><div class="meta-value">${escapeHtml(purchase.editBy)}</div></div>` : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th class="text-center">#</th>
          <th>Product / Barcode</th>
          <th class="text-center">Qty</th>
          <th class="text-right">Unit Cost</th>
          <th class="text-right">Discount</th>
          <th class="text-right">VAT / Tax</th>
          <th class="text-right">Line Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="summary-box avoid-break">
      <div class="summary-row"><span>Total Items / Net Qty:</span><span class="num">${purchase.items.length} / ${purchase.items.reduce((s, i) => s + i.quantity, 0)}</span></div>
      <div class="summary-row"><span>Subtotal:</span><span class="num">${formatRs(purchase.subtotal)}</span></div>
      <div class="summary-row"><span>Discount:</span><span class="num">-${formatRs(purchase.totalDiscount || 0)}</span></div>
      <div class="summary-row"><span>Tax / VAT:</span><span class="num">${formatRs(purchase.totalTax || 0)}</span></div>
      <div class="summary-row grand-row"><span>GRAND TOTAL:</span><span>${formatRs(purchase.grandTotal)}</span></div>
      <div class="summary-row"><span>Amount Paid (${escapeHtml(purchase.paymentMethod)}):</span><span class="num">${formatRs(purchase.amountPaid)}</span></div>
      <div class="summary-row"><span>Remaining Payable:</span><span class="num">${formatRs(purchase.remainingBalance)}</span></div>
      ${purchase.notes ? `<div style="margin-top:6px;font-size:10px;color:#475569;">Notes: ${escapeHtml(purchase.notes)}</div>` : ''}
    </div>

    <div class="footer-note">WAQAS POS SOFTWARE · Purchase Stock Reconciliation Voucher</div>
  `;

  const escLines = [
    branding?.storeName || 'WAQAS MART',
    hasNegative ? 'PURCHASE / STOCK ADJUSTMENT' : 'PURCHASE INVOICE',
    `Inv: ${purchase.purchaseInvoiceNo}`,
    `Date: ${purchase.purchaseDate}`,
    `Supplier: ${purchase.supplierName}`,
    purchase.userName ? `User: ${purchase.userName}` : '',
    '--------------------------------',
    ...purchase.items.map((it) => `${it.productName.slice(0, 18)} x${it.quantity} = ${it.lineTotal.toFixed(0)}`),
    '--------------------------------',
    `Grand Total: Rs. ${purchase.grandTotal.toFixed(0)}`,
    `Paid:        Rs. ${purchase.amountPaid.toFixed(0)}`,
    `Remaining:   Rs. ${purchase.remainingBalance.toFixed(0)}`,
  ].filter(Boolean);

  return executeThermalOrHtmlPrint(
    buildPrintableHtmlDocument(body, { paperSize: paper, title: `Purchase ${purchase.purchaseInvoiceNo}` }),
    escLines
  );
}

// ============================================================================
// 3. PURCHASE RETURN RECEIPT & REPORT
// ============================================================================
export async function printPurchaseReturnReceipt(
  ret: PurchaseReturn,
  branding?: StoreBranding,
  paperOverride?: PrinterPaperSize
): Promise<PrintExecutionResult> {
  const settings = loadPrinterSettings();
  const paper = paperOverride || settings.defaultReportSize || 'a4';
  const rows = ret.items
    .map(
      (it, idx) => `
      <tr>
        <td class="text-center">${idx + 1}</td>
        <td><strong>${escapeHtml(it.productName)}</strong>${it.reason ? `<div style="font-size:9px;color:#64748b;">Reason: ${escapeHtml(it.reason)}</div>` : ''}</td>
        <td class="text-center num">${it.quantity}</td>
        <td class="text-right num">${formatRs(it.purchasePrice)}</td>
        <td class="text-right num">${formatRs(it.lineTotal)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">PURCHASE RETURN RECEIPT</span>
    </div>
    <div class="meta-grid">
      <div><div class="meta-label">Return #</div><div class="meta-value">${escapeHtml(ret.returnNumber)}</div></div>
      <div><div class="meta-label">Date</div><div class="meta-value">${escapeHtml(ret.date)}</div></div>
      <div><div class="meta-label">Supplier</div><div class="meta-value">${escapeHtml(ret.supplierName)}</div></div>
      <div><div class="meta-label">Orig Purchase #</div><div class="meta-value">${escapeHtml(ret.originalInvoiceNumber || 'N/A')}</div></div>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Product</th><th class="text-center">Returned Qty</th><th class="text-right">Cost Price</th><th class="text-right">Refund Total</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary-box avoid-break">
      <div class="summary-row"><span>Settlement Method:</span><span class="num">${ret.refundType === 'reduce_payable' ? 'Reduce Supplier Payable' : 'Cash Refund Received'}</span></div>
      <div class="summary-row grand-row"><span>TOTAL RETURN AMOUNT:</span><span>${formatRs(ret.totalRefund)}</span></div>
      ${ret.notes ? `<div style="margin-top:4px;font-size:10px;">Notes: ${escapeHtml(ret.notes)}</div>` : ''}
    </div>
    <div class="footer-note">WAQAS POS SOFTWARE · Purchase Return Stock Deduction Receipt</div>
  `;

  const escLines = [
    branding?.storeName || 'WAQAS MART',
    'PURCHASE RETURN RECEIPT',
    `Return #: ${ret.returnNumber}`,
    `Date: ${ret.date}`,
    `Supplier: ${ret.supplierName}`,
    '--------------------------------',
    ...ret.items.map((it) => `${it.productName.slice(0, 18)} x${it.quantity} = ${it.lineTotal.toFixed(0)}`),
    '--------------------------------',
    `Total Return: Rs. ${ret.totalRefund.toFixed(0)}`,
  ];

  return executeThermalOrHtmlPrint(
    buildPrintableHtmlDocument(body, { paperSize: paper, title: `Purchase Return ${ret.returnNumber}` }),
    escLines
  );
}

export async function printPurchaseReturnsSummaryReport(
  returns: PurchaseReturn[],
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const totalRefund = returns.reduce((s, r) => s + r.totalRefund, 0);
  const rows = returns
    .map(
      (r, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td><strong>${escapeHtml(r.returnNumber)}</strong></td>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.supplierName)}</td>
        <td>${escapeHtml(r.originalInvoiceNumber || '-')}</td>
        <td class="text-center num">${r.items.reduce((s, it) => s + it.quantity, 0)}</td>
        <td class="text-right num">${formatRs(r.totalRefund)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">PURCHASE RETURNS REGISTER</span>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Return #</th><th>Date</th><th>Supplier</th><th>Orig Bill</th><th class="text-center">Items Qty</th><th class="text-right">Total Amount</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6" class="text-right">TOTAL PURCHASE RETURNS (${returns.length})</td><td class="text-right num">${formatRs(totalRefund)}</td></tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'Purchase Returns Report' }));
}

// ============================================================================
// 4. CUSTOMER UDHAAR LEDGER (INDIVIDUAL & ALL CUSTOMERS)
// ============================================================================
export async function printCustomerLedgerReport(
  customer: Customer,
  entries: CustomerLedgerEntry[],
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  let running = Number(customer.previousBalance) || 0;
  const rows = entries
    .map((e, idx) => {
      running = running + (Number(e.credit) || 0) - (Number(e.debit) || 0);
      return `
        <tr>
          <td class="text-center">${idx + 1}</td>
          <td>${escapeHtml(e.date)}</td>
          <td>${escapeHtml(e.details)}${e.invoiceNumber ? ` <small>(#${escapeHtml(e.invoiceNumber)})</small>` : ''}</td>
          <td class="text-right num">${e.credit > 0 ? formatRs(e.credit) : '-'}</td>
          <td class="text-right num">${e.debit > 0 ? formatRs(e.debit) : '-'}</td>
          <td class="text-right num">${formatRs(running)}</td>
        </tr>`;
    })
    .join('');

  const totalCredit = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
  const totalDebit = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">CUSTOMER UDHAAR LEDGER (کھاتہ بیان)</span>
    </div>
    <div class="meta-grid">
      <div><div class="meta-label">Customer Name</div><div class="meta-value">${escapeHtml(customer.name)}</div></div>
      <div><div class="meta-label">Phone</div><div class="meta-value">${escapeHtml(customer.phone || 'N/A')}</div></div>
      <div><div class="meta-label">Opening Balance</div><div class="meta-value">${formatRs(customer.previousBalance || 0)}</div></div>
      <div><div class="meta-label">Current Receivable</div><div class="meta-value">${formatRs(running)}</div></div>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Date</th><th>Details</th><th class="text-right">Udhaar (+)</th><th class="text-right">Recovery (-)</th><th class="text-right">Balance</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="text-right">TOTALS</td>
          <td class="text-right num">${formatRs(totalCredit)}</td>
          <td class="text-right num">${formatRs(totalDebit)}</td>
          <td class="text-right num">${formatRs(running)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="footer-note">Printed on ${new Date().toLocaleString('en-PK')} · WAQAS POS SOFTWARE</div>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: `Customer Ledger - ${customer.name}` }));
}

export async function printAllCustomersLedgerSummary(
  customers: Array<Customer & { totalCredit: number; totalDebit: number; currentBalance: number }>,
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const grandTotalBalance = customers.reduce((s, c) => s + c.currentBalance, 0);
  const rows = customers
    .map(
      (c, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone || '-')}</td>
        <td class="text-right num">${formatRs(c.previousBalance || 0)}</td>
        <td class="text-right num">${formatRs(c.totalCredit)}</td>
        <td class="text-right num">${formatRs(c.totalDebit)}</td>
        <td class="text-right num">${formatRs(c.currentBalance)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">ALL CUSTOMERS UDHAAR SUMMARY</span>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Customer Name</th><th>Phone</th><th class="text-right">Opening</th><th class="text-right">Total Udhaar</th><th class="text-right">Recovered</th><th class="text-right">Net Balance</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6" class="text-right">TOTAL MARKET RECEIVABLE (${customers.length} Customers)</td><td class="text-right num">${formatRs(grandTotalBalance)}</td></tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'All Customers Udhaar Report' }));
}

// ============================================================================
// 5. SUPPLIER LEDGER (INDIVIDUAL & ALL SUPPLIERS)
// ============================================================================
export async function printSupplierLedgerReport(
  supplier: Supplier,
  entries: Array<{ date: string; description: string; invoiceNumber?: string; credit: number; debit: number; runningBalance: number }>,
  currentPayable: number,
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const totalCredit = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
  const totalDebit = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
  const rows = entries
    .map(
      (e, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td>${escapeHtml(e.date)}</td>
        <td>${escapeHtml(e.description)}</td>
        <td>${escapeHtml(e.invoiceNumber || '-')}</td>
        <td class="text-right num">${e.credit > 0 ? formatRs(e.credit) : '-'}</td>
        <td class="text-right num">${e.debit > 0 ? formatRs(e.debit) : '-'}</td>
        <td class="text-right num">${formatRs(e.runningBalance)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">SUPPLIER LEDGER STATEMENT</span>
    </div>
    <div class="meta-grid">
      <div><div class="meta-label">Supplier</div><div class="meta-value">${escapeHtml(supplier.name)}</div></div>
      <div><div class="meta-label">Phone</div><div class="meta-value">${escapeHtml(supplier.phone || 'N/A')}</div></div>
      <div><div class="meta-label">Total Billed</div><div class="meta-value">${formatRs(totalCredit)}</div></div>
      <div><div class="meta-label">Net Payable</div><div class="meta-value">${formatRs(currentPayable)}</div></div>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Date</th><th>Description</th><th>Ref #</th><th class="text-right">Bill (+)</th><th class="text-right">Paid (-)</th><th class="text-right">Payable</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" class="text-right">TOTALS</td>
          <td class="text-right num">${formatRs(totalCredit)}</td>
          <td class="text-right num">${formatRs(totalDebit)}</td>
          <td class="text-right num">${formatRs(currentPayable)}</td>
        </tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: `Supplier Ledger - ${supplier.name}` }));
}

export async function printAllSuppliersSummary(
  suppliers: Array<Supplier & { computedPayable: number }>,
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const total = suppliers.reduce((s, sup) => s + sup.computedPayable, 0);
  const rows = suppliers
    .map(
      (sup, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td><strong>${escapeHtml(sup.name)}</strong></td>
        <td>${escapeHtml(sup.phone || '-')}</td>
        <td>${escapeHtml(sup.city || '-')}</td>
        <td class="text-right num">${formatRs(sup.computedPayable)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">ALL SUPPLIERS PAYABLES REPORT</span>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Supplier Name</th><th>Phone</th><th>City</th><th class="text-right">Net Payable</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4" class="text-right">TOTAL PAYABLE BALANCE</td><td class="text-right num">${formatRs(total)}</td></tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'All Suppliers Report' }));
}

// ============================================================================
// 6. DAILY HISAB REPORT (ALL 11 COLUMNS, A4 LANDSCAPE)
// ============================================================================
export async function printDailyHisabReport(
  monthLabel: string,
  rowsData: DailyHisabRow[],
  totals: {
    sale: number;
    purchase: number;
    extra: number;
    credit: number;
    recovery: number;
    kitchen: number;
    expenses: number;
    closingCash: number;
  },
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const rowsHtml = rowsData
    .map(
      (r) => `
      <tr>
        <td class="text-right num">${r.openingCash.toLocaleString()}</td>
        <td class="text-center"><strong>${escapeHtml(r.date)}</strong></td>
        <td class="text-right num">${r.dailySale.toLocaleString()}</td>
        <td class="text-right num">${r.dailyPurchase.toLocaleString()}</td>
        <td class="text-right num">${r.dailyExtra.toLocaleString()}</td>
        <td class="text-right num">${r.dailyCredit.toLocaleString()}</td>
        <td class="text-right num">${r.dailyRecovery.toLocaleString()}</td>
        <td class="text-right num">${r.dailyKitchen.toLocaleString()}</td>
        <td class="text-right num">${r.dailyExpenses.toLocaleString()}</td>
        <td>${escapeHtml(r.details || '')}</td>
        <td class="text-right num"><strong>${r.closingCash.toLocaleString()}</strong></td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">DAILY HISAB REGISTER — ${escapeHtml(monthLabel)}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th class="text-right">Opening Cash</th>
          <th class="text-center">Date</th>
          <th class="text-right">Daily Sale</th>
          <th class="text-right">Daily Purchase</th>
          <th class="text-right">Daily Extra</th>
          <th class="text-right">Daily Credit</th>
          <th class="text-right">Daily Recovery</th>
          <th class="text-right">Daily Kitchen</th>
          <th class="text-right">Daily Expenses</th>
          <th>Details</th>
          <th class="text-right">Closing Cash</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td></td>
          <td class="text-center">MONTHLY TOTAL</td>
          <td class="text-right num">${totals.sale.toLocaleString()}</td>
          <td class="text-right num">${totals.purchase.toLocaleString()}</td>
          <td class="text-right num">${totals.extra.toLocaleString()}</td>
          <td class="text-right num">${totals.credit.toLocaleString()}</td>
          <td class="text-right num">${totals.recovery.toLocaleString()}</td>
          <td class="text-right num">${totals.kitchen.toLocaleString()}</td>
          <td class="text-right num">${totals.expenses.toLocaleString()}</td>
          <td>End Cash</td>
          <td class="text-right num">${totals.closingCash.toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>
    <div class="footer-note">WAQAS POS SOFTWARE · Printed ${new Date().toLocaleString('en-PK')}</div>
  `;

  return printHtmlDocument(
    buildPrintableHtmlDocument(body, {
      paperSize: 'a4',
      orientation: 'landscape',
      title: `Daily Hisab - ${monthLabel}`,
    })
  );
}

// ============================================================================
// 7. EXPENSES REPORT
// ============================================================================
export async function printExpenseReport(
  expenses: ExpenseEntry[],
  filterLabel: string,
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const rows = expenses
    .map(
      (e, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td>${escapeHtml(e.date)}</td>
        <td><strong>${escapeHtml(e.category)}</strong></td>
        <td>${escapeHtml(e.description)}</td>
        <td>${escapeHtml(e.paidTo || '-')}</td>
        <td class="text-center">${escapeHtml(e.paymentMethod.toUpperCase())}</td>
        <td class="text-right num">${formatRs(e.amount)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">EXPENSES REPORT (${escapeHtml(filterLabel)})</span>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Date</th><th>Category</th><th>Description</th><th>Paid To</th><th class="text-center">Method</th><th class="text-right">Amount</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6" class="text-right">TOTAL EXPENSES (${expenses.length} Entries)</td><td class="text-right num">${formatRs(total)}</td></tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'Expense Report' }));
}

// ============================================================================
// 8. STOCK REPORT (TOTAL STOCK / SUMMARY) & PRODUCTS LIST
// ============================================================================
export async function printStockReport(
  products: Product[],
  filterLabel: string,
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const totalQty = products.reduce((s, p) => s + (Number(p.stock) || 0), 0);
  const totalCostVal = products.reduce((s, p) => s + Math.max(0, Number(p.stock) || 0) * (Number(p.costPrice) || 0), 0);
  const totalSaleVal = products.reduce((s, p) => s + Math.max(0, Number(p.stock) || 0) * (Number(p.price) || 0), 0);

  const rows = products
    .map(
      (p, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td><strong>${escapeHtml(p.name)}</strong>${p.barcode ? `<div style="font-size:9px;color:#64748b;">${escapeHtml(p.barcode)}</div>` : ''}</td>
        <td>${escapeHtml(p.category)}</td>
        <td class="text-center num">${p.stock} ${escapeHtml(p.unit || 'Pcs')}</td>
        <td class="text-right num">${formatRs(p.costPrice)}</td>
        <td class="text-right num">${formatRs(p.price)}</td>
        <td class="text-right num">${formatRs(Math.max(0, p.stock) * p.costPrice)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">STOCK INVENTORY REPORT (${escapeHtml(filterLabel)})</span>
    </div>
    <div class="meta-grid">
      <div><div class="meta-label">Total Products</div><div class="meta-value">${products.length}</div></div>
      <div><div class="meta-label">Total Stock Units</div><div class="meta-value">${totalQty.toLocaleString()}</div></div>
      <div><div class="meta-label">Cost Valuation</div><div class="meta-value">${formatRs(totalCostVal)}</div></div>
      <div><div class="meta-label">Retail Valuation</div><div class="meta-value">${formatRs(totalSaleVal)}</div></div>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Product & Barcode</th><th>Category</th><th class="text-center">Current Stock</th><th class="text-right">Cost Price</th><th class="text-right">Sale Price</th><th class="text-right">Stock Value</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="3" class="text-right">TOTALS</td><td class="text-center num">${totalQty}</td><td></td><td></td><td class="text-right num">${formatRs(totalCostVal)}</td></tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'Stock Valuation Report' }));
}

export async function printProductList(
  products: Product[],
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const rows = products
    .map(
      (p, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td style="font-family:monospace;">${escapeHtml(p.barcode || p.sku || '-')}</td>
        <td><strong>${escapeHtml(p.name)}</strong>${p.urduName ? ` <span class="font-urdu">(${escapeHtml(p.urduName)})</span>` : ''}</td>
        <td>${escapeHtml(p.category)}</td>
        <td class="text-center">${escapeHtml(p.unit || 'Pcs')}</td>
        <td class="text-right num">${formatRs(p.costPrice)}</td>
        <td class="text-right num">${formatRs(p.price)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">COMPLETE PRODUCT CATALOG LIST (${products.length} ITEMS)</span>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Barcode / SKU</th><th>Product Name</th><th>Category</th><th class="text-center">Unit</th><th class="text-right">Cost Rate</th><th class="text-right">Sale Rate</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer-note">WAQAS POS SOFTWARE · Product Price Catalog · ${new Date().toLocaleDateString('en-GB')}</div>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'Product Catalog List' }));
}

// ============================================================================
// 9. REPORTS — SALES, PURCHASE & PROFIT REPORTS
// ============================================================================
export async function printSalesProfitReport(
  params: {
    reportTitle: string;
    dateLabel: string;
    totalRevenue: number;
    totalCogs: number;
    grossProfit: number;
    netProfit: number;
    totalRefunds: number;
    totalPurchaseSpend: number;
    transactions: SaleTransaction[];
    purchases: PurchaseTransaction[];
  },
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const saleRows = params.transactions
    .map(
      (tx, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td style="font-family:monospace;">${escapeHtml(tx.invoiceNumber)}</td>
        <td>${escapeHtml(tx.dateTime)}</td>
        <td>${escapeHtml(tx.customerName || 'Walk-in Customer')}</td>
        <td class="text-center">${escapeHtml(tx.paymentMethod.toUpperCase())}</td>
        <td class="text-right num">${formatRs(tx.grandTotal)}</td>
      </tr>`
    )
    .join('');

  const purchaseRows = params.purchases
    .map(
      (p, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td style="font-family:monospace;">${escapeHtml(p.purchaseInvoiceNo)}</td>
        <td>${escapeHtml(p.purchaseDate)}</td>
        <td>${escapeHtml(p.supplierName)}</td>
        <td class="text-right num">${formatRs(p.grandTotal)}</td>
        <td class="text-right num">${formatRs(p.remainingBalance)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">${escapeHtml(params.reportTitle)} (${escapeHtml(params.dateLabel)})</span>
    </div>
    <div class="meta-grid">
      <div><div class="meta-label">Total Sales</div><div class="meta-value">${formatRs(params.totalRevenue)}</div></div>
      <div><div class="meta-label">Purchase Spend</div><div class="meta-value">${formatRs(params.totalPurchaseSpend)}</div></div>
      <div><div class="meta-label">Cost of Goods</div><div class="meta-value">${formatRs(params.totalCogs)}</div></div>
      <div><div class="meta-label">Net Profit</div><div class="meta-value">${formatRs(params.netProfit)}</div></div>
    </div>

    <h3 style="margin:8px 0 4px;font-size:12px;color:#064e3b;">Sales Invoices (${params.transactions.length})</h3>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Invoice #</th><th>Date & Time</th><th>Customer</th><th class="text-center">Payment</th><th class="text-right">Grand Total</th></tr>
      </thead>
      <tbody>${saleRows || '<tr><td colspan="6" class="text-center">No sales in selected period</td></tr>'}</tbody>
    </table>

    <h3 style="margin:12px 0 4px;font-size:12px;color:#064e3b;">Purchase Invoices (${params.purchases.length})</h3>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>Purchase Inv #</th><th>Date</th><th>Supplier</th><th class="text-right">Grand Total</th><th class="text-right">Payable</th></tr>
      </thead>
      <tbody>${purchaseRows || '<tr><td colspan="6" class="text-center">No purchases recorded</td></tr>'}</tbody>
    </table>

    <div class="summary-box avoid-break">
      <div class="summary-row"><span>Gross Revenue:</span><span class="num">${formatRs(params.totalRevenue)}</span></div>
      <div class="summary-row"><span>Sales Refunds:</span><span class="num">-${formatRs(params.totalRefunds)}</span></div>
      <div class="summary-row"><span>Gross Profit:</span><span class="num">${formatRs(params.grossProfit)}</span></div>
      <div class="summary-row grand-row"><span>NET BUSINESS PROFIT:</span><span>${formatRs(params.netProfit)}</span></div>
    </div>
  `;

  return printHtmlDocument(
    buildPrintableHtmlDocument(body, { paperSize: 'a4', title: params.reportTitle })
  );
}

// ============================================================================
// 10. STAFF DIRECTORY PRINT
// ============================================================================
export async function printStaffDirectoryReport(
  staffList: StaffMember[],
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const totalPayroll = staffList.reduce((s, m) => s + (Number(m.salary) || 0), 0);
  const rows = staffList
    .map(
      (s, i) => `
      <tr>
        <td class="text-center">${i + 1}</td>
        <td style="font-family:monospace;">${escapeHtml(s.employeeId)}</td>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>${escapeHtml(s.role)}</td>
        <td>${escapeHtml(s.shift)}</td>
        <td>${escapeHtml(s.phone)}</td>
        <td class="text-right num">${formatRs(s.salary)}</td>
      </tr>`
    )
    .join('');

  const body = `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(branding?.storeName || 'WAQAS MART')}</h1>
      <span class="doc-badge">STAFF DIRECTORY & PAYROLL SUMMARY</span>
    </div>
    <table>
      <thead>
        <tr><th class="text-center">#</th><th>EMP ID</th><th>Name</th><th>Role</th><th>Shift</th><th>Phone</th><th class="text-right">Monthly Salary</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6" class="text-right">TOTAL MONTHLY PAYROLL (${staffList.length} Staff)</td><td class="text-right num">${formatRs(totalPayroll)}</td></tr>
      </tfoot>
    </table>
  `;
  return printHtmlDocument(buildPrintableHtmlDocument(body, { paperSize: 'a4', title: 'Staff Directory Report' }));
}

// ============================================================================
// 11. TEST PRINT (FOR PRINTER SETTINGS MODAL)
// ============================================================================
export async function runTestPrint(
  settings: PrinterSettings,
  branding?: StoreBranding
): Promise<PrintExecutionResult> {
  const paper = settings.defaultReceiptSize || '80mm';
  const storeName = branding?.storeName || 'WAQAS MART';
  const html = buildPrintableHtmlDocument(
    `
    <div class="header-box">
      <h1 class="store-title">${escapeHtml(storeName)}</h1>
      <span class="doc-badge">PRINTER TEST PRINT</span>
    </div>
    <div class="summary-box">
      <div class="summary-row"><span>Status:</span><strong>CONNECTION VERIFIED</strong></div>
      <div class="summary-row"><span>Printer Mode:</span><strong>${escapeHtml(settings.connectionType.toUpperCase())}</strong></div>
      <div class="summary-row"><span>Selected Printer:</span><strong>${escapeHtml(settings.printerName)}</strong></div>
      <div class="summary-row"><span>Paper Size:</span><strong>${escapeHtml(paper.toUpperCase())}</strong></div>
      <div class="summary-row"><span>Time:</span><strong>${new Date().toLocaleString('en-PK')}</strong></div>
    </div>
    <div class="footer-note">WAQAS POS SOFTWARE · If you can read this clearly, printing is properly calibrated.</div>
    `,
    { paperSize: paper, title: 'WAQAS POS Test Print' }
  );

  const escLines = [
    storeName.toUpperCase(),
    'PRINTER TEST PRINT - OK',
    '--------------------------------',
    `Mode: ${settings.connectionType.toUpperCase()}`,
    `Paper: ${paper.toUpperCase()}`,
    `Time: ${new Date().toLocaleString('en-PK')}`,
    '--------------------------------',
    'Alignment & Feed Check OK!',
  ];

  return executeThermalOrHtmlPrint(html, escLines, settings.connectionType);
}
