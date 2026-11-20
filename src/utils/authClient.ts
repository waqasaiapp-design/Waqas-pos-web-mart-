import { AuthSession, AuthUser, BootstrapAuthStatus, ShopAccount } from '../types/pos';
import { getApiBaseUrl, safeFetchJson } from './apiClient';

export const AUTH_STORAGE_KEY = 'waqas_pos_session_v1';

const LEGACY_LOCK_KEYS = [
  'waqas_mart_auth_session',
  'waqas_mart_device_unlock_v1',
  'waqas_mart_app_pin_hash_v6',
  'waqas_mart_security_config_v6',
  'waqas_mart_session_token',
  'waqas_mart_master_pin_v1',
];

export function purgeLegacyLockKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_LOCK_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {}
}

export function getStoredAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.user) {
      return parsed as AuthSession;
    }
  } catch {}
  return null;
}

export function getStoredToken(): string | null {
  return getStoredAuthSession()?.token || null;
}

export function saveAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  purgeLegacyLockKeys();
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

export function clearStoredAuthSession(): void {
  if (typeof window === 'undefined') return;
  purgeLegacyLockKeys();
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
}

export async function getBootstrapStatus(): Promise<BootstrapAuthStatus> {
  const res = await safeFetchJson<{
    success: boolean;
    superAdminConfigured: boolean;
    superAdminSetupLocked?: boolean;
    firebaseGoogleAuthConfigured?: boolean;
    googleOAuthConfigured?: boolean;
    googleRedirectUris?: { dev: string; shared: string };
    maskedGmail?: string;
  }>('/api/auth/bootstrap-status');
  return {
    superAdminConfigured: Boolean(res.data?.superAdminConfigured),
    superAdminSetupLocked: Boolean(res.data?.superAdminSetupLocked),
    firebaseGoogleAuthConfigured: Boolean(res.data?.firebaseGoogleAuthConfigured),
    googleOAuthConfigured: Boolean(res.data?.googleOAuthConfigured),
    googleRedirectUris: res.data?.googleRedirectUris,
    maskedGmail: res.data?.maskedGmail,
  };
}

export async function verifyGoogleIdToken(
  idToken: string,
  purpose: 'login' | 'provision'
): Promise<{
  assertionToken: string;
  gmail: string;
  fullName: string;
}> {
  const res = await safeFetchJson<{
    success: boolean;
    assertionToken: string;
    gmail: string;
    fullName: string;
  }>('/api/auth/google/verify-id-token', {
    method: 'POST',
    body: JSON.stringify({ idToken, purpose }),
  });
  return {
    assertionToken: res.data.assertionToken,
    gmail: res.data.gmail,
    fullName: res.data.fullName,
  };
}

export async function getGoogleOAuthUrl(purpose: 'login' | 'provision'): Promise<{
  url: string;
  redirectUri: string;
}> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const res = await safeFetchJson<{
    success: boolean;
    url: string;
    redirectUri: string;
  }>(`/api/auth/google/url?purpose=${encodeURIComponent(purpose)}&origin=${encodeURIComponent(origin)}`);
  return {
    url: res.data.url,
    redirectUri: res.data.redirectUri,
  };
}

export async function validateProvisionToken(provisionToken: string): Promise<{
  valid: boolean;
  googleOAuthConfigured: boolean;
  googleRedirectUris?: { dev: string; shared: string };
}> {
  const res = await safeFetchJson<{
    success: boolean;
    valid: boolean;
    googleOAuthConfigured: boolean;
    googleRedirectUris?: { dev: string; shared: string };
  }>('/api/auth/super-admin/validate-provision-token', {
    method: 'POST',
    body: JSON.stringify({ provisionToken }),
  });
  return {
    valid: Boolean(res.data?.valid),
    googleOAuthConfigured: Boolean(res.data?.googleOAuthConfigured),
    googleRedirectUris: res.data?.googleRedirectUris,
  };
}

export async function provisionSuperAdminWithGoogle(payload: {
  provisionToken?: string;
  googleAssertionToken: string;
  password: string;
  confirmPassword: string;
  fullName?: string;
}): Promise<{
  success: boolean;
  gmail: string;
  fullName: string;
  superAdminSetupLocked: boolean;
  message: string;
}> {
  const res = await safeFetchJson<{
    success: boolean;
    gmail: string;
    fullName: string;
    superAdminSetupLocked: boolean;
    message: string;
  }>('/api/auth/super-admin/provision', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function loginSuperAdminWithGoogle(payload: {
  googleAssertionToken: string;
  password: string;
}): Promise<AuthSession> {
  const res = await safeFetchJson<{
    success: boolean;
    token: string;
    expiresAt?: string;
    user: AuthUser;
  }>('/api/auth/super-admin/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session: AuthSession = {
    token: res.data.token,
    user: res.data.user,
    expiresAt: res.data.expiresAt,
  };
  saveAuthSession(session);
  return session;
}

export async function loginAccount(payload: {
  portal: 'shop';
  identifier: string;
  password: string;
}): Promise<AuthSession> {
  const res = await safeFetchJson<{
    success: boolean;
    token: string;
    expiresAt?: string;
    user: AuthUser;
    shop?: ShopAccount;
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const session: AuthSession = {
    token: res.data.token,
    user: res.data.user,
    shop: res.data.shop,
    expiresAt: res.data.expiresAt,
  };
  saveAuthSession(session);
  return session;
}

export async function fetchCurrentSession(): Promise<AuthSession | null> {
  const stored = getStoredAuthSession();
  if (!stored?.token) return null;
  try {
    const res = await safeFetchJson<{
      success: boolean;
      user: AuthUser;
      shop?: ShopAccount;
      expiresAt?: string;
    }>('/api/auth/me');
    if (res.ok && res.data?.user) {
      const updated: AuthSession = {
        token: stored.token,
        user: res.data.user,
        shop: res.data.shop,
        expiresAt: res.data.expiresAt || stored.expiresAt,
      };
      saveAuthSession(updated);
      return updated;
    }
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      clearStoredAuthSession();
      throw err;
    }
    return stored;
  }
  return stored;
}

export async function logoutSession(): Promise<void> {
  const token = getStoredToken();
  if (token) {
    try {
      const base = getApiBaseUrl();
      await fetch(`${base}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch {}
  }
  clearStoredAuthSession();
}

export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<string> {
  const res = await safeFetchJson<{ success: boolean; message: string }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return res.data?.message || 'Password updated successfully.';
}

export async function revokeOtherSuperAdminSessions(): Promise<string> {
  const res = await safeFetchJson<{ success: boolean; message: string }>('/api/super-admin/sessions/revoke-others', {
    method: 'POST',
    body: '{}',
  });
  return res.data?.message || 'Other sessions terminated.';
}
