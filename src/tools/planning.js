import {
  h, money, POS_NAME, avatar, statusDot,
} from "../core/ui.js";
import { store } from "../core/data.js";
import { getCurrentGameweek } from "../core/store.js";

const CHIP_META = {
  wildcard: { name: "Wildcard", short: "WC", desc: "Unlimited free transfers for one gameweek.", icon: "🔁" },
  freehit: { name: "Free Hit", short: "FH", desc: "Build a one-week squad, then revert.", icon: "🎯" },
  bboost: { name: "Bench Boost", short: "BB", desc: "Bench players also score points.", icon: "🪑" },
  "3xc": { name: "Triple Captain", short: "TC", desc: "Captain scores triple points.", icon: "👑" },
};

export const chipPlanning = {
  id: "planning",
  name: "Team & Chip Planning",
  icon: "chip",
  mount(root) {
    root.classList.add("tool");
    const unsub = store.subscribe(render);

    function render() {
      const s = store.state;
      if (s.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      if (!s.teamId) {
        root.replaceChildren(header(), h("div", { class: "state" }, "Enter your FPL team ID in the top bar to plan your team and chips."));
        return;
      }
      if (s.teamLoading) {
        root.replaceChildren(header(), h("div", { class: "state" }, "Loading your team…"));
        return;
      }
      if (s.teamError) {
        root.replaceChildren(header(), h("div", { class: "state state--err" }, s.teamError));
        return;
      }
      root.replaceChildren(header(), budget(), chips(), squad());
    }

    function header() {
      return h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, "Team & Chip Planning"),
          h("p", { class: "tool-sub" }, "Budget overview, squad value and smart chip strategy."),
        ),
      );
    }

    function budget() {
      const s = store.state;
      const e = s.entry;
      const bank = e ? (e.last_deadline_bank ?? 0) / 10 : 0;
      const value = e ? (e.last_deadline_value ?? 0) / 10 : 0;
      const inBank = e ? (e.last_deadline_value ?? 0) / 10 : 0;
      const gw = s.picks?.entry_history;
      const freeTransfers = gw?.event_transfers ?? 0;
      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Budget"),
        h("div", { class: "stat-grid stat-grid--5" },
          tile("Team value", money(value)),
          tile("In the bank", money(bank)),
          tile("Selling value", money(inBank)),
          tile("Free transfers", String(freeTransfers)),
          tile("Overall rank", e?.summary_overall_rank ? e.summary_overall_rank.toLocaleString() : "—"),
        ),
      );
    }

    function chips() {
      const s = store.state;
      const used = {};
      for (const c of s.history?.chips || []) used[c.name.toLowerCase()] = c.event;

      const dgw = detectDoubleGameweeks(s);
      const bgw = detectBlankGameweeks(s);

      const suggest = (chip) => {
        const key = chip;
        switch (key) {
          case "wildcard": return wildcardTip(s);
          case "freehit": return bgw ? `Use on GW${bgw.id} (blank week for ${bgw.teams.length} teams).` : "Use on a blank gameweek to avoid missing players.";
          case "bboost": return dgw ? `Use on GW${dgw.id} (${dgw.teams.length} teams double).` : "Save for a double gameweek.";
          case "3xc": return dgw ? `Use on GW${dgw.id} on a premium captain.` : "Best used on a double gameweek.";
        }
        return "";
      };

      const cards = Object.entries(CHIP_META).map(([key, meta]) => {
        const gwUsed = used[key];
        return h("div", { class: `chip-card ${gwUsed ? "used" : "avail"}` },
          h("div", { class: "chip-icon" }, meta.icon),
          h("div", { class: "chip-name" }, meta.name),
          h("div", { class: "chip-desc" }, meta.desc),
          gwUsed
            ? h("span", { class: "badge badge--used" }, `Used GW${gwUsed}`)
            : h("div", null,
                h("span", { class: "badge badge--avail" }, "Available"),
                h("div", { class: "chip-tip" }, suggest(key)),
              ),
        );
      });

      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Chips"),
        h("div", { class: "chip-grid" }, ...cards),
      );
    }

    function squad() {
      const s = store.state;
      const picks = s.picks?.picks;
      if (!picks?.length) return h("div", { class: "card" }, h("div", { class: "state" }, "No squad data for this gameweek yet."));
      const order = { 1: 0, 2: 1, 3: 2, 4: 3 };
      const sorted = [...picks].sort((a, b) => {
        const pa = store.player(a.element), pb = store.player(b.element);
        return (order[pa?.position] ?? 9) - (order[pb?.position] ?? 9);
      });
      const groups = {};
      for (const pk of sorted) {
        const p = store.player(pk.element);
        if (!p) continue;
        const key = p.position;
        (groups[key] = groups[key] || []).push({ p, pk });
      }
      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Your squad"),
        h("div", { class: "squad-groups" },
          ...[1, 2, 3, 4].filter((k) => groups[k]).map((k) =>
            h("div", { class: "sg" },
              h("div", { class: "sg-title" }, POS_NAME[k]),
              h("div", { class: "sg-row" },
                ...groups[k].map(({ p, pk }) =>
                  h("div", { class: `p-card ${pk.position > 11 ? "bench" : ""}` },
                    avatar(p, store.state.teams[p.team_id]),
                    h("div", { class: "p-name" }, p.name),
                    h("div", { class: "p-meta" },
                      store.state.teams[p.team_id]?.short_name,
                      pk.is_captain ? " · C" : pk.is_vice_captain ? " · VC" : "",
                    ),
                    h("div", { class: "p-price" }, money(p.price)),
                    statusDot(p.status),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    render();
    return () => { unsub(); root.replaceChildren(); root.classList.remove("tool"); };
  },
};

function tile(label, val) {
  return h("div", { class: "stat-cell" },
    h("div", { class: "stat-num" }, val),
    h("div", { class: "stat-lbl" }, label),
  );
}

// A gameweek is a "double" when any team plays more than once.
function detectDoubleGameweeks(s) {
  const cur = getCurrentGameweek(s.gameweeks)?.id || 1;
  let best = null;
  for (const gw of s.gameweeks.filter((g) => g.id >= cur)) {
    const fs = s.fixturesByGameweek.get(gw.id) || [];
    const count = new Map();
    for (const f of fs) {
      count.set(f.home_team_id, (count.get(f.home_team_id) || 0) + 1);
      count.set(f.away_team_id, (count.get(f.away_team_id) || 0) + 1);
    }
    const teams = [...count.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    if (teams.length && (!best || teams.length > best.teams.length)) best = { id: gw.id, teams };
  }
  return best;
}

function detectBlankGameweeks(s) {
  const cur = getCurrentGameweek(s.gameweeks)?.id || 1;
  for (const gw of s.gameweeks.filter((g) => g.id >= cur)) {
    const fs = s.fixturesByGameweek.get(gw.id) || [];
    const playing = new Set();
    for (const f of fs) {
      playing.add(f.home_team_id);
      playing.add(f.away_team_id);
    }
    const blanks = Object.values(s.teams).filter((t) => !playing.has(t.id));
    if (blanks.length) return { id: gw.id, teams: blanks };
  }
  return null;
}

function wildcardTip(s) {
  const injured = s.players.filter((p) => p.status !== "a").length;
  return injured > 20
    ? `${injured} players flagged — wildcard now to clear injuries.`
    : "Available. Best used after an international break or injury crisis.";
}
