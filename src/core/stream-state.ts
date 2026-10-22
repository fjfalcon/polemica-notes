/**
 * Идёт ли трансляция в OBS — для content-скрипта (22.10.2026, «осуждёнка»).
 *
 * Правду знает фон (его OBS-клиент слушает StreamStateChanged): он рассылает
 * событие `obs_stream_state` всем вкладкам сайта и отдаёт текущее значение в
 * `get_status`. Здесь — общее на вкладку состояние и подписка. Без
 * интеграции OBS эфира не видно: считаем, что его нет (об этом сказано в
 * подсказке попапа).
 */
import { onMessage, sendRuntime } from "./messaging";

let streaming = false;
let unsubMessage: (() => void) | null = null;
const subscribers = new Set<() => void>();

function set(value: boolean): void {
  if (value === streaming) return;
  streaming = value;
  subscribers.forEach((cb) => cb());
}

/** Идёт ли эфир (по последнему, что сказал фон). */
export function isStreaming(): boolean {
  return streaming;
}

/** Спросить фон заново. obsEnabled=false — интеграции нет, эфира не видно. */
export async function refreshStreamState(obsEnabled: boolean): Promise<boolean> {
  if (!obsEnabled) {
    set(false);
    return false;
  }
  try {
    const res = await sendRuntime<{ streaming?: boolean | null }>({ type: "obs_command", command: "get_status" });
    set(res?.streaming === true);
  } catch {
    /* фон недоступен — остаёмся при последнем известном */
  }
  return streaming;
}

/**
 * Подписка на смену «идёт эфир». Первая подписка слушает рассылку фона и
 * спрашивает текущее значение; последняя отписка снимает слушатель.
 */
export function watchStreamState(cb: () => void, obsEnabled: () => boolean): () => void {
  subscribers.add(cb);
  if (!unsubMessage) {
    unsubMessage = onMessage((msg) => {
      const m = msg as { type?: string; eventType?: string; data?: { streaming?: boolean | null } };
      if (m.type === "obs_event" && m.eventType === "obs_stream_state") set(m.data?.streaming === true);
    });
    void refreshStreamState(obsEnabled());
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && unsubMessage) {
      unsubMessage();
      unsubMessage = null;
      streaming = false;
    }
  };
}
