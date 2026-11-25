/** Своя раскладка, не зависит от scoped-классов таблицы сайта. */
export const MATCH_REVIEW_STYLES = `
  .pn-match-review {
    --pn-bg: #181d27; --pn-raised: #212736; --pn-line: #333d50;
    --pn-text: #edf0f7; --pn-muted: #acb6ca; --pn-accent: #d4c6ff;
    --pn-selected: #322850; --pn-result: #f3d09a;
    color-scheme: dark; box-sizing: border-box; color: var(--pn-text);
    background: var(--pn-bg); border: 1px solid var(--pn-line); border-radius: 14px;
    font: 14px/1.4 system-ui, sans-serif; margin: 0 0 16px; min-width: 0; max-width: 100%;
    scroll-margin-top: 82px;
  }
  .pn-match-review *, .pn-match-review *::before { box-sizing: border-box; }
  .pn-match-review [hidden] { display: none !important; }
  .pn-match-review :is(h2,h3,ul,p) { margin: 0; color: inherit; }
  .pn-match-review ul { list-style: none; padding: 0; }
  .pn-match-review :is(button,select) { font: inherit; color: inherit; background: var(--pn-raised); }
  .pn-match-review :is(button,summary) { cursor: pointer; }
  .pn-match-review :focus-visible { outline: 2px solid var(--pn-accent); outline-offset: -2px; }
  .pn-mr-head, .pn-mr-controls, .pn-mr-day-banner {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
    gap: 9px 14px; padding: 12px 16px;
  }
  .pn-mr-head {
    background: linear-gradient(112deg, #252237, #1c2230 68%);
    border-radius: 13px 13px 0 0; border-bottom: 1px solid var(--pn-line);
  }
  .pn-mr-head h2 { font-size: 18px; line-height: 1.3; font-weight: 750; letter-spacing: -.02em; }
  .pn-mr-controls { border-bottom: 1px solid var(--pn-line); }
  .pn-mr-choices, .pn-mr-jumps { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
  .pn-mr-choices button, .pn-mr-jumps button, .pn-mr-filter select {
    border: 1px solid var(--pn-line); border-radius: 7px; padding: 5px 9px; font-size: 13px;
  }
  .pn-mr-choices button[aria-pressed="true"] { background: var(--pn-selected); border-color: #9a87cc; color: var(--pn-accent); }
  .pn-mr-choices button:hover:not([aria-pressed="true"]), .pn-mr-jumps button:hover { border-color: var(--pn-muted); }
  .pn-mr-choices button span { color: var(--pn-muted); font-size: 10px; font-weight: 720; margin-right: 2px; }
  .pn-mr-filter { color: var(--pn-muted); font-size: 13px; }
  .pn-mr-filter select { max-width: min(100%, 240px); margin-left: 3px; color: var(--pn-text); }
  .pn-mr-day-summary, .pn-mr-results { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; }
  .pn-mr-day-banner strong { font-size: 16px; }
  .pn-mr-day-summary span, .pn-mr-caption { font-size: 12px; color: var(--pn-muted); }
  .pn-mr-outcome {
    background: #382e2a; color: var(--pn-result); border: 1px solid #604c42;
    padding: 3px 7px; border-radius: 6px; font-size: 12px; font-weight: 650;
  }
  .pn-mr-stack { display: grid; gap: 8px; padding: 10px 12px; min-width: 0; }
  .pn-mr-stack:empty { display: none; }
  .pn-mr-seat {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    border-radius: 5px; padding: 2px 5px; min-width: 25px; margin-right: 2px;
    background: var(--pn-raised); color: var(--pn-muted); font-size: 11px; font-weight: 750;
    white-space: nowrap; font-variant-numeric: tabular-nums;
  }
  .pn-mr-role-0 { color: #c084fc; background: #342642; }
  .pn-mr-role-1 { color: #d1d5db; background: #303542; }
  .pn-mr-role-2 { color: #fca5a5; background: #422c33; }
  .pn-mr-role-3 { color: #facc15; background: #3d3522; }
  .pn-mr-scroll { overflow-x: auto; max-width: 100%; }
  .pn-mr-table {
    width: 100%; border: 0; border-spacing: 0; border-collapse: separate; table-layout: fixed;
    font: inherit; font-size: 13px; color: inherit; background: var(--pn-bg);
  }
  .pn-mr-table :is(th,td) {
    text-align: center; vertical-align: middle; width: 88px; padding: 7px 4px;
    border-top: 1px solid var(--pn-line); border-right: 1px solid var(--pn-line);
  }
  .pn-mr-table :is(th,td):last-child { border-right: 0; }
  .pn-mr-table th { background: var(--pn-raised); }
  .pn-mr-table th:first-child { position: sticky; left: 0; z-index: 1; width: 144px; text-align: left; padding-left: 9px; }
  .pn-mr-table th strong, .pn-mr-table th small, .pn-mr-table-voters { display: block; font-size: 11px; }
  .pn-mr-table th strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
  .pn-mr-table th small, .pn-mr-table-voters, .pn-mr-empty-cell { color: var(--pn-muted); }
  .pn-mr-table th small { font-weight: 450; }
  .pn-mr-table td b { font-size: 18px; font-variant-numeric: tabular-nums; }
  .pn-mr-table .pn-mr-leading { color: var(--pn-accent); background: #27263c; }
  .pn-mr-table .pn-mr-final :is(th,.pn-mr-leading) { background: var(--pn-selected); }
  .pn-mr-empty { color: var(--pn-muted); padding: 10px 16px; }
  .pn-mr-timeline { border-left: 1px solid var(--pn-line); margin: 12px 12px 12px 19px; padding-left: 13px; }
  .pn-mr-step { position: relative; }
  .pn-mr-step + .pn-mr-step { margin-top: 8px; }
  .pn-mr-step::before {
    content: ""; position: absolute; top: 19px; left: -18px; width: 9px; height: 9px;
    border-radius: 50%; background: #b9a9f3; box-shadow: 0 0 0 3px #292644;
  }
  .pn-mr-day { border: 1px solid var(--pn-line); background: #1d2230; border-radius: 9px; }
  .pn-mr-day[open] > summary { border-bottom: 1px solid var(--pn-line); }
  .pn-mr-day > summary { gap: 5px 9px; list-style: none; padding-block: 9px; }
  .pn-mr-day > summary::-webkit-details-marker { display: none; }
  .pn-mr-day > summary > .pn-mr-day-summary { flex: 1; }
  .pn-mr-chevron { color: var(--pn-muted); font-size: 20px; line-height: 1; }
  .pn-mr-day[open] > summary .pn-mr-chevron { transform: rotate(90deg); }
  .pn-mr-night { border-left: 2px solid #6b80a6; padding: 4px 8px; margin: 3px 0; min-width: 0; }
  .pn-mr-night > summary { color: #bed5fe; font-size: 13px; }
  .pn-mr-night > .pn-mr-stack { padding-bottom: 0; }
  .pn-mr-cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%, 245px), 1fr)); gap: 8px; align-items: start; }
  .pn-mr-card, .pn-mr-block, .pn-mr-lift, .pn-mr-extra {
    background: #151a24; border: 1px solid var(--pn-line); border-radius: 8px; min-width: 0;
  }
  .pn-mr-card.pn-mr-final { border-color: #8b78c1; }
  .pn-mr-card-head, .pn-mr-block-head, .pn-mr-block > h3 {
    display: flex; align-items: baseline; gap: 3px 8px; flex-wrap: wrap;
    background: var(--pn-raised); border-radius: 7px 7px 0 0; padding: 7px 8px;
  }
  .pn-mr-card.pn-mr-final .pn-mr-card-head { background: var(--pn-selected); }
  .pn-match-review h3 { font-size: 14px; line-height: 1.35; font-weight: 700; }
  .pn-mr-card-head span, .pn-mr-block-head span, .pn-mr-score, .pn-mr-voters > span:first-child {
    font-size: 11px; color: var(--pn-muted);
  }
  .pn-mr-card li, .pn-mr-block li {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 8px;
    padding: 5px 8px; border-top: 1px solid var(--pn-line); font-size: 13px;
  }
  .pn-mr-card li { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .pn-mr-card li.pn-mr-leading { background: #222236; }
  .pn-mr-card.pn-mr-final li.pn-mr-leading { background: #2e2743; }
  .pn-mr-candidate { display: flex; align-items: baseline; gap: 3px; overflow-wrap: anywhere; }
  .pn-mr-score { white-space: nowrap; }
  .pn-mr-score b { color: var(--pn-text); font-size: 15px; font-variant-numeric: tabular-nums; }
  .pn-mr-voters { grid-column: 1/-1; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
  .pn-mr-voters > span:first-child { margin-right: 5px; }
  .pn-mr-lift, .pn-mr-extra { padding: 6px 8px; }
  .pn-mr-extra > summary { font-size: 13px; color: var(--pn-muted); }
  .pn-mr-extra > :is(.pn-mr-card,.pn-mr-block) { margin-top: 6px; }
  .pn-mr-block li:nth-child(even) { background: #1a202b; }
  .pn-mr-block { scroll-margin-top: 82px; }
  .pn-mr-block li > span { overflow-wrap: anywhere; }
  .pn-mr-block .pn-mr-vote-line { display: grid; grid-template-columns: minmax(0, 155px) auto minmax(0, 1fr); }
  .pn-mr-event-label, .pn-mr-event-note { color: var(--pn-muted); }
  .pn-mr-block li .pn-mr-extra { padding: 2px 5px; }
  .pn-mr-jumps button { color: var(--pn-accent); font-size: 12px; }
  @media (max-width: 580px) {
    .pn-mr-head, .pn-mr-controls, .pn-mr-day-banner { padding-inline: 8px; }
    .pn-mr-stack { padding-inline: 7px; }
    .pn-mr-table th:first-child { width: 110px; overflow-wrap: anywhere; }
    .pn-mr-timeline { margin-right: 7px; }
  }
`;
