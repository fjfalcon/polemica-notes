/** Стили внутри Shadow DOM: глобальный tbody tr:hover сайта сюда не попадает. */
export const MATCH_REVIEW_STYLES = `
  :host {
    display: block; box-sizing: border-box; margin: 0 0 16px; min-width: 0; max-width: 100%;
    scroll-margin-top: 82px;
  }
  .pn-mr-panel {
    --pn-bg: #141415; --pn-raised: #242426; --pn-line: #343437;
    --pn-text: #f1f1f2; --pn-muted: #b2b2b6; --pn-rule: #a4a4a8;
    --pn-emphasis: #322b23; --pn-soft: #1a1b20; --pn-sky: #83caff; --pn-result: #ffd28e;
    color-scheme: dark; color: var(--pn-text); background: var(--pn-bg);
    border: 1px solid var(--pn-line); border-radius: 12px;
    font: 14px/1.45 system-ui, sans-serif; min-width: 0; overflow-wrap: anywhere;
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  :is(h2,h3,ul,p) { margin: 0; color: inherit; }
  ul { list-style: none; padding: 0; }
  :is(button,select) { font: inherit; color: inherit; background: var(--pn-raised); }
  :is(button,summary) { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--pn-text); outline-offset: -2px; }
  .pn-mr-head, .pn-mr-nav, .pn-mr-controls, .pn-mr-day-banner {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
    gap: 8px 14px; padding: 10px 16px;
  }
  .pn-mr-head { padding-block: 15px 5px; }
  .pn-mr-head h2 { color: var(--pn-sky); font-size: 24px; line-height: 1.25; font-weight: 730; letter-spacing: -.025em; }
  .pn-mr-kicker { color: var(--pn-muted); font-size: 11px; }
  .pn-mr-judge { color: var(--pn-muted); font-size: 12px; margin-top: 4px; }
  .pn-mr-winner {
    padding: 4px 9px; border-radius: 6px; border: 1px solid #3c5063;
    font-size: 14px; font-weight: 650; color: #b6ddff; background: #202a35;
  }
  .pn-mr-mafia-win { border-color: #684047; color: #ffaaaa; background: #322328; }
  .pn-mr-nav, .pn-mr-controls { border-bottom: 1px solid var(--pn-line); }
  .pn-mr-choices, .pn-mr-jumps { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .pn-mr-choices button, .pn-mr-jumps button, .pn-mr-filter select {
    border: 1px solid var(--pn-line); border-radius: 6px; padding: 5px 10px; font-size: 13px;
  }
  .pn-mr-nav { padding-block: 2px 0; }
  .pn-mr-nav button {
    padding: 8px 10px; background: transparent; color: var(--pn-muted); font-weight: 650;
    border: 0; border-bottom: 3px solid transparent; border-radius: 0;
  }
  .pn-mr-nav button[aria-pressed="true"] { color: var(--pn-text); border-bottom-color: currentColor; }
  .pn-mr-controls button[aria-pressed="true"] {
    color: var(--pn-text); background: #32343a; border-color: var(--pn-rule);
  }
  .pn-mr-controls button[aria-pressed="true"]:focus-visible { outline-offset: -4px; }
  :is(.pn-mr-choices,.pn-mr-jumps) button:hover:not([aria-pressed="true"]) { background: #2e2e31; }
  .pn-mr-filter { color: var(--pn-muted); font-size: 13px; }
  .pn-mr-filter select { max-width: min(100%, 240px); margin-left: 3px; color: var(--pn-text); }
  .pn-mr-day-summary, .pn-mr-results { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; }
  .pn-mr-day-banner strong { font-size: 16px; }
  .pn-mr-day-summary span, .pn-mr-caption { font-size: 12px; color: var(--pn-muted); }
  .pn-mr-outcome {
    font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums;
  }
  .pn-mr-vote-result { color: var(--pn-result); }
  .pn-mr-stack { display: grid; gap: 8px; padding: 10px 12px; min-width: 0; }
  .pn-mr-stack:empty { display: none; }
  .pn-mr-seat {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    border-radius: 5px; padding: 2px 5px; min-width: 25px; margin-right: 2px;
    background: var(--role-bg, var(--pn-raised)); color: var(--role-ink, var(--pn-muted)); font-size: 11px; font-weight: 750;
    white-space: nowrap; font-variant-numeric: tabular-nums;
  }
  .pn-mr-role-0 { --role-ink: #dac1ff; --role-bg: #382d46; }
  .pn-mr-role-1 { --role-ink: #d6ddea; --role-bg: #343a46; }
  .pn-mr-role-2 { --role-ink: #ffa4b0; --role-bg: #442932; }
  .pn-mr-role-3 { --role-ink: #f8d675; --role-bg: #403522; }
  .pn-mr-scroll { overflow-x: auto; max-width: 100%; }
  .pn-mr-table {
    width: 100%; border: 0; border-spacing: 0; border-collapse: separate; table-layout: fixed;
    font: inherit; font-size: 13px; color: inherit; background: var(--pn-bg);
  }
  .pn-mr-table :is(th,td) {
    text-align: center; vertical-align: middle; width: 88px; padding: 8px 5px;
    border-top: 1px solid var(--pn-line); border-right: 1px solid var(--pn-line);
  }
  .pn-mr-table :is(th,td):last-child { border-right: 0; }
  .pn-mr-table th { background: var(--pn-raised); }
  .pn-mr-table th:first-child { position: sticky; left: 0; z-index: 1; width: 150px; text-align: left; padding-left: 11px; }
  .pn-mr-table th.pn-mr-group-head { position: static; width: auto; padding: 0; background: var(--pn-soft); }
  .pn-mr-table td.pn-mr-day-more { padding: 0; text-align: left; }
  .pn-mr-table thead :is(th,td) { padding-block: 5px; }
  .pn-mr-table thead th:first-child, .pn-mr-table thead .pn-mr-place {
    color: var(--pn-muted); font-size: 12px; font-weight: 600;
  }
  .pn-mr-table .pn-mr-player-name { vertical-align: top; }
  .pn-mr-table th :is(.pn-mr-name,small), .pn-mr-table-voters { display: block; font-size: 11px; }
  .pn-mr-table th .pn-mr-name {
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
    font-size: 13px; line-height: 1.35;
  }
  .pn-mr-name { color: inherit; font-weight: 650; text-decoration: none; }
  a.pn-mr-name { text-decoration: underline; text-decoration-color: #77777b; text-underline-offset: .18em; }
  a.pn-mr-name:hover, a.pn-mr-name:focus-visible { text-decoration-color: currentColor; }
  .pn-mr-name[data-pn-alias-suffix]::after { content: " (" attr(data-pn-alias-suffix) ")"; color: var(--pn-muted); }
  .pn-mr-table th small, .pn-mr-table-voters, .pn-mr-empty-cell { color: var(--pn-muted); }
  .pn-mr-table th small { font-weight: 450; }
  .pn-mr-table-voters { margin-top: 2px; font-variant-numeric: tabular-nums; }
  .pn-mr-nominators { margin-top: 0; font-size: 13px; }
  .pn-mr-table-voters span, .pn-mr-table .pn-mr-role-label, .pn-mr-roster-player .pn-mr-role-label {
    color: var(--role-ink); font-weight: 650;
  }
  .pn-mr-table td b { font-size: 18px; font-variant-numeric: tabular-nums; }
  .pn-mr-table .pn-mr-leading { background: #212123; }
  .pn-mr-table .pn-mr-final .pn-mr-leading { background: var(--pn-emphasis); }
  .pn-mr-final .pn-mr-leading b { color: var(--pn-result); font-weight: 850; }
  .pn-mr-table .pn-mr-final > th { box-shadow: inset 3px 0 var(--pn-result); }
  .pn-mr-table tfoot :is(th,td) { background: var(--pn-soft); }
  .pn-mr-table tfoot tr:first-child :is(th,td) { border-top-color: #525253; }
  .pn-mr-number { color: var(--pn-muted); font-variant-numeric: tabular-nums; }
  .pn-mr-table tfoot .pn-mr-number { font-size: 16px; font-weight: 700; }
  .pn-mr-plus { color: #10b981; font-weight: 670; }
  .pn-mr-minus { color: #ef4444; font-weight: 670; }
  .pn-mr-rating-row { display: var(--pn-mr-rating-display, table-row); }
  .pn-mr-rating-inline { display: var(--pn-mr-rating-display, inline); }
  .pn-mr-empty { color: var(--pn-muted); padding: 10px 16px; }
  .pn-mr-timeline { border-left: 1px solid var(--pn-line); margin: 12px 12px 12px 19px; padding-left: 13px; }
  .pn-mr-step { position: relative; }
  .pn-mr-step + .pn-mr-step { margin-top: 8px; }
  .pn-mr-step::before {
    content: ""; position: absolute; top: 19px; left: -18px; width: 9px; height: 9px;
    border-radius: 50%; background: #88888b; box-shadow: 0 0 0 3px var(--pn-bg);
  }
  .pn-mr-day { border: 1px solid var(--pn-line); background: var(--pn-soft); border-radius: 8px; }
  .pn-mr-day[open] > summary { border-bottom: 1px solid var(--pn-line); }
  .pn-mr-day > summary { gap: 5px 9px; list-style: none; padding-block: 9px; }
  .pn-mr-day > summary::-webkit-details-marker { display: none; }
  .pn-mr-day > summary > .pn-mr-day-summary { flex: 1; }
  .pn-mr-chevron { color: var(--pn-muted); font-size: 20px; line-height: 1; }
  .pn-mr-day[open] > summary .pn-mr-chevron { transform: rotate(90deg); }
  .pn-mr-night { border-left: 2px solid #505055; padding: 4px 8px; margin: 3px 0; min-width: 0; }
  .pn-mr-night > summary { color: var(--pn-muted); font-size: 13px; }
  .pn-mr-night > .pn-mr-stack { padding-bottom: 0; }
  .pn-mr-cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%, 245px), 1fr)); gap: 8px; align-items: start; }
  .pn-mr-card, .pn-mr-block, .pn-mr-lift, .pn-mr-extra {
    background: var(--pn-bg); border: 1px solid var(--pn-line); border-radius: 8px; min-width: 0;
  }
  .pn-mr-card.pn-mr-final { border-top: 2px solid var(--pn-result); }
  .pn-mr-card-head, .pn-mr-block-head, .pn-mr-block > h3 {
    display: flex; align-items: baseline; gap: 3px 8px; flex-wrap: wrap;
    background: var(--pn-raised); border-radius: 7px 7px 0 0; padding: 7px 8px;
  }
  h3 { font-size: 14px; line-height: 1.35; font-weight: 700; }
  .pn-mr-card-head span, .pn-mr-block-head span, .pn-mr-score, .pn-mr-voters > span:first-child {
    font-size: 11px; color: var(--pn-muted);
  }
  .pn-mr-card li, .pn-mr-block li {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 8px;
    padding: 5px 8px; border-top: 1px solid var(--pn-line); font-size: 13px;
  }
  .pn-mr-card li { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .pn-mr-card li.pn-mr-leading { background: var(--pn-soft); }
  .pn-mr-card.pn-mr-final li.pn-mr-leading { background: var(--pn-emphasis); }
  .pn-mr-candidate { display: flex; align-items: baseline; gap: 3px; overflow-wrap: anywhere; }
  .pn-mr-score { white-space: nowrap; }
  .pn-mr-score b { color: var(--pn-text); font-size: 15px; font-variant-numeric: tabular-nums; }
  .pn-mr-voters { grid-column: 1/-1; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
  .pn-mr-voters > span:first-child { margin-right: 5px; }
  .pn-mr-lift, .pn-mr-extra { padding: 6px 8px; }
  .pn-mr-extra > summary { font-size: 13px; color: var(--pn-muted); }
  .pn-mr-extra > :is(.pn-mr-card,.pn-mr-block) { margin-top: 6px; }
  .pn-mr-block li:nth-child(even) { background: var(--pn-soft); }
  .pn-mr-block { scroll-margin-top: 82px; }
  .pn-mr-block li > span { overflow-wrap: anywhere; }
  .pn-mr-block .pn-mr-vote-line {
    display: grid; grid-template-columns: minmax(0, min(39%, 210px)) auto minmax(0, 1fr); align-items: start;
  }
  .pn-mr-vote-line > span:not(.pn-mr-event-label) { display: flex; gap: 3px; align-items: baseline; }
  .pn-mr-event-label, .pn-mr-event-note { color: var(--pn-muted); }
  .pn-mr-block li .pn-mr-extra { padding: 2px 5px; }
  .pn-mr-jumps button { font-size: 12px; }
  :is(.pn-mr-roster,.pn-mr-shooting) { border-top: 1px solid var(--pn-line); padding: 10px 16px; }
  :is(.pn-mr-roster,.pn-mr-shooting) > summary { width: fit-content; color: var(--pn-muted); font-size: 13px; }
  :is(.pn-mr-roster > ul,.pn-mr-shooting-list) {
    display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%, 218px),1fr)); gap: 6px; margin-top: 8px;
  }
  :is(.pn-mr-roster li,.pn-mr-shooting-list section) {
    border: 1px solid var(--pn-line); border-radius: 6px; background: var(--pn-soft); padding: 6px 8px;
  }
  .pn-mr-roster-player small, .pn-mr-roster-scores { color: var(--pn-muted); font-size: 12px; }
  .pn-mr-former { display: block; color: var(--pn-muted); font-size: 10px; }
  .pn-mr-name-history { margin-top: 3px; color: var(--pn-muted); font-size: 11px; font-weight: 450; }
  .pn-mr-roster-scores { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 3px; }
  .pn-mr-shooting-list li { margin-top: 4px; color: var(--pn-muted); font-size: 12px; }
  @media (forced-colors: active) {
    .pn-mr-choices button[aria-pressed="true"] { border-color: Highlight; text-decoration: underline; }
  }
  @media (max-width: 580px) {
    .pn-mr-head, .pn-mr-nav, .pn-mr-controls, .pn-mr-day-banner { padding-inline: 8px; }
    .pn-mr-stack { padding-inline: 7px; }
    .pn-mr-table th:first-child { width: 110px; overflow-wrap: anywhere; }
    .pn-mr-timeline { margin-right: 7px; }
  }
`;
