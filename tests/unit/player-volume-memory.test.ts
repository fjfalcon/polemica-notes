// @vitest-environment jsdom
/**
 * Запомненная громкость игрока (09.11.2026).
 *
 * Сторожим три вещи: что запоминаем ровно ползунок «Громкость игрока» нужного
 * игрока (id из ссылки профиля его меню), что page-скрипт зовёт метод сайта
 * updateVolumeIcon один раз на значение и не спорит с ползунком дальше, и что
 * своя плитка и выкрик не трогаются.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const disk: Record<string, unknown> = {};
  return {
    disk,
    get: vi.fn(async (key: string) => (key in disk ? { [key]: disk[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(disk, JSON.parse(JSON.stringify(items)));
    }),
    storageListeners: [] as Array<(c: Record<string, { newValue?: unknown }>, a: string) => void>,
  };
});

vi.mock("@core/env", () => ({
  browser: {
    storage: {
      local: { get: mocks.get, set: mocks.set },
      onChanged: {
        addListener: vi.fn((fn) => mocks.storageListeners.push(fn)),
        removeListener: vi.fn((fn) => {
          const i = mocks.storageListeners.indexOf(fn);
          if (i >= 0) mocks.storageListeners.splice(i, 1);
        }),
      },
    },
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
  },
}));
vi.mock("@core/log", () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  MAX_PLAYER_VOLUMES,
  PLAYER_VOLUMES_KEY,
  normalizeVolume,
  sanitizePlayerVolumes,
  userIdFromProfileHref,
  withPlayerVolume,
} from "@shared/player-volumes";
import { applyPlayerVolumes, findPlayerComponents } from "@content/page/player-volume-page";
import { noteSliderChange, playerVolumeMemoryFeature, readSliderChange } from "@content/features/player-volume-memory";
import type { FeatureContext } from "@core/feature";

describe("карта громкостей", () => {
  test("значение — целое 0…100, мусор отбрасывается", () => {
    expect(normalizeVolume(37.6)).toBe(38);
    expect(normalizeVolume("20")).toBe(20);
    expect(normalizeVolume(140)).toBe(100);
    expect(normalizeVolume(-3)).toBe(0);
    expect(normalizeVolume("")).toBeNull();
    expect(normalizeVolume(NaN)).toBeNull();
    expect(normalizeVolume(null)).toBeNull();
  });

  test("id только из /profile/<число>", () => {
    expect(userIdFromProfileHref("/profile/12345")).toBe("12345");
    expect(userIdFromProfileHref("/profile/12345?tab=1")).toBe("12345");
    expect(userIdFromProfileHref("/profile/abc")).toBeNull();
    expect(userIdFromProfileHref("https://evil/profile/1")).toBeNull();
    expect(userIdFromProfileHref(null)).toBeNull();
  });

  test("разбор недоверенной карты поштучный", () => {
    const out = sanitizePlayerVolumes([["1", 20], ["x", 5], ["2", "abc"], ["3", 101], [4, 7], "junk", ["1", 30]]);
    // Повтор id — поздний свежее и встаёт в конец.
    expect([...out]).toEqual([["3", 100], ["1", 30]]);
    expect(sanitizePlayerVolumes({ "1": 20 }).size).toBe(0);
    expect(sanitizePlayerVolumes("x").size).toBe(0);
  });

  test("свежая запись переезжает в конец, потолок режет самые старые", () => {
    let map = sanitizePlayerVolumes([]);
    for (let i = 0; i < MAX_PLAYER_VOLUMES; i++) map = withPlayerVolume(map, String(i), 50);
    map = withPlayerVolume(map, "0", 10); // тронули первую — она свежая
    map = withPlayerVolume(map, "999999", 30);
    const keys = [...map.keys()];
    expect(keys.length).toBe(MAX_PLAYER_VOLUMES);
    expect(keys).not.toContain("1"); // самая старая ушла
    expect(map.get("0")).toBe(10);
    expect(keys[keys.length - 1]).toBe("999999");
  });
});

// ─────────────── page-скрипт: метод сайта, один раз на значение ───────────────

type FakePlayer = {
  currentVolume: number;
  itsMe: boolean;
  isOutcry: boolean;
  playerView: { user: { id: number } } | null;
  updateVolumeIcon: ReturnType<typeof vi.fn>;
};

function player(id: number | null, extra: Partial<FakePlayer> = {}): FakePlayer {
  const p: FakePlayer = {
    currentVolume: 50,
    itsMe: false,
    isOutcry: false,
    playerView: id === null ? null : { user: { id } },
    updateVolumeIcon: vi.fn((v: number) => {
      p.currentVolume = v;
    }),
    ...extra,
  };
  return p;
}

/** Дерево как у compat-сборки: корень через _vnode.component контейнера. */
function mountApp(players: FakePlayer[]): Array<{ proxy: FakePlayer }> {
  document.body.innerHTML = `<div id="app"></div>`;
  const instances = players.map((proxy) => ({ proxy, subTree: null }));
  const table = { proxy: { other: true }, subTree: { children: instances.map((c) => ({ component: c })) } };
  const root = { proxy: {}, subTree: { children: [{ children: [{ component: table }] }] } };
  (document.querySelector("#app") as Element & { _vnode?: unknown })._vnode = { component: root };
  return instances;
}

