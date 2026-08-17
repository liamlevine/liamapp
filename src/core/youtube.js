// Client-side access to the YouTuber data served by /api/youtubers.
const state = {
  data: null,
  loading: false,
  error: null,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

export async function refreshYt() {
  state.loading = true;
  emit();
  try {
    const res = await fetch("/api/youtubers", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`youtubers -> ${res.status}`);
    state.data = await res.json();
    state.error = null;
  } catch (e) {
    state.error = e.message;
  }
  state.loading = false;
  emit();
}

export async function saveYtEdit(channelId, patch) {
  const res = await fetch("/api/youtubers/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId, ...patch }),
  });
  if (!res.ok) throw new Error("edit failed");
  await refreshYt();
}

export async function triggerYtRefresh() {
  try {
    await fetch("/api/youtubers/refresh", { method: "POST" });
  } catch {
    // ignore
  }
}

// Latest Focal buy list, keyed by player id.
export function focalXpMap() {
  const map = new Map();
  const list = state.data?.focalBuy || [];
  const latest = list[0];
  if (latest) {
    for (const p of latest.players || []) {
      map.set(p.pid, { xp: p.xp, xp5: p.xp5, gw: latest.gw, lowConf: p.lowConf, quote: p.quote });
    }
  }
  return map;
}

export function latestVideos(limit = 8) {
  const vids = [];
  for (const ch of state.data?.channels || []) {
    for (const v of ch.videos || []) {
      vids.push({ ...v, channel: ch.name });
    }
  }
  vids.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return vids.slice(0, limit);
}

export const yt = { get state() { return state; }, subscribe, refreshYt, saveYtEdit, triggerYtRefresh };

refreshYt();
setInterval(refreshYt, 5 * 60 * 1000);
