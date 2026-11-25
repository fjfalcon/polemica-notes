/** Данные для трёх видов. Сайт задаёт номера туров, расширение не восстанавливает их по счёту. */
import { analyzeMafiaShots, type NightShooting } from "./mafia-shots";
import { isLiftBallot, resolveDayOutcome, type DayOutcome, type MatchVote } from "./match-outcome";

interface Stage {
  day?: number;
  night?: number;
  type?: string;
  player?: number;
}

interface Player {
  position: number;
  username?: string;
  player?: number | string;
  role?: number;
  fouls?: Array<{ stage?: Stage }>;
  penalties?: Array<{ stage?: Stage; type?: string; player?: number; initiator?: number; votes?: Record<string, boolean> }>;
  disqual?: Stage;
}

interface Shot {
  night: number;
  shooter: number;
  victim: number;
}

interface Check {
  night: number;
  role: number;
  player: number;
}

export interface MatchReviewInput {
  players?: Player[];
  votes?: MatchVote[];
  shots?: Shot[];
  checks?: Check[];
  stage?: Stage;
}

export interface MatchReviewSummaryPlayer {
  id?: number | string;
  username?: string;
  role_val?: number;
  points?: number | null;
  mmr_diff?: number | null;
}

export interface ReviewPlayer {
  position: number;
  username?: string;
  formerName?: string;
  id?: number;
  role?: number;
  points?: number;
  mmrDiff?: number;
}

export interface ReviewRound {
  num: number;
  votes: MatchVote[];
  candidates: { position: number; voters: (number | undefined)[] }[];
  leaders: number[];
}

export interface ReviewEvent {
  label: string;
  from?: number;
  to?: number;
  note?: string;
  ballot?: { yes: number[]; no: number[] };
}

export interface ReviewBestMove {
  day: number;
  night: boolean;
  player: number;
  description: string;
}

export interface ReviewDay {
  day: number;
  nomination?: ReviewRound;
  rounds: ReviewRound[];
  lift: MatchVote[];
  outcome: DayOutcome;
  removed: number[];
  shots?: NightShooting;
  checks: ReviewEvent[];
  dayEvents: ReviewEvent[];
  nightEvents: ReviewEvent[];
  finished: boolean;
}

export interface MatchReview {
  players: ReviewPlayer[];
  positions: number[];
  days: ReviewDay[];
}

const list = <T>(value?: T[]): T[] => Array.isArray(value) ? value : [];
const isPositiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

function playerId(value: number | string | undefined): number | undefined {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return isPositiveInt(id) ? id : undefined;
}

const score = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function reviewPlayers(players: Player[], summary: MatchReviewSummaryPlayer[]): ReviewPlayer[] {
  const byId = new Map<number, MatchReviewSummaryPlayer>();
  for (const row of summary) {
    const id = playerId(row?.id);
    if (id !== undefined) byId.set(id, row);
  }
  return players.map((p) => {
    const id = playerId(p.player);
    // История (data.players) хранит ник за столом, итог сайта (players) может
    // вернуть другой. Сводим по аккаунту, не по нику и не по индексу массива.
    const result = id !== undefined ? byId.get(id) : undefined;
    const username = typeof result?.username === "string" && result.username.trim()
      ? result.username : p.username;
    return {
      position: p.position, id,
      username,
      formerName: typeof p.username === "string" && p.username.trim() && p.username !== username ? p.username : undefined,
      role: p.role ?? result?.role_val,
      points: score(result?.points),
      mmrDiff: score(result?.mmr_diff),
    };
  });
}

function roundFrom(num: number, votes: MatchVote[]): ReviewRound {
  const byPosition = new Map<number, (number | undefined)[]>();
  for (const v of votes) {
    let voters = byPosition.get(v.candidate);
    if (!voters) byPosition.set(v.candidate, (voters = []));
    voters.push(isPositiveInt(v.voter) ? v.voter : undefined);
  }
  const candidates = [...byPosition].map(([position, voters]) => ({
    position, voters: voters.sort((a, b) => (a ?? Infinity) - (b ?? Infinity)),
  })).sort((a, b) => b.voters.length - a.voters.length || a.position - b.position);
  const leaders = candidates.filter((c) => c.voters.length === candidates[0]?.voters.length)
    .map((c) => c.position);
  return { num, votes, candidates, leaders };
}

