/**
 * Идёт ли трансляция в OBS — для content-скрипта (22.10.2026, «осуждёнка»).
 *
 * Правду знает фон (его OBS-клиент слушает StreamStateChanged): он рассылает
 * событие `obs_stream_state` всем вкладкам сайта и отдаёт текущее значение в
 * `get_status` (ответ в конверте `{success, data}`).
 *
 * ТРИ состояния, а не два (ревью 22.10.2026, блокеры): true — эфир, false —
 * эфира нет, null — неизвестно (фон ещё не ответил, нет связи с OBS, новый
 * SW). При включённой интеграции OBS «неизвестно» считается эфиром: первый
 * кадр страницы до ответа фона и обрыв связи не должны показать то, что на
 * эфире прячут. Без интеграции эфира не видно — его нет (сказано в попапе).
 */
import { onMessage, sendRuntime } from "./messaging";

let state: boolean | null = null;
/** Счётчик рассылок: ответ get_status, запрошенный до свежей рассылки, устарел. */
let pushSeq = 0;
let unsubMessage: (() => void) | null = null;
const subscribers = new Set<() => void>();

function set(value: boolean | null): void {
  if (value === state) return;
  state = value;
  subscribers.forEach((cb) => cb());
}

/**
 * Считать ли, что идёт эфир, — для решения, что прятать.
 * @param obsEnabled включена ли интеграция OBS (настройка obs_enabled)
 */
export function isStreaming(obsEnabled: boolean): boolean {
  return obsEnabled && state !== false;
}

/** Спросить фон. Ответ без данных — «неизвестно», а не «эфира нет». */
export async function refreshStreamState(obsEnabled: boolean): Promise<boolean> {
  if (!obsEnabled) return false;
  const seq = pushSeq;
  const res = await sendRuntime<{ success?: boolean; data?: { streaming?: boolean | null } }>({
    type: "obs_command",
    command: "get_status",
  });
  if (seq === pushSeq) {
    const streaming = res?.success ? res.data?.streaming : undefined;
    set(typeof streaming === "boolean" ? streaming : null);
  }
  return isStreaming(obsEnabled);
}

/**
 * Подписка на смену состояния эфира. Первая подписка слушает рассылку фона и
 * спрашивает текущее значение; последняя отписка снимает слушатель.
 */
export function watchStreamState(cb: () => void, obsEnabled: () => boolean): () => void {
  subscribers.add(cb);
  if (!unsubMessage) {
    unsubMessage = onMessage((msg) => {
      const m = msg as { type?: string; eventType?: string; data?: { streaming?: boolean | null } };
      if (m.type !== "obs_event" || m.eventType !== "obs_stream_state") return;
      pushSeq++;
      const streaming = m.data?.streaming;
      set(typeof streaming === "boolean" ? streaming : null);
    });
    void refreshStreamState(obsEnabled());
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && unsubMessage) {
      unsubMessage();
      unsubMessage = null;
      state = null;
    }
  };
}

/** Есть ли живая подписка (тогда состояние свежее и спрашивать фон не нужно). */
export function isStreamStateWatched(): boolean {
  return unsubMessage !== null;
}
