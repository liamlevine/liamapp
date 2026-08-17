import { getMeta, setMeta, getAll, putAll, bulkPutStats } from "./db.js";

const BASE = "/fpl-api";
const TTL_BOOTSTRAP = 60 * 60 * 1000;
const TTL_FIXTURES = 60 * 60 * 1000;
const TTL_ELEMENT = 15 * 60 * 1000; // fresher per-GW form/predictions
const TTL_ENTRY = 5 * 60 * 1000;
const TTL_LIVE = 60 * 1000;

const inflight = new Map();
const LS_TEAM = "fpl_team_id";

export function getTeamId() {
  return localStorage.getItem(LS_TEAM);
}
export function setTeamId(id) {
  localStorage.setItem(LS_TEAM, id);
}

function memo(key, p) {
  if (!inflight.has(key)) {
    inflight.set(key, p.finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

async function fetchJSON(path, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function getBootstrapStatic({ force = false } = {}) {
  const cached = {
    players: await getAll("players"),
    teams: await getAll("teams"),
    gameweeks: await getAll("gameweeks"),
    positions: await getAll("positions"),
  };
  const last = await getMeta("last_bootstrap");
  const fresh = last && Date.now() - last < TTL_BOOTSTRAP;
  const haveData = cached.players.length > 0;

  const render = () => ({ ...cached });

  if (haveData && fresh && !force) return render();

  const refresh = async () => {
    const data = await memo("bootstrap", fetchJSON("/bootstrap-static/"));
    await putAll("players", data.elements);
    await putAll("teams", data.teams);
    await putAll("gameweeks", data.events);
    await putAll("positions", data.element_types);
    await setMeta("last_bootstrap", Date.now());
    cached.players = data.elements;
    cached.teams = data.teams;
    cached.gameweeks = data.events;
    cached.positions = data.element_types;
  };

  if (haveData) {
    refresh().catch((e) => console.warn("bootstrap bg refresh failed", e));
    return render();
  }
  await refresh();
  return render();
}

export async function getFixtures({ force = false } = {}) {
  const cached = await getAll("fixtures");
  const last = await getMeta("last_fixtures");
  const fresh = last && Date.now() - last < TTL_FIXTURES;

  if (cached.length && fresh && !force) return cached;

  const refresh = async () => {
    const data = await memo("fixtures", fetchJSON("/fixtures/"));
    await putAll("fixtures", data);
    await setMeta("last_fixtures", Date.now());
    return data;
  };

  if (cached.length && !force) {
    refresh().catch((e) => console.warn("fixtures bg refresh failed", e));
    return cached;
  }
  return refresh();
}

export async function getElementSummary(playerId, { force = false } = {}) {
  const key = `el_${playerId}`;
  const ttlKey = `el_${playerId}_ts`;
  const last = await getMeta(ttlKey);
  const fresh = last && Date.now() - last < TTL_ELEMENT;

  const refresh = async () => {
    const data = await memo(key, fetchJSON(`/element-summary/${playerId}/`));
    await setMeta(ttlKey, Date.now());
    await setMeta(`el_${playerId}_obj`, data);
    if (data.history && data.history.length) {
      const stats = data.history.map((h) => ({
        id: `${playerId}_${h.round}`,
        player_id: playerId,
        gameweek_id: h.round,
        points: h.total_points,
        minutes: h.minutes,
        goals: h.goals_scored,
        assists: h.assists,
        price_at_time: h.value,
      }));
      await bulkPutStats(stats);
    }
    return data;
  };

  if (fresh && !force) {
    return (await getMeta(`el_${playerId}_obj`)) || refresh();
  }
  return refresh();
}

export async function getEntry(teamId) {
  if (!teamId) return null;
  return memo(`entry_${teamId}`, fetchJSON(`/entry/${teamId}/`));
}

export async function getPicks(teamId, gw) {
  if (!teamId || !gw) return null;
  return memo(`entry_${teamId}_${gw}`, fetchJSON(`/entry/${teamId}/event/${gw}/picks/`));
}

export async function getEntryHistory(teamId) {
  if (!teamId) return null;
  return memo(`entry_${teamId}_history`, fetchJSON(`/entry/${teamId}/history/`));
}

export async function getEventLive(gw) {
  if (!gw) return null;
  return memo(`live_${gw}`, fetchJSON(`/event/${gw}/live/`));
}

export async function getEntryTransfersLatest(teamId) {
  if (!teamId) return null;
  return memo(`entry_${teamId}_tlatest`, fetchJSON(`/entry/${teamId}/transfers/latest/`)).catch(() => null);
}

export async function bootstrapAgeMs() {
  const last = await getMeta("last_bootstrap");
  return last ? Date.now() - last : null;
}

export { getMeta, setMeta };