function eventsFor(players: Player[], day: ReviewDay): void {
  const seenPenalties = new Set<string>();
  for (const p of players) {
    for (const foul of list(p.fouls)) {
      const stage = foul?.stage;
      if (!stage) continue;
      const atNight = stage.night === day.day;
      if (!atNight && stage.day !== day.day) continue;
      const note = isPositiveInt(stage.player)
        ? stage.type === "speech" ? `Речь №${stage.player}`
          : stage.type === "shooted" ? `После отстрела №${stage.player}` : undefined
        : undefined;
      (atNight ? day.nightEvents : day.dayEvents).push({ label: "Фол", to: p.position, note });
    }
    for (const pen of list(p.penalties)) {
      const stage = pen?.stage;
      if (!stage) continue;
      const atNight = stage.night === day.day;
      if (!atNight && stage.day !== day.day) continue;
      const label = pen.type === "tech" ? "Тех. фол" : pen.type === "disqual" ? "Дисквалификация"
        : pen.type === "stop" ? "ППК" : "Штрафное голосование";
      const ballot = { yes: [] as number[], no: [] as number[] };
      for (const [key, vote] of Object.entries(pen.votes ?? {})) {
        const voter = Number(key);
        if (isPositiveInt(voter) && typeof vote === "boolean") (vote ? ballot.yes : ballot.no).push(voter);
      }
      const from = isPositiveInt(pen.initiator) ? pen.initiator : undefined;
      const to = isPositiveInt(pen.player) ? pen.player : undefined;
      const key = JSON.stringify([atNight, label, from, to, ballot]);
      if (seenPenalties.has(key)) continue;
      seenPenalties.add(key);
      (atNight ? day.nightEvents : day.dayEvents).push({ label, from, to, ballot });
    }
    if (p.disqual?.day === day.day) {
      day.removed.push(p.position);
      day.dayEvents.push({ label: "Дисквалификация", to: p.position });
    } else if (p.disqual?.night === day.day) {
      day.nightEvents.push({ label: "Дисквалификация", to: p.position });
    }
  }
}

export function buildMatchReview(
  input: MatchReviewInput,
  moves: readonly ReviewBestMove[] = [],
  summary?: MatchReviewSummaryPlayer[],
): MatchReview {
  const players = list(input.players).filter((p) => isPositiveInt(p?.position))
    .sort((a, b) => a.position - b.position);
  const votes = list(input.votes).filter((v) => isPositiveInt(v?.day) &&
    (isLiftBallot(v) ? Number.isSafeInteger(v.candidate)
      : Number.isSafeInteger(v.num) && v.num! >= 0 && isPositiveInt(v.candidate)));
  const shots = list(input.shots).filter((s) => isPositiveInt(s?.night) &&
    isPositiveInt(s.shooter) && isPositiveInt(s.victim));
  const checks = list(input.checks).filter((c) => isPositiveInt(c?.night) && isPositiveInt(c.player));
  const shooting = analyzeMafiaShots({ players, votes, shots });
  const lastDay = input.stage?.day;
  const dayNumbers = new Set<number>();
  const addDay = (n: unknown) => { if (isPositiveInt(n)) dayNumbers.add(n); };
  addDay(lastDay);
  for (const vote of votes) addDay(vote.day);
  for (const shot of shots) addDay(shot.night);
  for (const check of checks) addDay(check.night);
  for (const move of moves) addDay(move.day);
  for (const p of players) {
    addDay(p.disqual?.day);
    addDay(p.disqual?.night);
    for (const event of [...list(p.fouls), ...list(p.penalties)]) {
      addDay(event?.stage?.day);
      addDay(event?.stage?.night);
    }
  }

  const days = [...dayNumbers].sort((a, b) => a - b).map((day) => {
    const rows = votes.filter((v) => v.day === day);
    const numbered = new Map<number, MatchVote[]>();
    const lift: MatchVote[] = [];
    for (const v of rows) {
      if (isLiftBallot(v)) { lift.push(v); continue; }
      const num = v.num!;
      let round = numbered.get(num);
      if (!round) numbered.set(num, (round = []));
      round.push(v);
    }
    const nomination = numbered.get(0);
    const result: ReviewDay = {
      day,
      nomination: nomination ? roundFrom(0, nomination) : undefined,
      rounds: [...numbered].filter(([num]) => num > 0).sort(([a], [b]) => a - b)
        .map(([num, ballot]) => roundFrom(num, ballot)),
      lift,
      outcome: resolveDayOutcome(rows, day),
      removed: [],
      shots: shooting.find((n) => n.night === day),
      checks: checks.filter((c) => c.night === day).map((c) => ({
        label: c.role === 0 ? "Проверка дона" : "Проверка шерифа",
        from: players.find((p) => p.role === (c.role === 0 ? 0 : 3))?.position,
        to: c.player,
      })),
      dayEvents: [],
      nightEvents: [],
      finished: input.stage?.type === "gameOver" && lastDay === day,
    };
    eventsFor(players, result);
    for (const move of moves) {
      if (move.day !== day) continue;
      (move.night ? result.nightEvents : result.dayEvents)
        .push({ label: "Лучший ход", to: move.player, note: move.description });
    }
    return result;
  });

  const positions = new Set(players.map((p) => p.position));
  for (const v of votes) {
    if (!isLiftBallot(v)) positions.add(v.candidate);
    if (isPositiveInt(v.voter)) positions.add(v.voter);
  }
  for (const s of shots) { positions.add(s.shooter); positions.add(s.victim); }
  for (const c of checks) positions.add(c.player);
  return { players: reviewPlayers(players, list(summary)), days, positions: [...positions].sort((a, b) => a - b) };
}
