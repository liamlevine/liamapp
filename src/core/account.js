// Account, widget layout and shopping-list persistence.
// Local-first: everything is stored in localStorage immediately and works
// without an account. When signed in (Firebase Auth), the layout and
// shopping list are synced to Firestore (`users/{uid}`) silently; if the
// cloud is unavailable the app degrades to local-only.

const LS_ORDER = "liam_widget_order";
const LS_SHOPPING = "liam_shopping";

const listeners = new Set();
let user = null;
let listening = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

export function currentUser() {
  return user;
}

// Hydrate the auth session at startup (restores a previous sign-in).
// Fails silently if Firebase is unreachable — the app runs local-only.
export async function init() {
  try {
    await authEnv();
    emit();
  } catch {
    // local-only
  }
}

async function authEnv() {
  const fb = await import("../firebase.js");
  const m = await import("firebase/auth");
  if (!listening) {
    listening = true;
    m.onAuthStateChanged(fb.auth, (u) => {
      user = u;
      if (u) pullCloud();
      emit();
    });
  }
  user = fb.auth.currentUser;
  return { fb, m };
}

export async function signIn(email, pw) {
  const { fb, m } = await authEnv();
  await m.signInWithEmailAndPassword(fb.auth, email.trim(), pw);
}

export async function signUp(email, pw) {
  const { fb, m } = await authEnv();
  await m.createUserWithEmailAndPassword(fb.auth, email.trim(), pw);
}

export async function logOut() {
  const { fb, m } = await authEnv();
  await m.signOut(fb.auth);
}

// ── Widget order ────────────────────────────────────────────
export function widgetOrder(defaultIds) {
  const saved = JSON.parse(localStorage.getItem(LS_ORDER) || "[]");
  const valid = saved.filter((id) => defaultIds.includes(id));
  return [...valid, ...defaultIds.filter((id) => !valid.includes(id))];
}

export function setWidgetOrder(ids) {
  localStorage.setItem(LS_ORDER, JSON.stringify(ids));
  syncCloud();
  emit();
}

// ── Shopping list ───────────────────────────────────────────
export function getShopping() {
  try {
    return JSON.parse(localStorage.getItem(LS_SHOPPING) || "[]");
  } catch {
    return [];
  }
}

export function setShopping(items) {
  localStorage.setItem(LS_SHOPPING, JSON.stringify(items));
  syncCloud();
}

// ── Cloud sync (best effort) ────────────────────────────────
async function syncCloud() {
  if (!user) return;
  try {
    const { fb } = await authEnv();
    const f = await import("firebase/firestore");
    await f.setDoc(f.doc(fb.db, "users", user.uid), {
      email: user.email || "",
      widgetOrder: JSON.parse(localStorage.getItem(LS_ORDER) || "[]"),
      shopping: getShopping(),
      updatedAt: Date.now(),
    });
  } catch {
    // cloud unavailable — local data stays
  }
}

async function pullCloud() {
  try {
    const { fb } = await authEnv();
    const f = await import("firebase/firestore");
    const snap = await f.getDoc(f.doc(fb.db, "users", user.uid));
    if (snap.exists()) {
      const d = snap.data();
      if (Array.isArray(d.widgetOrder) && d.widgetOrder.length)
        localStorage.setItem(LS_ORDER, JSON.stringify(d.widgetOrder));
      if (Array.isArray(d.shopping))
        localStorage.setItem(LS_SHOPPING, JSON.stringify(d.shopping));
      emit();
    }
  } catch {
    // ignore
  }
}

export const account = {
  subscribe,
  currentUser,
  init,
  signIn,
  signUp,
  logOut,
  widgetOrder,
  setWidgetOrder,
  getShopping,
  setShopping,
};
