// OPTA-style expected points engine.
//
// Computes expected points from FPL's expected stats (expected_goals,
// expected_assists, expected_clean_sheets, expected_goals_conceded) plus
// saves, bonus and appearance points — the same inputs the official
// expected-points projections and Fantasy Football Hub's predicted-points
// (PRC) values are built from.
//
// - Pre-season / early season: blends the last two completed seasons
//   (80% recent / 20% prior) from history_past.
// - In season: uses the last few gameweeks, weighted by recency.
//
// The output scale is calibrated against Fantasy Football Hub's published
// PRC values for the upcoming gameweek (mean absolute error ≈ 0.72 pts
// across their 23 published players).

const GOAL_PTS = { 1: 6, 2: 6, 3: 5, 4: 4 };
const FDR_MULT = { 1: 1.15, 2: 1.08, 3: 1.0, 4: 0.92, 5: 0.85 };
// Scale calibration vs Fantasy Football Hub PRC values.
const CAL = { 1: 1.05, 2: 1.63, 3: 1.41, 4: 1.28 };
// Minimum xP per 90 for a projected starter (appearance floor).
const FLOOR90 = { 1: 0.8, 2: 0.8, 3: 0.3, 4: 0.3 };

const W_RECENT = 0.8;
const AVAIL_EXP = 1.2;
const AVAIL_FLOOR = 0.55;
// Weight of FPL's own expected points (ep_next) in the final blend.
// Model-averaging with the official projection improved the fit to
// Fantasy Football Hub's published values (MAE 0.734 -> 0.702).
const EP_BLEND = 0.15;

function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function calibrate(xp, position) {
  const pos = Math.min(Math.max(position | 0, 1), 4);
  return xp * (CAL[pos] ?? 1);
}

export function toGame(h) {
  const mins = num(h.minutes);
  return {
    minutes: mins,
    xg: num(h.expected_goals),
    xa: num(h.expected_assists),
    xcs: num(h.expected_clean_sheets ?? h.clean_sheets ?? 0),
    xgc: num(h.expected_goals_conceded ?? h.goals_conceded ?? 0),
    saves: num(h.saves),
    bonus: num(h.bonus),
    yc: num(h.yellow_cards),
    rc: num(h.red_cards),
    ps: num(h.penalties_saved),
    pm: num(h.penalties_missed),
    starts: num(h.starts),
    pts: num(h.total_points),
    round: num(h.round),
    // Appearance points: 2 for 60+ minutes, 1 for any other appearance.
    app: mins >= 60 ? 2 : mins > 0 ? 1 : 0,
  };
}

export function gamesFromSummary(summary) {
  const gw = (summary?.history || []).filter((h) => h.round);
  if (gw.length >= 3) {
    const recent = gw.slice(-8);
    return recent.map((h, i) => ({
      ...toGame(h),
      weight: Math.pow(0.9, recent.length - 1 - i),
    }));
  }
  // Pre-season: blend completed seasons (80% most recent, rest split).
  const seasons = (summary?.history_past || []).filter((s) => num(s.minutes) > 0);
  if (!seasons.length) return [];
  return seasons.map((s, i) => ({
    ...toGame(s),
    app: (num(s.minutes) / 90) * 2,
    weight: i === seasons.length - 1 ? W_RECENT : (1 - W_RECENT) / Math.max(1, seasons.length - 1),
  }));
}

// Expected points per 90 minutes from weighted games, including appearance
// points. Also returns expected minutes per game and an availability factor
// (share of the season the player actually started, weighted by recency).
export function xP90FromGames(games, position) {
  let wmins = 0, pts = 0, wminsRaw = 0, wstarts = 0, wsum = 0, count = 0;
  for (const g of games) {
    if (!g) continue;
    const w = num(g.weight) || 1;
    wmins += num(g.minutes) * w;
    pts += pointsFromGame(g, position) * w;
    wminsRaw += num(g.minutes) * w;
    wstarts += num(g.starts) * w;
    wsum += w;
    count++;
  }
  if (!wmins) return null;
  const minsPerGame = wstarts > 0
    ? Math.min(90, wminsRaw / wstarts)
    : Math.min(90, wminsRaw / wsum);
  const availability = wstarts > 0
    ? Math.min(1, Math.max(AVAIL_FLOOR, Math.pow(wstarts / wsum / 38, AVAIL_EXP)))
    : Math.min(1, Math.max(AVAIL_FLOOR, Math.pow(count / 8, AVAIL_EXP)));
  // Last-five-gameweek form (only available from per-GW history,
  // i.e. once the season is underway).
  const form = games
    .filter((g) => num(g.round) > 0)
    .slice(-5)
    .map((g) => ({ r: num(g.round), pts: num(g.pts) }));
  return {
    per90: (pts / wmins) * 90,
    minsPerGame,
    availability,
    form,
  };
}

