import {
  h, money, fmt, pct, POS_SHORT, POS_NAME, avatar, fdrBadge, statusDot, sparkline,
  debounce, crestUrl,
} from "../core/ui.js";
import { store } from "../core/data.js";
import { getElementSummary } from "../core/api.js";
import { nextFixturesForTeam, teamDifficultyForFixture } from "../core/store.js";

export const playerProfiler = {
  id: "profiler",
  name: "Player Profiler",
  icon: "user",
  mount(root) {
    const state = { id: null, q: "", open: false, summary: null };
    root.classList.add("tool");
    const unsub = store.subscribe(render);

    function searchResults() {
      const q = state.q.trim().toLowerCase();
      if (!q) return [];
      return store.state.players
        .filter((p) => p.name.toLowerCase().includes(q))
        .sort((a, b) => b.selected_by_percent - a.selected_by_percent)
        .slice(0, 10);
    }

    function select(id) {
      state.id = id;
      state.q = "";
      state.open = false;
      state.summary = null;
      render();
      store.enrichPlayers([id]);
      getElementSummary(id).then((s) => {
        if (state.id === id) { state.summary = s; render(); }
      }).catch(() => {});
    }

    function searchBox() {
      const results = searchResults();
      return h("div", { class: "search-wrap" },
        h("input", {
          class: "input search", placeholder: "Search player…", value: state.q,
          oninput: debounce((e) => { state.q = e.target.value; state.open = true; render(); }, 150),
          onfocus: () => { state.open = true; },
        }),
        state.open && results.length
          ? h("div", { class: "dropdown" },
              results.map((p) => {
                const team = store.state.teams[p.team_id];
                return h("button", { class: "dd-item", onclick: () => select(p.id) },
                  avatar(p, team, { size: "sm" }),
                  h("span", null, p.name),
                  h("span", { class: "muted dd-sub" }, `${team?.short_name} · ${POS_SHORT[p.position]}`),
                );
              }),
            )
          : null,
      );
    }

    function render() {
      const header = h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, "Player Profiler"),
          h("p", { class: "tool-sub" }, "Deep-dive on any player: season stats, ICT breakdown and fixtures."),
        ),
        searchBox(),
      );

      if (store.state.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      if (!state.id) {
        root.replaceChildren(header, h("div", { class: "state" }, "Search and select a player to view their profile."));
        return;
      }
      const p = store.player(state.id);
      if (!p) {
        root.replaceChildren(header, h("div", { class: "state" }, "Player not found."));
        return;
      }

      root.replaceChildren(header, profile(p));
    }

    function profile(p) {
      const team = store.state.teams[p.team_id];
      const posAvg = positionalAverage(p.position);
      const fx = nextFixturesForTeam(p.team_id, store.state.fixturesByTeam, store.state.gameweeks, 6);
      const nextXp = fx.length ? store.predictedFor(p, fx[0]).xp : null;

      const history = (state.summary?.history || [])
        .filter((h) => h.minutes != null || h.total_points)
        .sort((a, b) => (a.round || 0) - (b.round || 0));
      const points = history.map((h) => h.total_points || 0);

      const hero = h("div", { class: "profile-hero" },
        avatar(p, team, { size: "lg" }),
        h("div", { class: "ph-main" },
          h("div", { class: "ph-name" },
            p.name,
            statusDot(p.status),
          ),
          h("div", { class: "muted" }, `${p.full_name} · ${team?.name || ""}`),
          h("div", { class: "ph-tags" },
            h("span", { class: `pos-tag pos-${p.position}` }, POS_NAME[p.position]),
            h("span", { class: "pill" }, money(p.price)),
            h("span", { class: "pill" }, `ICT rank #${p.ict_index_rank || "?"}`),
          ),
        ),
        h("div", { class: "ph-stats" },
          stat("Form", fmt(p.form)),
          stat("Total", fmt(p.total_points, 0)),
          stat("PPG", fmt(p.points_per_game)),
          stat("Sel %", pct(p.selected_by_percent)),
        ),
      );

      const historyCard = h("div", { class: "card" },
        h("div", { class: "card-title" }, "Season history"),
        points.length
          ? h("div", null,
              sparkline(points, { height: 60 }),
              h("div", { class: "hist-meta" },
                h("span", { class: "muted" }, `${points.length} gameweeks`),
                h("span", { class: "muted" }, `best ${Math.max(...points)} · avg ${(points.reduce((a, b) => a + b, 0) / points.length).toFixed(1)}`),
              ),
            )
          : h("div", { class: "state" }, "Loading history…"),
      );

      const ict = [
        ["Influence", p.influence, posAvg.influence],
        ["Creativity", p.creativity, posAvg.creativity],
        ["Threat", p.threat, posAvg.threat],
        ["ICT index", p.ict_index, posAvg.ict_index],
      ];
      const ictCard = h("div", { class: "card" },
        h("div", { class: "card-title" }, "ICT breakdown"),
        h("div", { class: "stat-bars" },
          ...ict.map(([label, val, avg]) =>
            h("div", { class: "sbar" },
              h("div", { class: "sbar-row" },
                h("span", null, label),
                h("span", { class: "muted" }, `${fmt(val)} · pos avg ${fmt(avg)}`),
              ),
              h("div", { class: "sbar-track" },
                h("i", { style: `width:${Math.min(100, (val / (Math.max(avg, val, 0.0001))) * 100)}%` }),
              ),
            ),
          ),
        ),
      );

      const counts = [
        ["Minutes", p.minutes],
        ["Goals", p.goals_scored],
        ["Assists", p.assists],
        ["Clean sheets", p.clean_sheets],
        ["Goals conceded", p.goals_conceded],
        ["Saves", p.saves],
        ["Bonus", p.bonus],
        ["BPS", p.bps],
        ["xP (next)", nextXp],
      ];
      const seasonCard = h("div", { class: "card" },
        h("div", { class: "card-title" }, "Season stats"),
        h("div", { class: "stat-grid" },
          ...counts.map(([label, val]) =>
            h("div", { class: "stat-cell" },
              h("div", { class: "stat-num" }, val == null ? "—" : fmt(val, Number.isInteger(val) ? 0 : 1)),
              h("div", { class: "stat-lbl" }, label),
            ),
          ),
        ),
      );

      const fixturesCard = h("div", { class: "card" },
        h("div", { class: "card-title" }, "Upcoming fixtures"),
        h("div", { class: "fx-list" },
          ...fx.map((f) => {
            const d = teamDifficultyForFixture(p.team_id, f) ?? 3;
            const home = f.home_team_id === p.team_id;
            const opp = store.state.teams[home ? f.away_team_id : f.home_team_id];
            return h("div", { class: "fx-item" },
              h("span", { class: "gw-pill" }, `GW${f.gameweek_id}`),
              h("span", { class: `h-a ${home ? "on" : ""}` }, home ? "H" : "A"),
              opp?.code ? h("img", { class: "crest", src: crestUrl(opp), alt: "" }) : null,
              h("span", { class: "fx-opp" }, opp?.name || "?"),
              fdrBadge(d),
            );
          }),
        ),
      );

      return h("div", { class: "profile" },
        hero,
        h("div", { class: "profile-grid" },
          historyCard,
          ictCard,
          seasonCard,
          fixturesCard,
        ),
      );
    }

    function stat(label, val) {
      return h("div", { class: "ph-stat" },
        h("div", { class: "ph-stat-num" }, val),
        h("div", { class: "ph-stat-lbl" }, label),
      );
    }

    render();
    return () => { unsub(); root.replaceChildren(); root.classList.remove("tool"); };
  },
};

function positionalAverage(pos) {
  const players = store.state.players.filter((p) => p.position === pos);
  const n = players.length || 1;
  const sum = (key) => players.reduce((a, p) => a + (p[key] || 0), 0) / n;
  return {
    influence: sum("influence"),
    creativity: sum("creativity"),
    threat: sum("threat"),
    ict_index: sum("ict_index"),
  };
}
