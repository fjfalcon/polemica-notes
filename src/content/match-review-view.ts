/** Интерактивный «Полный вид», отдельный от Vue-таблицы сайта. */
import { registerOwnContainer, unregisterOwnContainer } from "@core/dom";
import { escapeHtml } from "@core/escape";
import { voteRoundName, type MatchVote } from "./match-outcome";
import { shotIconTitle } from "./mafia-shots";
import { watchMatchReviewAliases } from "./features/player-notes/nick-alias";
import type { MatchReview, ReviewDay, ReviewEvent, ReviewPlayer, ReviewRound } from "./match-review-data";
import { MATCH_REVIEW_STYLES } from "./match-review-styles";

const VIEWS = [
  ["table", "Таблица"],
  ["timeline", "Ход игры"],
  ["journal", "Журнал"],
] as const;
type View = (typeof VIEWS)[number][0];
const TAB_VIEW_KEY = "pn_match_review_view";
const ROLE_NAMES = ["Дон", "Мафия", "Мирный", "Шериф"];
const pointsFormat = new Intl.NumberFormat("ru", { maximumFractionDigits: 2 });
const mmrFormat = new Intl.NumberFormat("ru", { signDisplay: "exceptZero" });
const byView = (value: string | null | undefined): value is View => VIEWS.some(([key]) => key === value);

export interface MatchReviewState {
  view: View;
  day?: number;
  player?: number;
  timelineDays?: Set<number>;
  allDaysPreference?: boolean;
}

export function createMatchReviewState(): MatchReviewState {
  try {
    const saved = sessionStorage.getItem(TAB_VIEW_KEY);
    if (byView(saved)) return { view: saved };
  } catch { /* Страница может запрещать Web Storage. */ }
  return { view: "timeline" };
}

