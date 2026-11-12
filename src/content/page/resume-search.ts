/** Bounded recovery of the site's ordinary search client after the direct-search handoff.
 * Authentication and search messages remain in the site's own methods. This coordinator
 * only authorizes their invocation, watches the real outcomes and owns its listeners.
 */
export interface ResumeSocket {
  connected?: boolean;
  on(event: string, handler: (value: unknown) => void): unknown;
  removeListener(event: string, handler: (value: unknown) => void): unknown;
}

export interface ResumeClient {
  socket?: ResumeSocket | null;
  isSearching?: boolean;
  isIniSearch?: boolean;
  isFoundGame?: boolean;
  userInGame?: boolean;
  /** Сайт (12.11.2026): сессия сокета принята хотя бы раз на этой загрузке. */
  sessionAccepted?: boolean;
  startSearch(): void;
  disconnectSocket(): void;
}

export type ResumeResult =
  | { state: "restored"; timeInSearch: number }
  | { state: "new" | "already-searching" | "deferred" | "game" | "timeout" }
  | { state: "refused"; reason: "server" | "connection" | "contract" | "authorization" };

export interface ResumeOptions {
  authorize(): boolean | Promise<boolean>;
  result(result: ResumeResult): void;
  /** Total budget, including authorization, socket creation and a possible retry. */
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Only a previous successful queue ACK makes in_game evidence of a new assignment.
   * Cold/refused starts can still refer to the old disbanded room. */
  confirmedQueue?: boolean;
}

type Handler = (value: unknown) => void;

/**
 * Флаг сайта (сборка 12.11.2026): сокет поиска оборвался до
 * session_initialized — его notifyServerIsDown один раз перезагружает
 * страницу, отметив это в sessionStorage. Наш обработчик стоит после
 * сайтового, так что «1» здесь значит: перезагрузка уже запущена.
 */
export const SITE_RELOAD_FLAG = "polemica-client-reload";
function siteReloading(client: ResumeClient): boolean {
  if (client.sessionAccepted === true) return false;
  try { return sessionStorage.getItem(SITE_RELOAD_FLAG) === "1"; } catch { return false; }
}

