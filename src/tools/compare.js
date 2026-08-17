import {
  h, money, fmt, pct, POS_SHORT, avatar, fdrBadge, bar, debounce,
} from "../core/ui.js";
import { store } from "../core/data.js";
import { nextFixturesForTeam, pointsPerMillion, teamDifficultyForFixture } from "../core/store.js";

const MAX = 4;

export const playerCompare = {
  id: "compare",
  name: "Player Comparison",
  icon: "compare",
  mount(root) {
    const state = { selected: [], q: "", open: false };
    root.classList.add("tool");
    const unsub = store.subscribe(render);

    function searchResults() {
      const q = state.q.trim().toLowerCase();
      if (!q) return [];
      return store.state.players
        .filter((p) => p.name.toLowerCase().includes(q) && !state.selected.includes(p.id))
        .sort((a, b) => b.selected_by_percent - a.selected_by_percent)
        .slice(0, 8);
    }

    function add(id) {
      if (state.selected.length >= MAX) return;
      if (!state.selected.includes(id)) state.selected.push(id);
      state.q = "";
      state.open = false;
      render();
    }

    function remove(id) {
      state.selected = state.selected.filter((x) => x !== id);
      render();
    }

    function picker() {
      const results = searchResults();
      const chips = state.selected.map((id) => {
        const p = store.player(id);
        if (!p) return null;
        const team = store.state.teams[p.team_id];
        return h("span", { class: "sel-chip" },
          avatar(p, team, { size: "sm" }),
          p.name,
          h("button", { class: "x", onclick: () => remove(id) }, "×"),
        );
      });
      return h("div", { class: "picker" },
        h("div", { class: "picker-row" },
          chips,
          state.selected.length < MAX
            ? h("div", { class: "search-wrap" },
                h("input", {
                  class: "input search", placeholder: "Add player…", value: state.q,
                  oninput: debounce((e) => { state.q = e.target.value; state.open = true; render(); }, 150),
                  onfocus: () => { state.open = true; },
                }),
                state.open && results.length
                  ? h("div", { class: "dropdown" },
                      results.map((p) => {
                        const team = store.state.teams[p.team_id];
                        return h("button", { class: "dd-item", onclick: () => add(p.id) },
                          avatar(p, team, { size: "sm" }),
                          h("span", null, p.name),
                          h("span", { class: "muted dd-sub" }, `${team?.short_name} · ${POS_SHORT[p.position]}`),
                        );
                      }),
                    )
                  : null,
              )
            : h("span", { class: "muted" }, "Maximum 4 players"),
        ),
      );
    }

    function statRow(label, get, { fmtFn = fmt, invert = false, maxNorm } = {}) {
      const vals = state.selected.map((id) => get(store.player(id)) || 0);
      const max = maxNorm ?? Math.max(...vals, 0.0001);
      return h("div", { class: "cmp-row" },
        h("div", { class: "cmp-label" }, label),
        state.selected.map((id, i) => {
          const v = vals[i];
          const isBest = invert ? v === Math.min(...vals) : v === Math.max(...vals);
          return h("div", { class: `cmp-cell ${isBest ? "best" : ""}` },
            h("div", { class: "cmp-val" }, fmtFn(v)),
            bar(v, max, { warn: invert && isBest }),
          );
        }),
      );
    }

    function render() {
      if (store.state.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      const sel = state.selected.map((id) => store.player(id)).filter(Boolean);
      if (sel.length) store.enrichPlayers(sel.map((p) => p.id));

      const header = h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, "Player Comparison"),
          h("p", { class: "tool-sub" }, "Compare up to 4 players side-by-side across key FPL stats."),
        ),
      );

      if (!sel.length) {
        root.replaceChildren(
          header,
          picker(),
          h("div", { class: "state" }, "Search and select players to begin comparing."),
        );
        return;
      }

      const cols = sel.map((p) => {
        const team = store.state.teams[p.team_id];
        const fx = nextFixturesForTeam(p.team_id, store.state.fixturesByTeam, store.state.gameweeks, 5);
        return h("div", { class: "cmp-head" },
          avatar(p, team, { size: "lg" }),
          h("div", { class: "cmp-name" }, p.name),
          h("div", { class: "muted" }, `${team?.short_name || "?"} · ${POS_NAME_FULL(p.position)}`),
          h("div", { class: "cmp-price" }, money(p.price)),
          h("div", { class: "cmp-fixtures" },
            ...fx.map((f) => fdrBadge(teamDifficultyForFixture(p.team_id, f) ?? 3, `GW${f.gameweek_id} v ${(store.state.teams[f.home_team_id === p.team_id ? f.away_team_id : f.home_team_id]?.short_name)}`)),
          ),
        );
      });

      const rows = [
        statRow("Price", (p) => p.price, { fmtFn: money, invert: true }),
        statRow("Form", (p) => p.form),
        statRow("Points per game", (p) => p.points_per_game),
        statRow("Total points", (p) => p.total_points),
        statRow("Points per £m", (p) => pointsPerMillion(p)),
        statRow("Minutes", (p) => p.minutes, { fmtFn: (v) => fmt(v, 0) }),
        statRow("Goals", (p) => p.goals_scored, { fmtFn: (v) => fmt(v, 0) }),
        statRow("Assists", (p) => p.assists, { fmtFn: (v) => fmt(v, 0) }),
        statRow("Clean sheets", (p) => p.clean_sheets, { fmtFn: (v) => fmt(v, 0) }),
        statRow("Goals conceded", (p) => p.goals_conceded, { fmtFn: (v) => fmt(v, 0), invert: true }),
        statRow("Saves", (p) => p.saves, { fmtFn: (v) => fmt(v, 0) }),
        statRow("Bonus", (p) => p.bonus, { fmtFn: (v) => fmt(v, 0) }),
        statRow("BPS", (p) => p.bps, { fmtFn: (v) => fmt(v, 0) }),
        statRow("ICT index", (p) => p.ict_index, { fmtFn: (v) => fmt(v, 1) }),
        statRow("Influence", (p) => p.influence, { fmtFn: (v) => fmt(v, 1) }),
        statRow("Creativity", (p) => p.creativity, { fmtFn: (v) => fmt(v, 1) }),
        statRow("Threat", (p) => p.threat, { fmtFn: (v) => fmt(v, 1) }),
        statRow("Selected by", (p) => p.selected_by_percent, { fmtFn: pct }),
        statRow("Predicted pts (next)", (p) => {
          const fx = nextFixturesForTeam(p.team_id, store.state.fixturesByTeam, store.state.gameweeks, 1)[0];
          return store.predictedFor(p, fx).xp;
        }),
      ];

      root.replaceChildren(
        header,
        picker(),
        h("div", { class: "cmp-grid", style: `grid-template-columns: 150px repeat(${sel.length}, minmax(120px, 1fr))` },
          h("div", { class: "cmp-corner" }),
          ...cols,
          h("div", { class: "cmp-clear" }),
          ...rows,
        ),
      );
    }

    render();
    return () => { unsub(); root.replaceChildren(); root.classList.remove("tool"); };
  },
};

function POS_NAME_FULL(p) {
  return ({ 1: "Goalkeeper", 2: "Defender", 3: "Midfielder", 4: "Forward" })[p] || "?";
}
