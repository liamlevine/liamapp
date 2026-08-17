export function normalizeBootstrap(data) {
  const teams = {};
  for (const t of data.teams) {
    teams[t.id] = {
      id: t.id,
      name: t.name,
      short_name: t.short_name,
      code: t.code,
      strength_home: t.strength_overall_home || 0,
      strength_away: t.strength_overall_away || 0,
      position: t.position,
      points: t.points,
    };
  }
  const positions = {};
  for (const p of data.positions) {
    positions[p.id] = {
      id: p.id,
      name: p.singular_name_short || p.singular_name,
      plural: p.plural_name_short || p.plural_name,
    };
  }
  const gameweeks = data.gameweeks.map((g) => ({
    id: g.id,
    name: g.name,
    deadline_time: g.deadline_time,
    is_current: !!g.is_current,
    is_next: !!g.is_next,
    finished: !!g.finished,
    average_entry_score: g.average_entry_score,
    highest_score: g.highest_score,
  }));
  const players = data.players.map((e) => ({
    id: e.id,
    name: e.web_name || `${e.first_name} ${e.second_name}`,
    full_name: `${e.first_name} ${e.second_name}`,
    team_id: e.team,
    position: e.element_type,
    price: (e.now_cost || 0) / 10,
    status: e.status || "a",
    news: e.news || "",
    total_points: e.total_points || 0,
    form: parseFloat(e.form) || 0,
    points_per_game: parseFloat(e.points_per_game) || 0,
    selected_by_percent: parseFloat(e.selected_by_percent) || 0,
    minutes: e.minutes || 0,
    goals_scored: e.goals_scored || 0,
    assists: e.assists || 0,
    clean_sheets: e.clean_sheets || 0,
    goals_conceded: e.goals_conceded || 0,
    saves: e.saves || 0,
    bonus: e.bonus || 0,
    bps: e.bps || 0,
    ict_index: parseFloat(e.ict_index) || 0,
    ict_index_rank: e.ict_index_rank,
    influence: parseFloat(e.influence) || 0,
    creativity: parseFloat(e.creativity) || 0,
    threat: parseFloat(e.threat) || 0,
    ep_next: parseFloat(e.ep_next) || null,
    ep_this: parseFloat(e.ep_this) || null,
    chance_next: e.chance_of_playing_next_round,
    chance_this: e.chance_of_playing_this_round,
    in_dreamteam: !!e.in_dreamteam,
    dreamteam_count: e.dreamteam_count || 0,
    transfers_in: e.transfers_in_event || 0,
    transfers_out: e.transfers_out_event || 0,
    value_form: parseFloat(e.value_form) || 0,
    value_season: parseFloat(e.value_season) || 0,
    photo: e.photo || "",
  }));
  return { teams, positions, gameweeks, players };
}

export function normalizeFixtures(raw) {
  return raw.map((f) => ({
    id: f.id,
    gameweek_id: f.event,
    home_team_id: f.team_h,
    away_team_id: f.team_a,
    home_difficulty: f.team_h_difficulty,
    away_difficulty: f.team_a_difficulty,
    home_score: f.team_h_score,
    away_score: f.team_a_score,
    finished: !!f.finished,
    started: !!f.started,
    kickoff_time: f.kickoff_time,
    minutes: f.minutes,
  }));
}

export function getCurrentGameweek(gameweeks) {
  return (
    gameweeks.find((g) => g.is_current) ||
    gameweeks.find((g) => g.is_next) ||
    gameweeks.filter((g) => !g.finished)[0] ||
    gameweeks[gameweeks.length - 1] ||
    null
  );
}

export function getNextGameweeks(gameweeks, fromId, n = 6) {
  const start = fromId || (getCurrentGameweek(gameweeks)?.id || 1);
  return gameweeks.filter((g) => g.id >= start).slice(0, n);
}

export function buildIndices(players, fixtures) {
  const playersByTeam = new Map();
  const playersByPosition = new Map();
  const playersById = new Map();
  const fixturesByGameweek = new Map();
  const fixturesByTeam = new Map();

  for (const p of players) {
    playersById.set(p.id, p);
    if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
    playersByTeam.get(p.team_id).push(p);
    if (!playersByPosition.has(p.position)) playersByPosition.set(p.position, []);
    playersByPosition.get(p.position).push(p);
  }

  for (const f of fixtures) {
    if (f.gameweek_id == null) continue;
    if (!fixturesByGameweek.has(f.gameweek_id))
      fixturesByGameweek.set(f.gameweek_id, []);
    fixturesByGameweek.get(f.gameweek_id).push(f);
    if (!fixturesByTeam.has(f.home_team_id)) fixturesByTeam.set(f.home_team_id, []);
    if (!fixturesByTeam.has(f.away_team_id)) fixturesByTeam.set(f.away_team_id, []);
    fixturesByTeam.get(f.home_team_id).push(f);
    fixturesByTeam.get(f.away_team_id).push(f);
  }

  return { playersByTeam, playersByPosition, playersById, fixturesByGameweek, fixturesByTeam };
}

