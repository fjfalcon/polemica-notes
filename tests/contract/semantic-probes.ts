/**
 * Семантические пробы по СЫРОМУ тексту бандлов сайта.
 *
 * Ответ на главный урок недели 01–06.08.2026 (см. docs/audit-fragility):
 * прежний контракт проверял «класс ещё существует», а все жалобы были про
 * «класс больше не означает то состояние». Каждая проба пригвождает СВЯЗЬ
 * (байндинг, ветку, матрицу кнопок), а не факт существования строки.
 *
 * Правила:
 *  - только стабильные якоря: строковые литералы, имена свойств и ключи
 *    локали; минифицированные имена переменных матчатся как [\w$]+;
 *  - пробы чистые (текст → вердикт): их гоняет и живой контракт-тест по
 *    сети, и офлайн-юнит по реальным фрагментам с мутациями — так
 *    мутационный критерий проверяется без сети;
 *  - окно после якоря ограничено: «где-то в бандле» — не доказательство.
 */

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

type Probe = (text: string) => ProbeResult;

function re(pattern: RegExp, detail: string): Probe {
  return (text) => ({ ok: pattern.test(text), detail });
}

function has(needle: string, detail: string): Probe {
  return (text) => ({ ok: text.includes(needle), detail });
}

/**
 * Окно после якоря; null — якорь не найден. Для socket-хендлеров окно
 * дополнительно обрезается по началу СЛЕДУЮЩЕЙ подписки: фиксированная длина
 * заезжала в соседний хендлер и его кнопки читались как «лишние» в нашем
 * (проба stopGameMatrix поймала это на первом же прогоне).
 */
function windowAfter(text: string, anchor: string, size: number): string | null {
  const at = text.indexOf(anchor);
  if (at < 0) return null;
  let end = at + anchor.length + size;
  const nextHandler = text.indexOf('.on("', at + anchor.length);
  if (nextHandler > 0 && nextHandler < end) end = nextHandler;
  return text.slice(at, end);
}

function inWindow(
  anchor: string,
  size: number,
  mustHave: string[],
  mustNotHave: string[],
  detail: string,
): Probe {
  return (text) => {
    const w = windowAfter(text, anchor, size);
    if (w === null) return { ok: false, detail: `${detail}: якорь «${anchor}» не найден` };
    for (const needle of mustHave) {
      if (!w.includes(needle)) return { ok: false, detail: `${detail}: в окне нет «${needle}»` };
    }
    for (const needle of mustNotHave) {
      if (w.includes(needle)) return { ok: false, detail: `${detail}: в окне лишнее «${needle}»` };
    }
    return { ok: true, detail };
  };
}

// ─────────────────────────── game-search.js ───────────────────────────

