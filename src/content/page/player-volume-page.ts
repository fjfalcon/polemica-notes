/**
 * Громкость игроков — PAGE-скрипт (мир страницы). Просьба владельца 09.11.2026:
 * громкость игрока сайта с каждой новой игрой сбрасывается на умолчание.
 *
 * Как устроено у сайта (room/bundle/main.js, сверено 09.11.2026): у
 * компонента плитки в data `currentVolume` (100, а при useAudioAmplification —
 * 50: усилитель ×2), ползунок меню зовёт его метод
 *   updateVolumeIcon(v): currentVolume = v; усилитель.setVolume(v/100)
 *                         (или <audio>.volume = v/100 без усиления).
 * Компонент создаётся заново в каждой игре — отсюда сброс.
 *
 * Что делаем: по команде content-скрипта со списком [userId, громкость]
 * находим плитки (у компонента есть updateVolumeIcon, currentVolume и
 * playerView.user.id) и зовём тот самый метод сайта — звук и ползунок
 * сходятся, своего пути громкости нет. Каждую плитку — один раз на игрока
 * (WeakMap по компоненту): дальше игрок двигает ползунок сам, мы не спорим.
 * Усилитель сайта (WebAudio) переносит громкость на поток при подключении
 * (setSource → updateVolume), поэтому применять до прихода звука можно.
 *
 * Не трогаем: свою плитку (itsMe), плитку во время выкрика (сайт сам
 * вернёт громкость после него — применим следующим проходом), плитку под
 * нашим мьютом (без усиления звук идёт прямо в <audio>.volume, и вызов
 * сайта перебил бы ноль мьюта).
 *
 * Команду может подделать сама страница — это ничего ей не даёт: громкость
 * плиток и так в её власти.
 *
 * Имена (updateVolumeIcon/currentVolume/playerView/itsMe/isOutcry) — ключи
 * объектов Vue, минификатор их не переименовывает. Сайт перепишут — скрипт
 * молча ничего не найдёт; всё под try/catch.
 */
import {
  PLAYER_VOLUME_CMD_SOURCE,
  sanitizePlayerVolumes,
  type PlayerVolumes,
} from "@shared/player-volumes";

interface PlayerProxy {
  updateVolumeIcon?: (v: number) => void;
  currentVolume?: unknown;
  itsMe?: unknown;
  isOutcry?: unknown;
  playerView?: { user?: { id?: unknown } | null } | null;
}

interface VueInstance {
  proxy?: unknown;
  subTree?: VueVNode | null;
}
interface VueVNode {
  component?: VueInstance | null;
  children?: unknown;
}
interface VueContainer extends Element {
  __vue_app__?: {
    _instance?: VueInstance | null;
    _container?: { _vnode?: { component?: VueInstance | null } | null } | null;
  };
  _vnode?: { component?: VueInstance | null } | null;
}

/** Потолки обхода: страховка от патологического дерева. */
const INSTANCE_LIMIT = 5000;
const VNODE_LIMIT = 50000;

function looksLikePlayer(p: unknown): p is PlayerProxy {
  return (
    !!p &&
    typeof p === "object" &&
    typeof (p as PlayerProxy).updateVolumeIcon === "function" &&
    "currentVolume" in (p as object) &&
    "playerView" in (p as object)
  );
}

/**
 * Компоненты плиток. Корень — как в media-probe-page (compat-сборка Vue не
 * заполняет `_instance`, рабочий маршрут — `_vnode.component` контейнера).
 * Экспорт — тестовый шов.
 */
export function findPlayerComponents(doc: Document): Array<{ inst: VueInstance; proxy: PlayerProxy }> {
  const app = doc.querySelector("#app") as VueContainer | null;
  const root =
    app?.__vue_app__?._instance ??
    app?._vnode?.component ??
    app?.__vue_app__?._container?._vnode?.component ??
    null;
  const out: Array<{ inst: VueInstance; proxy: PlayerProxy }> = [];
  if (!root) return out;
  const queue: VueInstance[] = [root];
  let instances = 0;
  let vnodes = 0;
  const pushVNode = (vnode: unknown): void => {
    if (!vnode || typeof vnode !== "object" || ++vnodes > VNODE_LIMIT) return;
    const v = vnode as VueVNode;
    if (v.component) {
      queue.push(v.component);
      return;
    }
    if (Array.isArray(v.children)) for (const child of v.children) pushVNode(child);
  };
  while (queue.length > 0 && instances < INSTANCE_LIMIT) {
    const inst = queue.shift();
    instances++;
    if (!inst) continue;
    if (looksLikePlayer(inst.proxy)) {
      out.push({ inst, proxy: inst.proxy });
      continue; // внутри плитки других плиток нет
    }
    pushVNode(inst.subTree);
  }
  return out;
}

