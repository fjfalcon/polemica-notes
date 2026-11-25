/** Интерактивный «Полный вид», отдельный от Vue-таблицы сайта. */
import { registerOwnContainer, unregisterOwnContainer } from "@core/dom";
import { escapeHtml } from "@core/escape";
import { voteRoundName, type MatchVote } from "./match-outcome";
import type { MatchReview, ReviewDay, ReviewEvent, ReviewRound } from "./match-review-data";

const VIEWS = [
  ["table", "Таблица"],
  ["timeline", "Ход игры"],
  ["journal", "Журнал"],
] as const;
type View = (typeof VIEWS)[number][0];
const TAB_VIEW_KEY = "pn_match_review_view";
const ROLE_NAMES = ["Дон", "Мафия", "Мирный", "Шериф"];
const byView = (value: string | null | undefined): value is View => VIEWS.some(([key]) => key === value);

export interface MatchReviewState {
  view: View;
  day?: number;
  player?: number;
}

export function createMatchReviewState(): MatchReviewState {
  try {
    const saved = sessionStorage.getItem(TAB_VIEW_KEY);
    if (byView(saved)) return { view: saved };
  } catch { /* Страница может запрещать Web Storage. */ }
  return { view: "timeline" };
}

export function createMatchReview(review: MatchReview, state: MatchReviewState): { root: HTMLElement; dispose: () => void } {
  const players = new Map(review.players.map((p) => [p.position, p]));
  const nameOf = (pos: number) => {
    const name = players.get(pos)?.username;
    return typeof name === "string" ? name : "";
  };
  const seat = (pos?: number): string => {
    if (!Number.isSafeInteger(pos)) return `<span class="pn-mr-seat" title="Номер не указан">?</span>`;
    const role = players.get(pos!)?.role;
    const tone = role === 0 || role === 1 || role === 2 || role === 3 ? ` pn-mr-role-${role}` : "";
    return `<span class="pn-mr-seat${tone}" title="${escapeHtml(nameOf(pos!))}">№${pos}</span>`;
  };
  const person = (pos?: number) => {
    const name = pos !== undefined ? nameOf(pos) : "";
    return `${seat(pos)}${name ? ` <span>${escapeHtml(name)}</span>` : ""}`;
  };
  const voterChips = (voters: (number | undefined)[]) => voters.map(seat).join("");
  const seats = (list: number[]) => list.slice().sort((a, b) => a - b).map((n) => `№${n}`).join(", ");

  const root = document.createElement("section");
  root.className = "pn-match-review";
  root.setAttribute("aria-label", "Полный разбор матча");
  let view = state.view;
  // Открываем самый насыщенный голосованиями день; при равенстве — первый.
  let day = review.days.find((d) => d.day === state.day) ??
    review.days.reduce<ReviewDay | undefined>((best, next) =>
      !best || next.rounds.length > best.rounds.length ? next : best, undefined);
  let player = state.player !== undefined && review.positions.includes(state.player) ? state.player : undefined;
  root.innerHTML = `
    <div class="pn-mr-head">
      <h2>Полный разбор</h2>
      <div class="pn-mr-choices" role="group" aria-label="Вид разбора">
        ${VIEWS.map(([key, label], i) => `<button type="button" data-pn-review-view="${key}"><span aria-hidden="true">0${i + 1}</span> ${label}</button>`).join("")}
      </div>
    </div>
    <div class="pn-mr-controls" hidden>
      <div class="pn-mr-choices" role="group" aria-label="День матча">
        ${review.days.map((d) => `<button type="button" data-pn-review-day="${d.day}">День ${d.day}</button>`).join("")}
      </div>
      <label class="pn-mr-filter" hidden>Игрок
        <select><option value="">Все игроки</option>
          ${review.positions.map((pos) => `<option value="${pos}">№${pos}${nameOf(pos) ? ` · ${escapeHtml(nameOf(pos))}` : ""}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="pn-mr-content"></div>`;
  const controls = root.querySelector<HTMLElement>(".pn-mr-controls")!;
  const filter = root.querySelector<HTMLElement>(".pn-mr-filter")!;
  const pane = root.querySelector<HTMLElement>(".pn-mr-content")!;
  const playerInput = filter.querySelector("select")!;
  playerInput.value = player === undefined ? "" : String(player);
  const viewButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-pn-review-view]"));
  const dayButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-pn-review-day]"));

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
      <div class="pn-mr-results"><span class="pn-mr-outcome">${result(d)}</span>
      ${d.removed.length ? `<span class="pn-mr-outcome">Дисквалификация: ${seats(d.removed)}</span>` : ""}</div>`;
  };

  function table(d: ReviewDay): string {
    const rows = [...(d.nomination ? [d.nomination] : []), ...d.rounds];
    const grid = rows.length ? `<div class="pn-mr-scroll" role="region" aria-label="Таблица голосования" tabindex="0">
      <table class="pn-mr-table"><thead><tr><th scope="col">Тур / кандидат</th>
        ${review.positions.map((pos) => {
          const name = nameOf(pos);
          const role = players.get(pos)?.role;
          return `<th scope="col">${seat(pos)}
            ${name ? `<strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>` : ""}
            ${role !== undefined && ROLE_NAMES[role] ? `<small>${ROLE_NAMES[role]}</small>` : ""}</th>`;
        }).join("")}</tr></thead>
        <tbody>${rows.map((r) => {
          const last = r.num > 0 && r.num === d.outcome.finalNum;
          const candidates = new Map(r.candidates.map((c) => [c.position, c.voters]));
          return `<tr${last ? ' class="pn-mr-final"' : ""}><th scope="row">${voteRoundName(r.num)}
            ${last && d.rounds.length > 1 ? "<small>Финальный тур</small>" : ""}</th>
            ${review.positions.map((pos) => {
              const voters = candidates.get(pos);
              const top = r.num > 0 && r.leaders.includes(pos);
              return voters ? `<td${top ? ' class="pn-mr-leading"' : ""}><b>${voters.length}</b>
                <span class="pn-mr-table-voters">${voters.map((v) => v ?? "?").join(", ")}</span></td>`
                : '<td class="pn-mr-empty-cell">—</td>';
            }).join("")}</tr>`;
        }).join("")}</tbody></table></div>` : '<p class="pn-mr-empty">Записей голосования за этот день нет.</p>';
    return `<div class="pn-mr-day-banner">${dayBanner(d)}</div>${grid}
      <div class="pn-mr-stack">${lift(d)}${dayEvents(d)}${night(d)}</div>`;
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
      <details class="pn-mr-day" data-pn-review-detail="${d.day}"${d === day ? " open" : ""}><summary class="pn-mr-day-banner">
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
    for (const button of dayButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.pnReviewDay) === day?.day));
    controls.hidden = view === "timeline" || !day;
    filter.hidden = view !== "journal";
    pane.innerHTML = !day ? '<p class="pn-mr-empty">Нет данных о ходе матча.</p>'
      : view === "timeline" ? timeline() : view === "table" ? table(day) : journal(day);
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
      view = state.view = next;
      try { sessionStorage.setItem(TAB_VIEW_KEY, view); } catch { /* Выбор всё равно действует. */ }
      paint();
    } else if (dayButtons.includes(button)) {
      const nextDay = review.days.find((d) => d.day === Number(button.dataset.pnReviewDay));
      if (nextDay && day !== nextDay) { day = nextDay; state.day = day.day; paint(); }
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

  paint();
  root.addEventListener("click", click);
  playerInput.addEventListener("change", changePlayer);
  registerOwnContainer(root);
  return {
    root,
    dispose: () => {
      root.removeEventListener("click", click);
      playerInput.removeEventListener("change", changePlayer);
      unregisterOwnContainer(root);
      root.remove();
    },
  };
}
