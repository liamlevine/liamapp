import {
  h, money, fmt, POS_SHORT, POS_NAME, avatar, debounce,
} from "../core/ui.js";
import { ICONS } from "../core/icons.js";
import { store } from "../core/data.js";
import { yt, saveYtEdit, triggerYtRefresh, latestVideos } from "../core/youtube.js";

const CAPS = { 1: 2, 2: 5, 3: 5, 4: 3 };
const POS_ORDER = [1, 2, 3, 4];

const KIND_LABEL = { reveal: "TEAM REVEAL", buy: "PLAYERS TO BUY", other: "VIDEO" };

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export const youtubers = {
  id: "youtubers",
  name: "FPL YouTuber Teams",
  icon: "article",
  mount(root) {
    const state = {
      edit: null, // channel id being edited
      q: "",
      open: false,
      openPos: null,
      draft: null, // { players, captain } while editing
    };
    root.classList.add("tool");
    const unsubYt = yt.subscribe(render);
    const unsubStore = store.subscribe(render);

    function searchResults() {
      if (state.openPos == null || !state.draft) return [];
      const q = state.q.trim().toLowerCase();
      if (!q) return [];
      const used = new Set(state.draft.players.map((p) => p.pid));
      return store.state.players
        .filter((p) => p.position === state.openPos && p.name.toLowerCase().includes(q) && !used.has(p.id))
        .sort((a, b) => b.selected_by_percent - a.selected_by_percent)
        .slice(0, 8);
    }

    function startEdit(ch) {
      if (!ch.team) return;
      state.edit = ch.id;
      state.draft = {
        players: ch.team.players.map((p) => ({ ...p })),
        captain: ch.team.captain,
      };
      render();
    }

    function cancelEdit() {
      state.edit = null;
      state.draft = null;
      state.openPos = null;
      state.q = "";
      render();
    }

    async function saveEdit(ch) {
      if (!state.draft) return;
      await saveYtEdit(ch.id, {
        players: state.draft.players,
        captain: state.draft.captain,
      });
      state.edit = null;
      state.draft = null;
      render();
    }

    function addToDraft(id) {
      if (!state.draft || state.openPos == null) return;
      const p = store.player(id);
      if (!p || p.position !== state.openPos) return;
      const pos = p.position;
      const existing = state.draft.players.filter((x) => x.pos === pos);
      if (existing.length >= CAPS[pos]) return;
      if (state.draft.players.some((x) => x.pid === id)) return;
      state.draft.players.push({ pid: id, name: p.name, pos, team: store.state.teams[p.team_id]?.short_name || "?", quote: "Added manually", conf: 1 });
      state.openPos = null;
      state.q = "";
      render();
    }

    function removeFromDraft(pid) {
      if (!state.draft) return;
      state.draft.players = state.draft.players.filter((x) => x.pid !== pid);
      if (state.draft.captain === pid) state.draft.captain = null;
      render();
    }

    // ── Sections ───────────────────────────────────────────
    function header() {
      const data = yt.state.data;
      const updated = data?.updatedAt ? fmtDate(data.updatedAt) + " " + new Date(data.updatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
      return h("div", { class: "tool-head" },
        h("div", null,
          h("h2", { class: "tool-title" }, "FPL YouTuber Teams"),
          h("p", { class: "tool-sub" }, "Their latest team reveals, what they said, and Focal's weekly buy lists — auto-extracted from transcripts."),
        ),
        h("div", { class: "tool-actions" },
          h("span", { class: "yt-updated" }, `Updated ${updated}`),
          h("button", {
            class: "btn",
            onclick: () => { triggerYtRefresh(); render(); },
            title: "Re-scan the channels for new videos (server side)",
          }, "Refresh now"),
        ),
      );
    }

    function focalCard() {
      const data = yt.state.data;
      const list = data?.focalBuy || [];
      const latest = list[0];
      if (!latest) {
        return h("div", { class: "yt-card" },
          h("div", { class: "yt-card-head" }, "FPL FOCAL · PLAYERS TO BUY"),
          h("div", { class: "dash-empty" }, "No buy list extracted yet — his Monday video hasn't been scanned."),
        );
      }
      return h("div", { class: "yt-card yt-card--focal" },
        h("div", { class: "yt-card-head" },
          `FPL FOCAL · PLAYERS TO BUY · GW${latest.gw}`,
          h("a", { class: "yt-link", href: `https://www.youtube.com/watch?v=${latest.videoId}`, target: "_blank", rel: "noopener" }, "Watch ↗"),
        ),
        h("div", { class: "yt-buy" },
          ...(latest.players || []).slice(0, 12).map((p) =>
            h("div", { class: "yt-buy-row", title: p.quote || "" },
              h("span", { class: "yt-buy-name" }, p.name),
              h("span", { class: "yt-buy-team" }, p.team),
              h("span", { class: "yt-buy-xp" },
                p.xp != null ? `${p.xp.toFixed(1)} xP${p.lowConf ? "?" : ""}` : `${p.xp5.toFixed(1)} · 5GW`),
            ),
          ),
        ),
        h("div", { class: "footnote" }, `"${latest.title}" — published ${fmtDate(latest.publishedAt)}. Numbers extracted from the transcript; hover a player for the quote.`),
      );
    }

    function teamRows(ch, team, editable) {
      const players = (editable ? state.draft?.players : team.players) || [];
      const captain = editable ? state.draft?.captain : team.captain;
      return POS_ORDER.map((pos) => {
        const group = players.filter((p) => p.pos === pos);
        const empty = CAPS[pos] - group.length;
        return h("div", { class: "tr-board-row" },
          h("div", { class: "tr-board-pos" },
            POS_NAME[pos],
            h("span", { class: "tr-board-pos-count" }, `${group.length}/${CAPS[pos]}`),
          ),
          h("div", { class: "tr-board-slots" },
            ...group.map((p) =>
              h("div", {
                class: `tr-slot filled yt-slot ${p.pid === captain ? "cap" : ""}`,
                title: p.quote || "",
                onclick: () => {
                  if (!editable) return;
                  state.draft.captain = state.draft.captain === p.pid ? null : p.pid;
                  render();
                },
              },
                editable ? h("button", {
                  class: "tr-slot-x",
                  onclick: (e) => { e.stopPropagation(); removeFromDraft(p.pid); },
                }, "×") : null,
                h("span", { class: "yt-slot-team" }, p.team),
                h("span", { class: "tr-slot-name" }, p.name),
                p.pid === captain ? h("span", { class: "c-badge" }, "C") : null,
                p.bench ? h("span", { class: "yt-slot-bench" }, "B") : null,
              ),
            ),
            ...Array.from({ length: Math.max(0, empty) }).map(() =>
              h("button", {
                class: "tr-slot empty",
                onclick: () => {
                  if (!editable) return;
                  state.openPos = pos;
                  state.q = "";
                  render();
                  root.querySelector(".yt-search-input")?.focus();
                },
              },
                h("span", { class: "tr-slot-plus", html: ICONS.plus }),
              ),
            ),
          ),
        );
      });
    }

    function editSearch(ch) {
      if (state.openPos == null || !state.draft) return null;
      const results = searchResults();
      return h("div", { class: "tr-search" },
        h("div", { class: "tr-search-head" },
          h("span", { class: "tr-search-label" }, `Add a ${POS_NAME[state.openPos]}`),
          h("button", { class: "btn", onclick: () => { state.openPos = null; state.q = ""; render(); } }, "Close"),
        ),
        h("div", { class: "search-wrap" },
          h("input", {
            class: "input search yt-search-input",
            placeholder: `Search ${POS_NAME[state.openPos]}s…`,
            value: state.q,
            oninput: debounce((e) => { state.q = e.target.value; render(); }, 120),
          }),
          results.length
            ? h("div", { class: "dropdown" },
                results.map((p) => {
                  const team = store.state.teams[p.team_id];
                  return h("button", { class: "dd-item", onclick: () => addToDraft(p.id) },
                    avatar(p, team, { size: "sm" }),
                    h("span", null, p.name),
                    h("span", { class: "muted dd-sub" }, `${team?.short_name} · ${money(p.price)}`),
                  );
                }),
              )
            : null,
        ),
      );
    }

    function channelCard(ch) {
      const team = ch.team;
      const editing = state.edit === ch.id;
      if (!team) {
        return h("div", { class: "yt-card" },
          h("div", { class: "yt-card-head" }, ch.name),
          h("div", { class: "dash-empty" }, "No team reveal extracted yet."),
        );
      }
      const confPct = Math.round((team.conf || 0) * 100);
      return h("div", { class: "yt-card" },
        h("div", { class: "yt-card-head" },
          ch.name,
          h("span", { class: `yt-badge yt-badge--${team.status}` }, team.status === "edited" ? "EDITED" : team.status === "auto" ? `AUTO · ${confPct}%` : team.status),
          h("a", { class: "yt-link", href: `https://www.youtube.com/watch?v=${team.videoId}`, target: "_blank", rel: "noopener" }, "Video ↗"),
        ),
        h("div", { class: "yt-team-title", title: team.title }, `"${team.title}"`),
        editing ? editSearch(ch) : null,
        h("div", { class: "tr-board" }, ...teamRows(ch, team, editing)),
        h("div", { class: "yt-card-foot" },
          editing
            ? h("div", { class: "yt-actions" },
                h("button", { class: "btn btn--primary", onclick: () => saveEdit(ch) }, "Save"),
                h("button", { class: "btn", onclick: cancelEdit }, "Cancel"),
                h("span", { class: "muted" }, "Click a player to make them captain · × removes"),
              )
            : h("button", { class: "btn", onclick: () => startEdit(ch) }, "Edit team"),
          h("span", { class: "yt-notes" }, team.notes || ""),
        ),
      );
    }

    function articlesCard() {
      const vids = latestVideos(12);
      if (!vids.length) return null;
      return h("div", { class: "yt-card" },
        h("div", { class: "yt-card-head" }, "LATEST VIDEOS"),
        h("div", { class: "yt-articles" },
          ...vids.map((v) =>
            h("a", { class: "yt-article", href: v.url, target: "_blank", rel: "noopener" },
              h("img", { class: "yt-thumb", src: v.thumb, alt: "", loading: "lazy" }),
              h("div", { class: "yt-article-body" },
                h("div", { class: "yt-article-title" }, v.title),
                h("div", { class: "yt-article-meta" },
                  h("span", { class: `yt-kind yt-kind--${v.kind}` }, KIND_LABEL[v.kind] || "VIDEO"),
                  h("span", null, v.channel),
                  h("span", null, fmtDate(v.publishedAt)),
                  v.transcript === false ? h("span", { class: "yt-no-cap" }, "no captions") : null,
                ),
              ),
            ),
          ),
        ),
      );
    }

    function render() {
      if (store.state.loading) {
        root.replaceChildren(h("div", { class: "state" }, "Loading FPL data…"));
        return;
      }
      const data = yt.state.data;
      if (yt.state.loading && !data) {
        root.replaceChildren(header(), h("div", { class: "state" }, "Loading YouTuber data…"));
        return;
      }
      if (!data) {
        root.replaceChildren(header(), h("div", { class: "state state--err" }, "Couldn't load YouTuber data — is the server running?"));
        return;
      }
      root.replaceChildren(
        header(),
        focalCard(),
        h("div", { class: "yt-grid" },
          ...(data.channels || []).map(channelCard),
        ),
        articlesCard(),
        h("div", { class: "footnote" },
          "Teams are auto-extracted from each channel's latest team-reveal video transcript (name matching + context scoring). YouTubers often discuss drafts and other people's teams, so auto picks can be wrong — confidence is shown per squad and you can edit any team above. Edits are saved on the server and win over auto-extraction."),
      );
    }

    render();
    return () => {
      unsubYt();
      unsubStore();
      root.replaceChildren();
      root.classList.remove("tool");
    };
  },
};
