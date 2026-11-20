import React, { useEffect, useState } from 'react';
import {
  X,
  Printer,
  Bluetooth,
  Usb,
  Wifi,
  CheckCircle2,
  AlertCircle,
  Eye,
  Play,
  Unplug,
  Sliders,
} from 'lucide-react';
import {
  DEFAULT_RECEIPT_SETTINGS,
  PrinterConnectionType,
  PrinterPaperSize,
  PrinterSettings,
  StoreBranding,
} from '../types/pos';
import {
  buildSaleReceiptHtml,
  connectBluetoothThermalPrinter,
  connectUsbOrSerialPrinter,
  disconnectBluetoothPrinter,
  disconnectUsbOrSerialPrinter,
  getPrinterHardwareStatus,
  loadPrinterSettings,
  runTestPrint,
  savePrinterSettings,
} from '../utils/printerService';
import { FullScreenPageHeader } from './FullScreenPageHeader';

interface PrinterSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  branding?: StoreBranding;
  onSettingsUpdated?: (settings: PrinterSettings) => void;
  asPage?: boolean;
}

export const PrinterSettingsModal: React.FC<PrinterSettingsModalProps> = ({
  isOpen,
  onClose,
  branding,
  onSettingsUpdated,
  asPage = false,
}) => {
  const [settings, setSettings] = useState<PrinterSettings>(() => loadPrinterSettings());
  const [hwStatus, setHwStatus] = useState(() => getPrinterHardwareStatus());
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSettings(loadPrinterSettings());
      setHwStatus(getPrinterHardwareStatus());
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const updateAndSave = (next: PrinterSettings) => {
    setSettings(next);
    savePrinterSettings(next);
    onSettingsUpdated?.(next);
  };

  const handleConnectBluetooth = async () => {
    setIsConnecting(true);
    setFeedback(null);
    const res = await connectBluetoothThermalPrinter();
    setHwStatus(getPrinterHardwareStatus());
    const reloaded = loadPrinterSettings();
    setSettings(reloaded);
    onSettingsUpdated?.(reloaded);
    setFeedback({ type: res.ok ? 'success' : 'error', text: res.message });
    setIsConnecting(false);
  };

  const handleConnectUsb = async () => {
    setIsConnecting(true);
    setFeedback(null);
    const res = await connectUsbOrSerialPrinter();
    setHwStatus(getPrinterHardwareStatus());
    const reloaded = loadPrinterSettings();
    setSettings(reloaded);
    onSettingsUpdated?.(reloaded);
    setFeedback({ type: res.ok ? 'success' : 'error', text: res.message });
    setIsConnecting(false);
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    setFeedback(null);
    savePrinterSettings(settings);
    const res = await runTestPrint(settings, branding);
    setFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.message,
    });
    setIsTesting(false);
  };

  const previewHtml = buildSaleReceiptHtml(
    {
      invoiceNumber: 'SAMPLE-PRINT-CHECK',
      dateTime: new Date().toLocaleString('en-PK'),
      mode: 'sale',
      items: [
        {
          id: 'preview-1',
          product: {
            id: 'preview-p1',
            barcode: '000001',
            name: 'Sample Thermal Line Check',
            category: 'Check',
            price: 100,
            costPrice: 80,
            stock: 1,
            unit: 'Pcs',
          },
          quantity: 1,
          unitPrice: 100,
          discountAmount: 0,
          lineTotal: 100,
        },
      ],
      subtotal: 100,
      discount: 0,
      taxAmount: 0,
      grandTotal: 100,
      paymentMethod: 'cash',
      cashTendered: 100,
      changeDue: 0,
      cashierName: 'Counter 01',
      status: 'completed',
    },
    branding,
    { ...DEFAULT_RECEIPT_SETTINGS, paperSize: settings.defaultReceiptSize },
    settings.defaultReceiptSize
  );

  return (
    <div
      className={
        asPage
          ? 'flex-1 min-h-full w-full bg-slate-50 flex flex-col font-sans'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-xs overflow-y-auto'
      }
    >
      {asPage && (
        <FullScreenPageHeader
          title="Printer Settings"
          subtitle="58mm / 80mm تھرمل، A4 لیزر پرنٹر، بلیوٹوتھ، یو ایس بی اور وائی فائی سیٹنگز"
          icon={<Printer className="w-5 h-5 text-emerald-600" />}
          onBackToHome={onClose}
          accentColor="emerald"
        />
      )}
      <div
        className={
          asPage
            ? 'w-full max-w-6xl mx-auto my-4 rounded-3xl bg-white shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1'
            : 'w-full max-w-4xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[94vh]'
        }
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-[#064e3b] via-[#047857] to-[#0284c7] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight">
                Printer System Settings (پرنٹر سیٹنگز)
              </h2>
              <p className="text-xs text-emerald-100">
                58mm, 80mm Thermal & A4 Report Printing · Bluetooth, USB & Wi-Fi / Android
              </p>
            </div>
          </div>
          {!asPage && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-white/15 text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 bg-slate-50">
          {/* Left Column: Controls */}
          <div className="lg:col-span-7 space-y-4">
            {feedback && (
              <div
                className={`p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs font-bold ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : feedback.type === 'error'
                    ? 'bg-red-50 border-red-300 text-red-900'
                    : 'bg-blue-50 border-blue-300 text-blue-900'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Connection Method */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-emerald-600" />
                1. Printer Connection Type
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'system', label: 'System / Wi-Fi', icon: Wifi },
                    { id: 'bluetooth', label: 'Bluetooth', icon: Bluetooth },
                    { id: 'usb', label: 'USB / Serial', icon: Usb },
                    { id: 'network', label: 'LAN / IP', icon: Printer },
                  ] as Array<{ id: PrinterConnectionType; label: string; icon: any }>
                ).map((item) => {
                  const Icon = item.icon;
                  const active = settings.connectionType === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        updateAndSave({
                          ...settings,
                          connectionType: item.id,
                          printerName:
                            item.id === 'system'
                              ? 'System / Wi-Fi / Android Default Printer'
                              : settings.printerName,
                        })
                      }
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5 ${
                        active
                          ? 'bg-emerald-50 border-emerald-600 text-emerald-900 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${active ? 'text-emerald-700' : 'text-slate-500'}`} />
                      <span className="text-xs font-black">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Connection Specific Actions */}
              {settings.connectionType === 'bluetooth' && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-black text-blue-950">
                      {hwStatus.bluetoothConnected
                        ? `Connected: ${hwStatus.bluetoothDeviceName || 'Thermal Printer'}`
                        : 'No Bluetooth printer connected'}
                    </div>
                    <div className="text-[11px] text-blue-700">
                      {hwStatus.bluetoothSupported
                        ? 'Works in Chrome on Android & Desktop for 58mm/80mm ESC/POS.'
                        : 'Web Bluetooth unavailable on this browser. Switch to System / Wi-Fi mode.'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hwStatus.bluetoothConnected && (
                      <button
                        type="button"
                        onClick={async () => {
                          await disconnectBluetoothPrinter();
                          setHwStatus(getPrinterHardwareStatus());
                          setFeedback({ type: 'info', text: 'Bluetooth printer disconnected.' });
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 font-bold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        Disconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleConnectBluetooth}
                      disabled={isConnecting}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                    >
                      {isConnecting ? 'Pairing...' : 'Select Bluetooth Printer'}
                    </button>
                  </div>
                </div>
              )}

              {settings.connectionType === 'usb' && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="font-black text-emerald-950">
                      {hwStatus.usbConnected
                        ? `Connected: ${hwStatus.usbDeviceName || 'USB Printer'}`
                        : 'No USB / Serial printer connected'}
                    </div>
                    <div className="text-[11px] text-emerald-700">
                      {hwStatus.usbSupported || hwStatus.serialSupported
                        ? 'Select your USB thermal printer via browser permissions.'
                        : 'Direct WebUSB not available here. System Print works with any installed OS USB driver.'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hwStatus.usbConnected && (
                      <button
                        type="button"
                        onClick={async () => {
                          await disconnectUsbOrSerialPrinter();
                          setHwStatus(getPrinterHardwareStatus());
                          setFeedback({ type: 'info', text: 'USB printer disconnected.' });
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 font-bold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Unplug className="w-3.5 h-3.5" />
                        Disconnect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleConnectUsb}
                      disabled={isConnecting}
                      className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                    >
                      {isConnecting ? 'Connecting...' : 'Select USB Printer'}
                    </button>
                  </div>
                </div>
              )}

              {settings.connectionType === 'network' && (
                <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Wi-Fi / LAN Printer IP Address
                    </label>
                    <input
                      type="text"
                      value={settings.networkPrinterHost || ''}
                      onChange={(e) =>
                        updateAndSave({
                          ...settings,
                          networkPrinterHost: e.target.value,
                          printerName: e.target.value ? `Wi-Fi (${e.target.value})` : 'Wi-Fi / LAN Printer',
                        })
                      }
                      placeholder="192.168.1.200"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">Port</label>
                    <input
                      type="number"
                      value={settings.networkPrinterPort || 9100}
                      onChange={(e) =>
                        updateAndSave({
                          ...settings,
                          networkPrinterPort: Number(e.target.value) || 9100,
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Paper Sizes */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                2. Paper Size & Calibration
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Thermal Receipt Size (Sales & Slips)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['58mm', '80mm', 'a4'] as PrinterPaperSize[]).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => updateAndSave({ ...settings, defaultReceiptSize: sz })}
                        className={`py-2 px-2 rounded-xl text-xs font-black border cursor-pointer ${
                          settings.defaultReceiptSize === sz
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-white'
                        }`}
                      >
                        {sz.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    Reports, Ledgers & Invoices
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['a4', '80mm'] as const).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => updateAndSave({ ...settings, defaultReportSize: sz })}
                        className={`py-2 px-2 rounded-xl text-xs font-black border cursor-pointer ${
                          settings.defaultReportSize === sz
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-white'
                        }`}
                      >
                        {sz.toUpperCase()} {sz === 'a4' ? '(Standard)' : '(Roll)'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100 text-xs">
                <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoCut}
                    onChange={(e) => updateAndSave({ ...settings, autoCut: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Auto Paper Cut (ESC/POS)</span>
                </label>
                <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.openCashDrawer}
                    onChange={(e) => updateAndSave({ ...settings, openCashDrawer: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Open Cash Drawer on Sale</span>
                </label>
              </div>
            </div>

            {/* Active Printer Summary & Test Print */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase">Active Printer Profile</div>
                <div className="text-sm font-black text-slate-900">{settings.printerName}</div>
                <div className="text-xs text-slate-500">
                  Receipts: {settings.defaultReceiptSize.toUpperCase()} · Reports: {settings.defaultReportSize.toUpperCase()}
                </div>
              </div>
              <button
                type="button"
                onClick={handleTestPrint}
                disabled={isTesting}
                className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                <span>{isTesting ? 'Printing...' : 'Send Test Print'}</span>
              </button>
            </div>
          </div>

          {/* Right Column: Live Print Preview */}
          <div className="lg:col-span-5 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-blue-600" />
                Live Print Preview ({settings.defaultReceiptSize.toUpperCase()})
              </span>
              <span className="text-[11px] font-bold text-slate-500">Exact Print Output</span>
            </div>
            <div className="flex-1 bg-slate-200/70 p-3 flex justify-center overflow-auto min-h-[340px]">
              <iframe
                title="Printer Settings Live Preview"
                srcDoc={previewHtml}
                className={`bg-white border border-slate-300 rounded-xl shadow-md h-[380px] ${
                  settings.defaultReceiptSize === '58mm'
                    ? 'w-[240px]'
                    : settings.defaultReceiptSize === '80mm'
                    ? 'w-[320px]'
                    : 'w-full'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs cursor-pointer"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
