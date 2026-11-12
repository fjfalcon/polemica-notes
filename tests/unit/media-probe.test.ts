// @vitest-environment jsdom
/**
 * Зонд медиа-комнаты («F5 только для видео»).
 *
 * Зонд дёргает ЖИВОЙ медиа-слой сайта, поэтому сторожим не «функции
 * вызвались», а порядок и аргументы штатного пути сайта: неправильный
 * аргумент disconnect убивает дорожки собственной камеры игрока, а
 * неправильный порядок оставляет комнату без медиа вовсе.
 */
import { describe, expect, test, vi } from "vitest";

import { findRoomProxy, readMediaGen, reconnectMedia, refreshStreams } from "@content/page/media-probe-page";

function appWithProxy(proxy: unknown): void {
  document.body.innerHTML = `<div id="app"></div>`;
  (document.querySelector("#app") as Element & { __vue_app__?: unknown }).__vue_app__ = {
    _instance: { proxy },
  };
}

function workingProxy() {
  const calls: string[] = [];
  const freshRoom = {
    isConnected: false,
    connect: vi.fn((id: unknown) => calls.push(`connect:${String(id)}`)),
    disconnect: vi.fn(),
  };
  const proxy = {
    mediaRoom: {
      isConnected: true,
      disconnect: vi.fn((keep: boolean) => calls.push(`disconnect:${String(keep)}`)),
      connect: vi.fn(),
    },
    createMediaRoom: vi.fn(() => {
      calls.push("create");
      proxy.mediaRoom = freshRoom;
    }),
    $store: { state: { gameId: 42 } },
  };
  return { proxy, calls, freshRoom };
}

describe("штатный путь сайта, шаг в шаг", () => {
  test("disconnect(true) → createMediaRoom → connect(gameId) на НОВОЙ комнате", () => {
    const { proxy, calls, freshRoom } = workingProxy();
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBeNull();
    // Порядок — это и есть контракт: так делает сам сайт на «ice failed».
    expect(calls).toEqual(["disconnect:true", "create", "connect:42"]);
    expect(freshRoom.connect).toHaveBeenCalledWith(42);
  });

  test("disconnect обязан получить true — иначе гаснет СВОЯ камера", () => {
    // Без аргумента сайт останавливает дорожки playerStream, и после
    // переподключения игрок публиковал бы мёртвый поток. Это главный способ
    // навредить, поэтому проверяется отдельно от «порядок верный».
    const { proxy } = workingProxy();
    appWithProxy(proxy);
    const old = proxy.mediaRoom;
    reconnectMedia(document);
    expect(old.disconnect).toHaveBeenCalledWith(true);
  });
});

