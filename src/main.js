import { store } from "./core/data.js";
import { h } from "./core/ui.js";
import { ICONS } from "./core/icons.js";
import { WIDGETS } from "./widgets/registry.js";
import { account } from "./core/account.js";

const app = document.getElementById("app");
let activeUnmount = null;
let modalOpen = false;
let authError = "";

function route() {
  const hsh = location.hash.replace(/^#\/?/, "");
  const parts = hsh.split("?")[0].split("/").filter(Boolean);
  return { widgetId: parts[0] || null, sub: parts[1] || null };
}

// ── Account modal ────────────────────────────────────────────
function friendlyAuthError(err) {
  const code = String(err?.code || "");
  const map = {
    "auth/invalid-credential": "wrong email or password bro.",
    "auth/invalid-email": "That email address aint right.",
    "auth/email-already-in-use": "An account with that email already exists — sign in instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/network-request-failed": "no wifi or some other problem idk",
    "auth/too-many-requests": "Too many attempts just reset the pasword.",
  };
  return map[code] || err?.message || "something gone wrong. maybe try again but prob wont work.";
}

function openModal() { authError = ""; modalOpen = true; renderHome(); }
function closeModal() { modalOpen = false; authError = ""; renderHome(); }

async function doSignIn(email, pw) {
  try {
    await account.signIn(email, pw);
    closeModal();
  } catch (e) {
    authError = friendlyAuthError(e);
    renderHome();
  }
}

async function doSignUp(email, pw) {
  try {
    await account.signUp(email, pw);
    closeModal();
  } catch (e) {
    authError = friendlyAuthError(e);
    renderHome();
  }
}

function authModal() {
  const user = account.currentUser();
  const overlay = h("div", {
    class: "modal-overlay",
    onclick: (e) => { if (e.target === overlay) closeModal(); },
  });
  const modal = h("div", { class: "modal" },
    user
      ? h("div", null,
          h("h2", { class: "modal-title" }, "Signed in"),
          h("p", { class: "modal-sub" }, user.email),
          h("p", { class: "modal-note" }, "Your widget layout and lists are synced to the cloud."),
          h("div", { class: "modal-actions" },
            h("button", {
              class: "btn", onclick: async () => {
                try { await account.logOut(); } catch { /* ignore */ }
                closeModal();
              },
            }, "Sign out"),
            h("button", { class: "btn", onclick: closeModal }, "Close"),
          ),
        )
      : h("form", {
          class: "modal-form",
          onsubmit: (e) => {
            e.preventDefault();
            doSignIn(e.target.elements.email.value, e.target.elements.password.value);
          },
        },
          h("h2", { class: "modal-title" }, "Account"),
          h("p", { class: "modal-sub" }, "Sign in to sync your widgets and lists across devices."),
          h("label", { class: "form-label" }, "Email"),
          h("input", { class: "input", name: "email", type: "email", placeholder: "you@example.com", autocomplete: "email" }),
          h("label", { class: "form-label" }, "Password"),
          h("input", { class: "input", name: "password", type: "password", placeholder: "••••••••", autocomplete: "current-password" }),
          authError ? h("p", { class: "modal-err" }, authError) : null,
          h("div", { class: "modal-actions" },
            h("button", { class: "btn btn--primary", type: "submit" }, "Sign in"),
            h("button", {
              class: "btn", type: "button",
              onclick: (e) => {
                const f = e.target.closest("form");
                doSignUp(f.elements.email.value, f.elements.password.value);
              },
            }, "Create account"),
          ),
          h("p", { class: "modal-note" }, "No account? Everything still works locally — an account just keeps it in sync."),
        ),
  );
  overlay.appendChild(modal);
  return overlay;
}

// ── Home (widget shelf) ──────────────────────────────────────
let dragId = null;

function orderedWidgets() {
  const ids = account.widgetOrder(WIDGETS.map((w) => w.id));
  return ids.map((id) => WIDGETS.find((w) => w.id === id)).filter(Boolean);
}

function accountBtn() {
  const user = account.currentUser();
  const label = user ? (user.email || "Account") : "Sign in";
  return h("button", {
    class: "btn account-btn",
    onclick: openModal,
    html: `<span class="acct-icon">${ICONS.account}</span><span class="acct-label">${label}</span>`,
    title: user ? `Signed in as ${user.email}` : "Sign in",
  });
}

function homeTop() {
  const cur = store.currentGw();
  return h("div", { class: "home-top" },
    h("span", { class: "home-top-label" }, "LIAMAPP • WIDGETs"),
    h("div", { class: "home-top-right" },
      cur ? h("span", { class: "gw-pill" }, `GW${cur.id}`) : null,
      accountBtn(),
    ),
  );
}

function homeHero() {
  return h("div", { class: "home-hero" },
    h("p", { class: "home-kicker" }, "widgets"),
    h("h1", { class: "home-title" }, "liamapp"),
    h("p", { class: "home-sub" }, "Drag to rearrange. Open to get to work."),
  );
}

function ticker() {
  const items = [
    "widgets", "FPL PREDICTED POINTS", "TEAM RATING", "FIXTURE ANALYSER",
    "LIVE RANK", "MY TEAM", "SHOPPING LIST", "CHIP PLANNING", "PLAYER PROFILER",
    "ACCOUNT SYNC",
  ].join("  •  ");
  return h("div", { class: "ticker", "aria-hidden": "true" },
    h("div", { class: "ticker-track" },
      h("span", null, items + "  •  "),
      h("span", null, items + "  •  "),
    ),
  );
}

function widgetCard(w, i) {
  return h("a", {
    class: "widget-card",
    href: `#/${w.id}`,
    ondragover: (e) => {
      if (dragId && dragId !== w.id) {
        e.preventDefault();
        e.currentTarget.classList.add("drag-over");
      }
    },
    ondragleave: (e) => e.currentTarget.classList.remove("drag-over"),
    ondrop: (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove("drag-over");
      if (!dragId || dragId === w.id) return;
      const ids = orderedWidgets().map((x) => x.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(w.id);
      if (from < 0 || to < 0) return;
      ids.splice(from, 1);
      ids.splice(to, 0, dragId);
      account.setWidgetOrder(ids);
      dragId = null;
      renderHome();
    },
  },
    h("span", {
      class: "wc-grip",
      html: ICONS.grip,
      draggable: "true",
      title: "drag to reorder.",
      ondragstart: (e) => {
        dragId = w.id;
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.closest(".widget-card")?.classList.add("dragging");
        e.stopPropagation();
      },
      ondragend: (e) => {
        e.currentTarget.closest(".widget-card")?.classList.remove("dragging");
        dragId = null;
      },
      onclick: (e) => e.preventDefault(),
    }),
    h("div", { class: "wc-top" },
      h("span", { class: "wc-code" }, `W-${String(i + 1).padStart(2, "0")} / ${w.code || "APP"}`),
      h("span", { class: "wc-tag" }, "OPEN"),
    ),
    h("div", { class: "wc-icon", html: ICONS[w.icon] }),
    h("div", { class: "wc-title" }, w.name),
    h("div", { class: "wc-desc" }, w.tagline),
    h("div", { class: "wc-meta" }, w.meta || ""),
    h("div", { class: "wc-open", html: `OPEN ${ICONS.arrow}` }),
  );
}

function homeFoot() {
  return h("div", { class: "home-foot" },
    h("span", { class: "home-foot-label" }, "liamapp • widgets · v1.1"),
    h("div", { class: "home-foot-links" },
      h("span", { class: "home-foot-k" }, "JUMP TO…"),
      ...orderedWidgets().map((w) => h("a", { class: "home-foot-link", href: `#/${w.id}` }, w.name)),
      h("a", { class: "home-foot-link", href: "#/", onclick: openModal }, "account"),
    ),
  );
}

function homeView() {
  const widgets = orderedWidgets();
  return h("div", { class: "home" },
    homeTop(),
    h("div", { class: "home-body" },
      homeHero(),
      ticker(),
      h("div", { class: "widget-grid" },
        ...widgets.map(widgetCard),
        h("div", { class: "widget-card widget-card--new" },
          h("div", { class: "wc-top" },
            h("span", { class: "wc-code" }, `W-${String(widgets.length + 1).padStart(2, "0")} / NEW`),
          ),
          h("div", { class: "wc-icon", html: ICONS.plus }),
          h("div", { class: "wc-title" }, "more coming soon."),
          h("div", { class: "wc-desc" }, "new widgets drop here when made."),
        ),
      ),
    ),
    homeFoot(),
    modalOpen ? authModal() : null,
  );
}

function renderHome() {
  app.replaceChildren(homeView());
}

function render() {
  if (activeUnmount) { activeUnmount(); activeUnmount = null; }
  const r = route();
  if (!r.widgetId) {
    renderHome();
    return;
  }
  const w = WIDGETS.find((x) => x.id === r.widgetId);
  if (!w) {
    renderHome();
    return;
  }
  activeUnmount = w.mount(app);
}

window.addEventListener("hashchange", render);

store.subscribe(() => {
  if (!route().widgetId) renderHome();
});
account.subscribe(() => {
  if (!route().widgetId) renderHome();
});

store.init();
account.init().catch(() => {});
render();