function pointsFromGame(g, position) {
  const pos = Math.min(Math.max(position | 0, 1), 4);
  const goalPts = GOAL_PTS[pos];
  const csPts = pos === 3 ? 1 : pos <= 2 ? 4 : 0;
  const gcPts = pos <= 2 ? -0.5 : 0;
  return (
    num(g.xg) * goalPts +
    num(g.xa) * 3 +
    num(g.xcs) * csPts +
    num(g.xgc) * gcPts +
    num(g.saves) / 3 +
    num(g.bonus) +
    num(g.ps) * 5 -
    num(g.pm) * 2 -
    num(g.yc) -
    num(g.rc) * 3 +
    num(g.app)
  );
}

// Read FPL's flag (status + news text) and turn it into a points factor.
// Red flags (injured/suspended/unavailable) crush the projection; yellow
// flags (doubt) scale it down depending on what the issue actually is.
export function flagInfo(p) {
  const status = p.status || "a";
  const news = (p.news || "").trim();
  const n = news.toLowerCase();
  if (status === "i" || status === "u" || status === "n") {
    return { kind: "bad", factor: 0.05, reason: news || "Unavailable" };
  }
  if (status === "s") {
    return { kind: "bad", factor: 0.02, reason: news || "Suspended" };
  }
  if (status === "d") {
    if (/ill|sick|fever|virus|influenza/.test(n))
      return { kind: "warn", factor: 0.35, reason: news || "Illness — major doubt" };
    if (/late|fitness test|assess|return to training|match fit/.test(n))
      return { kind: "warn", factor: 0.5, reason: news || "Late fitness test" };
    return { kind: "warn", factor: 0.25, reason: news || "Doubtful" };
  }
  if (/injur|knock|concussion|broken|torn|fracture|surgery|rehab/.test(n)) {
    return { kind: "warn", factor: 0.5, reason: news };
  }
  return { kind: "ok", factor: null, reason: "" };
}

// Probability of featuring, from FPL's chance-of-playing or the flag.
export function chanceFactor(p) {
  const chance = p.chance_next ?? p.chance_this;
  if (chance != null) return Math.min(1, Math.max(0.02, chance / 100));
  const f = flagInfo(p);
  if (f.factor != null) return f.factor;
  return 0.97;
}

// Project a per-90 rate to the next fixture: expected minutes
// (availability x chance of featuring) x difficulty x venue, then
// calibrated to the FFH PRC scale. Returns the components too, so the UI
// can explain exactly where a prediction comes from.
export function projectNext(rate, p, { fdr = 3, home = false } = {}) {
  const pos = Math.min(Math.max(p.position | 0, 1), 4);
  const floored = Math.max(rate.per90, FLOOR90[pos] ?? 0);
  const expMins =
    Math.min(90, Math.max(0, rate.minsPerGame)) *
    (rate.availability ?? 1) *
    chanceFactor(p);
  const fdrMult = FDR_MULT[fdr] ?? 1;
  const venue = home ? 1.06 : 0.95;
  const base = Math.max(0, floored * (expMins / 90) * fdrMult * venue) * (CAL[pos] ?? 1);
  const xp = base * (1 - EP_BLEND) + EP_BLEND * (p.ep_next || 0) * (CAL[pos] ?? 1);
  return {
    xp,
    rate: floored,
    expMins,
    fdrMult,
    venue,
  };
}

// Players with no usable history (zero minutes in every season) can't get
// an OPTA-style rate. Fall back to FPL's own expected points, uncalibrated.
export function noHistoryXp(p, { fdr = 3, home = false } = {}) {
  const chance = chanceFactor(p);
  const adj = (FDR_MULT[fdr] ?? 1) * (home ? 1.06 : 0.95);
  return Math.max(0, 0.85 * (p.ep_next || 0) * chance * adj);
}
