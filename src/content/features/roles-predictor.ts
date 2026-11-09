/**
 * Фича: панель вероятностей ролей на игровом столе.
 *
 * Что она делает честно и всегда: считает ТОЧНУЮ условную вероятность
 * «место чёрное» при известном составе стола (1 дон + 2 мафии + 1 шериф +
 * 6 мирных) и всей уже раскрытой информации — своей роли и ролей игроков,
 * открывшихся по ходу игры. Это не догадка, а прямое следствие того, что
 * чёрных на столе ровно три: если один чёрный уже открыт, у остальных
 * вероятность падает, и панель это пересчитывает.
 *
 * Что она делает осторожно: добавляет позиционные поправки (веса мест, равные
 * для всех игроков) из встроенного артефакта src/shared/roles-model.json — но
 * ТОЛЬКО если проверка на отложенных данных показала, что они реально
 * улучшают предсказание. Иначе веса нулевые, и панель показывает чистые
 * базовые доли, прямо об этом сообщая.
 *
 * Личной истории игроков панель НЕ использует и сеть не трогает вовсе —
 * работает только по DOM (решение мейнтейнера 09.11.2026, см. roles-model).
 */
import { onDomChange, onDomChangeImmediate } from "@core/dom";
import { escapeHtml } from "@core/escape";
import { log } from "@core/log";
import { FloatingPanel } from "@core/FloatingPanel";
import { SITE, SITE_CLASS, OWN } from "@core/selectors";
import { FAKE_SHIELD_ATTR } from "../role-fake-orphans";
import { getRoleVisibilityTargets, isNativeRoleHidden, pinHolds } from "../role-pin";
import { isPeeking } from "./auto-start";
import {
  NEUTRAL_MODEL,
  predictBlack,
  type RolesModel,
} from "@core/roles-model";
import type { Feature, FeatureContext } from "@core/feature";
import modelArtifact from "@shared/roles-model.json";

const SCOPE = "roles-predictor";

/** Состав стандартного стола: сколько кого раздаётся на 10 мест. */
const TABLE = { seats: 10, blacks: 3, don: 1, mafia: 2, sheriff: 1, civilian: 6 };

type RoleId = "civilian" | "sheriff" | "mafia" | "godfather";
const BLACK_ROLES: RoleId[] = ["mafia", "godfather"];

interface SeatInfo {
  seat: number;
  name: string;
  isMe: boolean;
  /** Роль, если она РАСКРЫТА в интерфейсе (своя, напарники по мафии, вскрытые). */
  knownRole: RoleId | null;
}

interface Assessment {
  seats: SeatInfo[];
  /** P(место чёрное) — нужна красному игроку. */
  pBlack: Map<number, number>;
  /** P(место — шериф) — нужна чёрному: своих он и так знает. */
  pSheriff: Map<number, number>;
  unknownBlacks: number;
  unknownSheriffs: number;
  myRole: RoleId | null;
  /**
   * Что показывать основным числом. Чёрному бессмысленно считать чёрных —
   * он знает всю свою тройку; ему нужен шериф. Красному наоборот.
   */
  focus: "black" | "sheriff";
  baseline: number;
  note: string | null;
}

let model: RolesModel = NEUTRAL_MODEL;
let panel: PredictorPanel | null = null;
let offDom: (() => void) | null = null;
let offPrivacy: (() => void) | null = null;
let lastOwnRole = "";
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let lastSignature = "";

// ───────────────────────────── чтение стола из DOM ─────────────────────────────

function asRoleId(id: string | null | undefined): RoleId | null {
  return id === "civilian" || id === "sheriff" || id === "mafia" || id === "godfather"
    ? id
    : null;
}

/** Читает только отображаемый SVG; служебные оригиналы подмены не читаются. */
function roleFromElement(el: Element | null): RoleId | null {
  if (!el) return null;
  const use = el.querySelector("use[href], use[xlink\\:href]");
  const href = use?.getAttribute("href") || use?.getAttribute("xlink:href");
  return href ? asRoleId(href.split("#")[1]) : null;
}

/**
 * Роль считается раскрытой, только если её иконка реально видна.
 * Сайт держит в разметке скрытые узлы ролей — читать их было бы подглядыванием
 * за чужую карту, а не выводом из открытой информации.
 */
