/** Controlled Socket.IO protocol. Preparation authenticates a connection only;
 * the queue request is emitted exclusively by start() after room authorization.
 */
export interface SearchSocket {
  connected?: boolean;
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, handler: (value: any) => void): unknown;
  removeListener(event: string, handler: (value: any) => void): unknown;
  disconnect(): unknown;
}
export interface SearchRequest {
  gameMode: "league";
  role: "player";
  userId: number;
  authKey: string;
  censorship: string[];
}
export interface PreparedConfig { endpoint: string; request: SearchRequest }
export type SearchOutcome = "ready" | "sent" | "queued" | "refused" | "unavailable" | "existing-search" | "found";
export interface FoundGame { gameId: number; dynamicFilling: boolean | string | number }
/** Сколько живёт подготовленное, но не запущенное соединение. */
export const READY_TTL_MS = 120_000;
export class DirectSearch {
  private socket: SearchSocket | null = null;
  private phase: "idle" | "preparing" | "ready" | "sent" | "queued" | "found" | "closed" = "idle";
  private attempts = 0;
  private firstSentAt = 0;
  private lastSentAt = 0;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private statePoll: ReturnType<typeof setTimeout> | null = null;
  private game: FoundGame | null = null;
  private handlers: [string, (value: any) => void][] = [];

  constructor(private readonly config: PreparedConfig, private readonly create: (config: PreparedConfig) => SearchSocket,
    private readonly result: (state: SearchOutcome) => void) {}

  prepare(): boolean {
    if (this.phase !== "idle") return false;
    this.phase = "preparing";
    try {
      this.socket = this.create(this.config);
      this.listen("session_initialized", value => {
        if (this.phase !== "preparing") return;
        if (value && Object.hasOwn(value, "timeInSearch")) {
          // The server already holds a search. Never silently take it over in a standby.
          this.abort("existing-search");
          return;
        }
        this.clearTimers();
        this.phase = "ready";
        // Потолок жизни готового соединения: осиротевший или забытый
        // экземпляр не держит лишнее соединение аккаунта (ревью 09.11.2026).
        this.deadline = setTimeout(() => this.abort("unavailable"), READY_TTL_MS);
        this.result("ready");
      });
      for (const name of ["disconnect", "connect_error", "connect_timeout", "connection_refused"])
        this.listen(name, () => {
          if (this.phase === "preparing" || this.phase === "ready") this.abort("unavailable");
          else if (this.phase === "sent") this.abort("refused");
        });
      this.listen("on_start_game_search", value => this.onStart(value));
      this.listen("on_game_found", value => {
        if (this.phase !== "sent" && this.phase !== "queued") return;
        const id = typeof value?.gameId === "string" ? Number(value.gameId) : value?.gameId;
        if (!Number.isSafeInteger(id) || id <= 0) { this.abort("refused"); return; }
        this.game = { gameId: id, dynamicFilling: ((typeof value.dynamicFilling === "string" || typeof value.dynamicFilling === "number" || typeof value.dynamicFilling === "boolean") && value.dynamicFilling) || false };
        this.clearTimers(); this.clearStatePoll();
        this.phase = "found";
        this.result("found");
      });
      this.deadline = setTimeout(() => this.abort("unavailable"), 10_000);
      return true;
    } catch { this.abort("unavailable"); return false; }
  }

  ready(): boolean { return this.phase === "ready" && this.socket?.connected === true; }
  start(): boolean {
    if (!this.ready()) return false;
    this.clearTimers();
    this.phase = "sent";
    this.deadline = setTimeout(() => this.abort("refused"), 8000);
    this.send();
    this.scheduleStatePoll(4);
    return true;
  }
  requestTiming(): { firstSentAt: number; sentAt: number; attempt: number } {
    return { firstSentAt: this.firstSentAt, sentAt: this.lastSentAt, attempt: this.attempts };
  }
  foundGame(): FoundGame | null { return this.phase === "found" ? this.game : null; }
  private onStart(value: { success?: boolean; illegalState?: string } | null): void {
    if (this.phase !== "sent") return;
    if (value?.success === true) {
      this.clearTimers(); this.phase = "queued"; this.result("queued"); return;
    }
    if (value?.illegalState === "in_game" && this.attempts < 3) {
      if (!this.retry) this.retry = setTimeout(() => { this.retry = null; this.send(); }, 150 * this.attempts);
      return;
    }
    this.abort("refused");
  }
  private send(): void {
    if (this.phase !== "sent" || this.attempts >= 3) return;
    if (!this.socket?.connected) { this.abort("refused"); return; }
    this.attempts++;
    this.lastSentAt = Date.now();
    if (this.attempts === 1) this.firstSentAt = this.lastSentAt;
    try { this.socket.emit("start_game_search", this.config.request); if (this.phase === "sent") this.result("sent"); }
    catch { this.abort("refused"); }
  }
  /** Match the site's application-level membership check after an explicit start.
   * Socket.IO handles its transport heartbeat independently. No request runs while
   * authenticating the standby connection, and ACK keeps this poll alive until handoff.
   */
  private scheduleStatePoll(delay: number): void {
    if (this.statePoll || (this.phase !== "sent" && this.phase !== "queued")) return;
    this.statePoll = setTimeout(() => {
      this.statePoll = null;
      if (this.phase !== "sent" && this.phase !== "queued") return;
      if (!this.socket?.connected) {
        if (this.phase === "sent") this.abort("refused"); else this.dispose();
        return;
      }
      try { this.socket.emit("check_if_user_is_in_game", { userId: this.config.request.userId }); }
      catch {
        // A queued result is historical truth. A later read failure only ends this
        // connection; it must not manufacture another success or contradiction.
        if (this.phase === "sent") this.abort("refused"); else this.dispose();
        return;
      }
      this.scheduleStatePoll(7000);
    }, delay);
  }
  private clearStatePoll(): void {
    if (this.statePoll) clearTimeout(this.statePoll);
    this.statePoll = null;
  }
  private listen(name: string, handler: (value: any) => void): void {
    this.handlers.push([name, handler]); this.socket!.on(name, handler);
  }
  private clearTimers(): void {
    if (this.deadline) clearTimeout(this.deadline);
    if (this.retry) clearTimeout(this.retry);
    this.deadline = this.retry = null;
  }
  private abort(state: "refused" | "unavailable" | "existing-search"): void {
    if (this.phase === "closed") return;
    this.dispose(); this.result(state);
  }
  cancel(): void { this.dispose(); }
  /**
   * Отмена НАШИМ решением после отправленного запроса (вкладка ушла в фон,
   * ввод, матч пошёл, фичу выключили): поиск на сервере переживает разрыв
   * сокета, и без снятия он висел бы без интерфейса — собравшуюся группу
   * никто бы не принял (ревью 09.11.2026). Снимаем штатно, как сайт
   * (stop_game_search без аргументов). При передаче на страницу поиска
   * (pagehide) зовётся dispose, а не stop: там поиск должен выжить.
   */
  stop(): void {
    if ((this.phase === "sent" || this.phase === "queued") && this.socket?.connected) {
      try { this.socket.emit("stop_game_search"); } catch { /* закрывается всё равно */ }
    }
    this.dispose();
  }
  dispose(): void {
    this.phase = "closed"; this.clearTimers(); this.clearStatePoll();
    for (const [name, handler] of this.handlers) this.socket?.removeListener(name, handler);
    this.handlers = [];
    try { this.socket?.disconnect(); } catch { /* already closed */ }
    this.socket = null;
  }
}