describe("честные отказы вместо поломки страницы", () => {
  test("нет #app или Vue — диагноз, а не исключение", () => {
    document.body.innerHTML = "<div>ничего</div>";
    expect(reconnectMedia(document)).toBe("vue_root_not_found");
    document.body.innerHTML = `<div id="app"></div>`;
    expect(reconnectMedia(document), "app без __vue_app__").toBe("vue_root_not_found");
  });

  test("медиа ещё не поднято — переподключать нечего", () => {
    const { proxy } = workingProxy();
    proxy.mediaRoom.isConnected = false;
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBe("media_not_connected");
    expect(proxy.createMediaRoom).not.toHaveBeenCalled();
  });

  test("нет gameId — не дёргаем disconnect ВООБЩЕ", () => {
    // Порвать соединение и не суметь поднять новое — хуже, чем не делать
    // ничего: проверки обязаны идти ДО первого разрушающего шага.
    const { proxy } = workingProxy();
    proxy.$store = { state: { gameId: undefined } } as never;
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBe("game_id_missing");
    expect(proxy.mediaRoom.disconnect).not.toHaveBeenCalled();
  });

  test("createMediaRoom не пересоздал комнату — признаёмся", () => {
    const { proxy } = workingProxy();
    proxy.createMediaRoom = vi.fn(() => {
      proxy.mediaRoom = null as never;
    });
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBe("recreate_failed");
  });

  test("мягкий шаг зовёт updateStreams и НИЧЕГО не рвёт", () => {
    // Смысл мягкого шага именно в бескровности: дожать отложенные подписки,
    // не трогая соединения, — у остальных игроков картинка не мигает.
    const { proxy } = workingProxy();
    (proxy.mediaRoom as unknown as { updateStreams?: () => void }).updateStreams = vi.fn();
    appWithProxy(proxy);
    expect(refreshStreams(document)).toBeNull();
    expect((proxy.mediaRoom as unknown as { updateStreams: () => void }).updateStreams).toHaveBeenCalled();
    expect(proxy.mediaRoom.disconnect).not.toHaveBeenCalled();
    expect(proxy.createMediaRoom).not.toHaveBeenCalled();
  });

  test("мягкий шаг без updateStreams — честный отказ", () => {
    const { proxy } = workingProxy();
    appWithProxy(proxy);
    expect(refreshStreams(document)).toBe("update_streams_missing");
  });

  test("findRoomProxy достаёт proxy из #app", () => {
    const { proxy } = workingProxy();
    appWithProxy(proxy);
    expect(findRoomProxy(document)).toBe(proxy);
  });

  test("compat-сборка Vue: _instance пуст, маршрут — через _vnode контейнера", () => {
    // Реальный отказ 14.08.2026: у compat-сборки mount не пишет _instance
    // (только _container и __vue_app__), и путь через него давал
    // vue_root_not_found на живой игре при работающем сайте.
    const { proxy } = workingProxy();
    document.body.innerHTML = `<div id="app"></div>`;
    const app = document.querySelector("#app") as Element & Record<string, unknown>;
    app.__vue_app__ = { _instance: null };
    app._vnode = { component: { proxy } };
    expect(findRoomProxy(document)).toBe(proxy);
    expect(reconnectMedia(document), "и весь путь кнопки с ним работает").toBeNull();
  });

  test("комната — не корень, а ВНУК корня: обход дерева находит её", () => {
    // Реальный отказ 14.08.2026 (второй): корневой компонент — обёртка без
    // mediaRoom, и «взять корень» давало media_room_not_found при живом сайте.
    const { proxy } = workingProxy();
    document.body.innerHTML = `<div id="app"></div>`;
    const app = document.querySelector("#app") as Element & Record<string, unknown>;
    const roomInst = { proxy, subTree: null };
    const middle = { proxy: { какойто: 1 }, subTree: { component: roomInst } };
    app.__vue_app__ = {
      _instance: {
        proxy: { тоже: "не комната" },
        // Корень рисует фрагмент: компонент комнаты — среди детей vnode'ов.
        subTree: { children: [{ children: [] }, { component: middle }] },
      },
    };
    expect(findRoomProxy(document)).toBe(proxy);
    expect(reconnectMedia(document)).toBeNull();
  });

  test("комнаты в дереве нет — честный vue_root_not_found, а не вечный обход", () => {
    document.body.innerHTML = `<div id="app"></div>`;
    const app = document.querySelector("#app") as Element & Record<string, unknown>;
    app.__vue_app__ = { _instance: { proxy: {}, subTree: { children: [] } } };
    expect(reconnectMedia(document)).toBe("vue_root_not_found");
  });

  test("маршрут через _container._vnode тоже живой", () => {
    const { proxy } = workingProxy();
    document.body.innerHTML = `<div id="app"></div>`;
    const app = document.querySelector("#app") as Element & Record<string, unknown>;
    const container = { _vnode: { component: { proxy } } };
    app.__vue_app__ = { _instance: null, _container: container };
    expect(findRoomProxy(document)).toBe(proxy);
  });
});

/**
 * Новый медиа-клиент сайта (12.11.2026): у mediaRoom только resume /
 * updateStreams / close, номер сессии — внутри клиента. Жёсткий шаг —
 * L1 самого сайта: media_recreate {gen, reason:"other"} в сокет комнаты.
 */
function newApiProxy(gen = 7) {
  const sent: Array<[string, unknown]> = [];
  class Socket {
    emit(event: string, payload: unknown): this {
      sent.push([event, payload]);
      return this;
    }
  }
  const socket = new Socket();
  const proxy = {
    socket,
    mediaRoom: {
      // Как у сайта: resume() → signaling.emit("media_resume", {gen}), где signaling — тот же сокет.
      resume: vi.fn(() => socket.emit("media_resume", { gen })),
      updateStreams: vi.fn(),
      close: vi.fn(),
    },
    createMediaRoom: vi.fn(),
    $store: { state: { gameId: 42 } },
  };
  return { proxy, sent, socket };
}

