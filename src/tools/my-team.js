import {
  h, money, POS_SHORT, avatar, statusDot, fdrColor,
} from "../core/ui.js";
import { store } from "../core/data.js";
import { nextFixturesForTeam, teamDifficultyForFixture } from "../core/store.js";

export const myTeam = {
  id: "my-team",
  name: "My Team",
  icon: "team",
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
        root.replaceChildren(header(), h("div", { class: "state" }, "Enter your FPL team ID in the top bar to load your team."));
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
      root.replaceChildren(header(), summary(), pitch(), bench());
    }

    function header() {
      const s = store.state;
      return h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, s.entry?.name || "My Team"),
          h("p", { class: "tool-sub" }, `FPL team ID ${s.teamId}`),
        ),
        h("div", { class: "tool-actions" },
          s.entry?.player_first_name
            ? h("span", { class: "muted" }, `${s.entry.player_first_name} ${s.entry.player_last_name}`)
            : null,
        ),
      );
    }

    function summary() {
      const s = store.state;
      const e = s.entry;
      const cur = s.history?.current?.[s.history.current.length - 1];
      return h("div", { class: "card" },
        h("div", { class: "stat-grid stat-grid--6" },
          tile("Overall rank", e?.summary_overall_rank ? e.summary_overall_rank.toLocaleString() : "—"),
          tile("Overall points", e?.summary_overall_points ?? "—"),
          tile("GW points", e?.summary_event_points ?? "—"),
          tile("Team value", e ? money(e.last_deadline_value / 10) : "—"),
          tile("In bank", e ? money((e.last_deadline_bank ?? 0) / 10) : "—"),
          tile("Total transfers", e?.last_deadline_total_transfers ?? "—"),
        ),
      );
    }

    function livePoints(pick) {
      const s = store.state;
      if (!s.live || s.liveGw !== (s.picksGw)) return null;
      const el = s.live.elements?.find((x) => x.id === pick.element);
      if (!el) return null;
      const pts = el.stats?.total_points ?? 0;
      return pts * pick.multiplier;
    }

    function playerCell(pick, { live = false } = {}) {
      const s = store.state;
      const p = store.player(pick.element);
      if (!p) return null;
      const team = s.teams[p.team_id];
      const lp = livePoints(pick);
      const fx = nextFixturesForTeam(p.team_id, s.fixturesByTeam, s.gameweeks, 1)[0];
      const fdr = fx ? teamDifficultyForFixture(p.team_id, fx) : null;
      return h("div", { class: `mt-player ${pick.position > 11 ? "bench" : ""}` },
        pick.is_captain ? h("span", { class: "c-badge" }, "C") : null,
        pick.is_vice_captain ? h("span", { class: "vc-badge" }, "VC") : null,
        avatar(p, team),
        h("div", { class: "mt-name" }, p.name),
        h("div", { class: "mt-sub" }, `${team?.short_name} · ${money(p.price)}`),
        lp != null
          ? h("div", { class: `mt-pts ${lp >= 6 ? "good" : lp <= 1 ? "bad" : ""}` }, String(lp))
          : fdr != null
            ? h("div", { class: "mt-fdr", style: `background:${fdrColor(fdr)}` }, `${fx.home_team_id === p.team_id ? "H" : "A"} ${fx.away_team_id === p.team_id ? "" : ""}· FDR ${fdr}`)
            : null,
        statusDot(p.status),
      );
    }

    function pitch() {
      const s = store.state;
      const picks = s.picks?.picks || [];
      if (!picks.length) return h("div", { class: "card" }, h("div", { class: "state" }, "No squad set for this gameweek yet."));
      const starters = picks.filter((pk) => pk.position <= 11).sort((a, b) => a.position - b.position);
      const byPos = { 1: [], 2: [], 3: [], 4: [] };
      for (const pk of starters) {
        const p = store.player(pk.element);
        if (p) byPos[p.position].push(pk);
      }
      const rows = [1, 2, 3, 4].map((k) => ({ k, picks: byPos[k] }));

      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Starting XI"),
        h("div", { class: "pitch" },
          ...rows.map((r) =>
            h("div", { class: "pitch-row" },
              h("div", { class: "pitch-pos" }, POS_SHORT[r.k]),
              h("div", { class: "pitch-players" },
                ...r.picks.map((pk) => playerCell(pk)),
              ),
            ),
          ),
        ),
      );
    }

    function bench() {
      const s = store.state;
      const picks = s.picks?.picks || [];
      const subs = picks.filter((pk) => pk.position > 11).sort((a, b) => a.position - b.position);
      if (!subs.length) return null;
      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Bench"),
        h("div", { class: "bench" }, ...subs.map((pk) => playerCell(pk))),
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
