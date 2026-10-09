/**
 * Подписка content-фич на подключение OBS: фон рассылает obs_event
 * (obs_connected) на каждом Identified, в том числе после реконнекта.
 */
import { onMessage } from "./messaging";
import type { ExtMessage } from "@shared/types";

export function onObsConnected(handler: () => void): () => void {
  return onMessage((msg: ExtMessage) => {
    const m = msg as { type?: unknown; eventType?: unknown } | null;
    if (m?.type === "obs_event" && m.eventType === "obs_connected") handler();
  });
}
