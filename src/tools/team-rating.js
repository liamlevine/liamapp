import {
  h, money, fmt, POS_SHORT, POS_NAME, avatar, debounce,
} from "../core/ui.js";
import { ICONS } from "../core/icons.js";
import { store } from "../core/data.js";
import { nextFixturesForTeam } from "../core/store.js";
import { flagInfo } from "../core/xp.js";

const CAPS = { 1: 2, 2: 5, 3: 5, 4: 3 };
const SLOT_ORDER = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>';

function nextFixtureMap() {
  const s = store.state;
  const map = new Map();
  for (const t of Object.values(s.teams)) {
    const f = nextFixturesForTeam(t.id, s.fixturesByTeam, s.gameweeks, 1)[0];
    map.set(t.id, f || null);
  }
  return map;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Best XI from a squad (≥3 DEF, ≥2 MID, ≥1 FWD), captain doubled.
function bestXI(withXp, captainId) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  for (const x of withXp) byPos[x.p.position].push(x);
  for (const k of [1, 2, 3, 4]) byPos[k].sort((a, b) => b.xp - a.xp);
  if (!byPos[1].length) return null;
  const xi = [byPos[1][0], ...byPos[2].slice(0, 3), ...byPos[3].slice(0, 2), ...byPos[4].slice(0, 1)];
  const rest = [...byPos[2].slice(3), ...byPos[3].slice(2), ...byPos[4].slice(1)].sort((a, b) => b.xp - a.xp);
  xi.push(...rest.slice(0, 10 - xi.length));
  const inXi = new Set(xi);
  const bench = withXp.filter((x) => !inXi.has(x));
  let cap = xi.find((x) => x.p.id === captainId);
  if (!cap) cap = xi[0];
  const total = xi.reduce((a, x) => a + x.xp * (x === cap ? 2 : 1), 0)
    + bench.reduce((a, x) => a + x.xp * 0.25, 0);
  return { xi, bench, cap, total };
}

// Dream-team ceiling: greedy best squad under £100m with position caps.
function dreamTotal(nf) {
  const s = store.state;
  const all = s.players
    .map((p) => ({ p, xp: store.predictedFor(p, nf.get(p.team_id)).xp }))
    .filter((x) => x.p.price > 0)
    .sort((a, b) => b.xp - a.xp);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const squad = [];
  let budget = 100;
  for (const x of all) {
    if (squad.length >= 15) break;
    const pos = x.p.position;
    if (counts[pos] >= CAPS[pos]) continue;
    if (budget < x.p.price) continue;
    squad.push(x);
    counts[pos]++;
    budget -= x.p.price;
  }
  const xi = bestXI(squad, null);
  return xi ? xi.total : null;
}

