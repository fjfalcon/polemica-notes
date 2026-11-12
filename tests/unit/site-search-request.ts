/**
 * Как сайт (сборка game-search от 12.11.2026) спрашивает /api/search/me и
 * /api/games/quit: кука сессии, пустое тело, без authKey. Образец сверяется
 * с настоящим методом сайта (direct-search-live-methods.test.ts) и с нашим
 * запросом (direct-requeue-page.test.ts).
 */
export const SITE_STATE_REQUEST = {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json;charset=utf-8" },
  body: "{}",
};
