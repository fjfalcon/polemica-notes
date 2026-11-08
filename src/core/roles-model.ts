/**
 * Ядро предиктора ролей: условное распределение Бернулли (нецентральное
 * многомерное гипергеометрическое Фишера) на ФИКСИРОВАННОЕ число чёрных.
 *
 * Ситуация в игре: я знаю свою роль и рассадку. Среди остальных мест ровно K
 * чёрных — это жёсткое ограничение состава стола, а не догадка. При 9 неизвестных
 * местах и 3 чёрных всего C(9,3)=84 расклада, поэтому перебираем их целиком и
 * получаем ТОЧНЫЕ вероятности — без Монте-Карло и без приближений.
 *
 * Веса мест берутся из артефакта research/out (см. src/static/roles-model.json).
 * Если исследование не нашло сигнала, все веса нулевые и модель честно
 * вырождается в базовые доли K/N — так и задумано: считать «преимущество» там,
 * где его нет, она не умеет.
 *
 * Зеркалит research/analysis/condbern.py — правки нужно вносить в оба файла.
 */

/** Перебор всех сочетаний k из n как битовых масок. */
function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const walk = (start: number): void => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      walk(i + 1);
      cur.pop();
    }
  };
  walk(0);
  return out;
}

/**
 * P(место i чёрное) при лог-весах мест и ровно k чёрных из n.
 * Softmax по суммам весов внутри расклада — стандартная conditional Bernoulli.
 */
export function seatMarginals(logW: number[], k: number): number[] {
  const n = logW.length;
  if (k <= 0) return new Array(n).fill(0);
  if (k >= n) return new Array(n).fill(1);

  const combos = subsets(n, k);
  const scores = combos.map((c) => c.reduce((s, i) => s + logW[i], 0));
  const max = Math.max(...scores);

  const marg = new Array(n).fill(0);
  let total = 0;
  for (let s = 0; s < combos.length; s++) {
    const w = Math.exp(scores[s] - max);
    total += w;
    for (const i of combos[s]) marg[i] += w;
  }
  return marg.map((v) => v / total);
}

// ───────────────────────────── артефакт модели ─────────────────────────────

export interface ModelValidation {
  /** Прошла ли модель проверку на отложенных данных. false = показываем базовые доли. */
  go: boolean;
  auc_model: number;
  auc_baseline: number;
  logloss_model: number;
  logloss_baseline: number;
  n_test_predictions: number;
  test_period: [string, string];
}

export interface RolesModel {
  generated_at: string;
  n_matches: number;
  period: [string, string];
  /** Лог-вес каждого из 10 мест (0 = места равноправны). */
  seat_log_w: number[];
  global_p: number;
  /**
   * Сила бета-приора для персонального сжатия (α+β). Infinity/null означает,
   * что персонального сигнала в данных нет и личная история не используется —
   * тогда расширение вообще не ходит за статистикой игроков.
   */
  personal_prior_strength: number | null;
  validation: ModelValidation;
  /** Краткие итоги проверок легенд — для честной шапки панели. */
  findings: { title: string; verdict: string }[];
}

/** Модель по умолчанию: никаких смещений, чистые базовые доли. */
export const NEUTRAL_MODEL: RolesModel = {
  generated_at: "",
  n_matches: 0,
  period: ["", ""],
  seat_log_w: new Array(10).fill(0),
  global_p: 0.3,
  personal_prior_strength: null,
  validation: {
    go: false,
    auc_model: 0.5,
    auc_baseline: 0.5,
    logloss_model: 0,
    logloss_baseline: 0,
    n_test_predictions: 0,
    test_period: ["", ""],
  },
  findings: [],
};

/** Использует ли модель личную историю игрока (иначе запросы не нужны). */
export function usesPersonalPrior(model: RolesModel): boolean {
  const s = model.personal_prior_strength;
  return model.validation.go && s !== null && Number.isFinite(s) && s > 0;
}

/**
 * Персональная поправка к лог-шансам по пожизненной статистике игрока,
 * сжатая эмпирико-байесовским приором. При слабой истории поправка → 0.
 */
export function personalLogOdds(
  model: RolesModel,
  blackGames: number,
  totalGames: number,
): number {
  const strength = model.personal_prior_strength;
  if (!usesPersonalPrior(model) || strength === null || totalGames <= 0) return 0;
  const p = model.global_p;
  const alpha = p * strength;
  const beta = (1 - p) * strength;
  const post = (blackGames + alpha) / (totalGames + alpha + beta);
  const clamped = Math.min(Math.max(post, 1e-6), 1 - 1e-6);
  return Math.log(clamped / (1 - clamped)) - Math.log(p / (1 - p));
}

export interface SeatInput {
  /** Номер места на столе, 1-based. */
  seat: number;
  /** Персональная поправка к лог-шансам (0, если истории нет/не используется). */
  personal?: number;
}

/**
 * Итоговые вероятности «место чёрное» для неизвестных мест.
 * kBlack — сколько чёрных среди них (жёсткое ограничение состава).
 */
export function predictBlack(
  model: RolesModel,
  seats: SeatInput[],
  kBlack: number,
): number[] {
  const logW = seats.map(
    (s) => (model.seat_log_w[s.seat - 1] ?? 0) + (s.personal ?? 0),
  );
  return seatMarginals(logW, kBlack);
}
