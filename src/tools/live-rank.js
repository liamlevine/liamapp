import {
  h, fmt, POS_SHORT, avatar,
} from "../core/ui.js";
import { store } from "../core/data.js";

export const liveRank = {
  id: "live-rank",
  name: "Live Rank",
  icon: "live",
  mount(root) {
    root.classList.add("tool");
    const unsub = store.subscribe(render);
    let timer = null;

    function ensureLive() {
      const cur = store.currentGw();
      if (cur && store.state.liveGw !== cur.id) store.loadLive(cur.id);
    }

    function render() {
      const s = store.state;
      if (s.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      if (!s.teamId) {
        root.replaceChildren(header(), h("div", { class: "state" }, "Enter your FPL team ID in the top bar to see your live rank."));
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
      root.replaceChildren(header(), summary(), table());
    }

    function header() {
      const s = store.state;
      const cur = store.currentGw();
      return h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, "Live Rank"),
          h("p", { class: "tool-sub" },
            cur ? `GW${cur.id} ${cur.finished ? "· finished" : cur.is_current ? "· live now" : "· upcoming"}` : ""),
        ),
        h("div", { class: "tool-actions" },
          s.live ? h("span", { class: "badge badge--avail" }, "LIVE") : h("span", { class: "badge badge--used" }, "OFFLINE"),
        ),
      );
    }

    function liveFor(pick) {
      const s = store.state;
      if (!s.live) return null;
      const el = s.live.elements?.find((x) => x.id === pick.element);
      if (!el) return null;
      return el;
    }

    function summary() {
      const s = store.state;
      const picks = s.picks?.picks || [];
      let total = 0, onPitch = 0, bench = 0;
      for (const pk of picks) {
        const el = liveFor(pk);
        if (!el) continue;
        const pts = (el.stats?.total_points ?? 0) * pk.multiplier;
        total += pts;
        if (pk.position <= 11) onPitch += pts;
        else bench += pts;
      }
      const gw = store.currentGw();
      return h("div", { class: "card" },
        h("div", { class: "live-total" },
          h("div", null,
            h("div", { class: "live-num" }, String(total)),
            h("div", { class: "muted" }, "live points"),
          ),
          h("div", { class: "live-split" },
            h("span", null, `Pitch ${onPitch}`),
            h("span", { class: "muted" }, `Bench ${bench}`),
          ),
        ),
        h("div", { class: "stat-grid stat-grid--4" },
          tile("Overall rank", s.entry?.summary_overall_rank?.toLocaleString() ?? "—"),
          tile("Event rank", s.entry?.summary_event_rank?.toLocaleString() ?? "—"),
          tile("Overall points", s.entry?.summary_overall_points ?? "—"),
          tile("GW average", gw?.average_entry_score != null ? String(gw.average_entry_score) : "—"),
        ),
      );
    }

    function table() {
      const s = store.state;
      const picks = s.picks?.picks || [];
      if (!picks.length) return h("div", { class: "card" }, h("div", { class: "state" }, "No squad set for this gameweek."));
      const sorted = [...picks].sort((a, b) => a.position - b.position);
      const rows = sorted.map((pk) => {
        const p = store.player(pk.element);
        if (!p) return null;
        const el = liveFor(pk);
        const st = el?.stats;
        const team = s.teams[p.team_id];
        return h("tr", null,
          h("td", { class: "rank" }, pk.position <= 11 ? pk.position : `B${pk.position - 11}`),
          h("td", { class: "player" },
            avatar(p, team, { size: "sm" }),
            h("div", { class: "pl-meta" },
              h("div", { class: "pl-name" },
                p.name,
                pk.is_captain ? h("span", { class: "c-badge inline" }, "C") : null,
                pk.is_vice_captain ? h("span", { class: "vc-badge inline" }, "VC") : null,
              ),
              h("div", { class: "pl-sub" }, `${team?.short_name} · ${POS_SHORT[p.position]}`),
            ),
          ),
          h("td", { class: "num" }, st ? fmt(st.minutes, 0) : "—"),
          h("td", { class: "num" }, st ? fmt(st.goals_scored, 0) : "—"),
          h("td", { class: "num" }, st ? fmt(st.assists, 0) : "—"),
          h("td", { class: "num" }, st ? fmt(st.bonus, 0) : "—"),
          h("td", { class: "num xp" }, st ? fmt(st.total_points ?? 0, 0) : "—"),
        );
      }).filter(Boolean);

      return h("div", { class: "card" },
        h("div", { class: "card-title" }, "Player live breakdown"),
        h("div", { class: "table-wrap" },
          h("table", { class: "data-table" },
            h("thead", null,
              h("tr", null,
                h("th", { class: "rank" }, "#"),
                h("th", null, "Player"),
                h("th", null, "Min"),
                h("th", null, "G"),
                h("th", null, "A"),
                h("th", null, "B"),
                h("th", null, "Pts"),
              ),
            ),
            h("tbody", null, ...rows),
          ),
        ),
      );
    }

    ensureLive();
    render();
    timer = setInterval(ensureLive, 60000);
    return () => {
      unsub();
      if (timer) clearInterval(timer);
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
