/**
 * Сторож сети для офлайн-набора (unit + invariants).
 *
 * Правило проекта: единственный сетевой набор — tests/contract. Но правило
 * держалось на честном слове: фича, которая зовёт `fetch`, в unit-тесте без
 * заглушки молча ходила на живой сайт. 19.11.2026 это сорвало релизный гейт
 * 10.3.0 дважды подряд: postgame-search.test.ts делал 12 настоящих запросов
 * очередей за прогон, ответы прилетали во время ЧУЖИХ тестов, и внутренние
 * таймеры сетевого стека Node вставали на их фейковые часы — тест «после
 * disable таймеров нет» видел четыре лишних. Падение зависело от скорости
 * сети и загрузки машины, поэтому не воспроизводилось в одиночном прогоне.
 *
 * Теперь незаглушённый `fetch` в сеть не уходит вовсе: вызов отклоняется (как
 * при обрыве связи — фичи обязаны это переживать) и запоминается, а тест, в
 * котором он случился, падает с адресом. Тесту нужен ответ сервера — пусть
 * ставит свою заглушку: `vi.stubGlobal("fetch", …)`.
 */
import { afterAll, afterEach, expect } from "vitest";

const leaks: string[] = [];

function describeTarget(input: unknown): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    const url = (input as { url?: unknown } | null)?.url;
    return typeof url === "string" ? url : String(input);
  } catch {
    return "<адрес не разобран>";
  }
}

const guard = ((input: unknown) => {
  const target = describeTarget(input);
  leaks.push(target);
  return Promise.reject(new TypeError(`сеть в unit-тестах запрещена: fetch(${target}) без заглушки`));
}) as typeof fetch;

Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: guard });

/** Забрать и обнулить список — для теста самого сторожа. */
export function takeNetworkLeaks(): string[] {
  return leaks.splice(0);
}

function failOnLeaks(): void {
  if (leaks.length === 0) return;
  const seen = takeNetworkLeaks();
  expect.fail(
    `Тест полез в сеть (${seen.length} раз): ${[...new Set(seen)].join(", ")}. ` +
      'Поставь заглушку: vi.stubGlobal("fetch", vi.fn(async () => …)) — и сними её в afterEach.',
  );
}

afterEach(failOnLeaks);
// Запрос, ушедший уже после конца последнего теста файла.
afterAll(failOnLeaks);
