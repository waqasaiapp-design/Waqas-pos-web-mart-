import React from 'react';
import { QrCode, Smartphone, ShieldCheck, ArrowRight, Camera, Laptop } from 'lucide-react';
import { DeviceInfo, StoreBranding } from '../types/pos';
import { FullScreenPageHeader } from './FullScreenPageHeader';

interface QrConnectionPageProps {
  currentDevice: DeviceInfo;
  branding: StoreBranding;
  onOpenGenerateQr: () => void;
  onOpenPairThisDevice: () => void;
  onNavigateDevices: () => void;
  onBackToHome: () => void;
}

export const QrConnectionPage: React.FC<QrConnectionPageProps> = ({
  currentDevice,
  branding,
  onOpenGenerateQr,
  onOpenPairThisDevice,
  onNavigateDevices,
  onBackToHome,
}) => {
  return (
    <div className="h-full flex flex-col w-full bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      <FullScreenPageHeader
        title="QR Code Connection"
        urduTitle="کیو آر کوڈ ملٹی ڈیوائس کنکشن"
        subtitle="Secure single-use QR pairing between Android phones, iPhones, tablets & PCs"
        icon={<QrCode className="w-5 h-5" />}
        storeName={branding?.storeName || 'WAQAS MART'}
        onBackToHome={onBackToHome}
        actions={
          <button
            type="button"
            onClick={onNavigateDevices}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span>Authorized Devices</span>
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-4xl mx-auto w-full space-y-5">
        <div className="bg-white rounded-3xl border border-emerald-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-black text-slate-900 uppercase">This Terminal Identity</h3>
              <p className="text-xs text-slate-600">
                <strong>{currentDevice.deviceName}</strong> · <span className="font-mono">{currentDevice.deviceId}</span>
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold self-start sm:self-center">
            Single-Use QR Tokens Enforced
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Option 1: Owner displays QR */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2.5">
              <div className="w-12 h-12 rounded-2xl bg-[#057a44] text-white flex items-center justify-center shadow-sm">
                <QrCode className="w-6 h-6" />
              </div>
              <h2 className="text-base font-black text-slate-900">Connect Another Device (Owner QR)</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Generate a time-limited single-use QR code and 6-digit pairing code on this terminal so another phone, tablet, or laptop can request access and sync live.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1 list-disc list-inside">
                <li>Each QR token expires automatically and cannot be reused after approval.</li>
                <li>Requires explicit Owner Approval before sharing database access.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={onOpenGenerateQr}
              className="w-full py-3 bg-[#057a44] hover:bg-[#046337] text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <QrCode className="w-4 h-4" />
              <span>Generate Pairing QR Code</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Option 2: Scan or enter 6-digit code */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-2.5">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-400 flex items-center justify-center shadow-sm">
                <Camera className="w-6 h-6" />
              </div>
              <h2 className="text-base font-black text-slate-900">Pair This Device To Owner Terminal</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Open your phone camera to scan the Owner&apos;s QR code or enter the 6-digit pairing code to connect this terminal directly to the central WAQAS MART database.
              </p>
              <ul className="text-[11px] text-slate-500 space-y-1 list-disc list-inside">
                <li>Camera scanning requires HTTPS or localhost permission.</li>
                <li>Use 6-digit manual code on desktop PCs without a camera.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={onOpenPairThisDevice}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Laptop className="w-4 h-4 text-amber-400" />
              <span>Scan QR / Enter Pairing Code</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
