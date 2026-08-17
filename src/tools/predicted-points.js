import {
  h, money, fmt, POS_SHORT, POS_NAME, avatar, fdrBadge, debounce,
} from "../core/ui.js";
import { store } from "../core/data.js";
import { nextFixturesForTeam } from "../core/store.js";
import { flagInfo } from "../core/xp.js";
import { yt, focalXpMap } from "../core/youtube.js";

function nextFixtureMap() {
  const s = store.state;
  const map = new Map();
  for (const t of Object.values(s.teams)) {
    const f = nextFixturesForTeam(t.id, s.fixturesByTeam, s.gameweeks, 1)[0];
    map.set(t.id, f || null);
  }
  return map;
}

export const predictedPoints = {
  id: "predicted",
  name: "predictedpts",
  icon: "target",
  mount(root) {
    const state = {
      search: "",
      positions: new Set(),
      team: 0,
      minPrice: 0,
      maxPrice: 20,
      sort: { key: "xp", dir: "desc" },
      limit: 60,
      requested: new Set(),
    };
    const MAX_ENRICH = 60;
    root.classList.add("tool");

    const unsub = store.subscribe(render);
    const unsubYt = yt.subscribe(render);

    function ensureEnrichment(rows) {
      const ids = rows.slice(0, MAX_ENRICH).map((r) => r.p.id);
      const fresh = ids.filter((id) => !state.requested.has(id));
      if (!fresh.length) return;
      fresh.forEach((id) => state.requested.add(id));
      store.enrichPlayers(fresh);
    }

    function teamOptions() {
      return [
        h("option", { value: 0 }, "All teams"),
        ...Object.values(store.state.teams)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => h("option", { value: t.id }, t.name)),
      ];
    }

    function togglePos(p) {
      if (state.positions.has(p)) state.positions.delete(p);
      else state.positions.add(p);
      render();
    }

    function setSort(key) {
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "desc" ? "asc" : "desc";
      else {
        state.sort.key = key;
        state.sort.dir = key === "name" ? "asc" : "desc";
      }
      render();
    }

    function compute() {
      const s = store.state;
      const q = state.search.trim().toLowerCase();
      const nf = nextFixtureMap();
      let rows = [];
      for (const p of s.players) {
        if (q && !p.name.toLowerCase().includes(q)) continue;
        if (state.positions.size && !state.positions.has(p.position)) continue;
        if (state.team && p.team_id !== state.team) continue;
        if (p.price < state.minPrice || p.price > state.maxPrice) continue;
        const fixture = nf.get(p.team_id);
        const pred = store.predictedFor(p, fixture);
        rows.push({ p, pred });
      }
      const { key, dir } = state.sort;
      const val = (r) => {
        switch (key) {
          case "name": return r.p.name;
          case "price": return r.p.price;
          case "form": return r.p.form;
          case "ppg": return r.p.points_per_game;
          case "ict": return r.p.ict_index;
          case "sel": return r.p.selected_by_percent;
          case "total": return r.p.total_points;
          case "fdr": return r.pred.fdr;
          default: return r.pred.xp;
        }
      };
      rows.sort((a, b) => {
        const av = val(a), bv = val(b);
        if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        return dir === "asc" ? av - bv : bv - av;
      });
      return rows;
    }

    function formTier(pts) {
      if (pts >= 10) return "f3";
      if (pts >= 6) return "f2";
      if (pts >= 3) return "f1";
      return "f0";
    }

    function formCell(form) {
      if (!form || !form.length) {
        return h("td", {
          class: "num muted",
          title: "Last-5 form appears once gameweeks are played",
        }, "—");
      }
      const pts = form.map((f) => f.pts);
      const recent = pts.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, pts.slice(3).length);
      const earlier = pts.slice(0, 3).reduce((a, b) => a + b, 0) / Math.max(1, pts.slice(0, 3).length);
      const trend = recent - earlier;
      return h("td", { class: "form" },
        h("div", { class: "form-strip" },
          ...form.map((f) =>
            h("span", {
              class: `form-box ${formTier(f.pts)}`,
              title: `GW${f.r} · ${f.pts} pts`,
            }, String(f.pts)),
          ),
          h("span", {
            class: `form-trend ${trend > 0.5 ? "up" : trend < -0.5 ? "down" : "flat"}`,
            title: trend > 0.5
              ? `Improving · +${(trend).toFixed(1)} pts vs earlier`
              : trend < -0.5
                ? `Declining · ${trend.toFixed(1)} pts vs earlier`
                : "Steady form",
          }, trend > 0.5 ? "▲" : trend < -0.5 ? "▼" : "—"),
        ),
      );
    }

    function th(label, key, opts = {}) {
      const active = state.sort.key === key;
      const arrow = active ? (state.sort.dir === "desc" ? " ▾" : " ▴") : "";
      return h("th", {
        class: `sortable ${active ? "active" : ""} ${opts.class || ""}`,
        onclick: () => setSort(key),
      }, label + arrow);
    }

    function render() {
      if (store.state.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      if (store.state.error) {
        root.replaceChildren(h("div", { class: "state state--err" }, `Error: ${store.state.error}`));
        return;
      }
      const rows = compute();
      ensureEnrichment(rows);
      const visible = rows.slice(0, state.limit);
      const gw = store.currentGw();
      const dl = gw ? new Date(gw.deadline_time) : null;

      const posBtns = [1, 2, 3, 4].map((p) =>
        h("button", {
          class: `chip ${state.positions.has(p) ? "chip--on" : ""}`,
          onclick: () => togglePos(p),
        }, POS_SHORT[p]),
      );

      const controls = h("div", { class: "controls" },
        h("input", {
          class: "input search", type: "search", placeholder: "Search player…",
          value: state.search,
          oninput: debounce((e) => { state.search = e.target.value; render(); }),
        }),
        h("div", { class: "seg" }, ...posBtns),
        h("select", {
          class: "input", value: state.team,
          onchange: (e) => { state.team = parseInt(e.target.value, 10) || 0; render(); },
        }, ...teamOptions()),
        h("div", { class: "price" },
          h("input", {
            class: "input", type: "number", step: "0.5", min: "0", max: "20", value: state.minPrice,
            oninput: debounce((e) => { state.minPrice = parseFloat(e.target.value) || 0; render(); }),
          }),
          h("span", null, "–"),
          h("input", {
            class: "input", type: "number", step: "0.5", min: "0", max: "20", value: state.maxPrice,
            oninput: debounce((e) => { state.maxPrice = parseFloat(e.target.value) || 20; render(); }),
          }),
        ),
        h("select", {
          class: "input", value: state.limit,
          onchange: (e) => { state.limit = parseInt(e.target.value, 10) || 60; render(); },
        },
          h("option", { value: 30 }, "Top 30"),
          h("option", { value: 60 }, "Top 60"),
          h("option", { value: 100 }, "Top 100"),
        ),
      );

      const tbody = visible.map((r, i) => {
        const { p, pred } = r;
        const team = store.state.teams[p.team_id];
        const xp = pred.xp;
        const flag = flagInfo(p);
        const focal = focalXpMap().get(p.id);
        const rowCls = [
          "row",
          i < 3 ? "row--hot" : "",
          flag.kind === "bad" ? "row--bad" : flag.kind === "warn" ? "row--warn" : "",
        ].filter(Boolean).join(" ");
        return h("tr", { class: rowCls },
          h("td", { class: "rank" }, i + 1),
          h("td", { class: "player" },
            avatar(p, team, { size: "sm" }),
            h("div", { class: "pl-meta" },
              h("div", { class: "pl-name" },
                p.name,
                flag.kind !== "ok"
                  ? h("span", {
                      class: `dot dot--${flag.kind === "bad" ? "bad" : "warn"}`,
                      title: flag.reason,
                    })
                  : null,
              ),
              h("div", { class: "pl-sub" }, `${team?.short_name || "?"} · ${POS_NAME[p.position]}`),
            ),
          ),
          h("td", { class: "num price" }, money(p.price)),
          formCell(pred.form),
          h("td", { class: "num" }, fmt(p.points_per_game)),
          h("td", { class: "num" }, fmt(p.ict_index)),
          h("td", { class: "num muted" }, p.ep_next != null ? fmt(p.ep_next) : "—"),
          h("td", {
            class: "num yt-xp",
            title: focal ? (focal.quote ? `Focal GW${focal.gw}: "${focal.quote}"` : `Focal GW${focal.gw}`) : "Not in Focal's latest Players to Buy",
          }, focal ? (focal.xp != null ? fmt(focal.xp) : focal.xp5 != null ? `${fmt(focal.xp5)}·5` : "—") : "—"),
          h("td", { class: "fixture" },
            pred.opponent
              ? h("div", { class: "fx" },
                  h("span", { class: `h-a ${pred.home ? "on" : ""}` }, pred.home ? "H" : "A"),
                  h("img", { class: "crest", src: crest(pred.opponent), alt: "" }),
                  pred.opponent.short_name,
                  fdrBadge(pred.fdr),
                )
              : h("span", { class: "muted" }, "—"),
          ),
          h("td", {
            class: `xp ${pred.source === "blend" ? "xp--approx" : ""}`,
            title: pred.source === "opta"
              ? `OPTA xP · rate ${fmt(pred.rate)}/90 · starts ${Math.round((pred.avail || 1) * 100)}% · ${Math.round(pred.expMins)} mins · FDR ${pred.fdr} ${pred.home ? "H" : "A"}`
              : "Blend estimate — OPTA-style xP still loading",
          }, pred.source === "blend" ? `≈${fmt(xp)}` : fmt(xp)),
        );
      });

      root.replaceChildren(
        h("div", { class: "tool-head" },
          h("div", null,
            h("h2", { class: "tool-title" }, "predictedpts"),
            h("p", { class: "tool-sub" },
              gw ? `Next up: GW${gw.id} · deadline ${dl.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${dl.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "OPTA-style predicted points for the next gameweek."),
          ),
        ),
        controls,
        h("div", { class: "table-wrap" },
          h("table", { class: "data-table" },
            h("thead", null,
              h("tr", null,
                h("th", { class: "rank" }, "#"),
                h("th", null, "Player"),
                th("Price", "price"),
                th("Form (last 5)", "form"),
                th("PPG", "ppg"),
                th("ICT", "ict"),
                h("th", { class: "muted" }, "FPL xP"),
                h("th", { class: "muted" }, "Focal xP"),
                th("Fixture", "fdr"),
                th("Predicted (if starting)", "xp", { class: "xp" }),
              ),
            ),
            h("tbody", null, ...tbody),
          ),
        ),
        h("div", { class: "footnote" },
          footnote(rows)),
      );
    }

    function footnote(rows) {
      const top = rows.slice(0, MAX_ENRICH);
      const ready = top.filter((r) => r.pred.source === "opta").length;
      const loading = ready < top.length ? `Loading OPTA-style predictions… ${ready}/${top.length} ready. ` : "";
      return loading +
        "Predicted (if starting) = OPTA-style expected points (xG, xA, xCS, xGC, saves, bonus, appearance) × expected minutes × fixture difficulty, calibrated to Fantasy Football Hub's predicted-points scale. Minutes are never certain — starts % and chance of playing are built in. Focal xP is taken from his latest weekly 'Players to Buy' video transcript.";
    }

    render();
    return () => {
      unsub();
      unsubYt();
      root.replaceChildren();
      root.classList.remove("tool");
    };
  },
};

function crest(team) {
  if (!team?.code) return "";
  return `https://resources.premierleague.com/premierleague/badges/50/t${team.code}.png`;
}