export const gameSearchProbes: Record<string, Probe> = {
  /** Непринятость обозначена ровно cursor-pointer, привязанным к !isGameAccepted. */
  acceptCursorBinding: re(
    /class:\{"cursor-pointer":![\w$]+\.isGameAccepted\}/,
    "cursor-pointer ⇔ !isGameAccepted (queue-requeue и auto-start читают класс как состояние)",
  ),
  /** isGameAccepted — это group.ready, а не что-то другое. */
  acceptedIsGroupReady: re(
    /isGameAccepted:function\s*\(\)\s*\{[\s\S]{0,240}?\.group\)[\s\S]{0,140}?\.ready\}/,
    "isGameAccepted вычисляется из searchState.group.ready",
  ),
  /** Отказ лобби перезагружает страницу — на этом стоит мост этапа 1. */
  notAcceptedReloads: re(
    /"game_not_accepted"===[\w$]+\.reason\?window\.location\.reload\(\)/,
    "on_stop_game_search(game_not_accepted) → window.location.reload()",
  ),
  /** Подпись непринятой карточки. */
  acceptLabel: has("Принять игру", "текст «Принять игру» в ветке непринятой карточки"),
  /**
   * Переход в комнату — POST-форма на /game ИМЕННО в хендлере on_game_found
   * (queue-requeue опирается на полную загрузку). Два несвязанных «где-то в
   * бандле» здесь не доказательство: в game-search ДВЕ формы на /game, и
   * перевод целевой на GET оставался бы зелёным (контрольное ревью
   * 06.08.2026) — поэтому оба признака ищутся в окне самого хендлера.
   */
  postFormToGame: inWindow(
    'on("on_game_found"',
    900,
    ['location.origin+"/game"', 'setAttribute("method","post")'],
    [],
    "on_game_found строит POST-форму на /game",
  ),
  // ── «В поиск» после игры (postgame-search) ──
  /** Пока сервер держит игрока в игре, вместо «Играть» рисуется решающий блок. */
  decideBlockButtons: inWindow(
    "p-play__profile-game--decide",
    600,
    ["Продолжить игру", "Покинуть игру", "quitGame(!1)"],
    [],
    "решающий блок: «Продолжить игру» + «Покинуть игру» → quitGame(false)",
  ),
  /**
   * «Покинуть игру» сама из игры НЕ выводит: quitGame(false) открывает
   * модалку, и только quitGame(true) шлёт POST /api/games/quit и сбрасывает
   * userInGame. На этой двухшаговости стоит машина postgame-search.
   */
  quitOpensConfirmThenApi: inWindow(
    "quitGame:function",
    1200,
    ["showQuitAskModal=!0", "/api/games/quit", "storeChangeUserInGame(null)"],
    [],
    "quitGame: false → модалка; true → POST /api/games/quit → userInGame сброшен",
  ),
  /**
   * Единственное использование модалки подтверждения: quit → quitGame(true),
   * ban-проп НЕ передаётся (иначе текст модалки грозил бы баном, и автоклик
   * по ней потерял бы моральное право на существование).
   */
  confirmQuitWiring: inWindow(
    'ConfirmQuitGameModal",{on:',
    240,
    ["quitGame(!0)"],
    ["ban"],
    "usage ConfirmQuitGameModal: quit → quitGame(true), без ban-пропа",
  ),
  /** Кнопка модалки: класс, клик и подпись «Покинуть лобби». */
  confirmQuitButtonLabel: inWindow(
    'confirmQuit__content-btn",on:{click:',
    160,
    ["Покинуть лобби"],
    [],
    "кнопка модалки подтверждения: confirmQuit__content-btn + «Покинуть лобби»",
  ),
  /**
   * Второй путь выхода: на illegalState=in_game сайт открывает модалку
   * «Вы уже играете» с колбэком quit_game. Ветка гейтится inGameUsersAllowed
   * — значит модалка появляется не всегда, и decide-путь остаётся основным.
   */
  inGameModalWiring: inWindow(
    'case"in_game":',
    260,
    ["storeChangeUserInGame(!0)", "inGameUsersAllowed", '"game-in-progress"', 'emit("quit_game")'],
    [],
    "illegalState=in_game → модалка game-in-progress с onQuitGame → quit_game",
  ),
  /**
   * Режимы очередей и их подписи: их показывает панелька «сколько в
   * очередях» после игры, а сам список приходит с /api/search по ключам
   * mode. Переименуют — панель начнёт врать заголовками.
   */
  censorshipModeTitles: inWindow(
    "censorshipModes:[",
    900,
    ['mode:"standard"', 'title:"Обычный"', 'mode:"polite"', 'title:"Рейтинг"', 'mode:"prime"', 'title:"Prime"'],
    [],
    "очереди: standard «Обычный», polite «Рейтинг», prime «Prime»",
  ),
  /** disabled у «Играть» ⇔ не выбраны очереди (queue-requeue и postgame читают). */
  playDisabledBinding: re(
    /attrs:\{disabled:![\w$]+\.selectedCensorshipModes\.length\}/,
    "disabled «Играть» ⇔ !selectedCensorshipModes.length",
  ),
  /**
   * Лоадер кнопки поиска ⇔ isSearchBtnLoading. В ветке illegalState=in_game
   * сайт searchBtnLoading НЕ сбрасывает — «вечная крутилка», на детекции
   * которой стоит самолечение postgame-search (лог 07.08.2026, 18:29).
   */
  searchBtnLoaderBinding: re(
    /isSearchBtnLoading\?[\w$]+\("div",\{staticClass:"p-play__profile-game p-play__profile-game--search p-play__profile-game-loader-gradient"\}/,
    "isSearchBtnLoading ⇔ лоадер p-play__profile-game-loader-gradient вместо «Играть»",
  ),
  /**
   * Строка «Участников»: ссылка, ник и картинка — из ОДНОГО объекта игрока
   * (search-avatars сверяет ник карточки профиля по id из ссылки с ником той
   * же строки). Разъедутся — гейт «тот же игрок» перестанет что-то значить.
   */
  participantsRowBinding: re(
    /key:([\w$]+)\.username\+"_participant",staticClass:"participants-item",attrs:\{href:"\/profile\/"\.concat\(\1\.id\)[\s\S]{0,160}?staticClass:"participants-image",attrs:\{src:[\w$]+\.getUserAvatarUrl\(\1\.avatar_url,"100x"\)[\s\S]{0,80}?UsernameLabel",\{attrs:\{username:\1\.use/,
    "строка участника: href /profile/{id}, картинка и ник — из одного объекта",
  ),
  /** Список очереди живёт в галочке режима — по ней search-avatars отличает его от витрины лобби. */
  queueParticipantsInModeItem: inWindow(
    't("label",{staticClass:"p-play__profile-modes-item"',
    1200,
    ['staticClass:"p-play__participants"', 'ParticipantsList",{attrs:{participants:'],
    [],
    "список «Участники» очереди внутри label.p-play__profile-modes-item",
  ),
  /** Адрес аватара: file_name и size — query-параметры /image/user-avatar. */
  avatarUrlBuilder: re(
    /[\w$]+\.append\("file_name",[\w$]+\),[\w$]+&&[\w$]+\.append\("size",[\w$]+\),"\/image\/user-avatar\?"\.concat\(/,
    "getUserAvatarUrl: /image/user-avatar?file_name=…&size=…",
  ),
  /** Пока userInGame — поиск запрещён; «Играть» в DOM не существует. */
  searchDisabledWhileInGame: re(
    /searchDisabled:function\(\)\{return (?:[\w$]+|this)\.gameSearchDisabled\|\|(?:[\w$]+|this)\.userInGame&&!(?:[\w$]+|this)\.inGameUsersAllowed\}/,
    "searchDisabled ⇔ gameSearchDisabled || userInGame && !inGameUsersAllowed",
  ),
};

// ─────────────────────────── room/main.js ───────────────────────────

export const roomProbes: Record<string, Probe> = {
  /** Нажатая готовность = класс active, привязанный к votingForGameStart.voted. */
  readyActiveBoundToVoted: re(
    /\{active:[\w$]+(\.\$parent)?\.votingForGameStart\.voted\}/,
    "active ⇔ votingForGameStart.voted (второй признак готовности в queue-requeue)",
  ),
  /** Экран набора игроков ⇔ ровно стадия voting_for_game_start. */
  rollerPregameTernary: re(
    /"voting_for_game_start"===[\s\S]{0,160}?\.stage\.type\)\s*\?/,
    "тернарник роллера: .new-stage рисуется ровно при voting_for_game_start",
  ),
  newStageClass: has('class:"new-stage"', "класс new-stage существует в шаблоне роллера"),
  /** on_game_disbandment только запускает отсчёт (t.time) — больше ничего. */
  disbandmentStartsCountdown: re(
    /on\("on_game_disbandment",[\s\S]{0,220}?startDisbandmentCountdown\([\w$]+\.time\)/,
    "on_game_disbandment → startDisbandmentCountdown(t.time)",
  ),
  /** Старт стадии немедленно ставит gameDidStart (гасит отсчёт роспуска). */
  startStageSetsGameDidStart: inWindow(
    "on_start_stage:function",
    500,
    ["setGameDidStart"],
    [],
    "on_start_stage коммитит setGameDidStart сразу",
  ),
  /**
   * Матрица кнопок роспуска: on_stop_game рисует ЕДИНСТВЕННУЮ ссылку на поиск
   * — ровно та узкая форма, по которой queue-requeue доказывает развал.
   */
  stopGameMatrix: inWindow(
    'on("on_stop_game"',
    900,
    ["link_search_game"],
    ["link_home_redirect", "try_again"],
    "on_stop_game: только ссылка на поиск, без home и retry",
  ),
  /** Экран исключения — home + search: ambiguous для queue-requeue. */
  selfStrikeMatrix: inWindow(
    'on("on_self_strike"',
    1500,
    ["link_home_redirect", "link_search_game"],
    [],
    "on_self_strike: home + search (исключённого нельзя вернуть автокликом)",
  ),
  /** Потеря сессии — только action без ссылки на поиск (retry-вето). */
  sessionDroppedMatrix: inWindow(
    'on("on_session_dropped"',
    500,
    ["try_again"],
    ["link_search_game"],
    "on_session_dropped: только try_again-action, без ссылки на поиск",
  ),
  /** Камера «выключена» = класс off, привязанный к !videoTrackAvailable. */
  cameraOffBinding: re(
    /\{off:!this\.\$store\.state\.videoTrackAvailable\}/,
    "off ⇔ !videoTrackAvailable (auto-start прекращает автоклики по off)",
  ),
  /**
   * Направление меню ролей: при показанной роли пункт зовётся значением ключа
   * hide_roles. ВНИМАНИЕ: ключи локали семантически ИНВЕРТИРОВАНЫ
   * (show_roles:"Скрыть роли") — проба пригвождает и байндинг, и инверсию:
   * если сайт «исправит» любую половину, тест упадёт и мы пересмотрим маркеры.
   */
  roleMenuDirection: re(
    /roleDisplay\?this\.\$root\.Loc\.hide_roles:this\.\$root\.Loc\.show_roles/,
    "roleDisplay ? Loc.hide_roles : Loc.show_roles",
  ),
  /** Пара without-hover/with-hover принадлежит кнопке продолжения паузы. */
  withoutHoverContinue: re(
    /class:"without-hover",textContent:[\w$]+\([\w$]+\.\$parent\.readinessTextWithoutHoverContinue\)/,
    "without-hover привязан к тексту продолжения паузы (F8)",
  ),
  /** Строка суммы в таблице статистики подписана «Итог» (захардкожено сайтом). */
  sumRowTitle: has(
    'code:"sum",title:"Итог"',
    "строка суммы: code=sum, title=«Итог» (match-stats ищет строку по этому тексту)",
  ),
  /** Ячейки таблицы статистики: ["cell","title",code] / ["cell","player",code]. */
  statsCellClasses: (text) => ({
    ok: /\["cell","title",[\w$]+\.code\]/.test(text) && /\["cell","player",[\w$]+\.code\]/.test(text),
    detail: "классы ячеек таблицы статистики (.cell.title.<code>)",
  }),
  // ── «В поиск» после игры (postgame-search) ──
  /**
   * Убитый/заголосованный при начавшейся игре сам становится зрителем —
   * ровно поэтому кнопка «В поиск» показывается в режиме зрителя: это
   * штатное состояние умершего игрока, а из игры сервер его НЕ выписал.
   */
  deadPlayerBecomesViewer: inWindow(
    'on("on_self_strike"',
    1500,
    ['"/game?role=viewer&game_id="'],
    [],
    "on_self_strike (не kick, игра идёт) → редирект в /game?role=viewer",
  ),
  /**
   * Выбытие игрока помечается классами плитки, и ровно ими postgame-search
   * узнаёт «матч окончен ДЛЯ МЕНЯ»: сайт выбывшего из комнаты не уводит и в
   * `?role=viewer` не переводит (жалоба 07.08.2026). Проба держит связь
   * класс ⇔ состояние, а не факт существования строки.
   */
  eliminatedStateClasses: inWindow(
    "notTransparentStateClasses:function",
    400,
    ['isKilled?', '"state-voted"', '"state-killed"', 'isDisqualified&&', '"state-disqualified"'],
    [],
    "state-voted/state-killed ⇔ isKilled(+votedBy), state-disqualified ⇔ isDisqualified",
  ),
  /**
   * Плашка игрока: номер (PlayerNumber) и ник живут в одном `.player__info`,
   * а у самой плашки — сайтовый onClick (превью игрока). На этом стоит
   * compact-nicks: сворачиваем ник, «ручкой» служит номер, а его клик мы
   * обязаны гасить, иначе откроется чужое окно.
   */
  playerInfoPlate: inWindow(
    'class:"player__info info"',
    420,
    ["showPlayerPreview", 'class:"info__name"'],
    [],
    "player__info: onClick=showPlayerPreview + внутри info__name",
  ),
  /** Номер игрока: класс player-N (id), подпись — id+1. */
  playerNumberBinding: re(
    /\["player-number","player-"\.concat\([\w$]+\.id\)\][^)]*\)[^)]*textContent:[\w$]+\([\w$]+\.id\+1\)/,
    "PlayerNumber: класс player-<id>, текст id+1 (id 0-based, подпись с единицы)",
  ),
  /**
   * Инициатор паузы приходит с сервера: сайт читает `pause.initiatorId` из
   * состояния игры и прокидывает его в обработчик паузы (сам обработчик
   * поле игнорирует — именно поэтому «кто поставил» нигде не видно). На
   * этом стоит фича pause-initiator: пропадёт поле — фича замолчит, и
   * узнать об этом надо тестом, а не по жалобе.
   */
  pauseInitiatorInState: re(
    /[\w$]+\.pause&&[\w$]+\.pause\.initiatorId&&\([\w$]+=[\w$]+\.pause\.initiatorId\)/,
    "состояние игры несёт pause.initiatorId",
  ),
  /**
   * …и доезжает до обработчика паузы. ВАЖНО про честность формулировки: это
   * ВНУТРЕННИЙ вызов сайта (`e.on_start_pause({…, initiatorId:f})`), а не
   * доказательство того, что поле есть в проводном событии `on_start_pause`.
   * Что кладёт туда сервер, из бандла не следует — обработчик поле не
   * читает. Проверять это можно только живой сессией (ревью 08.08.2026).
   */
  pauseInitiatorReachesHandler: re(
    /on_start_pause\(\{time:[\w$]+,voted:[^}]*initiatorId:[\w$]+\}\)/,
    "сайт передаёт initiatorId в свой обработчик паузы (внутренний вызов)",
  ),
  /** Футер статистики: «Поиск игры» ведёт на /game-search (fromGame). */
  statsFooterSearchLink: re(
    /endGameLink:function\(\)\{return\{link:"\/game-search"/,
    "endGameLink → /game-search (кнопка «Поиск игры» в футере статистики)",
  ),
  /** on_stop_game(gameOver): сайт сам уводит комнату на /game-search. */
  gameOverAutoRedirect: inWindow(
    'on("on_stop_game"',
    900,
    ['"gameOver"', 'location="/game-search"'],
    [],
    "on_stop_game c reason.code=gameOver → авторедирект на поиск",
  ),
  /**
   * Окно захвата стримера: сайт открывает ЖИВОМУ игроку viewer-вкладку с
   * window.name === "streamWindow" — на этом литерале стоит гейт кнопки
   * «В поиск» (иначе мисклик в окне захвата выписал бы стримера из матча).
   */
  streamWindowName: inWindow(
    "updateStreamerWindow:function",
    600,
    ['"?role=viewer&game_id="', 'window.open(', '"streamWindow"'],
    [],
    "updateStreamerWindow: window.open(url?role=viewer…, \"streamWindow\")",
  ),
};

// ─────────────────────────── bundle/main.css ───────────────────────────

/**
 * Правила раскладки таблицы статистики. Они SCOPED — привязаны к Vue-хешу
 * компонента, и наши вставленные строки фаз обязаны нести тот же атрибут,
 * иначе таблица разваливается (жалоба 07.08.2026: ячейки схлопнулись в
 * ноль, строки растянулись). Проба не проверяет КОНКРЕТНЫЙ хеш (он меняется
 * от ребилда к ребилду, и хардкод как раз и был причиной бага) — она
 * проверяет, что раскладка по-прежнему живёт под scoped-селектором: пока
 * это так, детект scope из DOM обязателен.
 */
export const siteCssProbes: Record<string, Probe> = {
  statsRowScoped: re(
    /\.table \.row\[data-v-[a-f0-9]+\]\{[^}]*display:flex/,
    "раскладка строки таблицы статистики scoped (.table .row[data-v-*]{display:flex})",
  ),
  statsCellScoped: re(
    // Граница `[;{]` обязательна: голое «flex:1» живёт и внутри префиксных
    // -webkit-box-flex/-ms-flex, и проба без неё оставалась зелёной, когда
    // настоящий flex уезжал (поймано мутацией 07.08.2026).
    /\.table \.row \.cell\[data-v-[a-f0-9]+\]\{[^}]*[;{]flex:1[;}]/,
    "ширина ячеек таблицы статистики scoped (.table .row .cell[data-v-*]{flex:1})",
  ),
  /** Числа, на которые опирается наш фолбэк-CSS, если scope не найден. */
  statsCellWidths: (text) => {
    const cell = /\.table \.row \.cell\[data-v-[a-f0-9]+\]\{([^}]*)\}/.exec(text);
    const title = /\.table \.row \.cell\.title\[data-v-[a-f0-9]+\]\{([^}]*)\}/.exec(text);
    const detail = "ширины ячеек статистики: player min-width 115px, title 67px";
    if (!cell || !title) return { ok: false, detail: `${detail}: правила не найдены` };
    const ok =
      cell[1].includes("min-width:115px") &&
      title[1].includes("min-width:67px") &&
      title[1].includes("max-width:67px");
    return { ok, detail };
  },
};