// Fixture difficulty of a team for a given fixture.
export function teamDifficultyForFixture(teamId, f) {
  if (f.home_team_id === teamId) return f.home_difficulty;
  if (f.away_team_id === teamId) return f.away_difficulty;
  return null;
}

export function isHome(teamId, f) {
  return f.home_team_id === teamId;
}

export function opponentFor(teamId, f, teams) {
  const oppId = f.home_team_id === teamId ? f.away_team_id : f.home_team_id;
  return teams[oppId];
}

// Next n fixtures for a team, starting at a given gameweek.
export function nextFixturesForTeam(teamId, fixturesByTeam, gameweeks, n = 5, fromId) {
  const curGw = fromId ?? (gameweeks.find((g) => g.is_current)?.id || 0);
  const all = fixturesByTeam.get(teamId) || [];
  return all
    .filter((f) => !f.finished && (f.gameweek_id || 0) >= curGw)
    .sort((a, b) => (a.gameweek_id || 0) - (b.gameweek_id || 0))
    .slice(0, n);
}

export function teamDifficultyScore(teamId, fixturesByTeam, gameweeks, n = 3) {
  const fs = nextFixturesForTeam(teamId, fixturesByTeam, gameweeks, n);
  if (!fs.length) return null;
  let sum = 0, count = 0;
  const rated = fs.map((f) => {
    const d = teamDifficultyForFixture(teamId, f);
    if (d != null) { sum += d; count++; }
    return { fixture: f, difficulty: d };
  });
  if (!count) return null;
  const avg = sum / count;
  const ease = 100 - ((avg - 1) / 4) * 100;
  return { avg, fixtures: rated, ease };
}

export function pointsPerMillion(p) {
  if (!p.price) return 0;
  return p.total_points / p.price;
}

// ── Predicted points model ────────────────────────────────────────────────
// Two signals, blended:
//   1. FPL's own "expected points next round" (ep_next) — already accounts for
//      the upcoming fixture, so it is used as-is (no double difficulty weighting).
//   2. An independent estimate: a long-run points-per-game rate (recent form
//      weighted above season PPG) adjusted for fixture difficulty, home/away and
//      expected minutes (availability / chance of playing).
// When ep_next is missing the model falls back entirely on the independent
// estimate. This is an independent model, not OPTA's.
const FDR_MULT = { 1: 1.12, 2: 1.06, 3: 1.0, 4: 0.94, 5: 0.88 };

function scoringRate(p) {
  return 0.4 * (p.points_per_game || 0) + 0.6 * (p.form || 0);
}

function expectedMinutesFactor(p) {
  const chance = p.chance_next ?? p.chance_this;
  if (chance != null) return Math.min(1, Math.max(0.02, chance / 100));
  const status = p.status || "a";
  const news = (p.news || "").toLowerCase();
  if (status === "i" || status === "u" || status === "n" || status === "s") return 0.05;
  if (status === "d") {
    if (/ill|sick|fever|virus/.test(news)) return 0.35;
    if (/late|fitness|assess|match fit/.test(news)) return 0.5;
    return 0.25;
  }
  if (/injur|knock|concussion|broken|torn|fracture|surgery/.test(news)) return 0.5;
  return 0.92;
}

export function predictionFor(p, fixture, teams) {
  const fdr = fixture ? teamDifficultyForFixture(p.team_id, fixture) ?? 3 : 3;
  const home = fixture ? isHome(p.team_id, fixture) : false;

  const rate = scoringRate(p);
  const venue = home ? 1.05 : 0.97;
  const minutesFactor = expectedMinutesFactor(p);
  const independent = rate * (FDR_MULT[fdr] ?? 1) * venue * minutesFactor;

  const official = p.ep_next;
  const xp = official != null
    ? 0.55 * official + 0.45 * independent
    : independent;

  return {
    xp,
    fdr,
    home,
    opponent: fixture ? opponentFor(p.team_id, fixture, teams) : null,
    fixture,
    gw: fixture ? fixture.gameweek_id : null,
    rate,
    official,
    independent,
    minutesFactor,
  };
}

export function predictedNext(p, ctx) {
  const { fixturesByTeam, gameweeks, teams } = ctx;
  const next = nextFixturesForTeam(p.team_id, fixturesByTeam, gameweeks, 1)[0];
  return predictionFor(p, next, teams);
}
