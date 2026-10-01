import { getActiveHotspotUsers } from './sessionService.js';
import { getHotspotUser } from './hotspotService.js';
/** Live counters straight from RouterOS; returns null if router has no data (never fabricated). */
export async function getActiveSessionUsage(username) {
  const s = (await getActiveHotspotUsers()).filter(a => a.username === username);
  if (!s.length) return null;
  const upload = s.reduce((n, a) => n + a.upload, 0), download = s.reduce((n, a) => n + a.download, 0);
  return { username, upload, download, total: upload + download, sessions: s.length };
}
export { getHotspotUser };
