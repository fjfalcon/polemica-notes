// @vitest-environment jsdom
import { expect, test } from "vitest";
import { parseSearchBootstrap, applySearchAvailability } from "@content/page/search-bootstrap";
import fixture from "../fixtures/search-start-methods.json";
export function html(user: unknown = { id: 7, mmr: { value: 1200 } }, options: { endpoint?: string; verified?: boolean; disabled?: string; service?: unknown } = {}): string {
  const attr = (value: unknown) => JSON.stringify(value).replaceAll("&", "&amp;").replaceAll("'", "&#39;");
  return `<meta name="csrf-param" content="_csrf-test"><meta name="csrf-token" content="fake-csrf">
    <game-search current-user='${attr(user)}' :verification-statuses='${attr({ isVerified: options.verified ?? true })}'
    :new-game-service='${attr(options.service === undefined ? { httpUrl: "https://game.polemicagame.com" } : options.service)}'
    game-search-disabled="${options.disabled ?? ""}" game-search-service-url="https://wrong.polemicagame.com:4242"
    rating-game-search-service-url="${options.endpoint ?? "https://game.polemicagame.com/search"}"></game-search>`;
}
test("параметры точного рейтингового namespace и payload", () => {
  expect(parseSearchBootstrap(html(), '["prime","standard"]')).toEqual({ endpoint: "https://game.polemicagame.com/search",
    request: { gameMode: "league", role: "player", userId: 7, censorship: ["prime", "standard"] }, csrfParam: "_csrf-test", csrfToken: "fake-csrf", stateEndpoint: "https://game.polemicagame.com/api/search/me" });
});
test("чтение HTML не выполняет beforeMount, script или загрузку iframe", () => {
  const markup = html() + '<script>globalThis.__pnUnwantedSearch=true</script><iframe src="/game-search"></iframe>';
  parseSearchBootstrap(markup, null);
  expect((globalThis as any).__pnUnwantedSearch).toBeUndefined(); expect(document.querySelector("iframe")).toBeNull();
});
test("JSON entities разбираются ровно один раз", () => {
  const nick = "key&quota='test'";
  expect(parseSearchBootstrap(html({ id: 7, username: nick, mmr: { value: 1200 } }), null)?.request).toMatchObject({ userId: 7, censorship: ["standard"] });
});
test("сайт 12.11.2026: authKey не нужен, а если остался в разметке — в запрос не попадает", () => {
  const config = parseSearchBootstrap(html({ id: 7, authKey: "old-key", mmr: { value: 1200 } }), null);
  expect(config).not.toBeNull();
  expect(Object.keys(config!.request).sort()).toEqual(["censorship", "gameMode", "role", "userId"]);
  expect(JSON.stringify(config)).not.toContain("old-key");
});
test.each(["garbage", "[]", '["evil"]', '["standard",null]', '{}'])("невалидный список %s даёт штатный default", saved => {
  expect(parseSearchBootstrap(html(), saved)?.request.censorship).toEqual(["standard"]);
});
test("штатный default для 1000 MMR и отсутствия MMR — polite", () => {
  expect(parseSearchBootstrap(html({ id: 7, mmr: { value: 1000 } }), null)?.request.censorship).toEqual(["polite"]);
  expect(parseSearchBootstrap(html({ id: 7 }), null)?.request.censorship).toEqual(["polite"]);
});
test.each(["https://polemicagame.com.evil.test/search", "https://evil.test/search", "http://game.polemicagame.com/search", "https://a:b@game.polemicagame.com/search", "javascript:alert(1)"])("не передаёт auth на неподходящий endpoint %s", endpoint => {
  expect(parseSearchBootstrap(html(undefined, { endpoint }), null)).toBeNull();
});
test.each([null, { id: "7" }, { id: 0 }, { id: -3 }, { name: "x" }])("не создаёт конфиг для неавторизованного пользователя", user => {
  expect(parseSearchBootstrap(html(user), null)).toBeNull();
});
test("verification, bans и отключённый поиск соблюдаются", () => {
  expect(parseSearchBootstrap(html(undefined, { verified: false }), null)).toBeNull();
  expect(parseSearchBootstrap(html(undefined, { disabled: "maintenance" }), null)).toBeNull();
  expect(parseSearchBootstrap(html({ id: 7, restriction: { gameModeBans: { league: { time_to_end: 15 } } } }), null)).toBeNull();
});