// ────────────────────── room/bundle/style.css (комната) ──────────────────────

/**
 * Геометрия плитки игрока, на которой стоит перестановка плашки по углам
 * (nick-plate). Двигаем мы КОНТЕЙНЕР `.player__botleftmenu`, и работает это
 * только пока: плитка — точка отсчёта (position: relative), а контейнер
 * прижат к её левому нижнему углу абсолютным позиционированием.
 */
export const roomCssProbes: Record<string, Probe> = {
  tileIsPositioningRoot: re(
    /\.player\[data-v-[a-f0-9]+\]\{[^}]*position:relative/,
    "плитка .player — position:relative (точка отсчёта для углов плашки)",
  ),
  plateContainerAnchored: (text) => {
    const rule = /\.player__botleftmenu\[data-v-[a-f0-9]+\]\{([^}]*)\}/.exec(text);
    const detail = "контейнер плашки прижат к левому нижнему углу (left/bottom .625rem)";
    if (!rule) return { ok: false, detail: `${detail}: правило не найдено` };
    const ok = rule[1].includes("bottom:.625rem") && rule[1].includes("left:.625rem");
    return { ok, detail };
  },
  /** Позиционирование контейнеров углов — absolute (общее правило сайта). */
  cornerMenusAbsolute: re(
    /\.player__(?:botleftmenu|toprightmenu)\[data-v-[a-f0-9]+\][^{]*\{[^}]*position:absolute/,
    "угловые контейнеры плитки позиционируются absolute",
  ),
};