function isVisibleRole(el: Element): boolean {
  // A visible role box can contain an invisible icon, or sit under an
  // opacity:0 ancestor. Its own computed style and rectangle are insufficient.
  const icon = el.querySelector(SITE.roleUse) || el;
  for (let node: Element | null = icon; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (node.hasAttribute("hidden") || style.display === "none" ||
        style.visibility === "hidden" || style.visibility === "collapse" ||
        Number.parseFloat(style.opacity) === 0) return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// role-pin.ts keeps this root shield while a hidden pin survives Vue updates.
const PIN_PRIVACY_ATTR = "data-pn-own-role-hidden";
const PRIVACY_NOTICE = "Панель скрыта: защита ролей или обновление данных стола.";

function privacyActive(): boolean {
  const root = document.documentElement;
  if (root.hasAttribute(FAKE_SHIELD_ATTR) || root.hasAttribute(PIN_PRIVACY_ATTR) ||
      document.getElementById(OWN.roleHideStyle) || isPeeking() || pinHolds("hidden")) return true;
  return getRoleVisibilityTargets().some(el => el.hasAttribute("data-original-role") ||
    isNativeRoleHidden(el) || !isVisibleRole(el));
}

function ownRoleSignature(): string {
  return getRoleVisibilityTargets().map(el => roleFromElement(el) || "unknown").join("|");
}

function protectPrivacy(): void {
  if (!panel) return;
  // Hide before the next paint; calculations retain their ordinary debounce.
  if (privacyActive() || ownRoleSignature() !== lastOwnRole) {
    lastSignature = "";
    panel.setPrivate(true);
  }
}

function readTable(): SeatInfo[] {
  const nodes = Array.from(document.querySelectorAll(SITE.player));
  const seats: SeatInfo[] = [];
  const seen = new Set<number>();

  for (const node of nodes) {
    const name = node.querySelector(SITE.playerName)?.textContent?.trim() || "";
    const numText = node.querySelector(SITE.playerNumber)?.textContent?.trim() || "";
    const seat = Number.parseInt(numText, 10);
    if (!Number.isFinite(seat) || seat < 1 || seat > TABLE.seats) continue;
    if (seen.has(seat)) continue;
    seen.add(seat);

    // «Своё» место определяем теми же селекторами, что и auto-start
    // (SITE.ownRoleTargets) — они уже отлажены на живом сайте и покрывают все
    // варианты разметки; свой отдельный набор быстро разошёлся бы с ними.
    const ownRoleEl = SITE.ownRoleTargets.reduce<Element | null>(
      (found, sel) => found || node.querySelector(sel),
      null,
    );
    const isMe = !!ownRoleEl || node.classList.contains(SITE_CLASS.myPlayer);

    const roleEl = ownRoleEl || node.querySelector(SITE.anyRole);
    const knownRole = roleEl && isVisibleRole(roleEl) ? roleFromElement(roleEl) : null;

    seats.push({ seat, name, isMe, knownRole });
  }
  return seats.sort((a, b) => a.seat - b.seat);
}

// ───────────────────────────── расчёт ─────────────────────────────

/**
 * Раскладывает k скрытых носителей роли по n неизвестным местам.
 * useModel=false → равномерно (k/n на каждое место), что при неизвестных
 * весах и есть точный ответ.
 */
function spread(
  unknown: SeatInfo[],
  k: number,
  useModel: boolean,
  into: Map<number, number>,
): void {
  if (unknown.length === 0) return;
  if (k <= 0) {
    for (const s of unknown) into.set(s.seat, 0);
    return;
  }
  if (k >= unknown.length) {
    for (const s of unknown) into.set(s.seat, 1);
    return;
  }
  const inputs = unknown.map((s) => ({ seat: s.seat }));
  const p = useModel
    ? predictBlack(model, inputs, k)
    : predictBlack(NEUTRAL_MODEL, inputs, k);
  unknown.forEach((s, i) => into.set(s.seat, p[i]));
}

function assess(seats: SeatInfo[]): Assessment | null {
  if (seats.length < 4) return null;

  const me = seats.find((s) => s.isMe) || null;
  const myRole = me?.knownRole ?? null;
  const iAmBlack = myRole !== null && BLACK_ROLES.includes(myRole);

  const known = seats.filter((s) => s.knownRole !== null);
  const knownBlacks = known.filter((s) => BLACK_ROLES.includes(s.knownRole as RoleId)).length;
  const knownSheriffs = known.filter((s) => s.knownRole === "sheriff").length;
  const unknown = seats.filter((s) => s.knownRole === null);
  const unknownBlacks = TABLE.blacks - knownBlacks;
  const unknownSheriffs = TABLE.sheriff - knownSheriffs;

  const pBlack = new Map<number, number>();
  const pSheriff = new Map<number, number>();

  spread(unknown, unknownBlacks, true, pBlack);
  // Для шерифа веса модели НЕ применяются: они обучены на «чёрности» места,
  // а проверка расположения шерифа отдельно показала равномерность. Брать
  // чужие веса значило бы переносить эффект, которого в этих данных нет.
  spread(unknown, unknownSheriffs, false, pSheriff);

  const focus: "black" | "sheriff" = iAmBlack ? "sheriff" : "black";
  const k = focus === "sheriff" ? unknownSheriffs : unknownBlacks;

  let note: string | null = null;
  if (unknown.length === 0) {
    note = "все роли на столе раскрыты";
  } else if (focus === "sheriff" && unknownSheriffs <= 0) {
    note = "шериф уже известен";
  } else if (focus === "black" && unknownBlacks <= 0) {
    note = "все чёрные раскрыты — остальные места красные";
  } else if (iAmBlack) {
    note = `свою команду знаю, ищу шерифа среди ${unknown.length} мест`;
  }

  return {
    seats,
    pBlack,
    pSheriff,
    unknownBlacks,
    unknownSheriffs,
    myRole,
    focus,
    baseline: unknown.length > 0 ? Math.max(0, k) / unknown.length : 0,
    note,
  };
}

// ───────────────────────────── панель ─────────────────────────────

const ROLE_LABEL: Record<RoleId, string> = {
  civilian: "Мирный",
  sheriff: "Шериф",
  mafia: "Мафия",
  godfather: "Дон",
};

/**
 * Заливка шкалы вероятности: ОДИН тон, меняется только насыщенность и яркость.
 *
 * Радужная шкала (красный→жёлтый→зелёный→синий) здесь была бы вредна: на
 * средних значениях она даёт зелёный, а зелёный читается как «безопасно», хотя
 * 33% — это ровно базовая неопределённость. Тон взят синий — тот же, которым
 * помечены уже вскрытые чёрные, так что шкала читается как «насколько это
 * место похоже на чёрную команду». Красный и жёлтый не используются: они на
 * сайте закреплены за мирным и шерифом, и путать их со шкалой нельзя.
 */
function heat(p: number): string {
  const t = Math.max(0, Math.min(1, p));
  const sat = 10 + 60 * t;
  const light = 26 + 22 * t;
  return `hsl(210, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
}

class PredictorPanel extends FloatingPanel {
  private content: HTMLElement | null = null;
  private privacyNotice: HTMLElement | null = null;
  private privateMode = true;

  constructor() {
    super({
      storageKey: "pn_roles_predictor_panel",
      title: "Аналитика раздачи",
      width: 300,
      height: 420,
      minWidth: 240,
      minHeight: 200,
      className: "pn-roles-predictor",
    });
  }

  protected renderBody(body: HTMLElement): void {
    body.style.cssText =
      "padding:8px; overflow:auto; font:12px system-ui,sans-serif; color:#e6e9f0;";
    const style = document.createElement("style");
    // The faker root flag is not in the shared observer's attribute filter.
    // CSS closes the old rendered frame synchronously, including orphan flags.
    const shields = [`html[${FAKE_SHIELD_ATTR}]`, `html[${PIN_PRIVACY_ATTR}]`];
    style.textContent = shields.map(sel => `${sel} .pn-roles-predictor .pn-predictor-sensitive { display:none !important; }
${sel} .pn-roles-predictor .pn-predictor-private { display:block !important; }`).join("\n");
    this.privacyNotice = document.createElement("div");
    this.privacyNotice.className = "pn-predictor-private";
    this.privacyNotice.textContent = PRIVACY_NOTICE;
    this.content = document.createElement("div");
    this.content.className = "pn-predictor-sensitive";
    this.content.hidden = true;
    body.append(style, this.privacyNotice, this.content);
    // Убрать панель с экрана, не выключая фичу: в напряжённый момент игры лезть
    // в настройки расширения некогда, а место на столе она занимает.
    this.addHeaderButton("✕", () => this.hide(), "Скрыть панель до перезагрузки страницы");
  }

  setPrivate(blocked: boolean): void {
    this.privateMode = blocked;
    if (this.content) {
      if (this.content.hidden !== blocked) this.content.hidden = blocked;
      if (blocked && this.content.childNodes.length) this.content.replaceChildren();
    }
    if (this.privacyNotice && this.privacyNotice.hidden !== !blocked) this.privacyNotice.hidden = !blocked;
  }

  update(a: Assessment | null): void {
    if (!this.content || this.privateMode) return;
    if (!a) {
      this.content.innerHTML = `<div style="opacity:.7">Стол не найден на странице.</div>`;
      return;
    }

    const primary = a.focus === "sheriff" ? a.pSheriff : a.pBlack;
    const rows = a.seats
      .map((s) => {
        const p = primary.get(s.seat);
        const label = s.knownRole
          ? `<span style="opacity:.85">${ROLE_LABEL[s.knownRole]}</span>`
          : `${((p ?? 0) * 100).toFixed(0)}%`;
        const bg = s.knownRole
          ? BLACK_ROLES.includes(s.knownRole)
            ? "hsl(210,45%,50%)"
            : "hsl(0,45%,32%)"
          : heat(p ?? 0);
        const width = s.knownRole ? 100 : Math.round((p ?? 0) * 100);
        const meMark = s.isMe ? " ★" : "";
        return `
          <div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
            <div style="width:16px;text-align:right;opacity:.6">${s.seat}</div>
            <div style="flex:1;min-width:0;position:relative;background:rgba(255,255,255,.05);
                        border-radius:4px;overflow:hidden;height:20px;">
              <div style="position:absolute;inset:0 auto 0 0;width:${width}%;
                          background:${bg};opacity:${s.knownRole ? 0.55 : 0.75};"></div>
              <div style="position:relative;padding:2px 6px;white-space:nowrap;
                          overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(s.name || "—")}${meMark}
              </div>
            </div>
            <div style="width:44px;text-align:right;font-variant-numeric:tabular-nums;">
              ${label}
            </div>
          </div>`;
      })
      .join("");

    const v = model.validation;
    const modelLine = v.go
      ? `модель бьёт базу: AUC ${v.auc_model.toFixed(3)} против ${v.auc_baseline.toFixed(3)}`
      : `сигнала в данных не найдено — показаны базовые доли`;

    const findings = model.findings.length
      ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.1);">
           ${model.findings
             .map(
               (f) =>
                 `<div style="margin:3px 0;"><span style="opacity:.6">${escapeHtml(
                   f.title,
                 )}:</span> ${escapeHtml(f.verdict)}</div>`,
             )
             .join("")}
         </div>`
      : "";

    const roleLine = a.myRole
      ? `Моя роль: <b>${ROLE_LABEL[a.myRole]}</b>`
      : `Моя роль не определена`;
    const target =
      a.focus === "sheriff"
        ? `Ищем <b>шерифа</b>: осталось ${Math.max(0, a.unknownSheriffs)}`
        : `Ищем <b>чёрных</b>: осталось ${Math.max(0, a.unknownBlacks)}`;

    this.content.innerHTML = `
      <div style="margin-bottom:6px;">
        <div>${roleLine}</div>
        <div style="opacity:.7">${target} · база ${(a.baseline * 100).toFixed(0)}%</div>
        ${a.note ? `<div style="opacity:.7;margin-top:2px;">${escapeHtml(a.note)}</div>` : ""}
      </div>
      ${rows}
      <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.1);
                  opacity:.65;line-height:1.4;">
        <div>${escapeHtml(modelLine)}</div>
        ${
          model.n_matches
            ? `<div>выборка: ${model.n_matches} матчей, ${escapeHtml(
                model.period[0]?.slice(0, 10) || "",
              )} – ${escapeHtml(model.period[1]?.slice(0, 10) || "")}</div>`
            : ""
        }
      </div>
      ${findings}
      <div style="margin-top:6px;opacity:.5;line-height:1.35;">
        Это вероятности, а не роли. Числа следуют из состава стола и раскрытой
        информации — они не «вычисляют» чужую карту.
      </div>`;
  }
}

