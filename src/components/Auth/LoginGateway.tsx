import React, { useState, useEffect, useRef } from 'react';
import {
  Crown,
  Store,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  QrCode,
  RefreshCw,
  User,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import { AuthSession, BootstrapAuthStatus, DeviceInfo } from '../../types/pos';
import {
  getBootstrapStatus,
  getGoogleOAuthUrl,
  validateProvisionToken,
  provisionSuperAdminWithGoogle,
  loginSuperAdminWithGoogle,
  loginAccount,
  verifyGoogleIdToken,
} from '../../utils/authClient';
import {
  isFirebaseGoogleConfigured,
  signInWithFirebaseGooglePopup,
  signOutFirebaseQuietly,
} from '../../utils/firebaseClient';
import { PairDeviceModal } from '../PairDeviceModal';
import { PWAInstallButton } from '../PWAInstallButton';
import { BeforeInstallPromptEvent } from '../../hooks/usePWAInstall';

interface LoginGatewayProps {
  onLoginSuccess: (session: AuthSession) => void;
  onPairedSuccess: (device: DeviceInfo, storeState?: any) => void;
  initialNotice?: string | null;
  deferredPrompt?: BeforeInstallPromptEvent | null;
}

type GatewayView = 'welcome' | 'mart' | 'super_admin' | 'private_provision';

const GoogleMark: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const LoginGateway: React.FC<LoginGatewayProps> = ({
  onLoginSuccess,
  onPairedSuccess,
  initialNotice,
  deferredPrompt,
}) => {
  const [view, setView] = useState<GatewayView>('welcome');
  const [bootstrap, setBootstrap] = useState<BootstrapAuthStatus | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);

  // Mart Owner / Staff Login state
  const [martIdentifier, setMartIdentifier] = useState('');
  const [martPassword, setMartPassword] = useState('');
  const [showMartPassword, setShowMartPassword] = useState(false);

  // Super Admin Official Google + WAQAS POS Password Login state
  const [saPassword, setSaPassword] = useState('');
  const [showSaPassword, setShowSaPassword] = useState(false);
  const [googleAssertionToken, setGoogleAssertionToken] = useState<string | null>(null);
  const [verifiedGmail, setVerifiedGmail] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthMissingUrls, setOauthMissingUrls] = useState<{ dev: string; shared: string } | null>(null);

  // Private Initial Provisioning state (strictly gated by ?provision=<secret>)
  const [provisionToken, setProvisionToken] = useState<string | null>(null);
  const [provFullName, setProvFullName] = useState('Muhammad Waqas');
  const [provPassword, setProvPassword] = useState('');
  const [provConfirmPassword, setProvConfirmPassword] = useState('');
  const [showProvPassword, setShowProvPassword] = useState(false);

  // QR Pairing Modal state (opened only from Mart Login)
  const [isPairOpen, setIsPairOpen] = useState(false);

  // Global feedback
  const [error, setError] = useState<string | null>(initialNotice || null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [restrictedInfo, setRestrictedInfo] = useState<{ shopName?: string; status?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const popupRef = useRef<Window | null>(null);
  const activeOAuthPurposeRef = useRef<'login' | 'provision'>('login');

  const resetMessages = () => {
    setError(null);
    setSuccessMsg(null);
    setRestrictedInfo(null);
    setOauthMissingUrls(null);
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      setLoadingBootstrap(true);
      try {
        const status = await getBootstrapStatus();
        if (!active) return;
        setBootstrap(status);

        // Private initial provisioning check: only activates when valid ?provision=<token> URL param is provided
        const params = new URLSearchParams(window.location.search);
        const rawProv = params.get('provision');
        if (rawProv && !status.superAdminConfigured && !status.superAdminSetupLocked) {
          try {
            const check = await validateProvisionToken(rawProv);
            if (active && check.valid) {
              setProvisionToken(rawProv);
              setView('private_provision');
              return;
            }
          } catch {
            if (active) {
              setError('Private provisioning link is invalid or expired.');
            }
          }
        }
      } catch {
        // Leave welcome screen functional
      } finally {
        if (active) setLoadingBootstrap(false);
      }
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  // Listen for official Google OAuth popup postMessage callback
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const originOk =
        event.origin === window.location.origin ||
        event.origin.endsWith('.run.app') ||
        event.origin.startsWith('http://localhost') ||
        event.origin.startsWith('http://127.0.0.1');
      if (!originOk) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'GOOGLE_OAUTH_SUCCESS' && data.assertionToken) {
        setOauthPending(false);
        setOauthMissingUrls(null);
        setError(null);
        setGoogleAssertionToken(String(data.assertionToken));
        setVerifiedGmail(String(data.gmail || ''));
        if (data.purpose === 'provision' && data.fullName) {
          setProvFullName(String(data.fullName));
        }
        setSuccessMsg(`Google account verified: ${String(data.gmail || '')}`);
        try {
          popupRef.current?.close();
        } catch {}
      } else if (data.type === 'GOOGLE_OAUTH_ERROR') {
        setOauthPending(false);
        setGoogleAssertionToken(null);
        setVerifiedGmail(null);
        setSuccessMsg(null);
        setError(String(data.message || 'Google verification failed.'));
        try {
          popupRef.current?.close();
        } catch {}
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Poll popup closed state so button never remains stuck in pending state
  useEffect(() => {
    if (!oauthPending) return;
    const timer = window.setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        setOauthPending(false);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [oauthPending]);

  const refreshBootstrapStatus = async (): Promise<BootstrapAuthStatus | null> => {
    try {
      const status = await getBootstrapStatus();
      setBootstrap(status);
      return status;
    } catch {
      return null;
    }
  };

  const startGoogleOAuth = async (purpose: 'login' | 'provision') => {
    resetMessages();
    activeOAuthPurposeRef.current = purpose;
    setOauthPending(true);

    if (bootstrap?.firebaseGoogleAuthConfigured || isFirebaseGoogleConfigured()) {
      try {
        const gRes = await signInWithFirebaseGooglePopup();
        const verified = await verifyGoogleIdToken(gRes.idToken, purpose);
        setGoogleAssertionToken(verified.assertionToken);
        setVerifiedGmail(verified.gmail);
        if (purpose === 'provision' && verified.fullName) {
          setProvFullName(verified.fullName);
        }
        setSuccessMsg(`Google account verified: ${verified.gmail}`);
      } catch (err: any) {
        setGoogleAssertionToken(null);
        setVerifiedGmail(null);
        setSuccessMsg(null);
        const code = String(err?.code || '');
        if (code === 'auth/popup-closed-by-user') {
          setError('Google sign-in popup was closed before selecting your Google account.');
        } else if (code === 'auth/cancelled-popup-request') {
          setError('Previous Google sign-in window was cancelled. Please click Continue with Google again.');
        } else if (code === 'auth/popup-blocked') {
          setError('Popup window was blocked by browser settings. Please allow popups and try Continue with Google again.');
        } else if (code === 'auth/unauthorized-domain') {
          setError('This domain is not authorized for Google Sign-In yet. Please contact the system owner.');
        } else {
          setError(err?.message || 'Unable to verify Google identity.');
        }
      } finally {
        setOauthPending(false);
      }
      return;
    }

    try {
      const { url } = await getGoogleOAuthUrl(purpose);
      const width = 500;
      const height = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
      const popup = window.open(
        url,
        'waqas_pos_google_oauth',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (!popup) {
        setOauthPending(false);
        setError('Popup window was blocked by browser settings. Please allow popups for Continue with Google.');
        return;
      }
      popupRef.current = popup;
    } catch (err: any) {
      setOauthPending(false);
      if (err?.data?.error === 'GOOGLE_OAUTH_NOT_CONFIGURED' && err?.data?.googleRedirectUris) {
        setOauthMissingUrls(err.data.googleRedirectUris);
      }
      setError(err?.message || 'Unable to start Continue with Google.');
    }
  };

  const goBackToWelcome = () => {
    resetMessages();
    setGoogleAssertionToken(null);
    setVerifiedGmail(null);
    setSaPassword('');
    setMartPassword('');
    setProvPassword('');
    setProvConfirmPassword('');
    setOauthPending(false);
    setView('welcome');
  };

  // Mart Login Handler (Shop ID or Shop Username + Shop Password)
  const handleMartLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    resetMessages();
    setIsSubmitting(true);
    try {
      const session = await loginAccount({
        portal: 'shop',
        identifier: martIdentifier.trim(),
        password: martPassword,
      });
      setMartPassword('');
      onLoginSuccess(session);
    } catch (err: any) {
      const data = err?.data;
      if (data?.error === 'SHOP_ACCOUNT_RESTRICTED') {
        setRestrictedInfo({ shopName: data.shopName, status: data.status });
      }
      setError(err?.message || 'Invalid Shop ID, Shop Username, or Shop Password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Super Admin Login Handler (Verified Google Gmail + Separate WAQAS POS Password)
  const handleSuperAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    resetMessages();

    if (!googleAssertionToken) {
      setError('Please click Continue with Google first to select your permanently registered Super Admin Gmail.');
      return;
    }
    if (!saPassword) {
      setError('Please enter your separate WAQAS POS Password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await loginSuperAdminWithGoogle({
        googleAssertionToken,
        password: saPassword,
      });
      setSaPassword('');
      setGoogleAssertionToken(null);
      setVerifiedGmail(null);
      onLoginSuccess(session);
    } catch (err: any) {
      if (err?.data?.error === 'UNAUTHORIZED_GMAIL' || err?.data?.error === 'GOOGLE_AUTH_REQUIRED') {
        setGoogleAssertionToken(null);
        setVerifiedGmail(null);
      }
      setError(err?.message || 'Super Admin verification failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Authorized First-Time Private Provisioning Handler (works both from SUPER ADMIN LOGIN first-time setup and ?provision= link)
  const handlePrivateProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    resetMessages();

    if (!googleAssertionToken) {
      setError('Click Continue with Google first to verify your permanent Super Admin Gmail.');
      return;
    }
    if (provPassword.length < 8) {
      setError('Create WAQAS POS Password must be at least 8 characters long.');
      return;
    }
    if (provPassword !== provConfirmPassword) {
      setError('WAQAS POS Password and Confirm Password do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await provisionSuperAdminWithGoogle({
        ...(provisionToken ? { provisionToken } : {}),
        googleAssertionToken,
        password: provPassword,
        confirmPassword: provConfirmPassword,
        fullName: provFullName.trim() || 'Muhammad Waqas',
      });
      setProvPassword('');
      setProvConfirmPassword('');
      setSaPassword('');
      setGoogleAssertionToken(null);
      setVerifiedGmail(null);
      setProvisionToken(null);
      await signOutFirebaseQuietly();
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {}

      await refreshBootstrapStatus();
      setView('super_admin');
      setSuccessMsg(
        res.message ||
          `Permanent Super Admin registered (${res.gmail}) and future registrations permanently locked. Sign in now using Continue with Google and your WAQAS POS Password.`
      );
    } catch (err: any) {
      setError(err?.message || 'Private provisioning failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Clean Brand Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-900/95">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
              WAQAS MART
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white mt-0.5">
              WAQAS POS SOFTWARE
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Better Shop Better Business
            </p>
          </div>
          <PWAInstallButton deferredPrompt={deferredPrompt} variant="login" />
        </div>

        {/* Alerts & Status */}
        {(error || successMsg) && (
          <div className="px-6 pt-5 space-y-3">
            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-red-950/70 border border-red-500/40 text-red-200 text-xs space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
                {restrictedInfo && (
                  <div className="pt-1 border-t border-red-800/50 flex items-center justify-between text-[11px]">
                    <span>WhatsApp Support: 03228570782</span>
                    <a
                      href="https://wa.me/923228570782"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-300 font-semibold hover:underline"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Contact Super Admin</span>
                    </a>
                  </div>
                )}
                {oauthMissingUrls && (
                  <div className="pt-2 border-t border-red-800/50 text-[11px] text-slate-300 space-y-1">
                    <div className="font-semibold text-amber-300">
                      Required Google Cloud OAuth Authorized Redirect URIs:
                    </div>
                    <div className="font-mono break-all text-slate-200">{oauthMissingUrls.dev}</div>
                    <div className="font-mono break-all text-slate-200">{oauthMissingUrls.shared}</div>
                  </div>
                )}
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}
          </div>
        )}

        {/* VIEW 1: FIRST SCREEN — EXACTLY TWO LOGIN OPTIONS */}
        {view === 'welcome' && (
          <div className="p-6 sm:p-8 space-y-6">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold text-white">Select Login Portal</h2>
              <p className="text-xs text-slate-400">
                Choose your access mode to continue into WAQAS POS SOFTWARE
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* OPTION 1 — MART LOGIN */}
              <button
                type="button"
                onClick={() => {
                  resetMessages();
                  setView('mart');
                }}
                className="group text-left p-6 rounded-2xl bg-slate-950/90 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/70 transition-all flex flex-col justify-between gap-5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                    <Store className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold tracking-wide text-white">
                      MART LOGIN
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Sign in to your authorized Mart database using Shop ID or Shop Username and Password.
                    </p>
                  </div>
                </div>
                <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 group-hover:bg-emerald-500 text-white font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-colors">
                  <span>MART LOGIN</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>

              {/* OPTION 2 — SUPER ADMIN LOGIN */}
              <button
                type="button"
                onClick={() => {
                  resetMessages();
                  setView('super_admin');
                }}
                className="group text-left p-6 rounded-2xl bg-slate-950/90 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-400/70 transition-all flex flex-col justify-between gap-5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                    <Crown className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold tracking-wide text-white">
                      SUPER ADMIN LOGIN
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Authorized Google verification and WAQAS POS Password for multi-mart administration.
                    </p>
                  </div>
                </div>
                <div className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-500 group-hover:bg-amber-400 text-slate-950 font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-colors">
                  <span>SUPER ADMIN LOGIN</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 2: MART LOGIN SCREEN */}
        {view === 'mart' && (
          <div className="p-6 sm:p-8 max-w-md mx-auto w-full space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Mart Owner & Staff Login</h2>
                  <p className="text-xs text-slate-400">Strict per-mart isolated database access</p>
                </div>
              </div>
              <button
                type="button"
                onClick={goBackToWelcome}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            </div>

            <form onSubmit={handleMartLogin} className="space-y-4">
              <div>
                <label htmlFor="mart-login-ident" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Shop ID or Shop Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="mart-login-ident"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    value={martIdentifier}
                    onChange={(e) => {
                      setMartIdentifier(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="e.g. SHOP-WM-001 or waqasmart"
                    className="w-full min-h-[46px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="mart-login-pass" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Shop Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="mart-login-pass"
                    type={showMartPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={martPassword}
                    onChange={(e) => {
                      setMartPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter shop password"
                    className="w-full min-h-[46px] pl-10 pr-12 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMartPassword((p) => !p)}
                    aria-label={showMartPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                    tabIndex={-1}
                  >
                    {showMartPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !martIdentifier.trim() || !martPassword}
                className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Signing in...' : 'Login'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">Multi-device POS terminal?</span>
              <button
                type="button"
                onClick={() => setIsPairOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Connect via QR Code</span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: SUPER ADMIN LOGIN SCREEN (CONTINUE WITH GOOGLE + SEPARATE WAQAS POS PASSWORD) */}
        {view === 'super_admin' && (
          <div className="p-6 sm:p-8 max-w-md mx-auto w-full space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Super Admin Login</h2>
                  <p className="text-xs text-slate-400">Google OAuth + WAQAS POS Password</p>
                </div>
              </div>
              <button
                type="button"
                onClick={goBackToWelcome}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            </div>

            {loadingBootstrap ? (
              <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Checking Super Admin security lock...</span>
              </div>
            ) : !bootstrap?.superAdminConfigured && bootstrap?.superAdminSetupLocked ? (
              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-bold text-amber-400">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Super Admin Registration Locked</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Super Admin registration lock is permanently enabled on this server. Contact the authorized system owner to unlock recovery on the host.
                </p>
                <button
                  type="button"
                  onClick={goBackToWelcome}
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold cursor-pointer"
                >
                  Back to Login Selection
                </button>
              </div>
            ) : !bootstrap?.superAdminConfigured ? (
              <form onSubmit={handlePrivateProvision} className="space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Authorized One-Time Super Admin Setup</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Verify your permanent Google account and set a separate WAQAS POS Password. After completion, future Super Admin registrations are permanently locked.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">
                    1. Select & Verify Permanent Google Account *
                  </label>
                  {verifiedGmail && googleAssertionToken ? (
                    <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-emerald-300">Google Account Verified</div>
                        <div className="text-xs font-mono text-white truncate">{verifiedGmail}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startGoogleOAuth('provision')}
                        className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline shrink-0 cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={oauthPending}
                      onClick={() => startGoogleOAuth('provision')}
                      className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-3 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <GoogleMark />
                      <span>{oauthPending ? 'Verifying Google account...' : 'Continue with Google'}</span>
                    </button>
                  )}
                </div>

                <div>
                  <label htmlFor="sa-prov-fullname" className="block text-xs font-semibold text-slate-300 mb-1.5">
                    2. Full Name *
                  </label>
                  <input
                    id="sa-prov-fullname"
                    type="text"
                    required
                    value={provFullName}
                    onChange={(e) => setProvFullName(e.target.value)}
                    placeholder="Muhammad Waqas"
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label htmlFor="sa-prov-pass" className="block text-xs font-semibold text-slate-300 mb-1.5">
                    3. Create WAQAS POS Password (min 8 chars) *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="sa-prov-pass"
                      type={showProvPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={provPassword}
                      onChange={(e) => {
                        setProvPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Create separate WAQAS POS Password"
                      className="w-full min-h-[46px] pl-10 pr-12 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowProvPassword((p) => !p)}
                      aria-label={showProvPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                      tabIndex={-1}
                    >
                      {showProvPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="sa-prov-confirm" className="block text-xs font-semibold text-slate-300 mb-1.5">
                    4. Confirm WAQAS POS Password *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="sa-prov-confirm"
                      type={showProvPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={provConfirmPassword}
                      onChange={(e) => {
                        setProvConfirmPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Re-enter WAQAS POS Password"
                      className="w-full min-h-[46px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !googleAssertionToken || provPassword.length < 8 || !provConfirmPassword}
                  className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isSubmitting ? 'Creating & Locking Super Admin...' : 'Create Permanent Super Admin & Lock Setup'}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleSuperAdminLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">
                    1. Verify Permanently Registered Super Admin Gmail
                  </label>
                  {verifiedGmail && googleAssertionToken ? (
                    <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-emerald-300">Verified Google Account</div>
                        <div className="text-xs font-mono text-white truncate">{verifiedGmail}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startGoogleOAuth('login')}
                        className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline shrink-0 cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={oauthPending}
                      onClick={() => startGoogleOAuth('login')}
                      className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-3 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <GoogleMark />
                      <span>{oauthPending ? 'Waiting for Google verification...' : 'Continue with Google'}</span>
                    </button>
                  )}
                  {bootstrap.maskedGmail && (
                    <p className="text-[11px] text-slate-400">
                      Registered Gmail: <span className="font-mono text-slate-300">{bootstrap.maskedGmail}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="sa-waqas-pass" className="block text-xs font-semibold text-slate-300 mb-1.5">
                    2. Separate WAQAS POS Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="sa-waqas-pass"
                      type={showSaPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={saPassword}
                      onChange={(e) => {
                        setSaPassword(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Enter separate WAQAS POS Password"
                      className="w-full min-h-[46px] pl-10 pr-12 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSaPassword((p) => !p)}
                      aria-label={showSaPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                      tabIndex={-1}
                    >
                      {showSaPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !googleAssertionToken || !saPassword}
                  className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Crown className="w-4 h-4" />
                  <span>{isSubmitting ? 'Verifying Super Admin...' : 'Login'}</span>
                </button>
              </form>
            )}
          </div>
        )}

        {/* VIEW 4: PRIVATE ONE-TIME INITIAL PROVISIONING (HIDDEN UNLESS ?provision=<SECRET>) */}
        {view === 'private_provision' && (
          <div className="p-6 sm:p-8 max-w-md mx-auto w-full space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  Private Owner Provisioning
                </div>
                <h2 className="text-base font-bold text-white">Register Permanent Super Admin</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  One-time locked setup. Binds 1 permanent Google account and locks setup forever.
                </p>
              </div>
              <button
                type="button"
                onClick={goBackToWelcome}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer shrink-0"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handlePrivateProvision} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Step 1: Verify Permanent Google Account *
                </label>
                {verifiedGmail && googleAssertionToken ? (
                  <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-emerald-300">Locked Gmail Selected</div>
                      <div className="text-xs font-mono text-white truncate">{verifiedGmail}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startGoogleOAuth('provision')}
                      className="text-xs font-semibold text-amber-300 underline shrink-0 cursor-pointer"
                    >
                      Switch
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={oauthPending}
                    onClick={() => startGoogleOAuth('provision')}
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm flex items-center justify-center gap-3 cursor-pointer"
                  >
                    <GoogleMark />
                    <span>{oauthPending ? 'Connecting Google...' : 'Continue with Google'}</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={provFullName}
                  onChange={(e) => setProvFullName(e.target.value)}
                  placeholder="Muhammad Waqas"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Create WAQAS POS Password (min 8 chars) *
                </label>
                <div className="relative">
                  <input
                    type={showProvPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={provPassword}
                    onChange={(e) => setProvPassword(e.target.value)}
                    placeholder="Create separate WAQAS POS Password"
                    className="w-full min-h-[44px] pl-3.5 pr-11 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowProvPassword((p) => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white cursor-pointer"
                    tabIndex={-1}
                  >
                    {showProvPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Confirm WAQAS POS Password *
                </label>
                <input
                  type={showProvPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={provConfirmPassword}
                  onChange={(e) => setProvConfirmPassword(e.target.value)}
                  placeholder="Re-enter WAQAS POS Password"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:border-amber-400"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !googleAssertionToken}
                className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Activating & Locking Setup...' : 'Complete Private Super Admin Setup'}
              </button>
            </form>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span>WAQAS POS SOFTWARE · Multi-Mart Cloud POS</span>
          <span>Currency: PKR (Rs.)</span>
        </div>
      </div>

      <PairDeviceModal
        isOpen={isPairOpen}
        onClose={() => setIsPairOpen(false)}
        onPairSuccess={(device, storeState) => {
          setIsPairOpen(false);
          onPairedSuccess(device, storeState);
        }}
      />
    </div>
  );
};
