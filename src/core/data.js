import {
  getBootstrapStatic,
  getFixtures,
  getEntry,
  getEntryHistory,
  getPicks,
  getEventLive,
  getElementSummary,
  bootstrapAgeMs,
  getTeamId,
  setTeamId as persistTeamId,
} from "./api.js";
import {
  normalizeBootstrap,
  normalizeFixtures,
  getCurrentGameweek,
  buildIndices,
  predictionFor,
  teamDifficultyForFixture,
  isHome,
  opponentFor,
} from "./store.js";
import { xP90FromGames, gamesFromSummary, projectNext, calibrate, noHistoryXp } from "./xp.js";

const state = {
  teams: {},
  positions: {},
  gameweeks: [],
  players: [],
  fixtures: [],
  playersById: new Map(),
  playersByTeam: new Map(),
  playersByPosition: new Map(),
  fixturesByTeam: new Map(),
  fixturesByGameweek: new Map(),
  loading: true,
  error: null,
  refreshAgeMs: null,

  teamId: getTeamId() || "",
  entry: null,
  history: null,
  picks: null,
  picksGw: null,
  live: null,
  liveGw: null,
  teamLoading: false,
  teamError: null,

  xpRates: new Map(),
  xpNoData: new Set(),
  xpInflight: new Set(),
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

function setState(patch) {
  Object.assign(state, patch);
}

async function loadCore({ force = false } = {}) {
  setState({ loading: true, error: null });
  emit();
  try {
    const [boot, fix] = await Promise.all([
      getBootstrapStatic({ force }),
      getFixtures({ force }),
    ]);
    const norm = normalizeBootstrap(boot);
    const fixtures = normalizeFixtures(fix);
    const idx = buildIndices(norm.players, fixtures);
    setState({
      teams: norm.teams,
      positions: norm.positions,
      gameweeks: norm.gameweeks,
      players: norm.players,
      fixtures,
      playersById: idx.playersById,
      playersByTeam: idx.playersByTeam,
      playersByPosition: idx.playersByPosition,
      fixturesByTeam: idx.fixturesByTeam,
      fixturesByGameweek: idx.fixturesByGameweek,
      loading: false,
    });
  } catch (e) {
    setState({ error: e.message, loading: false });
  }
  emit();
}

async function loadTeam() {
  if (!state.teamId) {
    setState({ entry: null, history: null, picks: null, teamError: null, teamLoading: false });
    emit();
    return;
  }
  setState({ teamLoading: true, teamError: null });
  emit();
  try {
    const [entry, history] = await Promise.all([
      getEntry(state.teamId),
      getEntryHistory(state.teamId),
    ]);
    const cur = getCurrentGameweek(state.gameweeks);
    let picks = null;
    let picksGw = null;
    if (cur) {
      try {
        picks = await getPicks(state.teamId, cur.id);
        picksGw = cur.id;
      } catch (e) {
        picks = null;
      }
    }
    setState({ entry, history, picks, picksGw, teamLoading: false });
  } catch (e) {
    const msg = /404|Not found/i.test(e.message || "")
      ? "Team not found — check the FPL team ID."
      : e.message || "Could not load team.";
    setState({ entry: null, history: null, picks: null, teamError: msg, teamLoading: false });
  }
  emit();
}

async function loadLive(gw) {
  if (!gw) return;
  const live = await getEventLive(gw).catch(() => null);
  setState({ live, liveGw: gw });
  emit();
}

async function refreshAge() {
  const ms = await bootstrapAgeMs();
  setState({ refreshAgeMs: ms });
  emit();
}

// ── OPTA-style expected points enrichment ────────────────────────────────
async function enrichOne(id) {
  if (state.xpRates.has(id) || state.xpNoData.has(id) || state.xpInflight.has(id)) return;
  const p = state.playersById.get(id);
  if (!p) return;
  state.xpInflight.add(id);
  try {
    const summary = await getElementSummary(id);
    const rate = xP90FromGames(gamesFromSummary(summary), p.position);
    if (rate) state.xpRates.set(id, rate);
    else state.xpNoData.add(id);
  } catch {
    // Record failures too — otherwise every render retries the same
    // broken players forever and pegs the main thread.
    state.xpNoData.add(id);
  } finally {
    state.xpInflight.delete(id);
  }
}

async function enrichPlayers(ids) {
  const missing = [...new Set(ids)].filter(
    (id) => !state.xpRates.has(id) && !state.xpNoData.has(id) && !state.xpInflight.has(id),
  );
  for (let i = 0; i < missing.length; i += 4) {
    const batch = missing.slice(i, i + 4);
    await Promise.allSettled(batch.map(enrichOne));
    emit();
  }
}

function predictedFor(p, fixture) {
  const s = state;
  const fdr = fixture ? teamDifficultyForFixture(p.team_id, fixture) ?? 3 : 3;
  const home = fixture ? isHome(p.team_id, fixture) : false;
  const common = {
    fdr,
    home,
    opponent: fixture ? opponentFor(p.team_id, fixture, s.teams) : null,
    fixture,
    gw: fixture ? fixture.gameweek_id : null,
  };
  const enriched = s.xpRates.get(p.id);
  if (enriched) {
    const proj = projectNext(enriched, p, { fdr, home });
    return {
      ...common,
      ...proj,
      per90: enriched.per90,
      avail: enriched.availability ?? 1,
      form: enriched.form || [],
      source: "opta",
    };
  }
  if (s.xpNoData.has(p.id)) {
    return { ...common, xp: noHistoryXp(p, { fdr, home }), form: null, source: "nodata" };
  }
  const base = predictionFor(p, fixture, s.teams);
  return {
    ...common,
    ...base,
    xp: calibrate(base.xp, p.position),
    form: null,
    source: "blend",
  };
}

function init() {
  loadCore();
  refreshAge();
  const t = setInterval(refreshAge, 30000);
  if (state.teamId) loadTeam();
  // Auto-refresh live data periodically once loaded.
  setInterval(() => {
    if (state.liveGw) loadLive(state.liveGw);
  }, 60000);
  return () => clearInterval(t);
}

export const store = {
  get state() {
    return state;
  },
  subscribe,
  loadCore,
  loadTeam,
  loadLive,
  refreshAge,
  enrichPlayers,
  predictedFor,
  init,
  currentGw() {
    return getCurrentGameweek(state.gameweeks);
  },
  player(id) {
    return state.playersById.get(id);
  },
  setTeamId(id) {
    const clean = String(id || "").trim();
    persistTeamId(clean);
    setState({ teamId: clean });
    loadTeam();
  },
};
