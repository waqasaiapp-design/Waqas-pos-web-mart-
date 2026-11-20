import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  Auth,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;

export function isFirebaseGoogleConfigured(): boolean {
  return Boolean(
    firebaseConfig &&
      firebaseConfig.projectId &&
      firebaseConfig.projectId !== 'remixed-project-id' &&
      firebaseConfig.apiKey
  );
}

function getFirebaseAuthInstance(): Auth {
  if (!isFirebaseGoogleConfigured()) {
    throw new Error('Google Sign-In configuration (firebase-applet-config.json) is not active.');
  }
  if (!cachedApp) {
    cachedApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(cachedApp);
  }
  return cachedAuth;
}

export async function signInWithFirebaseGooglePopup(): Promise<{
  idToken: string;
  email: string;
  displayName: string;
}> {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await signInWithPopup(auth, provider);
  const user = credential.user;
  if (!user || !user.email) {
    throw new Error('Google Sign-In did not return a valid email address.');
  }
  const idToken = await user.getIdToken(true);
  const email = user.email.trim().toLowerCase();
  const displayName = (user.displayName || 'Muhammad Waqas').trim();

  // Immediately clear transient client Firebase session so WAQAS POS backend enforces password + Gmail every login
  try {
    await signOut(auth);
  } catch {}

  return { idToken, email, displayName };
}

export async function signOutFirebaseQuietly(): Promise<void> {
  if (!isFirebaseGoogleConfigured()) return;
  try {
    const auth = getFirebaseAuthInstance();
    await signOut(auth);
  } catch {}
}