test.each([
  null, {}, { httpUrl: "https://evil.test" }, { httpUrl: "https://game.polemicagame.com.evil.test" },
  { httpUrl: "http://game.polemicagame.com" }, { httpUrl: "https://user:secret@game.polemicagame.com" },
  { httpUrl: "https://game.polemicagame.com?redirect=elsewhere" }, { httpUrl: "https://game.polemicagame.com#fragment" },
])("state endpoint never exposes auth to a malformed service %j", service => {
  expect(parseSearchBootstrap(html(undefined, { service }), null)).toBeNull();
});
test("SSR HTTP service is independent from the search namespace and retains a service prefix", () => {
  const config = parseSearchBootstrap(html(undefined, { service: { httpUrl: "https://api.polemicagame.com/prefix/" } }), null);
  expect(config?.endpoint).toBe("https://game.polemicagame.com/search");
  expect(config?.stateEndpoint).toBe("https://api.polemicagame.com/prefix/api/search/me");
});
const queueState = (standard: boolean, polite: boolean, prime: boolean) => ({
  queues: { standard: { available: standard, players: 3 }, polite: { available: polite, players: [] }, prime: { available: prime, players: 5 } },
});
test("expired Prime eligibility removes saved Prime and applies the site's standard fallback", () => {
  const original = parseSearchBootstrap(html(), '["prime"]')!;
  const result = applySearchAvailability(original, queueState(true, false, false));
  expect(result?.request.censorship).toEqual(["standard"]);
  expect(original.request.censorship).toEqual(["prime"]);
  expect(result?.request.userId).toBe(original.request.userId);
});
test("preserves other eligible selections without broadening the player's queues", () => {
  const original = parseSearchBootstrap(html(), '["prime","polite"]')!;
  expect(applySearchAvailability(original, queueState(true, true, false))?.request.censorship).toEqual(["polite"]);
});
test.each([null, {}, { queues: {} }, { queues: [] }, { queues: { standard: { available: true } } },
  { queues: { standard: { available: true }, polite: { available: true }, prime: { available: "true" } } },
])("unknown availability %j returns no prepared request", state => {
  const original = parseSearchBootstrap(html(), '["prime"]')!;
  expect(applySearchAvailability(original, state)).toBeNull();
  expect(original.request.censorship).toEqual(["prime"]);
});
test("all mode orders and eligibility combinations agree with the actual site method", () => {
  const method = new Function(`return (${fixture.methods.censorshipModesUpdate})`)();
  const keys = ["standard", "polite", "prime"];
  const selections: string[][] = [];
  const visit = (prefix: string[]) => {
    if (prefix.length) selections.push(prefix);
    for (const key of keys) if (!prefix.includes(key)) visit([...prefix, key]);
  };
  visit([]);
  const prior = localStorage.getItem("searchCensorshipModes");
  try {
    for (const selected of selections) for (let mask = 0; mask < 8; mask++) {
      const state = queueState(!!(mask & 1), !!(mask & 2), !!(mask & 4));
      const actual = { selectedCensorshipModes: [...selected], censorshipModes: keys.map(mode => ({ mode })) };
      method.call(actual, state);
      const parsed = parseSearchBootstrap(html(), JSON.stringify(selected))!;
      expect(applySearchAvailability(parsed, state)?.request.censorship, JSON.stringify({ selected, mask })).toEqual(actual.selectedCensorshipModes);
    }
  } finally {
    if (prior === null) localStorage.removeItem("searchCensorshipModes"); else localStorage.setItem("searchCensorshipModes", prior);
  }
});