describe("page-скрипт громкости", () => {
  test("находит плитки в глубине дерева", () => {
    mountApp([player(1), player(2)]);
    expect(findPlayerComponents(document)).toHaveLength(2);
  });

  test("зовёт updateVolumeIcon запомненным значением — и только у тех, кто в карте", () => {
    const a = player(11);
    const b = player(22);
    mountApp([a, b]);
    expect(applyPlayerVolumes(document, new Map([["11", 20]]))).toBe(1);
    expect(a.updateVolumeIcon).toHaveBeenCalledWith(20);
    expect(b.updateVolumeIcon).not.toHaveBeenCalled();
  });

  test("один раз на значение: дальше ползунок в руках игрока", () => {
    const a = player(11);
    mountApp([a]);
    applyPlayerVolumes(document, new Map([["11", 20]]));
    a.currentVolume = 70; // игрок подвинул ползунок сам
    applyPlayerVolumes(document, new Map([["11", 20]]));
    expect(a.updateVolumeIcon).toHaveBeenCalledTimes(1);
    expect(a.currentVolume).toBe(70);
  });

  test("новое значение того же игрока плитку не дёргает (запоздалый пуш не откатывает ползунок)", () => {
    const a = player(11);
    mountApp([a]);
    applyPlayerVolumes(document, new Map([["11", 20]]));
    a.currentVolume = 35; // игрок двигает ползунок; его же запись вернулась пушем
    applyPlayerVolumes(document, new Map([["11", 30]]));
    expect(a.updateVolumeIcon).toHaveBeenCalledTimes(1);
    expect(a.currentVolume).toBe(35);
  });

  test("место занял другой игрок: свой сохранённый — применяется, нет сохранённого — возврат прежнего", () => {
    const seat = player(11, { currentVolume: 50 });
    mountApp([seat]);
    applyPlayerVolumes(document, new Map([["11", 0], ["22", 70]]));
    expect(seat.currentVolume).toBe(0);
    seat.playerView = { user: { id: 22 } };
    applyPlayerVolumes(document, new Map([["11", 0], ["22", 70]]));
    expect(seat.currentVolume).toBe(70);
    seat.playerView = { user: { id: 33 } }; // у 33 ничего не запомнено
    applyPlayerVolumes(document, new Map([["11", 0], ["22", 70]]));
    expect(seat.currentVolume, "33 не наследует чужой ноль — громкость сайта до нашей правки").toBe(50);
  });

  test("плитка под нашим мьютом не трогается; после размьюта — применяется", () => {
    const a = player(11);
    mountApp([a]);
    const tile = document.createElement("div");
    tile.innerHTML = `<audio data-pn-muted="true"></audio>`;
    (a as unknown as { $el: Element }).$el = tile;
    applyPlayerVolumes(document, new Map([["11", 20]]));
    expect(a.updateVolumeIcon).not.toHaveBeenCalled();
    tile.querySelector("audio")!.removeAttribute("data-pn-muted");
    applyPlayerVolumes(document, new Map([["11", 20]]));
    expect(a.updateVolumeIcon).toHaveBeenCalledWith(20);
  });

  test("новая игра — новый компонент — применяется снова", () => {
    mountApp([player(11)]);
    applyPlayerVolumes(document, new Map([["11", 20]]));
    const fresh = player(11);
    mountApp([fresh]);
    applyPlayerVolumes(document, new Map([["11", 20]]));
    expect(fresh.updateVolumeIcon).toHaveBeenCalledWith(20);
  });

  test("своя плитка, пустое место и выкрик не трогаются; после выкрика — применяется", () => {
    const me = player(1, { itsMe: true });
    const empty = player(null);
    const loud = player(3, { isOutcry: true, currentVolume: 40 });
    mountApp([me, empty, loud]);
    applyPlayerVolumes(document, new Map([["1", 10], ["3", 10]]));
    expect(me.updateVolumeIcon).not.toHaveBeenCalled();
    expect(empty.updateVolumeIcon).not.toHaveBeenCalled();
    expect(loud.updateVolumeIcon).not.toHaveBeenCalled();
    loud.isOutcry = false;
    applyPlayerVolumes(document, new Map([["1", 10], ["3", 10]]));
    expect(loud.updateVolumeIcon).toHaveBeenCalledWith(10);
  });

  test("плитка без <audio> бросила — повтор зовёт сайт снова, хотя ползунок уже «верный»", () => {
    // Порядок сайта: currentVolume = v, ПОТОМ <audio>/усилитель — бросок
    // оставляет ползунок на новом значении, а звук на старом (ревью, major).
    const a = player(11);
    let audioVolume = 1;
    let ready = false;
    a.updateVolumeIcon.mockImplementation((v: number) => {
      a.currentVolume = v;
      if (!ready) throw new TypeError("Cannot set properties of undefined (setting 'volume')");
      audioVolume = v / 100;
    });
    mountApp([a]);
    expect(applyPlayerVolumes(document, new Map([["11", 20]]))).toBe(0);
    ready = true;
    expect(applyPlayerVolumes(document, new Map([["11", 20]]))).toBe(1);
    expect(audioVolume).toBe(0.2);
  });

  test("новому игроку на месте — умолчание компонента, а не личная громкость прежнего", () => {
    // Ревью: P0 (ничего не запомнено) → игрок сам ставит 30 → A (20) → B (ничего).
    const seat = player(1, { currentVolume: 50 });
    mountApp([seat]);
    const map = new Map([["2", 20]]);
    applyPlayerVolumes(document, map);
    seat.currentVolume = 30; // P0 поставили вручную
    seat.playerView = { user: { id: 2 } };
    applyPlayerVolumes(document, map);
    expect(seat.currentVolume).toBe(20);
    seat.playerView = { user: { id: 3 } };
    applyPlayerVolumes(document, map);
    expect(seat.currentVolume).toBe(50);
  });

  test("бросок, затем смена игрока: новый без запомненного получает умолчание", () => {
    const seat = player(11, { currentVolume: 50 });
    seat.updateVolumeIcon.mockImplementationOnce((v: number) => {
      seat.currentVolume = v;
      throw new TypeError("no audio");
    });
    mountApp([seat]);
    applyPlayerVolumes(document, new Map([["11", 20]]));
    seat.playerView = { user: { id: 33 } };
    applyPlayerVolumes(document, new Map([["11", 20]]));
    expect(seat.currentVolume).toBe(50);
  });

  test("вечно бросающая плитка: не больше трёх попыток, ползунок игрока не откатывается", () => {
    const a = player(11);
    a.updateVolumeIcon.mockImplementation((v: number) => {
      a.currentVolume = v;
      throw new TypeError("no audio");
    });
    mountApp([a]);
    applyPlayerVolumes(document, new Map([["11", 20]]));
    a.currentVolume = 70; // игрок сдвинул сам
    applyPlayerVolumes(document, new Map([["11", 20]]));
    expect(a.currentVolume).toBe(70);
    expect(a.updateVolumeIcon).toHaveBeenCalledTimes(1);

    const b = player(12);
    b.updateVolumeIcon.mockImplementation((v: number) => {
      b.currentVolume = v;
      throw new TypeError("no audio");
    });
    mountApp([b]);
    for (let i = 0; i < 6; i++) applyPlayerVolumes(document, new Map([["12", 20]]));
    expect(b.updateVolumeIcon).toHaveBeenCalledTimes(3);
  });

  test("громкость до броска запоминается для возврата, а не уже сдвинутая", () => {
    const seat = player(11, { currentVolume: 50 });
    seat.updateVolumeIcon.mockImplementationOnce((v: number) => {
      seat.currentVolume = v;
      throw new TypeError("no audio");
    });
    mountApp([seat]);
    applyPlayerVolumes(document, new Map([["11", 0]]));
    applyPlayerVolumes(document, new Map([["11", 0]]));
    seat.playerView = { user: { id: 33 } };
    applyPlayerVolumes(document, new Map([["11", 0]]));
    expect(seat.currentVolume).toBe(50);
  });

  test("нет корня Vue — тихо ничего", () => {
    document.body.innerHTML = "";
    expect(applyPlayerVolumes(document, new Map([["1", 5]]))).toBe(0);
  });
});