/**
 * Состояние компонента плитки:
 *  - id — чей он сейчас ("" — место пустое);
 *  - baseline — громкость компонента при ПЕРВОМ нашем взгляде (умолчание
 *    сайта): её получает новый игрок без запомненной громкости, если место
 *    переиспользовано, — как получил бы свежий компонент (ревью: иначе он
 *    наследовал бы чужую личную громкость);
 *  - done — с этим игроком закончили: дальше ползунок в его руках, и даже
 *    новое значение из хранилища (его же отпущенный ползунок) плитку не
 *    дёргает — иначе запоздалый пуш откатывал бы ползунок под рукой;
 *  - tried/attempts — вызов сайта бросил (нет <audio>): повтор не чаще
 *    MAX_ATTEMPTS раз и только пока игрок не сдвинул ползунок сам.
 */
interface Mark {
  id: string;
  baseline: number | null;
  reseated: boolean;
  done: boolean;
  tried: number | null;
  attempts: number;
}
const marks = new WeakMap<object, Mark>();
const MAX_ATTEMPTS = 3;

/** Плитку заглушил наш мьют (data-pn-muted на её медиа) — громкость не трогаем до размьюта. */
function mutedByUs(proxy: PlayerProxy): boolean {
  const el = (proxy as { $el?: unknown }).$el;
  return el instanceof Element && el.querySelector('[data-pn-muted="true"]') !== null;
}

/** Выставить запомненную громкость плиткам. Возвращает число применённых. Тестовый шов. */
export function applyPlayerVolumes(doc: Document, volumes: PlayerVolumes): number {
  let count = 0;
  for (const { inst, proxy } of findPlayerComponents(doc)) {
    try {
      if (proxy.itsMe === true) continue;
      const rawId = proxy.playerView?.user?.id;
      const id = typeof rawId === "number" || typeof rawId === "string" ? String(rawId) : "";
      const current = typeof proxy.currentVolume === "number" ? proxy.currentVolume : null;
      let st = marks.get(inst);
      if (!st) {
        st = { id, baseline: current, reseated: false, done: false, tried: null, attempts: 0 };
        marks.set(inst, st);
      } else if (st.id !== id) {
        Object.assign(st, { id, reseated: true, done: false, tried: null, attempts: 0 });
      }
      if (st.done) continue;
      // Выкрик: сайт временно приглушил и сам вернёт прежнее — не мешаем,
      // плитку применит следующий проход. Так же — под нашим мьютом.
      if (proxy.isOutcry === true || mutedByUs(proxy)) continue;
      // Прошлый вызов бросил, а игрок с тех пор сдвинул ползунок — он главный.
      if (st.tried !== null && current !== st.tried) {
        st.done = true;
        continue;
      }
      const saved = id ? volumes.get(id) : undefined;
      const target =
        typeof saved === "number"
          ? saved
          : st.reseated && st.baseline !== null && current !== st.baseline
            ? st.baseline
            : null;
      if (target === null) {
        st.done = true;
        continue;
      }
      st.tried = target;
      st.attempts++;
      try {
        // Без сравнения с currentVolume: сайт пишет его ДО звука, и после
        // броска ползунок уже «верный», а звук — нет.
        proxy.updateVolumeIcon!(target);
        st.done = true;
        st.tried = null;
        if (typeof saved === "number") count++;
      } catch {
        // Плитка ещё не дорисована (нет <audio>) — следующий проход повторит.
        if (st.attempts >= MAX_ATTEMPTS) st.done = true;
      }
    } catch {
      /* чужой объект вместо плитки — пропускаем */
    }
  }
  return count;
}

interface VolumeWindow extends Window {
  __pnPlayerVolumeInstalled?: boolean;
}

(() => {
  const w = window as VolumeWindow;
  if (w.__pnPlayerVolumeInstalled) return;
  w.__pnPlayerVolumeInstalled = true;

  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const d = e.data as { source?: unknown; volumes?: unknown } | null;
    if (!d || d.source !== PLAYER_VOLUME_CMD_SOURCE) return;
    try {
      applyPlayerVolumes(document, sanitizePlayerVolumes(d.volumes));
    } catch {
      /* код сайта бросил — страницу не роняем */
    }
  });
})();
