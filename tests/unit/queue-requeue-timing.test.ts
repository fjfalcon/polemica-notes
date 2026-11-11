// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://polemicagame.com/game-search" }
/**
 * Скорость автовозврата на СТРАНИЦЕ ПОИСКА (9.78.0): частый опрос кнопки
 * «Играть», чтение моста на активации предзагрузки и одна перезагрузка на
 * эпизод, если сайт застрял в «игрок ещё в игре».
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let domSubscriber: (() => void) | null = null;

vi.mock("@core/dom", () => ({
  onDomChange: vi.fn((cb: () => void) => {
    domSubscriber = cb;
    return () => {
      domSubscriber = null;
    };
  }),
  safeClick: vi.fn(() => true),
  isVisible: vi.fn(() => true),
}));
vi.mock("@core/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@core/toast", () => ({ showToast: vi.fn(), clearToasts: vi.fn() }));

import { noteTrustedInput, queueRequeueFeature } from "@content/features/queue-requeue";
import { serializeMark } from "@content/features/requeue-pending";
import { safeClick } from "@core/dom";
import { log } from "@core/log";
import type { Settings } from "@shared/types";

const PENDING_KEY = "pn_requeue_pending";
const RELOAD_KEY = "pn_requeue_reload";
const ctx = { settings: { requeue_after_lobby_fail_enabled: true } as Settings };

const reloadSpy = vi.fn();
const jsdomLocation = location;
vi.stubGlobal("location", {
  get pathname() {
    return jsdomLocation.pathname;
  },
  origin: jsdomLocation.origin,
  assign: vi.fn(),
  reload: reloadSpy,
});

const infoHas = (needle: string) =>
  vi.mocked(log.info).mock.calls.some((args) => args.some((a) => String(a).includes(needle)));

function freshBridge(): void {
  sessionStorage.setItem(
    PENDING_KEY,
    serializeMark({ issuedAt: Date.now() - 5_000, refreshedAt: Date.now() - 1_000 }),
  );
}

function playButton(): void {
  document.body.innerHTML = `
    <div class="p-play__profile-panel">
      <div class="p-play-profile__wr"><button class="p-play__profile-button">Играть</button></div>
    </div>`;
}

/** Сайт считает игрока ещё в игре: вместо «Играть» — «Продолжить/Покинуть». */
function decideBlock(): void {
  document.body.innerHTML = `
    <div class="p-play__profile-panel">
      <div class="p-play__profile-game p-play__profile-game--decide">
        <button>Продолжить игру</button><button class="p-play__profile-quit">Покинуть игру</button>
      </div>
    </div>`;
}

/** Крутилка на месте «Играть» (isSearchBtnLoading). */
function searchLoader(): void {
  document.body.innerHTML = `
    <div class="p-play__profile-panel">
      <div class="p-play__profile-game p-play__profile-game--search p-play__profile-game-loader-gradient"></div>
    </div>`;
}

/** В jsdom нет раскладки: модалку сайта «открытой» делает только размер. */
function giveSize(el: Element | null): void {
  if (!el) throw new Error("нет узла");
  Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 300 });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 200 });
}

function setPrerendering(on: boolean): void {
  Object.defineProperty(document, "prerendering", { configurable: true, get: () => on });
}

beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_800_000_000_000));
  vi.mocked(safeClick).mockClear();
  vi.mocked(log.info).mockClear();
  reloadSpy.mockClear();
  setPrerendering(false);
});

afterEach(() => {
  queueRequeueFeature.disable();
  domSubscriber = null;
  vi.useRealTimers();
  setPrerendering(false);
});


describe("замер контролируемого сценария", () => {
  test("TIMING_REPLAY: готовая страница и подтверждение очереди через 40 мс", () => {
    const rows: { loadMs: number; stopToClickMs: number; stopToQueueMs: number }[] = [];
    for (const loadMs of [0, 50, 100, 200, 300, 1000]) {
      queueRequeueFeature.disable();
      sessionStorage.clear();
      vi.mocked(safeClick).mockClear();
      const stoppedAt = Date.now();
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        issuedAt: stoppedAt - 5000, refreshedAt: stoppedAt, roomStoppedAt: stoppedAt,
      }));
      vi.advanceTimersByTime(loadMs);
      playButton();
      vi.mocked(safeClick).mockImplementationOnce(() => {
        const clickedAt = Date.now();
        setTimeout(() => {
          document.body.innerHTML = '<div class="p-play__profile-game--search"><span class="p-play__profile-game-search-time">00:01</span></div>';
          // Подтверждение сервера смоделировано отдельно от клика.
          domSubscriber?.();
          rows.push({ loadMs, stopToClickMs: clickedAt - stoppedAt, stopToQueueMs: Date.now() - stoppedAt });
        }, 40);
        return true;
      });
      queueRequeueFeature.enable(ctx);
      vi.advanceTimersByTime(1500);
      expect(rows.length).toBe([0, 50, 100, 200, 300, 1000].indexOf(loadMs) + 1);
    }
    console.log("TIMING_REPLAY=" + JSON.stringify(rows));
  });

});