describe("новый медиа-клиент сайта (12.11.2026)", () => {
  test("жёсткий шаг — L1 сайта: media_recreate с текущим gen, resume серверу не уходит", () => {
    const { proxy, sent, socket } = newApiProxy(7);
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBeNull();
    expect(sent).toEqual([["media_recreate", { gen: 7, reason: "other" }]]);
    // Сессию не рушим сами и свою камеру не трогаем — всё делает сайт по ответу сервера.
    expect(proxy.mediaRoom.close).not.toHaveBeenCalled();
    expect(proxy.createMediaRoom).not.toHaveBeenCalled();
    // emit экземпляра восстановлен: дальше сокет работает как прежде.
    expect(Object.prototype.hasOwnProperty.call(socket, "emit")).toBe(false);
    socket.emit("ping", 1);
    expect(sent.at(-1)).toEqual(["ping", 1]);
  });

  test("свой emit на экземпляре — возвращается тот же", () => {
    const { proxy } = newApiProxy(3);
    const own = vi.fn();
    (proxy.socket as unknown as { emit: unknown }).emit = own;
    (proxy.mediaRoom as { resume: () => void }).resume = () =>
      (proxy.socket as unknown as { emit: (e: string, p: unknown) => void }).emit("media_resume", { gen: 3 });
    expect(readMediaGen(proxy as never)).toBe(3);
    expect((proxy.socket as unknown as { emit: unknown }).emit).toBe(own);
    expect(own, "resume проглочен").not.toHaveBeenCalled();
  });

  test("сессии ещё нет (gen 0) — повторяем вход сайта: resume с gen 0 уходит, recreate нет", () => {
    const { proxy, sent } = newApiProxy(0);
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBeNull();
    expect(sent).toEqual([["media_resume", { gen: 0 }]]);
  });

  test("сокет комнаты лежит — ничего не шлём (emit лёг бы в буфер со старым gen)", () => {
    const { proxy, sent } = newApiProxy(7);
    (proxy.socket as unknown as { connected: boolean }).connected = false;
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBe("media_not_connected");
    expect(sent).toEqual([]);
    const second = newApiProxy(7);
    (second.proxy as unknown as { connectedToRoom: boolean }).connectedToRoom = false;
    appWithProxy(second.proxy);
    expect(reconnectMedia(document)).toBe("media_not_connected");
    expect(second.sent).toEqual([]);
  });

  test("сокет — реактивный Proxy Vue: перехват и восстановление идут через ловушки", () => {
    const { proxy, sent, socket } = newApiProxy(5);
    const reactive = new Proxy(socket, {});
    (proxy as { socket: unknown }).socket = reactive;
    proxy.mediaRoom.resume = vi.fn(() => reactive.emit("media_resume", { gen: 5 }));
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBeNull();
    expect(sent).toEqual([["media_recreate", { gen: 5, reason: "other" }]]);
    expect(Object.prototype.hasOwnProperty.call(socket, "emit")).toBe(false);
  });

  test("откат сайта: у mediaRoom снова connect — идём старым путём", () => {
    const { proxy, calls } = workingProxy();
    (proxy.mediaRoom as unknown as { resume: () => void }).resume = vi.fn();
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBeNull();
    expect(calls).toEqual(["disconnect:true", "create", "connect:42"]);
  });

  test("resume ничего не прислал — media_gen_unknown; нет сокета — socket_missing", () => {
    const { proxy, sent } = newApiProxy();
    (proxy.mediaRoom as { resume: () => void }).resume = () => undefined;
    appWithProxy(proxy);
    expect(reconnectMedia(document)).toBe("media_gen_unknown");
    expect(sent).toEqual([]);
    const second = newApiProxy();
    (second.proxy as { socket: unknown }).socket = null;
    appWithProxy(second.proxy);
    expect(reconnectMedia(document)).toBe("socket_missing");
  });

  test("resume бросил — emit всё равно восстановлен", () => {
    const { proxy, socket } = newApiProxy();
    (proxy.mediaRoom as { resume: () => void }).resume = () => {
      throw new Error("boom");
    };
    expect(() => readMediaGen(proxy as never)).toThrow("boom");
    expect(Object.prototype.hasOwnProperty.call(socket, "emit")).toBe(false);
  });

  test("мягкий шаг без isConnected (у нового клиента поля нет) — работает", () => {
    const { proxy } = newApiProxy();
    appWithProxy(proxy);
    expect(refreshStreams(document)).toBeNull();
    expect(proxy.mediaRoom.updateStreams).toHaveBeenCalled();
  });
});