// ─────────────── content: запись с ползунка ───────────────

function menuWithSlider(href: string | null, value: string, inPlayer = true): HTMLInputElement {
  document.body.innerHTML = `
    <div class="${inPlayer ? "player" : "other"}"><div class="player__menu active"><div class="menu"><div class="menu__container">
      <section><ul>
        ${href ? `<li><a href="${href}" target="_blank">Профиль</a></li>` : ""}
        <li><div class="volume"><span class="volume-title">Громкость игрока</span>
          <div class="volume__container"><div class="volume"><input type="range" min="0" max="100" value="${value}"></div></div>
        </div></li>
      </ul></section>
    </div></div></div></div>`;
  return document.querySelector("input[type=range]") as HTMLInputElement;
}

describe("запись с ползунка «Громкость игрока»", () => {
  test("id из ссылки профиля того же меню и значение ползунка", () => {
    const input = menuWithSlider("/profile/777", "30");
    expect(readSliderChange(input)).toEqual({ id: "777", volume: 30 });
  });

  test("без ссылки профиля (гость) и вне плитки — не наше", () => {
    expect(readSliderChange(menuWithSlider(null, "30"))).toBeNull();
    expect(readSliderChange(menuWithSlider("/profile/777", "30", false))).toBeNull();
    expect(readSliderChange(document.body)).toBeNull();
  });
});

