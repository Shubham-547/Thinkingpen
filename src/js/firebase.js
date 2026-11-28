const FIREBASE_HINT_KEY = 'sp_has_firebase_session';
const PENDING_REDIRECT_KEY = 'sp_pending_firebase_redirect';

let firebasePromise = null;
let loadedFirebase = null;

export function hasStoredFirebaseHint() {
  try {
    return localStorage.getItem(FIREBASE_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function hasPendingFirebaseRedirect() {
  try {
    return Boolean(sessionStorage.getItem(PENDING_REDIRECT_KEY));
  } catch {
    return false;
  }
}

function setFirebaseHint(active) {
  try {
    if (active) localStorage.setItem(FIREBASE_HINT_KEY, '1');
    else localStorage.removeItem(FIREBASE_HINT_KEY);
  } catch {}
}

function setPendingRedirectProvider(label) {
  try {
    if (label) sessionStorage.setItem(PENDING_REDIRECT_KEY, String(label));
    else sessionStorage.removeItem(PENDING_REDIRECT_KEY);
  } catch {}
}

function getPendingRedirectProvider() {
  try {
    return sessionStorage.getItem(PENDING_REDIRECT_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Dynamically loads Firebase App & Auth SDK only when needed (Social Sign-In or returning Firebase session).
 * Keeps initial Home page bundle free of ~280 KB of unused Firebase Auth JavaScript.
 */
async function ensureFirebaseLoaded() {
  if (loadedFirebase) return loadedFirebase;
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('../../firebase-applet-config.json'),
    ]).then(([appMod, authMod, cfgMod]) => {
      const app = appMod.initializeApp(cfgMod.default || cfgMod);
      const auth = authMod.getAuth(app);
      const googleAuthProvider = new authMod.GoogleAuthProvider();
      googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

      const facebookAuthProvider = new authMod.FacebookAuthProvider();
      facebookAuthProvider.addScope('email');

      const twitterAuthProvider = new authMod.TwitterAuthProvider();

      loadedFirebase = {
        auth,
        authMod,
        googleAuthProvider,
        facebookAuthProvider,
        twitterAuthProvider,
      };
      return loadedFirebase;
    });
  }
  return firebasePromise;
}

function isPopupFallbackError(err) {
  const code = err?.code || '';
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment'
  );
}

async function runPopupSignIn(providerKey, providerLabel = 'Social') {
  const loaded = await ensureFirebaseLoaded();
  const provider = loaded[providerKey];
  if (providerKey === 'facebookAuthProvider') {
    const isMobile =
      typeof window !== 'undefined' &&
      (window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''));
    provider.setCustomParameters({ display: isMobile ? 'touch' : 'popup' });
  }
  try {
    const result = await loaded.authMod.signInWithPopup(loaded.auth, provider);
    setPendingRedirectProvider('');
    setFirebaseHint(true);
    const idToken = await result.user.getIdToken(true);
    return { firebaseUser: result.user, idToken, redirected: false };
  } catch (err) {
    if (isPopupFallbackError(err)) {
      setPendingRedirectProvider(providerLabel);
      setFirebaseHint(true);
      await loaded.authMod.signInWithRedirect(loaded.auth, provider);
      return { redirected: true };
    }
    throw err;
  }
}

export async function consumeFirebaseRedirectResult() {
  const pendingLabel = getPendingRedirectProvider();
  try {
    const loaded = await ensureFirebaseLoaded();
    const result = await loaded.authMod.getRedirectResult(loaded.auth);
    if (!result?.user) {
      setPendingRedirectProvider('');
      return null;
    }
    setPendingRedirectProvider('');
    setFirebaseHint(true);
    const idToken = await result.user.getIdToken(true);
    return { firebaseUser: result.user, idToken, providerLabel: pendingLabel || 'Social' };
  } catch (err) {
    setPendingRedirectProvider('');
    return {
      error: err,
      providerLabel: pendingLabel || 'Social',
    };
  }
}

export async function signInWithGoogle() {
  return runPopupSignIn('googleAuthProvider', 'Google');
}

export async function signInWithFacebook() {
  return runPopupSignIn('facebookAuthProvider', 'Facebook');
}

export async function signInWithTwitter() {
  return runPopupSignIn('twitterAuthProvider', 'Twitter');
}

export function formatFirebaseAuthError(err, providerLabel = 'Social') {
  const code = err?.code || '';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return `${providerLabel} sign-in popup was closed before completing.`;
  }
  if (code === 'auth/popup-blocked') {
    return `Popup was blocked by your browser. Please allow popups for this site and try ${providerLabel} sign-in again.`;
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return `An account already exists with this email using a different sign-in method. Please sign in with your original method.`;
  }
  if (code === 'auth/operation-not-allowed') {
    return `${providerLabel} sign-in is not enabled yet in Firebase Authentication. Enable ${providerLabel} under Firebase Console → Authentication → Sign-in method (with your ${providerLabel} App ID & Secret).`;
  }
  if (code === 'auth/unauthorized-domain') {
    const hostHint = currentHost ? ` (${currentHost})` : '';
    return `This domain${hostHint} is not authorized in Firebase Authentication. Add "${currentHost || 'your domain'}" under Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (code === 'auth/network-request-failed') {
    return `Network error while contacting ${providerLabel} sign-in. Please check your internet connection and try again.`;
  }
  if (code === 'auth/internal-error') {
    return `${providerLabel} sign-in encountered a configuration or browser error. Check Firebase Authorized Domains and ${providerLabel} OAuth settings, then try again.`;
  }
  return err?.message || `${providerLabel} sign-in failed. Please try again.`;
}

export async function signOutFirebase() {
  setFirebaseHint(false);
  setPendingRedirectProvider('');
  if (!loadedFirebase) return;
  try {
    await loadedFirebase.authMod.signOut(loadedFirebase.auth);
  } catch (err) {
    console.warn('Firebase signOut warning:', err);
  }
}

export async function subscribeFirebaseAuth(callback) {
  const { auth, authMod } = await ensureFirebaseLoaded();
  return authMod.onAuthStateChanged(auth, (user) => {
    if (user) setFirebaseHint(true);
    callback(user);
  });
}

export async function getActiveFirebaseIdToken() {
  if (!loadedFirebase) {
    if (!hasStoredFirebaseHint()) return null;
    await ensureFirebaseLoaded();
  }
  const current = loadedFirebase?.auth?.currentUser;
  if (!current) return null;
  try {
    return await current.getIdToken();
  } catch {
    return null;
  }
}
