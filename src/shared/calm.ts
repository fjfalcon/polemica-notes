/**
 * Упражнения для успокоения — вкладка «Тильт» попапа (просьба владельца
 * 11.11.2026). Перенесены с его сайта fjtilt (src/main/frontend/src/lib/
 * breathing.ts, calmTools.ts, GroundingExercise.tsx) — ТОЛЬКО упражнения:
 * без дневников, КПТ, сети и сохранения данных.
 *
 * Чистая логика без DOM: тайминги дыхания и тексты шагов.
 */

export interface BreathPhase {
  label: string;
  seconds: number;
  /** Масштаб круга в начале и в конце фазы (0..1). */
  from: number;
  to: number;
}

export interface BreathPattern {
  id: string;
  title: string;
  subtitle: string;
  phases: BreathPhase[];
}

const IN = 1.0;
const OUT = 0.45;

export const BREATH_PATTERNS: Record<string, BreathPattern> = {
  "478": {
    id: "478",
    title: "Дыхание 4-7-8",
    subtitle: "Успокоиться",
    phases: [
      { label: "Вдох", seconds: 4, from: OUT, to: IN },
      { label: "Задержка", seconds: 7, from: IN, to: IN },
      { label: "Выдох", seconds: 8, from: IN, to: OUT },
    ],
  },
  box: {
    id: "box",
    title: "Квадратное дыхание",
    subtitle: "Сконцентрироваться",
    phases: [
      { label: "Вдох", seconds: 4, from: OUT, to: IN },
      { label: "Задержка", seconds: 4, from: IN, to: IN },
      { label: "Выдох", seconds: 4, from: IN, to: OUT },
      { label: "Пауза", seconds: 4, from: OUT, to: OUT },
    ],
  },
  "46": {
    id: "46",
    title: "Дыхание 4-6",
    subtitle: "Мягко удлинить выдох",
    phases: [
      { label: "Вдох", seconds: 4, from: OUT, to: IN },
      { label: "Выдох", seconds: 6, from: IN, to: OUT },
    ],
  },
  sigh: {
    id: "sigh",
    title: "Физиологический вздох",
    subtitle: "Быстро сбросить напряжение",
    phases: [
      { label: "Вдох", seconds: 3, from: OUT, to: 0.85 },
      { label: "Ещё немного вдоха", seconds: 1.5, from: 0.85, to: IN },
      { label: "Долгий выдох", seconds: 6, from: IN, to: OUT },
    ],
  },
};

export const BREATH_ORDER = ["478", "box", "46", "sigh"] as const;

export function cycleDuration(pattern: BreathPattern): number {
  return pattern.phases.reduce((sum, p) => sum + p.seconds, 0);
}

export interface BreathState {
  index: number;
  phase: BreathPhase;
  /** 0..1 прогресс внутри фазы. */
  phaseProgress: number;
  /** Масштаб круга 0..1. */
  scale: number;
  cycle: number;
  secondsLeft: number;
}

/** Состояние дыхания через elapsedSec секунд от старта. */
export function phaseAt(pattern: BreathPattern, elapsedSec: number): BreathState {
  const total = cycleDuration(pattern);
  const e = Math.max(0, elapsedSec);
  const cycle = Math.floor(e / total);
  let within = e - cycle * total;
  for (let i = 0; i < pattern.phases.length; i++) {
    const phase = pattern.phases[i];
    if (within < phase.seconds || i === pattern.phases.length - 1) {
      const phaseElapsed = Math.min(within, phase.seconds);
      const phaseProgress = phase.seconds === 0 ? 1 : phaseElapsed / phase.seconds;
      return {
        index: i,
        phase,
        phaseProgress,
        scale: phase.from + (phase.to - phase.from) * phaseProgress,
        cycle,
        secondsLeft: Math.max(0, Math.ceil(phase.seconds - phaseElapsed)),
      };
    }
    within -= phase.seconds;
  }
  const phase = pattern.phases[0];
  return { index: 0, phase, phaseProgress: 0, scale: phase.from, cycle, secondsLeft: phase.seconds };
}

export interface TimedStep {
  title: string;
  detail: string;
  seconds: number;
}

export const STOP_STEPS: TimedStep[] = [
  { title: "Stop — Остановись", detail: "Замри на пару секунд. Ничего не делай и не отвечай.", seconds: 5 },
  { title: "Take a breath — Вдохни", detail: "Один медленный глубокий вдох и долгий выдох.", seconds: 8 },
  { title: "Observe — Заметь", detail: "Что с телом, мыслями, эмоцией прямо сейчас? Без оценки.", seconds: 12 },
  { title: "Proceed — Продолжи", detail: "Выбери следующее действие осознанно, а не на автомате.", seconds: 6 },
];

export const BODY_SCAN_STEPS: TimedStep[] = [
  { title: "Лицо и челюсть", detail: "Заметь напряжение и мягко отпусти его.", seconds: 15 },
  { title: "Плечи и шея", detail: "Опусти плечи вниз, расслабь шею.", seconds: 15 },
  { title: "Руки и кисти", detail: "Разожми кулаки, расслабь предплечья.", seconds: 15 },
  { title: "Грудь и живот", detail: "Дай дыханию стать чуть глубже и свободнее.", seconds: 15 },
  { title: "Ноги и стопы", detail: "Почувствуй опору под стопами.", seconds: 15 },
];

export const GROUNDING_STEPS: ReadonlyArray<{ n: number; prompt: string }> = [
  { n: 5, prompt: "вещей, которые ты ВИДИШЬ вокруг" },
  { n: 4, prompt: "звука, которые ты СЛЫШИШЬ" },
  { n: 3, prompt: "вещи, которых можешь КОСНУТЬСЯ" },
  { n: 2, prompt: "запаха, которые чувствуешь" },
  { n: 1, prompt: "вкус, который ощущаешь" },
];

export type CalmTool =
  | { id: string; title: string; subtitle: string; kind: "breathing"; pattern: string }
  | { id: string; title: string; subtitle: string; kind: "grounding" }
  | { id: string; title: string; subtitle: string; kind: "steps"; steps: TimedStep[] };

export const CALM_TOOLS: CalmTool[] = [
  { id: "breath-478", title: "Дыхание 4-7-8", subtitle: "Успокоиться", kind: "breathing", pattern: "478" },
  { id: "breath-box", title: "Квадратное дыхание", subtitle: "Сконцентрироваться", kind: "breathing", pattern: "box" },
  { id: "breath-sigh", title: "Физиологический вздох", subtitle: "Быстро сбросить", kind: "breathing", pattern: "sigh" },
  { id: "grounding", title: "Заземление 5-4-3-2-1", subtitle: "Вернуться в момент", kind: "grounding" },
  { id: "stop", title: "Техника STOP", subtitle: "Пауза перед реакцией", kind: "steps", steps: STOP_STEPS },
  { id: "bodyscan", title: "Сканирование тела", subtitle: "Сбросить напряжение", kind: "steps", steps: BODY_SCAN_STEPS },
];