/** One start, at most one transport reconnect, one terminal result. */
export class ResumeSearch {
  private phase: "idle" | "waiting" | "finished" | "cancelled" = "idle";
  private generation = 0;
  private retried = false;
  private socket: ResumeSocket | null = null;
  private handlers: Array<[string, Handler]> = [];
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly client: ResumeClient, private readonly options: ResumeOptions) {}

  start(): void {
    if (this.phase !== "idle") return;
    this.phase = "waiting";
    this.deadlineTimer = setTimeout(
      () => this.finish({ state: "timeout" }),
      this.options.timeoutMs ?? 10_000,
    );
    void this.beginAttempt(false);
  }

  /** Stop our work; do not disconnect a search the page or user may already own. */
  cancel(): void {
    if (this.phase === "cancelled" || this.phase === "finished") return;
    this.phase = "cancelled";
    this.generation++;
    this.cleanup();
  }

  private current(generation: number): boolean {
    return this.phase === "waiting" && generation === this.generation;
  }

  private async beginAttempt(reconnect: boolean): Promise<void> {
    const generation = ++this.generation;
    let allowed: boolean;
    try {
      allowed = await this.options.authorize();
    } catch {
      if (this.current(generation)) this.finish({ state: "refused", reason: "authorization" });
      return;
    }
    if (!this.current(generation)) return;
    if (!allowed) {
      this.finish({ state: "deferred" });
      return;
    }
    try {
      if (this.client.isSearching || this.client.isFoundGame) {
        this.finish({ state: this.client.isFoundGame ? "game" : "already-searching" });
        return;
      }

      // startSearch does not resend anything on a connected idle socket. Reconnect it
      // once to obtain a fresh session_initialized from the service, using the site's
      // own disconnect/start methods and without emitting start_game_search ourselves.
      const idleConnected = this.client.socket?.connected && !this.client.isIniSearch;
      if (reconnect || idleConnected) {
        if (idleConnected) this.retried = true;
        this.detachSocket();
        this.client.disconnectSocket();
      }
      if (!this.current(generation)) return;
      if (!this.client.isIniSearch) this.client.startSearch();
      this.observe(generation);
    } catch {
      if (this.current(generation)) this.finish({ state: "refused", reason: "contract" });
    }
  }

  private observe(generation: number): void {
    if (!this.current(generation)) return;
    try {
      const socket = this.client.socket ?? null;
      if (socket !== this.socket) this.attachSocket(socket, generation);
      if (!this.current(generation)) return;
      if (this.client.isSearching || this.client.isFoundGame) {
        // A real event may have happened before we could attach. That is active search,
        // but there is no evidence that its time/priority belongs to the old episode.
        this.finish({ state: this.client.isFoundGame ? "game" : "already-searching" });
        return;
      }
      this.pollTimer = setTimeout(() => {
        this.pollTimer = null;
        this.observe(generation);
      }, 50);
    } catch {
      if (this.current(generation)) this.finish({ state: "refused", reason: "contract" });
    }
  }

  private attachSocket(socket: ResumeSocket | null, generation: number): void {
    this.detachSocket();
    this.socket = socket;
    if (!socket) return;
    const guarded = (handler: Handler): Handler => value => {
      if (this.current(generation) && this.socket === socket) handler(value);
    };
    const add = (event: string, handler: Handler): void => {
      const callback = guarded(handler);
      this.handlers.push([event, callback]);
      socket.on(event, callback);
    };
    add("session_initialized", value => {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, "timeInSearch")) return;
      const time = (value as { timeInSearch?: unknown }).timeInSearch;
      if (typeof time === "number" && Number.isFinite(time) && time >= 0) {
        this.finish({ state: "restored", timeInSearch: time });
      } else {
        this.finish({ state: "refused", reason: "contract" });
      }
    });
    add("on_start_game_search", value => {
      if (value && typeof value === "object" && (value as { success?: unknown }).success === true) {
        this.finish({ state: "new" });
      } else if (value && typeof value === "object" && (value as { illegalState?: unknown }).illegalState === "in_game") {
        this.finish(this.options.confirmedQueue === true
          ? { state: "game" }
          : { state: "refused", reason: "server" });
      } else {
        this.finish({ state: "refused", reason: "server" });
      }
    });
    add("disconnect", () => this.networkFailure());
    add("connect_error", () => this.networkFailure());
    add("connect_timeout", () => this.networkFailure());
    // An explicit refusal of the session is not a transient transport error.
    add("connection_refused", () => this.finish({ state: "refused", reason: "server" }));
  }

  private networkFailure(): void {
    if (this.phase !== "waiting" || this.retryTimer) return;
    // Сайт уже перезагружает страницу: повтор поверх уходящей страницы открыл
    // бы лишнее соединение и мог бы послать start_game_search, который тут же
    // оборвётся. Восстановит поиск сам сайт после загрузки (checkIfUserInSearch).
    if (this.retried || siteReloading(this.client)) {
      this.finish({ state: "refused", reason: "connection" });
      return;
    }
    this.retried = true;
    this.generation++;
    this.detachSocket();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.phase === "waiting") void this.beginAttempt(true);
    }, this.options.retryDelayMs ?? 250);
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      for (const [event, handler] of this.handlers) {
        try { socket.removeListener(event, handler); } catch { /* changed client; keep cleaning */ }
      }
    }
    this.handlers = [];
  }

  private cleanup(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.deadlineTimer = this.pollTimer = this.retryTimer = null;
    this.detachSocket();
  }

  private finish(result: ResumeResult): void {
    if (this.phase !== "waiting") return;
    this.phase = "finished";
    this.generation++;
    this.cleanup();
    this.options.result(result);
  }
}