describe("фича целиком", () => {
  const ctx = {} as FeatureContext;
  beforeEach(() => {
    for (const k of Object.keys(mocks.disk)) delete mocks.disk[k];
    mocks.set.mockClear();
    history.replaceState(null, "", "/game/123");
  });

  test("отпущенный ползунок (trusted change) пишется слиянием со свежим диском", async () => {
    mocks.disk[PLAYER_VOLUMES_KEY] = [["5", 60]];
    await playerVolumeMemoryFeature.enable(ctx);
    // Соседняя вкладка успела записать своё после нашего чтения.
    mocks.disk[PLAYER_VOLUMES_KEY] = [["5", 60], ["6", 15]];
    noteSliderChange(menuWithSlider("/profile/777", "25"));
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalled());
    expect(mocks.disk[PLAYER_VOLUMES_KEY]).toEqual([["5", 60], ["6", 15], ["777", 25]]);
    playerVolumeMemoryFeature.disable();
  });

  test("синтетическое событие страницы не пишется", async () => {
    await playerVolumeMemoryFeature.enable(ctx);
    const input = menuWithSlider("/profile/777", "25");
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.set).not.toHaveBeenCalled();
    playerVolumeMemoryFeature.disable();
  });

  test("в комнате с плитками ставит page-скрипт и шлёт ему карту списком пар", async () => {
    vi.useFakeTimers();
    try {
      mocks.disk[PLAYER_VOLUMES_KEY] = [["5", 60], ["777", 25]];
      document.body.innerHTML = `<div class="player"><div class="player__info"><span class="info__name">Вася</span></div></div>`;
      const post = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
      await playerVolumeMemoryFeature.enable(ctx);
      await vi.advanceTimersByTimeAsync(600);
      const tag = document.querySelector<HTMLScriptElement>('script[src$="player-volume-page.js"]');
      expect(tag, "page-скрипт ставится лениво, когда есть что применять").not.toBeNull();
      tag!.onload!(new Event("load"));
      expect(document.querySelector('script[src$="player-volume-page.js"]'), "тег убран после загрузки").toBeNull();
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toEqual({ source: "pn-player-volume-cmd", volumes: [["5", 60], ["777", 25]] });
      // Тот же стол, меньше RESEND_MS — повтора нет; через 5 с — повтор.
      document.body.appendChild(document.createElement("i"));
      await vi.advanceTimersByTimeAsync(600);
      expect(post).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      document.body.appendChild(document.createElement("i"));
      await vi.advanceTimersByTimeAsync(600);
      expect(post).toHaveBeenCalledTimes(2);
      playerVolumeMemoryFeature.disable();
      post.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  test("вне комнаты и с пустой картой — ничего не ставит", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<div class="player"></div>`;
      await playerVolumeMemoryFeature.enable(ctx);
      await vi.advanceTimersByTimeAsync(600);
      expect(document.querySelector("script")).toBeNull();
      playerVolumeMemoryFeature.disable();
    } finally {
      vi.useRealTimers();
    }
  });

  test("disable снимает слушатели", async () => {
    await playerVolumeMemoryFeature.enable(ctx);
    playerVolumeMemoryFeature.disable();
    expect(mocks.storageListeners).toHaveLength(0);
    noteSliderChange(menuWithSlider("/profile/777", "25"));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