// ───────────────────────────── жизненный цикл ─────────────────────────────

function refresh(): void {
  if (privacyActive()) {
    lastSignature = "";
    panel?.setPrivate(true);
    return;
  }
  const seats = readTable();
  lastOwnRole = ownRoleSignature();
  panel?.setPrivate(false);
  // Пересчитываем только при реальном изменении стола: общий observer срабатывает
  // на каждый тик таймера сайта, а перерисовка панели на каждый кадр — это лаг.
  const signature = seats.map((s) => `${s.seat}:${s.name}:${s.knownRole}:${s.isMe}`).join("|");
  if (signature === lastSignature) return;
  lastSignature = signature;
  panel?.update(assess(seats));
}

/**
 * Артефакт вшивается в бандл на этапе сборки (resolveJsonModule + esbuild),
 * а не грузится fetch'ем: не нужен web_accessible_resources, нет сетевого
 * запроса и нет расхождений с CSP расширения.
 * Файл артефакта: src/shared/roles-model.json; в runtime он не обновляется.
 */
function pair(v: unknown): [string, string] {
  return Array.isArray(v) && v.length >= 2 ? [String(v[0]), String(v[1])] : ["", ""];
}

function loadModel(): void {
  // Разбираем артефакт по полям, а не кастуем целиком: JSON собирается внешним
  // скриптом, и молча принять его «на слово» значило бы сломать панель при
  // любом расхождении формата.
  const raw = modelArtifact as Record<string, any>;
  const w = raw?.seat_log_w;
  const v = raw?.validation;
  if (!Array.isArray(w) || w.length !== NEUTRAL_MODEL.seat_log_w.length || !v) {
    log.warn(SCOPE, "artifact malformed, falling back to base rates");
    model = NEUTRAL_MODEL;
    return;
  }
  model = {
    generated_at: String(raw.generated_at ?? ""),
    n_matches: Number(raw.n_matches ?? 0),
    period: pair(raw.period),
    seat_log_w: w.map((x: unknown) => Number(x) || 0),
    global_p: Number(raw.global_p ?? 0.3),
    validation: {
      go: v.go === true,
      auc_model: Number(v.auc_model ?? 0.5),
      auc_baseline: Number(v.auc_baseline ?? 0.5),
      logloss_model: Number(v.logloss_model ?? 0),
      logloss_baseline: Number(v.logloss_baseline ?? 0),
      n_test_predictions: Number(v.n_test_predictions ?? 0),
      test_period: pair(v.test_period),
    },
    findings: Array.isArray(raw.findings)
      ? raw.findings.map((f: any) => ({
          title: String(f?.title ?? ""),
          verdict: String(f?.verdict ?? ""),
        }))
      : [],
  };
  log.info(
    SCOPE,
    "model",
    model.n_matches,
    "matches, go =",
    model.validation.go,
    model.validation.go ? "(seat weights)" : "(base rates only)",
  );
}

