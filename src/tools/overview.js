import { h, fmt, crestUrl, fdrBadge, avatar } from "../core/ui.js";
import { store } from "../core/data.js";
import { flagInfo } from "../core/xp.js";
import { nextFixturesForTeam } from "../core/store.js";
import { yt, focalXpMap, latestVideos } from "../core/youtube.js";

function nextFixtureMap() {
  const s = store.state;
  const map = new Map();
  for (const t of Object.values(s.teams)) {
    const f = nextFixturesForTeam(t.id, s.fixturesByTeam, s.gameweeks, 1)[0];
    map.set(t.id, f || null);
  }
  return map;
}

function card(title, ...kids) {
  return h("div", { class: "dash-card" },
    h("div", { class: "dash-title" }, title),
    h("div", { class: "dash-body" }, ...kids),
  );
}

export const overview = {
  id: "overview",
  name: "Overview",
  icon: "home",
  mount(root) {
    root.classList.add("tool");
    const unsub = store.subscribe(render);
    const unsubYt = yt.subscribe(render);

    function render() {
      const s = store.state;
      if (s.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      if (s.error) {
        root.replaceChildren(h("div", { class: "state state--err" }, `Error: ${s.error}`));
        return;
      }
      root.replaceChildren(
        h("div", { class: "tool-head" },
          h("div", null,
            h("h2", { class: "tool-title" }, "Dashboard"),
            h("p", { class: "tool-sub" }, "Everything that matters, at a glance."),
          ),
        ),
        h("div", { class: "dash-grid" },
          gameweekCard(),
          teamNewsCard(),
          predictedCard(),
          transfersCard(),
          fixturesCard(),
          liveCard(),
          focalBuyCard(),
          youTubeCard(),
        ),
      );
    }

    function focalBuyCard() {
      const map = focalXpMap();
      const rows = [...map.entries()]
        .filter(([, v]) => v.xp != null)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 6);
      if (!rows.length) return null;
      const gw = map.values().next().value?.gw || "?";
      return card(`Focal · Players to Buy · GW${gw}`,
        ...rows.map(([pid, v]) => {
          const p = store.player(pid);
          if (!p) return null;
          return h("div", { class: "dash-row dash-mini" },
            avatar(p, store.state.teams[p.team_id], { size: "sm" }),
            h("span", { class: "dash-mini-name" }, p.name),
            h("span", { class: "dash-mini-team" }, store.state.teams[p.team_id]?.short_name || "?"),
            h("span", { class: "dash-xp" }, fmt(v.xp)),
          );
        }).filter(Boolean),
      );
    }

    function youTubeCard() {
      const vids = latestVideos(6).filter((v) => v.kind !== "other");
      if (!vids.length) return null;
      return card("Latest YouTube",
        ...vids.map((v) =>
          h("a", { class: "dash-row yt-dash-link", href: v.url, target: "_blank", rel: "noopener" },
            h("span", { class: `yt-kind yt-kind--${v.kind}` }, v.kind === "reveal" ? "TEAM" : "BUY"),
            h("span", { class: "dash-news-name", style: "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, v.title),
            h("span", { class: "dash-news-team" }, v.channel),
          ),
        ),
      );
    }

    function gameweekCard() {
      const cur = store.currentGw();
      if (!cur) return card("Gameweek", h("div", { class: "dash-empty" }, "No gameweek data yet."));
      const d = new Date(cur.deadline_time);
      const state = cur.finished ? "Finished" : cur.is_current ? "Live now" : "Upcoming";
      const rows = [
        ["Status", state],
        ["Deadline", `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`],
      ];
      if (cur.average_entry_score != null) rows.push(["Average score", String(cur.average_entry_score)]);
      if (cur.highest_score != null) rows.push(["Highest score", String(cur.highest_score)]);
      return card(`GW${cur.id}`,
        ...rows.map(([k, v]) =>
          h("div", { class: "dash-kv" },
            h("span", { class: "dash-k" }, k),
            h("span", { class: "dash-v" }, v),
          ),
        ),
      );
    }

    function teamNewsCard() {
      const s = store.state;
      const flagged = s.players
        .filter((p) => p.status !== "a")
        .sort((a, b) => b.selected_by_percent - a.selected_by_percent)
        .slice(0, 8);
      if (!flagged.length) {
        return card("Team news", h("div", { class: "dash-empty" }, "No flagged players — clean bill of health."));
      }
      return card("Team news",
        ...flagged.map((p) => {
          const f = flagInfo(p);
          const team = s.teams[p.team_id];
          return h("div", { class: "dash-row flag-row" },
            h("span", { class: `dot dot--${f.kind === "bad" ? "bad" : "warn"}`, title: f.reason }),
            h("span", { class: "dash-news-name" }, p.name),
            h("span", { class: "dash-news-team" }, team?.short_name || "?"),
            h("span", { class: "dash-news-reason" }, f.reason),
          );
        }),
      );
    }

    function predictedCard() {
      const s = store.state;
      const nf = nextFixtureMap();
      const rows = s.players
        .map((p) => ({ p, pred: store.predictedFor(p, nf.get(p.team_id)) }))
        .sort((a, b) => b.pred.xp - a.pred.xp)
        .slice(0, 6);
      store.enrichPlayers(rows.map((r) => r.p.id));
      return card("Top predicted",
        ...rows.map((r, i) => {
          const team = s.teams[r.p.team_id];
          return h("div", { class: "dash-row dash-mini" },
            h("span", { class: "dash-rank" }, String(i + 1).padStart(2, "0")),
            avatar(r.p, team, { size: "sm" }),
            h("span", { class: "dash-mini-name" }, r.p.name),
            h("span", { class: "dash-mini-team" }, team?.short_name || "?"),
            h("span", { class: `dash-xp ${r.pred.source === "blend" ? "muted" : ""}` }, r.pred.source === "blend" ? `≈${fmt(r.pred.xp)}` : fmt(r.pred.xp)),
          );
        }),
      );
    }

    function transfersCard() {
      const s = store.state;
      const byIn = [...s.players].sort((a, b) => b.transfers_in - a.transfers_in).slice(0, 5);
      const byOut = [...s.players].sort((a, b) => b.transfers_out - a.transfers_out).slice(0, 5);
      const col = (label, rows, key) =>
        h("div", { class: "dash-transfer-col" },
          h("div", { class: "dash-transfer-label" }, label),
          ...rows.map((p) =>
            h("div", { class: "dash-row" },
              h("span", { class: "dash-news-name" }, p.name),
              h("span", { class: "dash-news-team" }, s.teams[p.team_id]?.short_name || "?"),
              h("span", { class: `dash-count ${key === "in" ? "good" : "bad"}` },
                `${key === "in" ? "▲" : "▼"} ${(p[key === "in" ? "transfers_in" : "transfers_out"] || 0).toLocaleString()}`),
            ),
          ),
        );
      return card("Transfer market",
        h("div", { class: "dash-transfer" },
          col("Most bought", byIn, "in"),
          col("Most sold", byOut, "out"),
        ),
      );
    }

    function fixturesCard() {
      const s = store.state;
      const gw = s.gameweeks.filter((g) => !g.finished)[0];
      const fs = gw ? s.fixturesByGameweek.get(gw.id) || [] : [];
      if (!fs.length) return card("Next fixtures", h("div", { class: "dash-empty" }, "No fixtures found."));
      const sorted = [...fs].sort((a, b) => new Date(a.kickoff_time) - new Date(b.kickoff_time));
      return card(`Fixtures · GW${gw.id}`,
        ...sorted.map((f) => {
          const hTeam = s.teams[f.home_team_id];
          const aTeam = s.teams[f.away_team_id];
          const d = new Date(f.kickoff_time);
          return h("div", { class: "dash-row dash-fixture" },
            h("span", { class: "dash-fx-team" },
              hTeam?.code ? h("img", { class: "crest", src: crestUrl(hTeam), alt: "" }) : null,
              hTeam?.short_name,
            ),
            fdrBadge(f.home_difficulty ?? 3),
            h("span", { class: "dash-fx-v" }, "v"),
            fdrBadge(f.away_difficulty ?? 3),
            h("span", { class: "dash-fx-team" },
              aTeam?.short_name,
              aTeam?.code ? h("img", { class: "crest", src: crestUrl(aTeam), alt: "" }) : null,
            ),
            h("span", { class: "dash-fx-time" },
              `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`),
          );
        }),
      );
    }

    function liveCard() {
      const s = store.state;
      if (!s.live?.elements) {
        return card("Live bonus", h("div", { class: "dash-empty" }, "Live data appears once the gameweek kicks off."));
      }
      const top = s.live.elements
        .filter((e) => (e.stats?.bonus || 0) > 0)
        .sort((a, b) => (b.stats?.bonus || 0) - (a.stats?.bonus || 0))
        .slice(0, 5);
      if (!top.length) return card("Live bonus", h("div", { class: "dash-empty" }, "No bonus points yet."));
      return card("Live bonus",
        ...top.map((e) => {
          const p = store.player(e.id);
          if (!p) return null;
          return h("div", { class: "dash-row dash-mini" },
            avatar(p, s.teams[p.team_id], { size: "sm" }),
            h("span", { class: "dash-mini-name" }, p.name),
            h("span", { class: "dash-mini-team" }, s.teams[p.team_id]?.short_name || "?"),
            h("span", { class: "dash-xp good" }, `+${e.stats.bonus}`),
          );
        }).filter(Boolean),
      );
    }

    render();
    return () => { unsub(); unsubYt(); root.replaceChildren(); root.classList.remove("tool"); };
  },
};
