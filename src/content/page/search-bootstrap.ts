import { SITE } from "@core/selectors";
import type { PreparedConfig } from "./direct-search";
export interface SearchBootstrap extends PreparedConfig { csrfParam: string; csrfToken: string; stateEndpoint: string }
const MODES = ["standard", "polite", "prime"];
export function parseSearchBootstrap(html: string, savedModes: string | null): SearchBootstrap | null {
  // Detached DOM parsing never executes the site's beforeMount/scripts or opens a socket.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const node = doc.querySelector(SITE.searchBootstrap);
  if (!node || node.getAttribute("game-search-disabled")) return null;
  let user: any, verification: any, service: any;
  try {
    user = JSON.parse(node.getAttribute("current-user") ?? node.getAttribute(":current-user") ?? "null");
    verification = JSON.parse(node.getAttribute(":verification-statuses") ?? "{}");
    service = JSON.parse(node.getAttribute(":new-game-service") ?? "null");
  } catch { return null; }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user.authKey !== "string" ||
      !user.authKey || user.authKey.length > 4096 || verification?.isVerified !== true) return null;
  const bans = user.restriction?.gameModeBans;
  // Values are seconds in SSR; preparing must respect the same league/common bans.
  if (bans?.common?.time_to_end > 0 || bans?.league?.time_to_end > 0) return null;
  let endpoint: URL;
  try { endpoint = new URL(node.getAttribute("rating-game-search-service-url") || ""); } catch { return null; }
  if (endpoint.protocol !== "https:" || !/(^|\.)polemicagame\.com$/.test(endpoint.hostname) || endpoint.username || endpoint.password) return null;
  let serviceUrl: URL;
  try { serviceUrl = new URL(typeof service?.httpUrl === "string" ? service.httpUrl : ""); } catch { return null; }
  if (serviceUrl.protocol !== "https:" || !/(^|\.)polemicagame\.com$/.test(serviceUrl.hostname) ||
      serviceUrl.username || serviceUrl.password || serviceUrl.search || serviceUrl.hash) return null;
  // Match the site's string concatenation, retaining a legitimate service prefix.
  const stateEndpoint = serviceUrl.href.replace(/\/$/, "") + "/api/search/me";
  const csrfParam = doc.querySelector(SITE.csrfParam)?.getAttribute("content");
  const csrfToken = doc.querySelector(SITE.csrfToken)?.getAttribute("content");
  if (!csrfParam || !csrfToken) return null;
  let censorship = user.mmr && user.mmr.value !== 1000 ? ["standard"] : ["polite"];
  try {
    const value: unknown = savedModes ? JSON.parse(savedModes) : null;
    if (Array.isArray(value) && value.length > 0 && value.length <= MODES.length && value.every(mode => typeof mode === "string" && MODES.includes(mode)))
      censorship = [...new Set(value)];
  } catch { /* site's default */ }
  return { endpoint: endpoint.href, request: { gameMode: "league", role: "player", userId: user.id, authKey: user.authKey, censorship }, csrfParam, csrfToken, stateEndpoint };
}

/** Apply the authenticated /api/search/me availability in the same order as
 * the site's censorshipModesUpdate(). Missing eligibility never means allowed.
 * The caller owns HTTP, cancellation and any persistence of the corrected list.
 */
export function applySearchAvailability(config: SearchBootstrap, state: unknown): SearchBootstrap | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const queues = (state as Record<string, unknown>).queues;
  if (!queues || typeof queues !== "object" || Array.isArray(queues)) return null;
  const availability = new Map<string, boolean>();
  for (const mode of MODES) {
    if (!Object.hasOwn(queues, mode)) return null;
    const entry = (queues as Record<string, unknown>)[mode];
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !Object.hasOwn(entry, "available") || typeof (entry as Record<string, unknown>).available !== "boolean") return null;
    availability.set(mode, (entry as { available: boolean }).available);
  }
  let censorship = [...config.request.censorship];
  for (const mode of MODES) {
    if (availability.get(mode) === false && censorship.includes(mode)) {
      censorship = censorship.filter(selected => selected !== mode);
      // The real client falls back immediately, even when standard itself is
      // unavailable. A plain filter-to-empty or fallback-to-every-mode differs.
      if (censorship.length === 0) censorship.push("standard");
    }
  }
  return { ...config, request: { ...config.request, censorship } };
}