export function createMatchReview(
  review: MatchReview,
  state: MatchReviewState,
  meta: { id: string; winner: string; mafiaWon: boolean; judge?: string; allDays: boolean; saveAllDays: (value: boolean) => void },
): { root: HTMLElement; dispose: () => void; setAllDays: (value: boolean) => void } {
  const players = new Map(review.players.map((p) => [p.position, p]));
  const nameOf = (pos: number) => {
    const name = players.get(pos)?.username;
    return typeof name === "string" ? name : "";
  };
  const roleOf = (pos?: number) => {
    const role = pos !== undefined ? players.get(pos)?.role : undefined;
    return role === 0 || role === 1 || role === 2 || role === 3 ? role : undefined;
  };
  const seat = (pos?: number): string => {
    if (!Number.isSafeInteger(pos)) return `<span class="pn-mr-seat" title="Номер не указан">?</span>`;
    const role = roleOf(pos);
    const tone = role !== undefined ? ` pn-mr-role-${role}` : "";
    return `<span class="pn-mr-seat${tone}" title="${escapeHtml(nameOf(pos!))}">№${pos}</span>`;
  };
  const person = (pos?: number) => {
    return `${seat(pos)}${pos !== undefined ? ` ${nameLabel(pos)}` : ""}`;
  };
  const voterChips = (voters: (number | undefined)[]) => voters.map(seat).join("");
  const seats = (list: number[]) => list.slice().sort((a, b) => a - b).map((n) => `№${n}`).join(", ");
  const hasPoints = review.players.some((p) => p.points !== undefined);
  const hasMmr = review.players.some((p) => p.mmrDiff !== undefined);

  function nameLabel(pos: number): string {
    const name = nameOf(pos);
    if (!name) return "";
    const p = players.get(pos);
    const id = p?.id;
    const attr = `class="pn-mr-name" data-pn-review-name="${id ?? ""}"${p?.formerName
      ? ` data-pn-review-former="${escapeHtml(p.formerName)}"` : ""}`;
    return id !== undefined
      ? `<a ${attr} href="/profile/${id}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`
      : `<span ${attr}>${escapeHtml(name)}</span>`;
  }

  function roleLabel(pos: number): string {
    const role = roleOf(pos);
    return role !== undefined ? `<small class="pn-mr-role-label pn-mr-role-${role}">${ROLE_NAMES[role]}</small>` : "";
  }

  function voterNumber(pos: number | undefined, nomination: boolean): string {
    if (pos === undefined || !Number.isSafeInteger(pos)) return "?";
    const role = roleOf(pos);
    const label = nomination ? `№${pos}` : String(pos);
    return role === undefined ? label
      : `<span class="pn-mr-role-${role}" title="№${pos} · ${ROLE_NAMES[role]}">${label}</span>`;
  }

  function formerNameLabel(pos: number): string {
    const name = players.get(pos)?.formerName;
    return name ? `<small class="pn-mr-former" title="В матче: ${escapeHtml(name)}">В матче: ${escapeHtml(name)}</small>` : "";
  }

  function score(value: number | undefined, format: Intl.NumberFormat): string {
    if (value === undefined) return '<span class="pn-mr-empty-cell">—</span>';
    const tone = value > 0 ? "pn-mr-plus" : value < 0 ? "pn-mr-minus" : "";
    return `<span class="pn-mr-number ${tone}">${format.format(value)}</span>`;
  }

  function rosterCard(p: ReviewPlayer): string {
    return `<li><div class="pn-mr-roster-player">${seat(p.position)} ${nameLabel(p.position)} ${roleLabel(p.position)}</div>
      ${formerNameLabel(p.position)}
      <div class="pn-mr-roster-scores">
        ${p.points !== undefined ? `<span>Баллы ${score(p.points, pointsFormat)}</span>` : ""}
        ${p.mmrDiff !== undefined ? `<span class="pn-mr-rating-inline">MMR ${score(p.mmrDiff, mmrFormat)}</span>` : ""}
      </div></li>`;
  }

  const root = document.createElement("section");
  root.className = "pn-match-review";
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = MATCH_REVIEW_STYLES;
  const panel = document.createElement("div");
  panel.className = "pn-mr-panel";
  root.setAttribute("aria-label", "Разбор матча");
  shadow.append(style, panel);
  let view = state.view;
  let wholeTable = meta.allDays && review.days.length > 1;
  if (state.allDaysPreference !== wholeTable) state.timelineDays = undefined;
  state.allDaysPreference = wholeTable;
  // Открываем самый насыщенный голосованиями день; при равенстве — первый.
  let day = review.days.find((d) => d.day === state.day) ??
    review.days.reduce<ReviewDay | undefined>((best, next) =>
      !best || next.rounds.length > best.rounds.length ? next : best, undefined);
  let player = state.player !== undefined && review.positions.includes(state.player) ? state.player : undefined;
  const nights = review.days.flatMap((d) => d.shots ? [d.shots] : []);
  const shooters = review.players.filter((p) => (p.role === 0 || p.role === 1) &&
    nights.some((n) => n.shots.some((s) => s.shooter === p.position)));
  panel.innerHTML = `
    <div class="pn-mr-head">
      <div><p class="pn-mr-kicker">Разбор игры</p><h2>Матч №${escapeHtml(meta.id)}</h2>
        ${meta.judge ? `<p class="pn-mr-judge">Судья: ${escapeHtml(meta.judge)}</p>` : ""}</div>
      ${meta.winner ? `<span class="pn-mr-winner${meta.mafiaWon ? " pn-mr-mafia-win" : ""}">${escapeHtml(meta.winner)}</span>` : ""}
    </div>
    <div class="pn-mr-nav">
      <div class="pn-mr-choices" role="group" aria-label="Вид разбора">
        ${VIEWS.map(([key, label]) => `<button type="button" data-pn-review-view="${key}">${label}</button>`).join("")}
      </div>
    </div>
    <div class="pn-mr-controls" hidden>
      <div class="pn-mr-choices" role="group" aria-label="День матча">
        ${review.days.map((d) => `<button type="button" data-pn-review-day="${d.day}">День ${d.day}</button>`).join("")}
        <button type="button" data-pn-review-all hidden>Открыть все дни</button>
      </div>
      <label class="pn-mr-filter" hidden>Игрок
        <select><option value="">Все игроки</option>
          ${review.positions.map((pos) => `<option value="${pos}">№${pos}${nameOf(pos) ? ` · ${escapeHtml(nameOf(pos))}` : ""}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="pn-mr-content"></div>
    ${review.players.length ? `<details class="pn-mr-roster"><summary>Состав и результаты</summary>
      <ul>${review.players.map(rosterCard).join("")}</ul></details>` : ""}
    ${shooters.length ? `<details class="pn-mr-shooting"><summary>Стрельба мафии за матч</summary>
      <div class="pn-mr-shooting-list">${shooters.map((p) =>
        `<section><h3>${person(p.position)}</h3><ul>${shotIconTitle(p.position, nights).split("\n").slice(1)
          .map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></section>`).join("")}</div></details>` : ""}`;
  const controls = panel.querySelector<HTMLElement>(".pn-mr-controls")!;
  const filter = panel.querySelector<HTMLElement>(".pn-mr-filter")!;
  const pane = panel.querySelector<HTMLElement>(".pn-mr-content")!;
  const roster = panel.querySelector<HTMLDetailsElement>(".pn-mr-roster");
  const playerInput = filter.querySelector("select")!;
  playerInput.value = player === undefined ? "" : String(player);
  const viewButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-pn-review-view]"));
  const dayButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-pn-review-day]"));
  const allButton = panel.querySelector<HTMLButtonElement>("[data-pn-review-all]")!;

  function result(d: ReviewDay): string {
    const { departed, tied, counts } = d.outcome;
    const score = counts.length > 1 && d.rounds.length ? ` · ${counts[0][1]}:${counts[1][1]}` : "";
    const notDisqualified = departed.filter((pos) => !d.removed.includes(pos));
    if (departed.length > 1 && notDisqualified.length) return `Подъём: ушли ${seats(notDisqualified)}`;
    if (notDisqualified.length === 1) return `Ушёл №${notDisqualified[0]}${score}`;
    // Один и тот же игрок в исходе по голосам и в записи о дисквалификации —
    // показываем счёт как результат тура, не как счёт дисквалификации.
    if (departed.length) return `Голосование${score}`;
    if (d.rounds.length && tied) return d.removed.length ? "Ничья в голосовании" : "Ничья · никто не ушёл";
    if (d.finished) return "Матч завершён";
    return d.rounds.length ? "Нет данных об исходе" : "Без голосования";
  }

  function roundCount(d: ReviewDay): string {
    const n = d.rounds.length;
    const ending = n % 100 >= 11 && n % 100 <= 14 ? "туров"
      : n % 10 === 1 ? "тур" : n % 10 >= 2 && n % 10 <= 4 ? "тура" : "туров";
    return n ? `${n} ${ending}` : "";
  }

  function voterCount(d: ReviewDay): string {
    const votes = d.rounds[0]?.votes ?? [];
    if (!votes.length || votes.some((v) => !Number.isSafeInteger(v.voter) || v.voter! < 1)) return "";
    const voters = new Set(votes.map((v) => v.voter)).size;
    return `${voters} ${voters === 1 ? "голосовавший" : "голосовавших"}`;
  }

  function lift(d: ReviewDay, who?: number): string {
    if (!d.lift.length || (who !== undefined && !d.lift.some((v) => v.voter === who))) return "";
    const yes = d.lift.filter((v) => v.candidate === 1);
    const no = d.lift.filter((v) => v.candidate !== 1);
    return `<section class="pn-mr-lift"><h3>Поднимаем всех?</h3>
      <div>За — ${yes.length} ${voterChips(yes.map((v) => v.voter))}</div>
      <div>Против — ${no.length} ${voterChips(no.map((v) => v.voter))}</div></section>`;
  }

  function eventList(title: string, rows: ReviewEvent[], who?: number): string {
    const events = who === undefined ? rows : rows.filter((e) =>
      e.from === who || e.to === who || e.ballot?.yes.includes(who) || e.ballot?.no.includes(who));
    if (!events.length) return "";
    return `<section class="pn-mr-block"><h3>${title}</h3><ul>${events.map((e) => {
      const { ballot } = e;
      return `<li><span class="pn-mr-event-label">${escapeHtml(e.label)}</span>
        ${e.from !== undefined ? `<span>${person(e.from)}</span>` : ""}
        ${e.from !== undefined && e.to !== undefined ? "<span aria-hidden=\"true\">→</span>" : ""}
        ${e.to !== undefined ? `<span>${person(e.to)}</span>` : ""}
        ${e.note ? `<span class="pn-mr-event-note">${escapeHtml(e.note)}</span>` : ""}
        ${ballot && (ballot.yes.length || ballot.no.length) ? `<details class="pn-mr-extra">
          <summary>За — ${ballot.yes.length} · против — ${ballot.no.length}</summary>
          ${voterChips(ballot.yes)} / ${voterChips(ballot.no)}</details>` : ""}</li>`;
    }).join("")}</ul></section>`;
  }

  function night(d: ReviewDay, who?: number): string {
    const shooting = eventList("Стрельба мафии", (d.shots?.shots ?? []).map((s) => ({
      label: "Выстрел", from: s.shooter, to: s.victim,
    })), who);
    const body = shooting + eventList("Проверки", d.checks, who) +
      eventList("События ночи", d.nightEvents, who);
    if (!body) return "";
    const status = d.shots?.missed ? " · Промах мафии" : d.shots?.victim != null ? ` · Убит №${d.shots.victim}` : "";
    return `<details class="pn-mr-night"${who !== undefined ? " open" : ""}><summary>Ночь ${d.day}${status}</summary>
      <div class="pn-mr-stack">${body}</div></details>`;
  }

  function dayEvents(d: ReviewDay, who?: number): string {
    const body = eventList("Фолы, штрафы и лучшие ходы", d.dayEvents, who);
    return body ? `<details class="pn-mr-extra"${who !== undefined ? " open" : ""}><summary>События дня</summary>${body}</details>` : "";
  }

  const dayBanner = (d: ReviewDay) => {
    const meta = [voterCount(d), roundCount(d)].filter(Boolean).join(" · ");
    return `<div class="pn-mr-day-summary"><strong>День ${d.day}</strong>${meta ? ` <span>${meta}</span>` : ""}</div>
      <div class="pn-mr-results"><span class="pn-mr-outcome${d.rounds.length ? " pn-mr-vote-result" : ""}">${result(d)}</span>
      ${d.removed.length ? `<span class="pn-mr-outcome">Дисквалификация: ${seats(d.removed)}</span>` : ""}</div>`;
  };

  function table(selected?: ReviewDay): string {
    const days = wholeTable ? review.days : selected ? [selected] : [];
    const extras = (d: ReviewDay) => lift(d) + dayEvents(d) + night(d);
    const dayBody = (d: ReviewDay) => {
      const rows = [...(d.nomination ? [d.nomination] : []), ...d.rounds];
      const columns = review.positions.length + 1;
      const more = wholeTable ? extras(d) : "";
      return `<tbody>${wholeTable ? `<tr><th scope="rowgroup" colspan="${columns}" class="pn-mr-group-head"><div class="pn-mr-day-banner">${dayBanner(d)}</div></th></tr>` : ""}
        ${rows.map((r) => {
          const last = r.num > 0 && r.num === d.outcome.finalNum;
          const candidates = new Map(r.candidates.map((c) => [c.position, c.voters]));
          return `<tr${last ? ' class="pn-mr-final"' : ""}><th scope="row">${voteRoundName(r.num)}
            ${last && d.rounds.length > 1 ? "<small>Финальный тур</small>" : ""}</th>
            ${review.positions.map((pos) => {
              const voters = candidates.get(pos);
              if (!voters) return '<td class="pn-mr-empty-cell">—</td>';
              const nomination = r.num === 0;
              const numbers = voters.map((v) => voterNumber(v, nomination)).join(", ");
              if (nomination) return `<td><span class="pn-mr-table-voters pn-mr-nominators">${numbers}</span></td>`;
              const top = r.leaders.includes(pos);
              return `<td${top ? ' class="pn-mr-leading"' : ""}><b>${voters.length}</b>
                <span class="pn-mr-table-voters">${numbers}</span></td>`;
            }).join("")}</tr>`;
        }).join("")}
        ${more ? `<tr><td class="pn-mr-day-more" colspan="${columns}"><div class="pn-mr-stack">${more}</div></td></tr>` : ""}</tbody>`;
    };
    const footerRow = (label: string, key: "points" | "mmrDiff", format: Intl.NumberFormat) =>
      `<tr${key === "mmrDiff" ? ' class="pn-mr-rating-row"' : ""}><th scope="row">${label}</th>
      ${review.positions.map((pos) => `<td>${score(players.get(pos)?.[key], format)}</td>`).join("")}</tr>`;
    const grid = review.positions.length ? `<div class="pn-mr-scroll" role="region" aria-label="Голосования и результаты матча" tabindex="0">
      <table class="pn-mr-table"><thead>
        <tr><th scope="row">Место</th>${review.positions.map((pos) =>
          `<th scope="col" class="pn-mr-place">№${pos}</th>`).join("")}</tr>
        <tr><th scope="row">Ник</th>${review.positions.map((pos) => {
          const former = formerNameLabel(pos);
          return `<th scope="col" class="pn-mr-player-name">${nameLabel(pos) || "—"}${former
            ? `<details class="pn-mr-name-history"><summary>Ник в матче</summary>${former}</details>` : ""}</th>`;
        }).join("")}</tr>
        <tr><th scope="row">Роль</th>${review.positions.map((pos) =>
          `<td>${roleLabel(pos) || "—"}</td>`).join("")}</tr></thead>
        ${days.map(dayBody).join("")}
        ${hasPoints || hasMmr ? `<tfoot>${hasPoints ? footerRow("Баллы за матч", "points", pointsFormat) : ""}
          ${hasMmr ? footerRow("MMR за матч", "mmrDiff", mmrFormat) : ""}</tfoot>` : ""}
      </table></div>` : "";
    if (wholeTable && grid) return grid;
    const summary = (d: ReviewDay) => `<div class="pn-mr-day-banner">${dayBanner(d)}</div>`;
    if (wholeTable) return days.map((d) => summary(d) + `<div class="pn-mr-stack">${extras(d)}</div>`).join("");
    return `${selected ? summary(selected) : ""}${grid}
      ${!selected?.nomination && !selected?.rounds.length ? '<p class="pn-mr-empty">Записей голосования за этот день нет.</p>' : ""}
      ${selected ? `<div class="pn-mr-stack">${extras(selected)}</div>` : ""}`;
  }

  function card(d: ReviewDay, r: ReviewRound): string {
    const final = r.num > 0 && r.num === d.outcome.finalNum;
    const tag = final && d.rounds.length > 1 ? "Финальный тур" : "";
    const tie = r.num > 0 && r.leaders.length > 1 ? `Ничья · ${r.leaders.length} ${r.leaders.length <= 4 ? "кандидата" : "кандидатов"}` : "";
    const voteWord = (n: number) => n % 100 >= 11 && n % 100 <= 14 ? "голосов"
      : n % 10 === 1 ? "голос" : n % 10 >= 2 && n % 10 <= 4 ? "голоса" : "голосов";
    return `<section class="pn-mr-card${final ? " pn-mr-final" : ""}"><div class="pn-mr-card-head"><h3>${voteRoundName(r.num)}</h3>
      ${tag || tie ? `<span>${[tag, tie].filter(Boolean).join(" · ")}</span>` : ""}</div>
      <ul>${r.candidates.map((c) => `<li${r.num > 0 && r.leaders.includes(c.position) ? ' class="pn-mr-leading"' : ""}>
        <span class="pn-mr-candidate">${person(c.position)}</span>
        <span class="pn-mr-score"><b>${c.voters.length}</b>${r.num > 0 ? ` ${voteWord(c.voters.length)}` : ""}</span>
        <span class="pn-mr-voters"><span>${r.num === 0 ? "Выставили" : "Голосовали"}</span>${voterChips(c.voters)}</span>
      </li>`).join("")}</ul></section>`;
  }

  function timeline(): string {
    return `<div class="pn-mr-timeline">${review.days.map((d) => `<div class="pn-mr-step">
      <details class="pn-mr-day" data-pn-review-detail="${d.day}"${(state.timelineDays?.has(d.day) ?? (wholeTable || d === day)) ? " open" : ""}><summary class="pn-mr-day-banner">
        ${dayBanner(d)}<span class="pn-mr-chevron" aria-hidden="true">›</span></summary>
        <div class="pn-mr-stack">
          ${d.rounds.length ? `<div class="pn-mr-cards">${d.rounds.map((r) => card(d, r)).join("")}</div>` : ""}
          ${d.nomination ? `<details class="pn-mr-extra"><summary>Выставления</summary>${card(d, d.nomination)}</details>` : ""}
          ${lift(d)}${dayEvents(d)}
          ${!d.rounds.length && !d.nomination && !d.lift.length && !d.dayEvents.length ? '<p class="pn-mr-empty">Нет записей за день.</p>' : ""}
        </div>
      </details>${night(d)}</div>`).join("")}</div>`;
  }

  function journal(d: ReviewDay): string {
    const filterVotes = (votes: MatchVote[]) => votes.filter((v) =>
      player === undefined || v.voter === player || v.candidate === player)
      .sort((a, b) => (a.voter ?? Infinity) - (b.voter ?? Infinity));
    const rounds = d.rounds.map((r) => ({ round: r, votes: filterVotes(r.votes) })).filter((r) => r.votes.length);
    const votesBlock = (r: ReviewRound, votes: MatchVote[]) =>
      `<section class="pn-mr-block"${r.num ? ` data-pn-review-round="${r.num}" tabindex="-1"` : ""}>
        <div class="pn-mr-block-head"><h3>${voteRoundName(r.num)}</h3>
          <span>${player !== undefined ? `Показано ${votes.length} из ${r.votes.length}` : `Всего: ${votes.length}`}</span></div>
        <ul>${votes.map((v) => `<li class="pn-mr-vote-line">
          <span>${person(v.voter)}</span><span class="pn-mr-event-label">${r.num === 0 ? "выставил" : "голос →"}</span>
          <span>${person(v.candidate)}</span></li>`).join("")}</ul></section>`;
    const nominations = d.nomination ? filterVotes(d.nomination.votes) : [];
    const body = (d.nomination && nominations.length
      ? `<details class="pn-mr-extra"><summary>Выставления</summary>${votesBlock(d.nomination, nominations)}</details>` : "") +
      rounds.map(({ round, votes }) => votesBlock(round, votes)).join("") +
      lift(d, player) + dayEvents(d, player) + night(d, player);
    return `<div class="pn-mr-day-banner">${dayBanner(d)}</div><div class="pn-mr-stack">
      ${rounds.length ? `<p class="pn-mr-caption">Внутри тура записи идут по номеру голосовавшего, а не по времени.</p>
        <div class="pn-mr-jumps">${rounds.map(({ round }) =>
          `<button type="button" data-pn-review-jump="${round.num}">${voteRoundName(round.num)}</button>`).join("")}</div>` : ""}
      ${body || '<p class="pn-mr-empty">Нет записей для выбранного дня и игрока.</p>'}</div>`;
  }

  function paint(): void {
    for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.pnReviewView === view));
    for (const button of dayButtons) {
      button.hidden = view === "timeline";
      button.setAttribute("aria-pressed", String(!(view === "table" && wholeTable) && Number(button.dataset.pnReviewDay) === day?.day));
    }
    allButton.hidden = view === "journal" || review.days.length < 2;
    controls.hidden = !day || (view === "timeline" && allButton.hidden);
    filter.hidden = view !== "journal";
    if (roster) roster.hidden = view === "table";
    pane.innerHTML = view === "table" ? table(day) : !day ? '<p class="pn-mr-empty">Нет данных о ходе матча.</p>'
      : view === "timeline" ? timeline() : journal(day);
    syncAllLabel();
    aliases.refresh();
  }

  function syncAllLabel(): void {
    if (allButton.hidden) return;
    const label = view === "timeline" && !pane.querySelector(".pn-mr-day:not([open])") ? "Свернуть все дни"
      : view === "table" && wholeTable ? "Вернуться к одному дню" : "Открыть все дни";
    if (allButton.textContent !== label) allButton.textContent = label;
  }
  function onToggle(event: Event): void {
    if (view === "timeline" && event.target instanceof HTMLDetailsElement && event.target.hasAttribute("data-pn-review-detail")) syncAllLabel();
  }

  function rememberTimeline(): void {
    if (view === "timeline") state.timelineDays = new Set(Array.from(
      pane.querySelectorAll<HTMLDetailsElement>(".pn-mr-day[open]"), (el) => Number(el.dataset.pnReviewDetail)));
  }
  function setPreference(value: boolean): void {
    wholeTable = state.allDaysPreference = value;
    state.timelineDays = undefined;
  }

  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const summary = event.target.closest("summary");
    const details = summary?.parentElement;
    if (details instanceof HTMLDetailsElement && !details.open && details.dataset.pnReviewDetail) {
      day = review.days.find((d) => d.day === Number(details.dataset.pnReviewDetail)) ?? day;
      state.day = day?.day;
    }
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button) return;
    const next = button.dataset.pnReviewView;
    if (viewButtons.includes(button) && byView(next) && next !== view) {
      rememberTimeline();
      view = state.view = next;
      try { sessionStorage.setItem(TAB_VIEW_KEY, view); } catch { /* Выбор всё равно действует. */ }
      paint();
    } else if (button === allButton && !button.hidden) {
      if (view === "table") {
        setPreference(!wholeTable);
        meta.saveAllDays(wholeTable);
        paint();
      }
      if (view === "timeline") {
        const open = !!pane.querySelector(".pn-mr-day:not([open])");
        setPreference(open);
        meta.saveAllDays(open);
        for (const item of pane.querySelectorAll<HTMLDetailsElement>(".pn-mr-day")) item.open = open;
        syncAllLabel();
      }
    } else if (dayButtons.includes(button)) {
      const nextDay = review.days.find((d) => d.day === Number(button.dataset.pnReviewDay));
      if (nextDay && (day !== nextDay || (view === "table" && wholeTable))) {
        state.timelineDays = undefined;
        if (view === "table" && wholeTable) {
          setPreference(false);
          meta.saveAllDays(false);
        }
        day = nextDay; state.day = day.day; paint();
      }
    } else if (button.dataset.pnReviewJump) {
      const num = Number(button.dataset.pnReviewJump);
      if (!Number.isSafeInteger(num) || num < 1) return;
      const round = pane.querySelector<HTMLElement>(`[data-pn-review-round="${num}"]`);
      round?.focus({ preventScroll: true });
      round?.scrollIntoView?.({ block: "nearest" });
    }
  }

  function changePlayer(): void {
    const next = Number(playerInput.value);
    player = review.positions.includes(next) ? next : undefined;
    state.player = player;
    paint();
  }

  const aliases = watchMatchReviewAliases(panel);
  paint();
  panel.addEventListener("click", click);
  pane.addEventListener("toggle", onToggle, true);
  playerInput.addEventListener("change", changePlayer);
  registerOwnContainer(root);
  return {
    root,
    setAllDays(value) {
      if (review.days.length < 2 || wholeTable === value) return;
      setPreference(value);
      if (view !== "journal") paint();
    },
    dispose: () => {
      rememberTimeline();
      panel.removeEventListener("click", click);
      pane.removeEventListener("toggle", onToggle, true);
      playerInput.removeEventListener("change", changePlayer);
      aliases.dispose();
      unregisterOwnContainer(root);
      root.remove();
    },
  };
}
