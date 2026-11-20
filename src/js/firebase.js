const FIREBASE_HINT_KEY = 'sp_has_firebase_session';

let firebasePromise = null;
let loadedFirebase = null;

export function hasStoredFirebaseHint() {
  try {
    return localStorage.getItem(FIREBASE_HINT_KEY) === '1';
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

/**
 * Dynamically loads Firebase App & Auth SDK only when needed (Google Sign-In or returning Google session).
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
      facebookAuthProvider.setCustomParameters({ display: 'popup' });

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

async function runPopupSignIn(providerKey) {
  const loaded = await ensureFirebaseLoaded();
  const provider = loaded[providerKey];
  const result = await loaded.authMod.signInWithPopup(loaded.auth, provider);
  setFirebaseHint(true);
  const idToken = await result.user.getIdToken(true);
  return { firebaseUser: result.user, idToken };
}

export async function signInWithGoogle() {
  return runPopupSignIn('googleAuthProvider');
}

export async function signInWithFacebook() {
  return runPopupSignIn('facebookAuthProvider');
}

export async function signInWithTwitter() {
  return runPopupSignIn('twitterAuthProvider');
}

export function formatFirebaseAuthError(err, providerLabel = 'Social') {
  const code = err?.code || '';
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
    return `This domain is not authorized in Firebase Authentication. Add the current hostname under Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  return err?.message || `${providerLabel} sign-in failed. Please try again.`;
}

export async function signOutFirebase() {
  setFirebaseHint(false);
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
