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
      loadedFirebase = { auth, authMod, googleAuthProvider };
      return loadedFirebase;
    });
  }
  return firebasePromise;
}

export async function signInWithGoogle() {
  const { auth, authMod, googleAuthProvider } = await ensureFirebaseLoaded();
  const result = await authMod.signInWithPopup(auth, googleAuthProvider);
  setFirebaseHint(true);
  const idToken = await result.user.getIdToken(true);
  return { firebaseUser: result.user, idToken };
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