/**
 * Длительность анимации перехода роллера (мс) — для сверки с нашим confirm.
 * Якорь по соседнему полю data-блока РОЛЛЕРА: в бандле два animationDuration
 * (у другого компонента — 0), и first-match после перестановки модулей
 * минификатором отдал бы 0, вакуумно «пройдя» сверку (ревью 06.08.2026).
 */
export function siteRollerAnimationMs(text: string): number | null {
  const m = /animationDuration:(\d+),currentSubstage:/.exec(text);
  return m ? Number(m[1]) : null;
}

/** Хэши иконок из auto-start обязаны существовать в бандле комнаты. */
export function missingIconHashes(text: string, hashes: string[]): string[] {
  return hashes.filter((h) => !text.includes(h));
}

// ─────────────────────────── локали ───────────────────────────

export const ruLocaleProbes: Record<string, Probe> = {
  readinessLabels: (text) => {
    const keys = [
      'start_game_readiness_button_not_ready:"Готов"',
      'start_game_readiness_button_ready:"Готов"',
      'player_start_game_readiness_state:"Готов"',
    ];
    const missing = keys.filter((k) => !text.includes(k));
    return {
      ok: missing.length === 0,
      detail: `обе подписи кнопки готовности и отметка плитки — ровно «Готов» (${missing.join("; ") || "ок"})`,
    };
  },
  /**
   * Подписи кнопок центра — по ним controls-safety отличает «Завершите
   * речь» и ЛХ от остальных: классы у всех кнопок одинаковые. Переименует
   * сайт — защита от случайного выкрика молча перестанет действовать.
   */
  controlActionLabels: (text) => {
    const keys = [
      'speech_player_finish:"Завершите речь"',
      'outcry:"Выкрикнуть"',
      'send_guess:"Оставить ЛХ"',
      'cancel_guess:"Сбросить ЛХ"',
    ];
    const missing = keys.filter((k) => !text.includes(k));
    return {
      ok: missing.length === 0,
      detail: `подписи кнопок действий в центре ряда (${missing.join("; ") || "ок"})`,
    };
  },
  /**
   * Текст стадии ДО прихода состояния комнаты. По нему queue-requeue и
   * postgame-search отличают свежезагруженную комнату от идущего матча —
   * переименует сайт, и возврат после развала снова начнёт выключаться сам
   * (жалоба 09.08.2026).
   */
  waitingForGameLabel: (text) => ({
    ok: text.includes('waiting_for_game:"Ожидание начала игры"'),
    detail: "подпись стадии ожидания начала игры",
  }),
  pauseLabels: (text) => ({
    ok:
      text.includes('pause:"Пауза"') &&
      text.includes('end_pause:"Завершить"') &&
      text.includes('continue_game_button_not_ready:"Продолжить игру"'),
    detail: "точные подписи паузы/продолжения/завершения (F8)",
  }),
  welcomeLabels: (text) => ({
    ok:
      text.includes('welcome:"Добро пожаловать"') &&
      text.includes('connect_to_game:"Начать игру"') &&
      text.includes('viewer_mode:"Режим зрителя"') &&
      text.includes('start_watching:"Начать просмотр"'),
    detail: "подписи стартового окна игрока и зрителя",
  }),
  /** Инверсия ключей меню ролей — вторая половина пробы roleMenuDirection. */
  roleMenuKeysInverted: (text) => ({
    ok: text.includes('show_roles:"Скрыть роли"') && text.includes('hide_roles:"Показать роли"'),
    detail: "ключи show/hide_roles семантически инвертированы (известная ловушка)",
  }),
  roleRowTitle: has('game_stats_role:"Роль"', "заголовок строки ролей — «Роль» (match-stats)"),
  disbandPrefix: has(
    'readiness_timeout:"Игра будет распущена через"',
    "префикс отсчёта роспуска (парсер MM:SS в queue-requeue)",
  ),
};

