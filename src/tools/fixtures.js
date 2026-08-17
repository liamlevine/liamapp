import { h, fdrBadge, crestUrl } from "../core/ui.js";
import { store } from "../core/data.js";
import { teamDifficultyForFixture } from "../core/store.js";

export const fixtureAnalyser = {
  id: "fixtures",
  name: "Fixture Analyser",
  icon: "grid",
  mount(root) {
    const state = { weeks: 6, sort: "ease" };
    root.classList.add("tool");
    const unsub = store.subscribe(render);

    function render() {
      if (store.state.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      const s = store.state;
      const cur = store.currentGw()?.id || 1;
      const gws = s.gameweeks.filter((g) => g.id >= cur).slice(0, state.weeks);

      const teams = Object.values(s.teams);
      const matrix = teams.map((t) => {
        const row = gws.map((gw) => {
          const fs = s.fixturesByGameweek.get(gw.id) || [];
          const f = fs.find((x) => x.home_team_id === t.id || x.away_team_id === t.id);
          if (!f) return null;
          const d = teamDifficultyForFixture(t.id, f);
          const oppId = f.home_team_id === t.id ? f.away_team_id : f.home_team_id;
          return { f, d, opp: s.teams[oppId], home: f.home_team_id === t.id };
        });
        const avg = row.reduce((a, c) => a + (c ? c.d : 0), 0) / (row.filter(Boolean).length || 1);
        return { t, row, avg };
      });

      matrix.sort((a, b) =>
        state.sort === "name" ? a.t.name.localeCompare(b.t.name) : a.avg - b.avg,
      );

      const header = h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, "Fixture Analyser"),
          h("p", { class: "tool-sub" }, "Fixture Difficulty Rating (FDR) heatmap for the coming gameweeks."),
        ),
        h("div", { class: "tool-actions" },
          h("div", { class: "seg" },
            [3, 5, 6, 8].map((n) =>
              h("button", {
                class: `chip ${state.weeks === n ? "chip--on" : ""}`,
                onclick: () => { state.weeks = n; render(); },
              }, `${n} GW`),
            ),
          ),
          h("select", {
            class: "input", value: state.sort,
            onchange: (e) => { state.sort = e.target.value; render(); },
          },
            h("option", { value: "ease" }, "Sort: easiest first"),
            h("option", { value: "name" }, "Sort: A–Z"),
          ),
        ),
      );

      const legend = h("div", { class: "legend" },
        h("span", { class: "muted" }, "FDR"),
        [1, 2, 3, 4, 5].map((n) => fdrBadge(n)),
        h("span", { class: "muted", style: "margin-left:8px" }, "H = home · A = away"),
      );

      const thead = h("tr", null,
        h("th", { class: "team-col" }, "Team"),
        ...gws.map((gw) => h("th", { class: "gw-col" }, `GW${gw.id}`)),
        h("th", { class: "avg-col" }, "Avg"),
      );

      const tbody = matrix.map(({ t, row, avg }) =>
        h("tr", { class: "fx-row" },
          h("td", { class: "team-col" },
            h("div", { class: "team-name" },
              t.code ? h("img", { class: "crest", src: crestUrl(t), alt: "" }) : null,
              t.short_name,
            ),
          ),
          ...row.map((c) =>
            h("td", { class: "fx-cell" },
              c
                ? h("div", {
                    class: `fx-cell-in fdr-${c.d}`,
                    title: `${c.home ? "Home" : "Away"} v ${c.opp?.name} · FDR ${c.d}`,
                  },
                    h("span", { class: "h-a" }, c.home ? "H" : "A"),
                    h("span", { class: "opp" }, c.opp?.short_name),
                  )
                : h("span", { class: "muted" }, "–"),
            ),
          ),
          h("td", { class: "avg-col" }, h("span", { class: "avg-pill" }, avg.toFixed(1))),
        ),
      );

      root.replaceChildren(
        header,
        legend,
        h("div", { class: "table-wrap" },
          h("table", { class: "data-table fx-table" },
            h("thead", null, thead),
            h("tbody", null, ...tbody),
          ),
        ),
      );
    }

    render();
    return () => { unsub(); root.replaceChildren(); root.classList.remove("tool"); };
  },
};
