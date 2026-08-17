import { store } from "../core/data.js";
import { h } from "../core/ui.js";
import { ICONS } from "../core/icons.js";
import { overview } from "../tools/overview.js";
import { predictedPoints } from "../tools/predicted-points.js";
import { playerCompare } from "../tools/compare.js";
import { fixtureAnalyser } from "../tools/fixtures.js";
import { playerProfiler } from "../tools/profiler.js";
import { teamRating } from "../tools/team-rating.js";
import { youtubers } from "../tools/youtubers.js";
import { chipPlanning } from "../tools/planning.js";
import { myTeam } from "../tools/my-team.js";
import { liveRank } from "../tools/live-rank.js";

const TOOLS = [
  overview,
  predictedPoints,
  playerCompare,
  fixtureAnalyser,
  playerProfiler,
  teamRating,
  youtubers,
  chipPlanning,
  myTeam,
  liveRank,
];

function currentToolId() {
  const hsh = location.hash.replace(/^#\/?/, "");
  const sub = hsh.split("?")[0].split("/")[1];
  return TOOLS.find((t) => t.id === sub)?.id || TOOLS[0].id;
}

export const fplWidget = {
  id: "fplhelp",
  name: "fplhelp",
  tagline: "Predictions, comparisons, fixtures, your team and chip planning.",
  icon: "ball",
  code: "FPL",
  meta: "10 TOOLS · LIVE FPL DATA",
  accent: "#2a5ce0",
  mount(root) {
    root.classList.add("fpl-widget");
    const unsub = store.subscribe(updateChrome);
    let toolUnmount = null;

    function topbar() {
      const s = store.state;
      const teamInput = h("input", {
        class: "input team-id", type: "number", placeholder: "FPL team ID", value: s.teamId,
      });
      teamInput.title = "Find it in your FPL team URL: /entry/{id}/";
      teamInput.addEventListener("change", () => store.setTeamId(teamInput.value));
      teamInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { teamInput.blur(); store.setTeamId(teamInput.value); }
      });

      return h("div", { class: "fpl-topbar" },
        h("a", { class: "back", href: "#/", html: `<span class="back-icon">${ICONS.back}</span><span>Widgets</span>` }),
        h("div", { class: "fpl-brand" },
          h("span", { class: "fpl-brand-mark", html: ICONS.ball }),
          h("span", { class: "fpl-brand-name" }, "fplhelp"),
        ),
        h("div", { class: "fpl-topbar-spacer" }),
        h("span", { class: "gw-pill", id: "gw-pill" }),
        h("span", { class: "topbar-deadline", id: "deadline" }),
        h("div", { class: "fpl-topbar-actions" },
          h("span", { class: "age", id: "age" },
            h("span", { class: "dot dot--ok" }),
            h("span", { id: "age-text" }),
          ),
          teamInput,
          h("button", {
            class: "btn", onclick: async () => {
              await store.loadCore({ force: true });
              if (store.state.teamId) store.loadTeam();
            },
          }, "Refresh"),
        ),
      );
    }

    function tabs() {
      const active = currentToolId();
      return h("div", { class: "fpl-tabs" },
        ...TOOLS.map((t) =>
          h("a", {
            class: `tab ${t.id === active ? "active" : ""}`,
            href: `#/fplhelp/${t.id}`,
            html: `<span class="tab-icon">${ICONS[t.icon]}</span><span>${t.name}</span>`,
          }),
        ),
      );
    }

    function mountActive() {
      if (toolUnmount) { toolUnmount(); toolUnmount = null; }
      const host = root.querySelector("#fpl-content");
      if (!host) return;
      const tool = TOOLS.find((t) => t.id === currentToolId());
      toolUnmount = tool.mount(host);
    }

    function updateChrome() {
      const s = store.state;
      const cur = store.currentGw();
      const gwPill = root.querySelector("#gw-pill");
      const deadline = root.querySelector("#deadline");
      const age = root.querySelector("#age");
      const ageText = root.querySelector("#age-text");
      const teamInput = root.querySelector(".team-id");

      if (gwPill) gwPill.textContent = cur ? `GW${cur.id}` : "…";
      if (deadline) {
        let dl = "Loading…";
        if (cur) {
          const d = new Date(cur.deadline_time);
          dl = `GW${cur.id} deadline ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
        }
        deadline.textContent = dl;
      }
      if (ageText) {
        const ms = s.refreshAgeMs;
        ageText.textContent = ms == null ? "loading…" : `${Math.round(ms / 60000)}m ago`;
      }
      if (age) age.classList.toggle("stale", s.refreshAgeMs != null && s.refreshAgeMs >= 10 * 60000);
      if (teamInput && document.activeElement !== teamInput) teamInput.value = s.teamId;
    }

    root.replaceChildren(
      h("div", { class: "fpl-head" },
        topbar(),
        tabs(),
      ),
      h("div", { class: "fpl-content", id: "fpl-content" }),
    );
    mountActive();
    updateChrome();

    return () => {
      unsub();
      if (toolUnmount) { toolUnmount(); toolUnmount = null; }
      root.replaceChildren();
      root.classList.remove("fpl-widget");
    };
  },
};