/**
 * Режим «Скрыть рейтинг» (28.10.2026): rating-hide.css прячет рейтинг по
 * классам сайта. Переименование класса вернуло бы рейтинг МОЛЧА — поэтому
 * пригвождаем связь «класс ↔ что в нём рисуется».
 */
export const roomRatingProbes: Record<string, Probe> = {
  mmrLabelClass: re(
    /[\w$]+=\{class:"mmrLabel"\}[\s\S]{0,700}image:"\/images\/user_mmr\//,
    "значок MMR комнаты — .mmrLabel с иконками /images/user_mmr/",
  ),
  mmrLabelValue: re(
    /value:[\w$]+\.playerView\.user\.mmr/,
    "в .mmrLabel лобби рисуется MMR игрока (playerView.user.mmr)",
  ),
  previewRatingLines: re(
    /\{class:"player-preview default-modal"\},[\w$]+=\{class:"profile-info"\}[\s\S]{0,80}\{class:"wrapper"\},[\w$]+=\{class:"username"\}/,
    "карточка игрока: .player-preview .profile-info .wrapper > p.username",
  ),
  previewRatingText: re(
    /ratingTypeText\[[\w$]+\.type\]\([\w$]+\.player\.position\)[\s\S]{0,120}" ранг"/,
    "место в рейтинге и ранг — абзацы .wrapper рядом с ником (не .username)",
  ),
};