/**
 * Что фича видит на странице прямо сейчас — для проверки в живой игре
 * (`polemicaPredictor()` в консоли). Разметку игрового стола нельзя проверить
 * снаружи игры, поэтому единственный честный способ убедиться, что селекторы
 * живы, — посмотреть разбор на реальном столе.
 */
export function predictorDiag(): unknown {
  if (privacyActive()) return {
    privacyBlocked: true, seatsFound: 0, myRole: null, focus: null,
    unknownBlacks: null, unknownSheriffs: null, table: [],
  };
  const seats = readTable();
  const a = assess(seats);
  return {
    model: {
      matches: model.n_matches,
      go: model.validation.go,
    },
    seatsFound: seats.length,
    myRole: a?.myRole ?? null,
    focus: a?.focus ?? null,
    unknownBlacks: a?.unknownBlacks ?? null,
    unknownSheriffs: a?.unknownSheriffs ?? null,
    table: seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      isMe: s.isMe,
      knownRole: s.knownRole,
      pBlack: a?.pBlack.get(s.seat) ?? null,
      pSheriff: a?.pSheriff.get(s.seat) ?? null,
    })),
  };
}

export const rolesPredictorFeature: Feature = {
  id: SCOPE,
  settingKey: "roles_predictor_enabled",
  async enable(_ctx: FeatureContext) {
    loadModel();
    panel = new PredictorPanel();
    panel.mount();
    lastSignature = "";
    refresh();
    offPrivacy = onDomChangeImmediate(protectPrivacy);
    offDom = onDomChange(() => {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        refresh();
      }, 300);
    });
    log.info(SCOPE, "enabled");
  },
  disable() {
    offDom?.();
    offDom = null;
    offPrivacy?.();
    offPrivacy = null;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    panel?.unmount();
    panel = null;
    lastSignature = "";
    lastOwnRole = "";
    log.info(SCOPE, "disabled");
  },
};