export const teamRating = {
  id: "team-rating",
  name: "Team Rating",
  icon: "trophy",
  mount(root) {
    const state = {
      mode: "manual",
      q: "",
      open: false,
      openSlot: null,
      slots: SLOT_ORDER.map((pos) => ({ pos, id: null })),
      captainId: null,
      scanStatus: "",
      scanErr: "",
    };
    root.classList.add("tool");
    const unsub = store.subscribe(render);

    function usedIds() {
      return new Set(state.slots.map((s) => s.id).filter(Boolean));
    }

    function searchResults() {
      if (state.openSlot == null) return [];
      const q = state.q.trim().toLowerCase();
      if (!q) return [];
      const pos = state.slots[state.openSlot].pos;
      const used = usedIds();
      return store.state.players
        .filter((p) => p.position === pos && p.name.toLowerCase().includes(q) && !used.has(p.id))
        .sort((a, b) => b.selected_by_percent - a.selected_by_percent)
        .slice(0, 8);
    }

    function counts() {
      const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const s of state.slots) if (s.id) c[s.pos]++;
      return c;
    }

    function add(id) {
      if (state.openSlot == null) return;
      const p = store.player(id);
      if (!p) return;
      if (p.position !== state.slots[state.openSlot].pos) return;
      if (usedIds().has(id)) return;
      state.slots[state.openSlot].id = id;
      state.openSlot = null;
      state.open = false;
      state.q = "";
      render();
    }

    function remove(slotIndex) {
      const id = state.slots[slotIndex].id;
      state.slots[slotIndex].id = null;
      if (state.captainId === id) state.captainId = null;
      render();
    }

    function clear() {
      state.slots = SLOT_ORDER.map((pos) => ({ pos, id: null }));
      state.captainId = null;
      state.openSlot = null;
      state.open = false;
      state.q = "";
      render();
    }

    function fillFromIds(ids, captainId = null) {
      const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
      state.slots = SLOT_ORDER.map((pos) => ({ pos, id: null }));
      for (const id of ids.slice(0, 15)) {
        const p = store.player(id);
        if (!p) continue;
        if (c[p.position] >= CAPS[p.position]) continue;
        const idx = state.slots.findIndex((s) => s.pos === p.position && s.id == null);
        if (idx < 0) continue;
        state.slots[idx].id = id;
        c[p.position]++;
      }
      state.captainId = captainId;
      render();
    }

    // ── OCR upload ─────────────────────────────────────────
    let tesseractP = null;
    function tesseract() {
      if (!tesseractP) {
        tesseractP = import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js")
          .catch(() => null);
      }
      return tesseractP;
    }

    function norm(s) {
      return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ");
    }

    function matchPlayers(text) {
      const t = " " + norm(text).replace(/\s+/g, " ") + " ";
      const scored = [];
      for (const p of store.state.players) {
        const web = norm(p.name).trim();
        const full = norm(p.full_name).trim();
        const last = full.split(" ").filter((w) => w.length > 2).pop() || "";
        let score = 0;
        if (web && t.includes(" " + web + " ")) score = 2;
        else if (web && t.includes(web.replace(/\./g, " "))) score = 2;
        else if (last && t.includes(" " + last + " ")) score = 1;
        if (score > 0) scored.push({ p, score });
      }
      scored.sort((a, b) => b.score - a.score || b.p.selected_by_percent - a.p.selected_by_percent);
      const out = [];
      const seen = new Set();
      const c = { 1: 0, 2: 0, 3: 0, 4: 0 };
      for (const { p } of scored) {
        if (out.length >= 15) break;
        if (seen.has(p.id)) continue;
        if (c[p.position] >= CAPS[p.position]) continue;
        seen.add(p.id);
        c[p.position]++;
        out.push(p.id);
      }
      return out;
    }

    async function scanFile(file) {
      state.scanErr = "";
      state.scanStatus = "Loading OCR engine…";
      render();
      const T = await tesseract();
      if (!T) {
        state.scanStatus = "";
        state.scanErr = "OCR engine failed to load — try building manually.";
        render();
        return;
      }
      state.scanStatus = "Scanning screenshot…";
      render();
      try {
        const url = URL.createObjectURL(file);
        const { data } = await T.recognize(url, "eng", { logger: () => {} });
        URL.revokeObjectURL(url);
        const ids = matchPlayers(data.text || "");
        if (ids.length >= 8) {
          fillFromIds(ids);
          state.scanStatus = `Found ${ids.length} players from the screenshot.`;
        } else if (ids.length) {
          fillFromIds(ids);
          state.scanStatus = `Only ${ids.length} players recognised — check or fix manually.`;
        } else {
          state.scanStatus = "";
          state.scanErr = "Couldn't read any player names — make sure the screenshot shows the team list.";
        }
      } catch (e) {
        state.scanStatus = "";
        state.scanErr = "Scan failed — try again or build manually.";
      }
      render();
    }

    function uploadInput() {
      const input = h("input", {
        class: "input",
        type: "file",
        accept: "image/*",
        style: "max-width:280px",
      });
      input.addEventListener("change", () => {
        const f = input.files && input.files[0];
        if (f) scanFile(f);
      });
      return input;
    }

    function loadMyTeam() {
      const s = store.state;
      if (!s.picks?.picks?.length) {
        state.scanErr = "No FPL team loaded — enter your team ID in the top bar first.";
        render();
        return;
      }
      const ids = [...s.picks.picks].sort((a, b) => a.position - b.position).map((pk) => pk.element);
      const cap = s.picks.picks.find((pk) => pk.is_captain)?.element || null;
      fillFromIds(ids, cap);
      state.scanStatus = "Loaded your FPL team.";
      render();
    }

    // ── Rendering ──────────────────────────────────────────
    function modeTabs() {
      const modes = [
        ["manual", "Build manually"],
        ["upload", "Upload screenshot"],
        ["myteam", "My FPL team"],
      ];
      return h("div", { class: "seg" },
        ...modes.map(([id, label]) =>
          h("button", {
            class: `chip ${state.mode === id ? "chip--on" : ""}`,
            onclick: () => { state.mode = id; state.scanErr = ""; render(); },
          }, label),
        ),
      );
    }

    function slotCell(slot, index) {
      const p = slot.id ? store.player(slot.id) : null;
      if (!p) {
        return h("button", {
          class: "tr-slot empty",
          title: `Add a ${POS_NAME[slot.pos]} — slot ${index + 1}`,
          onclick: () => {
            state.openSlot = index;
            state.q = "";
            state.open = true;
            render();
            root.querySelector(".tr-search-input")?.focus();
          },
        },
          h("span", { class: "tr-slot-plus", html: ICONS.plus }),
        );
      }
      const team = store.state.teams[p.team_id];
      const isCap = state.captainId === p.id;
      return h("div", {
        class: `tr-slot filled ${isCap ? "cap" : ""}`,
        title: isCap ? "Captain — click to unset" : "Click to make captain",
        onclick: () => {
          state.captainId = isCap ? null : p.id;
          render();
        },
      },
        h("button", {
          class: "tr-slot-x",
          title: "Remove",
          onclick: (e) => { e.stopPropagation(); remove(index); },
        }, "×"),
        avatar(p, team, { size: "sm" }),
        h("span", { class: "tr-slot-name" }, p.name),
        h("span", { class: "tr-slot-meta" }, `${team?.short_name || "?"} · ${money(p.price)}`),
        isCap ? h("span", { class: "c-badge" }, "C") : null,
      );
    }

    function board() {
      return h("div", { class: "tr-board" },
        ...[1, 2, 3, 4].map((pos) =>
          h("div", { class: "tr-board-row" },
            h("div", { class: "tr-board-pos" },
              POS_NAME[pos],
              h("span", { class: "tr-board-pos-count" },
                `${state.slots.filter((s) => s.pos === pos && s.id).length}/${CAPS[pos]}`),
            ),
            h("div", { class: "tr-board-slots" },
              ...state.slots
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.pos === pos)
                .map(({ s, i }) => slotCell(s, i)),
            ),
          ),
        ),
      );
    }

    function searchPanel() {
      if (state.openSlot == null) return null;
      const slot = state.slots[state.openSlot];
      const results = searchResults();
      return h("div", { class: "tr-search" },
        h("div", { class: "tr-search-head" },
          h("span", { class: "tr-search-label" }, `Slot ${state.openSlot + 1} · pick a ${POS_NAME[slot.pos]}`),
          h("button", {
            class: "btn",
            onclick: () => { state.openSlot = null; state.open = false; state.q = ""; render(); },
          }, "Close"),
        ),
        h("div", { class: "search-wrap" },
          h("input", {
            class: "input search tr-search-input",
            placeholder: `Search ${POS_NAME[slot.pos]}s…`,
            value: state.q,
            oninput: debounce((e) => { state.q = e.target.value; state.open = true; render(); }, 120),
            onfocus: () => { state.open = true; },
          }),
          state.open && results.length
            ? h("div", { class: "dropdown" },
                results.map((p) => {
                  const team = store.state.teams[p.team_id];
                  return h("button", { class: "dd-item", onclick: () => add(p.id) },
                    avatar(p, team, { size: "sm" }),
                    h("span", null, p.name),
                    h("span", { class: "muted dd-sub" }, `${team?.short_name} · ${money(p.price)}`),
                  );
                }),
              )
            : null,
        ),
        state.q.trim() && !results.length && state.open
          ? h("p", { class: "tr-scan-err" }, "No players match — try another name.")
          : null,
      );
    }

    function picker() {
      const c = counts();
      return h("div", { class: "tr-picker" },
        searchPanel(),
        h("div", { class: "picker-row" },
          h("span", { class: "tr-counts" },
            `GKP ${c[1]}/2 · DEF ${c[2]}/5 · MID ${c[3]}/5 · FWD ${c[4]}/3 · ${c[1] + c[2] + c[3] + c[4]}/15 · click a slot to pick, click a player to make them captain`,
          ),
          h("button", { class: "btn", onclick: clear }, "Clear"),
        ),
        board(),
      );
    }

    function uploadPanel() {
      return h("div", { class: "tr-upload" },
        h("p", { class: "tr-upload-note" }, "Screenshot your team (list view works best), upload it and we'll read the players automatically."),
        uploadInput(),
        state.scanStatus ? h("p", { class: "tr-scan-ok" }, state.scanStatus) : null,
        state.scanErr ? h("p", { class: "tr-scan-err" }, state.scanErr) : null,
        h("p", { class: "tr-upload-alt" }, "Or just build it manually above."),
      );
    }

    function myTeamPanel() {
      const s = store.state;
      return h("div", { class: "tr-upload" },
        (s.teamId
          ? h("p", { class: "tr-upload-note" }, `Team ID ${s.teamId}${s.entry?.name ? " — " + s.entry.name : ""}.`)
          : h("p", { class: "tr-upload-note" }, "Enter your FPL team ID in the top bar, then load your team.")),
        h("button", { class: "btn btn--primary", onclick: loadMyTeam }, "Load my FPL team"),
        state.scanStatus ? h("p", { class: "tr-scan-ok" }, state.scanStatus) : null,
        state.scanErr ? h("p", { class: "tr-scan-err" }, state.scanErr) : null,
      );
    }

    function stars(rating) {
      return h("div", { class: "tr-stars" },
        ...[1, 2, 3, 4, 5].map((i) => {
          const fill = clamp(rating - (i - 1), 0, 1);
          return h("span", { class: "star" },
            h("span", { class: "star-bg", html: STAR_SVG }),
            fill > 0
              ? h("span", { class: "star-fill", style: `width:${(fill * 100).toFixed(1)}%`, html: STAR_SVG })
              : null,
          );
        }),
      );
    }

    function ratingPanel(withXp) {
      const xi = bestXI(withXp, state.captainId);
      if (!xi || withXp.length < 11) {
        return h("div", { class: "card" },
          h("div", { class: "card-title" }, "Rating"),
          h("div", { class: "state" }, `Pick at least 11 players to get a rating (${withXp.length}/15 now).`),
        );
      }
      const nf = nextFixtureMap();
      const dream = dreamTotal(nf);
      const rating = dream ? clamp(5 * xi.total / dream, 0, 5) : 0;
      const value = withXp.reduce((a, x) => a + x.p.price, 0);
      const defs = xi.xi.filter((x) => x.p.position === 2).length;
      const mids = xi.xi.filter((x) => x.p.position === 3).length;
      const fwds = xi.xi.filter((x) => x.p.position === 4).length;

      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Rating"),
        h("div", { class: "tr-panel" },
          h("div", { class: "tr-rating" },
            stars(rating),
            h("div", { class: "tr-num" }, `${rating.toFixed(2)} / 5`),
            h("div", { class: "tr-sub" }, withXp.length < 15 ? `based on ${withXp.length} of 15 players` : "full 15-man squad"),
          ),
          h("div", { class: "stat-grid stat-grid--4" },
            tile("XI points", fmt(xi.total)),
            tile("Squad value", money(value)),
            tile("Formation", `${defs}-${mids}-${fwds}`),
            tile("Captain", xi.cap.p.name),
          ),
        ),
        h("div", { class: "tr-xi" },
          ...xi.xi.map((x) => {
            const flag = flagInfo(x.p);
            return h("div", { class: `tr-xi-row ${x === xi.cap ? "cap" : ""}` },
              h("span", { class: "tr-xi-pos" }, POS_SHORT[x.p.position]),
              avatar(x.p, store.state.teams[x.p.team_id], { size: "sm" }),
              h("span", { class: "tr-xi-name" }, x.p.name),
              x === xi.cap ? h("span", { class: "c-badge inline" }, "C") : null,
              flag.kind !== "ok" ? h("span", { class: `dot dot--${flag.kind === "bad" ? "bad" : "warn"}`, title: flag.reason }) : null,
              h("span", { class: "tr-xi-xp" }, fmt(x.xp)),
            );
          }),
        ),
        h("div", { class: "footnote" },
          dream ? `Your XI is worth ${((xi.total / dream) * 100).toFixed(0)}% of the best budget squad our predictions can build (£100m). Stars = that ratio × 5, to two decimals. Bench counts at 25%.` : ""),
      );
    }

    function render() {
      if (store.state.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      const selPlayers = state.slots.map((s) => s.id && store.player(s.id)).filter(Boolean);
      const nf = nextFixtureMap();
      const withXp = selPlayers.map((p) => ({ p, xp: store.predictedFor(p, nf.get(p.team_id)).xp }));
      if (selPlayers.length) store.enrichPlayers(selPlayers.map((p) => p.id));

      root.replaceChildren(
        h("div", { class: "tool-head" },
          h("div", null,
            h("h2", { class: "tool-title" }, "Team Rating"),
            h("p", { class: "tool-sub" }, "Upload a screenshot or build your squad — get a rating out of 5 stars."),
          ),
          modeTabs(),
        ),
        state.mode === "manual" ? picker() : null,
        state.mode === "upload" ? uploadPanel() : null,
        state.mode === "myteam" ? myTeamPanel() : null,
        ratingPanel(withXp),
      );
    }

    render();
    return () => {
      unsub();
      root.replaceChildren();
      root.classList.remove("tool");
    };
  },
};

function tile(label, val) {
  return h("div", { class: "stat-cell" },
    h("div", { class: "stat-num" }, val),
    h("div", { class: "stat-lbl" }, label),
  );
}