export const profileRatingProbes: Record<string, Probe> = {
  mmrLabelClass: has('return"mmrLabel ".concat', "значок MMR профиля — тот же класс .mmrLabel"),
  levelCardMmr: re(
    /t\("UserMmrLabel",\{attrs:\{containerClass:"avatarlvl__info-block avatarlvl__info-block-mmr"[\s\S]{0,200}value:Number\([\w$]+\.user\.mmr\)/,
    "MMR в карточке уровня — компонент UserMmrLabel",
  ),
  historyMmrCell: re(
    /"Итоговый MMR: "[\s\S]{0,120}staticClass:"profileGames__table-body-row-item-cont-mmr"/,
    "± истории игр — profileGames__table-body-row-item-cont-mmr",
  ),
  historyMmrColumn: has('{title:"MMR",key:"mmr"}', "колонка истории игр подписана «MMR» (метка по подписи)"),
};

/**
 * Подтверждение ППК (04.11.2026): ppk-guard узнаёт пункт меню и голос «Да»
 * по разметке и подписям. Дрейф — и защита от бана молча перестаёт спрашивать.
 */
export const roomPpkProbes: Record<string, Probe> = {
  menuContainer: re(
    /[\w$]+=\{class:"menu"\},[\w$]+=\{class:"menu__container"\}/,
    "меню игрока: .menu > .menu__container (селектор пункта ППК)",
  ),
  menuItemStartsVoting: re(
    /[\w$]+\("li",\{class:[\w$]+\(\{disabled:![\w$]+\.\$parent\.canStartVotingForStop\}\),onClick:[\s\S]{0,160}startStopVoting[\s\S]{0,60}Loc\.vote_for_menu_stop/,
    "пункт <li> «ППК» запускает голосование, недоступный — класс disabled",
  ),
  votingTitleByType: re(
    /title:function\(\)\{var ([\w$]+)="".concat\(this\.type,"_voting_title"\);return this\.\$root\.Loc\[\1\]/,
    "заголовок голосования — `${type}_voting_title` (ППК узнаём по нему)",
  ),
  votingTitleClass: re(/[\w$]+=\{key:0,class:"voting__top-title"\}/, "заголовок голосования — .voting__top-title"),
  votingRoot: re(/[\w$]+\("div",\{class:[\w$]+\(\["voting",/, "корень голосования — .voting (closest от кнопки «Да»)"),
  votingYesButton: re(
    /[\w$]+\("button",\{class:"voting__bottom-button",onClick:[^}]*[\w$]+\.vote\(!0\)\}\)\},[\w$]+\(this\.\$root\.Loc\.yes\)/,
    "голос «за» — button.voting__bottom-button с подписью Loc.yes",
  ),
};

export const ruPpkProbes: Record<string, Probe> = {
  menuLabel: has('vote_for_menu_stop:"ППК"', "пункт меню — ровно «ППК»"),
  votingTitle: has('stop_voting_title:"Проголосовать за ППК?"', "заголовок голосования за ППК"),
  yesLabel: has('yes:"Да"', "кнопка голоса «за» — ровно «Да»"),
};

/**
 * Скрыть рейтинг на странице лидеров /ratings (05.11.2026, bundle/rating.js):
 * rating-hide.css узнаёт вкладку по MMR по значку .mmrLabel в строке и
 * карточке, а заголовки колонок — по порядку.
 */
export const ratingPageProbes: Record<string, Probe> = {
  columnsOrder: has(
    '[{key:"position",title:"Место"},{key:"name",title:"Игрок"},{key:"mmr",title:"MMR"},{key:"total_games",title:"Игры"}]',
    "колонки вкладки по MMR: Место, Игрок, MMR, Игры (CSS гасит 1-й и 3-й заголовок)",
  ),
  headInInner: re(
    /staticClass:"p-rating-table__inner"\},\[[\w$]+\("div",\{staticClass:"p-rating-table__head"\},[\w$]+\._l\([\w$]+\.columns/,
    "заголовок — .p-rating-table__head внутри .p-rating-table__inner, ячейки по columns",
  ),
  rowPlaceCell: re(
    /staticClass:"p-rating-table__row"\},\[[\w$]+\.position\?[\w$]+\("span",\{staticClass:"p-rating-table__cell p-rating-table__place"\}/,
    "место в рейтинге — .p-rating-table__place прямым ребёнком строки",
  ),
  mmrCellLabel: re(
    /showMmrColumn\?[\w$]+\("span",\{staticClass:"p-rating-table__cell p-rating-table__amount"\},\[[\w$]+\("UserMmrLabel"/,
    "MMR в строке — UserMmrLabel прямо в .p-rating-table__amount, только при колонке MMR",
  ),
  personMmrLabel: re(/[\w$]+\.ratingInfo\.mmr\?[\w$]+\("UserMmrLabel"/, "значок MMR в карточке — только на вкладке по MMR"),
  personStatistic: re(
    /staticClass:"p-rating-person__statistic"\},[\w$]+\._l\([\w$]+\.ratingInfo/,
    "блок «Место / MMR» карточки — .p-rating-person__statistic по ratingInfo",
  ),
  mmrLabelClass: has('return"mmrLabel ".concat(this.containerClass)', "UserMmrLabel — класс mmrLabel на корне"),
  mmrLabelOnRoot: re(
    /directives:\[\{name:"show"[^\]]*\}\],class:[\w$]+\.contClassname\}/,
    "contClassname висит на корне UserMmrLabel (иначе > .mmrLabel не найдёт)",
  ),
  userInfoMmrBranch: re(
    /\{place:\{label:"Место",value:[\w$]+\+1\},mmr:\{label:"MMR",value:this\.toLocaleNumber\([\w$]+\.mmr\)\}\}/,
    "карточка вкладки по MMR — ровно {place, mmr}: значок карточки и скрытый блок",
  ),
  viewerColumns: has(
    '[{key:"place",title:"Место"},{key:"name",title:"Игрок"},{key:"points",title:"Мафпоинты"},{key:"total_games",title:"Игры"}]',
    "«Зрители» — мафпоинты без MMR (их места остаются)",
  ),
  personInMain: re(
    /staticClass:"p-rating-main"\},\[[\w$]+\.userRatingInfo\?[\w$]+\("UserBlock"[\s\S]{0,200}staticClass:"p-rating__tablecont"/,
    "карточка и таблица — в одном .p-rating-main (запасной селектор карточки)",
  ),
  tabsDisabledAttr: re(
    /staticClass:"p-rating__filterbtns-btn",class:\{[^}]*\},attrs:\{disabled:[\w$]+\.tabsDisabled\}/,
    "кнопки вкладок disabled на время загрузки",
  ),
  loadingWired: re(/on:\{ratingLoading:[\w$]+\.changeTabsDisabled\}/, "ratingLoading списка → блок кнопок вкладок"),
  rowsWithLoadingEnd: re(
    /[\w$]+\.rows=[\w$]+,[\w$]+\.\$emit\("ratingLoading",!1\)/,
    "строки подменяются в том же такте, что снимается блок вкладок",
  ),
};

/**
 * Действия по цифрам (04.11.2026): кнопка действия на плитке (PlayerAction)
 * подписана по виду действия, клик по ней — doAction(действие) сайта.
 */
export const roomPlayerActionProbes: Record<string, Probe> = {
  actionLabels: re(
    /case"nominate":return this\.\$root\.Loc\.nominate_player;case"shot":return this\.\$root\.Loc\.aim_player;case"vote":return this\.\$root\.Loc\.vote_player;case"check":return this\.\$root\.Loc\.reveal_role/,
    "подпись кнопки по действию: nominate/shot/vote/check → Loc.nominate_player/aim_player/vote_player/reveal_role",
  ),
  actionRootClick: re(
    /ao\("div",\{class:[\w$]+\(\["player-action",[\w$]+\.actionClasses\]\),onClick:[^}]*\$emit\("doAction"\)/,
    "корень кнопки — .player-action, клик по нему — doAction",
  ),
  actionContentClass: re(/[\w$]+=\{class:"player-action__content"\}/, "обёртка подписи — .player-action__content"),
  actionLabelSpan: re(
    /yo\("span",null,[\w$]+\([\w$]+\.actionText\),1\)\]\)/,
    "подпись — <span> прямым ребёнком обёртки (носитель подсказки клавиши)",
  ),
  actionsContainer: re(
    /[\w$]+\("div",\{key:\d+,class:[\w$]+\(\["player__actions",[\s\S]{0,260}onDoAction:function\(\)\{return [\w$]+\.doAction\([\w$]+\)\}/,
    "кнопки лежат в .player__actions, клик передаёт действие doAction(e)",
  ),
  /**
   * Цифры сайта зовут doAction() БЕЗ действия — кнопки снимаются, на сервер
   * ничего не уходит; поэтому, пока кнопки на столе, цифры сайту не отдаём.
   * Починит сайт — проба упадёт, и глушение надо пересмотреть.
   */
  siteDigitKeysWithoutAction: re(
    /[\w$]+\(""\.concat\([\w$]+,", num_"\)\.concat\([\w$]+\),\(function\(\)\{return event\.preventDefault\(\),[\w$]+\.doAction\(\),!1\}\)\)/,
    "цифры сайта (1…0, num_) вызывают doAction() без действия",
  ),
  /** …а Player.doAction шлёт РОВНО аргумент: дефолта «текущее действие» нет. */
  playerDoActionPassesArg: re(
    /doAction:function\(([\w$]+)\)\{var [\w$]+=\{id:this\.id,position:this\.id\+1,action:\1\};this\.\$EventBus\.\$emit\("player:onAction"/,
    "Player.doAction(e) отправляет action: e без подстановки",
  ),
  /** …и onPlayerAction снимает кнопки ДО разбора действия — потому цифра их и гасит. */
  onActionClearsFirst: re(
    /"guess"!==[\w$]+\.action&&this\.preparePlayersToAction\(""\),[\w$]+\.action\)\{case"nominate"/,
    "onPlayerAction: сначала preparePlayersToAction(\"\"), потом switch по действию",
  ),
};

export const ruPlayerActionProbes: Record<string, Probe> = {
  nominate: has('nominate_player:"Выставить этого игрока"', "кнопка выставления — ровно эта подпись"),
  vote: has('vote_player:"Проголосовать за этого игрока"', "кнопка голоса — ровно эта подпись"),
  shot: has('aim_player:"Сделать выстрел"', "кнопка выстрела — ровно эта подпись"),
  check: has('reveal_role:"Раскрыть роль"', "кнопка проверки — ровно эта подпись"),
};

/**
 * Громкость игрока (player-volume-memory, 09.11.2026). Page-скрипт зовёт у
 * компонента плитки метод сайта updateVolumeIcon(v) — тот же, что ползунок
 * меню; content запоминает отпущенный ползунок по id из ссылки «Профиль».
 */
export const roomPlayerVolumeProbes: Record<string, Probe> = {
  updateVolumeIcon: re(
    /updateVolumeIcon:function\(([\w$]+)\)\{this\.currentVolume=\1;var ([\w$]+)=this\.currentVolume\/100;this\.\$store\.state\.useAudioAmplification\?this\.volumeAmplifier\.setVolume\(\2\):this\.\$refs\.audioOutput\.volume=\2\}/,
    "updateVolumeIcon(v): currentVolume = v и громкость звука v/100 (усилитель или <audio>)",
  ),
  menuCallsUpdateVolumeIcon: re(
    /onPlayerVolumeChanged:[\w$]+\.updateVolumeIcon[,}]/,
    "ползунок меню плитки ведёт в updateVolumeIcon",
  ),
  sliderShowsCurrentVolume: re(
    /\([\w$]+,\{volume:[\w$]+\.player\.currentVolume,onChanged:[\w$]+\.playerVolumeChanged\}/,
    "ползунок показывает currentVolume плитки",
  ),
  sliderMarkup: re(
    /[\w$]+=\{class:"volume__container"\},[\w$]+=\{class:"volume"\}[\s\S]{0,1200}yo\("input",\{type:"range",min:"0",max:"100",value:[\w$]+\.volume/,
    "ползунок — input[type=range] 0…100 в .volume__container > .volume",
  ),
  sliderEmitsValue: re(
    /changeValue:function\(([\w$]+)\)\{return this\.\$emit\("changed",parseFloat\(\1\.target\.value\)\)\}/,
    "значение ползунка — его value как есть (шкала 0…100)",
  ),
  menuContainerClass: re(/[\w$]+=\{class:"menu"\},[\w$]+=\{class:"menu__container"\}/, "меню плитки — .menu > .menu__container"),
  profileLinkHref: re(
    /playerProfileLink:function\(\)\{[^}]*\?"\/profile\/"\.concat\(this\.player\.playerView\.user\.id\):null\}/,
    "ссылка «Профиль» меню — /profile/<playerView.user.id>",
  ),
  profileLinkInMenu: re(
    /[\w$]+\.playerProfileLink\?\([\w$]+\(\),[\w$]+\("li",[\w$]+,\[[\w$]+\("a",\{href:[\w$]+\.playerProfileLink/,
    "ссылка профиля — <a href> в том же меню, что ползунок",
  ),
  currentVolumeData: re(/actionTimerDuration:0,currentVolume:100,/, "currentVolume — поле data плитки"),
  itsMeComputed: re(/itsMe:function\(\)\{return this\.id===this\.\$store\.state\.playerId\}/, "itsMe — своя плитка"),
  outcryRestores: re(
    /startOutcry:function\([\w$]+\)\{this\.isOutcry=!0,this\.savedVolume=this\.currentVolume,/,
    "выкрик: isOutcry и сохранение громкости (её вернёт сайт)",
  ),
  outcryWatcherRestores: re(
    /isOutcry:function\(([\w$]+)\)\{!\1&&this\.currentVolume===this\.outcryVolume&&this\.\$store\.state\.useAudioAmplification&&this\.updateVolumeIcon\(this\.savedVolume\)\}/,
    "конец выкрика: сайт сам возвращает сохранённую громкость (поэтому во время выкрика не применяем)",
  ),
};

/**
 * «Завершите речь» с клавиши и ЛХ по клавишам (10.11.2026).
 * finish-speech-hotkey жмёт действие skip центра контролов; player-action-keys
 * во время ЛХ жмёт кнопки guessMaf/guessCiv/guessVice на плитках и
 * переключает режим сайта (guessRoles/guessVice) его кнопкой в контролах.
 */
export const roomBestMoveProbes: Record<string, Probe> = {
  skipIsFinishSpeech: re(
    /case"skip":return\{label:[\w$]+\.\$root\.Loc\.speech_player_finish,tooltip:[\w$]+\.\$root\.Loc\.finish_speech_tooltip,icon:[^}]*onClick:function\(\)\{[\w$]+\.runAction\([\w$]+\)\}\}/,
    "действие skip — кнопка «Завершите речь» (speech_player_finish), клик запускает skip",
  ),
  skipHasNoSiteHotKey: re(
    /case"skip":return\{(?:(?!hotKey)[^}])*\}/,
    "у skip нет своей клавиши сайта (наша её не перебивает)",
  ),
  guessActionLabels: re(
    /case"guessMaf":return this\.\$root\.Loc\.make_guess_maf;case"guessCiv":return this\.\$root\.Loc\.make_guess_civ;case"guessVice":return this\.\$root\.Loc\.make_guess_vice;/,
    "кнопки ЛХ на плитке: guessMaf/guessCiv/guessVice → make_guess_maf/civ/vice",
  ),
  tileButtonsByMode: re(
    /return"guessRoles"===this\.\$store\.state\.playerAction\?[^;]{0,200}?return\["guessCiv","guessMaf"\]\.includes\([\w$]+\)\}\)\):"guessVice"===this\.\$store\.state\.playerAction\?[^;]{0,200}?return"guessVice"===[\w$]+\}/,
    "режим guessRoles — на плитке пистолет и сердце, guessVice — корона",
  ),
  modesFromActions: re(
    /\["guessMaf","guessCiv"\]\.includes\(([\w$]+)\)&&\(\1="guessRoles"\)/,
    "режимы ЛХ сайта — guessRoles (из guessMaf/guessCiv) и guessVice",
  ),
  modeToggleRepeatClears: re(
    /togglePlayerAction:function\(([\w$]+),([\w$]+)\)\{\1\.playerAction===\2\?\1\.playerAction=null:\1\.playerAction=\2\}/,
    "повторный клик по активному режиму СНИМАЕТ его — активный не кликаем",
  ),
  modeToggleMarkup: re(
    /[\w$]+\([\w$]+,\{class:[\w$]+\(\{activated:([\w$]+)===[\w$]+\.\$store\.state\.playerAction,"not-activated":\1!==[\w$]+\.\$store\.state\.playerAction\}\)[\s\S]{0,300}onClick:function\(\)\{[\w$]+\.onPlayerActionToggle\(\1\)\}\},\{default:[\w$]+\(\(function\(\)\{return\[[\w$]+\([\w$]+\([\w$]+\.\$root\.Loc\["action_"\.concat\(\1\)\]\)/,
    "переключатель режима — кнопка контролов с классом activated и подписью Loc.action_<режим>",
  ),
};

export const ruBestMoveProbes: Record<string, Probe> = {
  guessMaf: has('make_guess_maf:"Оставить мафией"', "пистолет — ровно эта подпись"),
  guessCiv: has('make_guess_civ:"Оставить мирным"', "сердце — ровно эта подпись"),
  guessVice: has('make_guess_vice:"Оставить за главного"', "корона — ровно эта подпись"),
  modeRoles: has('action_guessRoles:"Угадать роли"', "режим ролей — ровно эта подпись"),
  modeVice: has('action_guessVice:"Оставить за главного"', "режим короны — ровно эта подпись"),
  finishSpeech: has('speech_player_finish:"Завершите речь"', "конец речи — ровно эта подпись"),
};

/** EN-подписи тех же кнопок: TEXT.guessAction / guessModeButton / finishSpeechButton. */
export const enBestMoveProbes: Record<string, Probe> = {
  guessMaf: has('make_guess_maf:"Select as mafia"', "пистолет (EN) — ровно эта подпись"),
  guessCiv: has('make_guess_civ:"Select as civilian"', "сердце (EN) — ровно эта подпись"),
  guessVice: has('make_guess_vice:"Leave in charge"', "корона (EN) — ровно эта подпись"),
  modeRoles: has('action_guessRoles:"Guess roles"', "режим ролей (EN) — ровно эта подпись"),
  modeVice: has('action_guessVice:"Leave in charge"', "режим короны (EN) — ровно эта подпись"),
  finishSpeech: has('speech_player_finish:"End the speech"', "конец речи (EN) — ровно эта подпись"),
};

/**
 * Карточка профиля на странице поиска (bundle/game-search): «У меня тильт»
 * встаёт за кнопкой «Профиль» прямым ребёнком .p-play__profile-main (11.11.2026).
 */
export const searchCardProbes: Record<string, Probe> = {
  profileButtonInMain: re(
    /t\("div",\{staticClass:"p-play__profile-main"\},\[t\("div",\{staticClass:"p-play__profile-info"\}[\s\S]{0,4000}?\]\),[\w$]+\._v\(" "\),t\("button",\{staticClass:"p-play__profile-btn[^"]*",attrs:\{type:"button"\},on:\{click:[\w$]+\.goToProfile\}\}/,
    "«Профиль» — button.p-play__profile-btn прямым ребёнком карточки, после блока инфо",
  ),
};

export function runProbes(
  probes: Record<string, Probe>,
  text: string,
): Array<{ name: string; ok: boolean; detail: string }> {
  return Object.entries(probes).map(([name, probe]) => {
    const r = probe(text);
    return { name, ok: r.ok, detail: r.detail };
  });
}
