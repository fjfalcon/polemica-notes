import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  gameSearchProbes,
  roomProbes,
  ruLocaleProbes,
  runProbes,
  roomCssProbes,
  roomRatingProbes,
  profileRatingProbes,
  roomPpkProbes,
  ruPpkProbes,
  roomPlayerActionProbes,
  roomPlayerVolumeProbes,
  roomBestMoveProbes,
  ruBestMoveProbes,
  enBestMoveProbes,
  ruPlayerActionProbes,
  ratingPageProbes,
  siteCssProbes,
  siteRollerAnimationMs,
} from "../contract/semantic-probes";

/**
 * Офлайн-половина семантического контракта: пробы гоняются по РЕАЛЬНЫМ
 * фрагментам бандлов (tests/fixtures/bundle-snippets, вырезаны из живых
 * файлов 06.08.2026), а затем по мутированным копиям — так мутационный
 * критерий каждой пробы проверяется без сети. Живая половина — в
 * tests/contract/site-semantics.test.ts, те же пробы по свежескачанным
 * бандлам.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snip = (name: string) =>
  fs.readFileSync(path.join(ROOT, "tests/fixtures/bundle-snippets", name), "utf8");

const GS = snip("game-search.txt");
const ROOM = snip("room-main.txt");
const RU = snip("ru-locale.txt");
const CSS = snip("main-css.txt");
const ROOM_CSS = snip("room-css.txt");
const ROOM_RATING = snip("room-rating.txt");
const PROFILE_RATING = snip("profile-rating.txt");
const ROOM_PPK = snip("room-ppk.txt");
const RU_PPK = snip("ru-ppk.txt");
const ROOM_PA = snip("room-player-actions.txt");
const RU_PA = snip("ru-player-actions.txt");
const ROOM_PV = snip("room-player-volume.txt");
const ROOM_BM = snip("room-best-move.txt");
const RU_BM = snip("ru-best-move.txt");
const EN_BM = snip("en-best-move.txt");
const RATING_PAGE = snip("rating-page.txt");

describe("пробы зелёные на реальных фрагментах бандлов", () => {
  test.each([
    ["game-search", gameSearchProbes, GS],
    ["room-main", roomProbes, ROOM],
    ["RU-локаль", ruLocaleProbes, RU],
    ["main.css", siteCssProbes, CSS],
    ["room/style.css", roomCssProbes, ROOM_CSS],
    ["room-main: рейтинг", roomRatingProbes, ROOM_RATING],
    ["profile: рейтинг", profileRatingProbes, PROFILE_RATING],
    ["room-main: ППК", roomPpkProbes, ROOM_PPK],
    ["RU: ППК", ruPpkProbes, RU_PPK],
    ["room-main: действия игрока", roomPlayerActionProbes, ROOM_PA],
    ["RU: действия игрока", ruPlayerActionProbes, RU_PA],
    ["room-main: громкость игрока", roomPlayerVolumeProbes, ROOM_PV],
    ["room-main: конец речи и ЛХ", roomBestMoveProbes, ROOM_BM],
    ["RU: конец речи и ЛХ", ruBestMoveProbes, RU_BM],
    ["EN: конец речи и ЛХ", enBestMoveProbes, EN_BM],
    ["rating: страница лидеров", ratingPageProbes, RATING_PAGE],
  ] as const)("%s", (_name, probes, text) => {
    const failed = runProbes(probes, text).filter((r) => !r.ok);
    expect(failed, failed.map((f) => `${f.name}: ${f.detail}`).join("\n")).toEqual([]);
  });

  test("длительность анимации роллера извлекается", () => {
    expect(siteRollerAnimationMs(ROOM)).toBe(250);
  });
});

/**
 * Мутации: каждая имитирует конкретный дрифт сайта и обязана уронить РОВНО
 * свою пробу. Проба, переживающая свою мутацию, — вакуумная.
 */
describe("каждая проба умирает от своего дрифта", () => {
  const cases: Array<[string, Parameters<typeof runProbes>[0], string, string, (t: string) => string]> = [
    // game-search
    ["acceptCursorBinding: инверсия байндинга", gameSearchProbes, "acceptCursorBinding", GS,
      (t) => t.replace('"cursor-pointer":!', '"cursor-pointer":')],
    ["acceptedIsGroupReady: ready → accepted", gameSearchProbes, "acceptedIsGroupReady", GS,
      (t) => t.replace(/\.ready\}/, ".accepted}")],
    ["notAcceptedReloads: reload заменён модалкой", gameSearchProbes, "notAcceptedReloads", GS,
      (t) => t.replace("window.location.reload()", 'x.showModal("y")')],
    ["acceptLabel: подпись переименована", gameSearchProbes, "acceptLabel", GS,
      (t) => t.replace("Принять игру", "Подтвердить участие")],
    ["postFormToGame: POST → GET", gameSearchProbes, "postFormToGame", GS,
      (t) => t.replace('setAttribute("method","post")', 'setAttribute("method","get")')],
    ["decideBlockButtons: «Покинуть игру» переименована", gameSearchProbes, "decideBlockButtons", GS,
      (t) => t.replace("Покинуть игру", "Выйти из игры")],
    ["quitOpensConfirmThenApi: эндпоинт выхода переехал", gameSearchProbes, "quitOpensConfirmThenApi", GS,
      (t) => t.replace("/api/games/quit", "/api/games/leave")],
    ["confirmQuitWiring: подтверждение перестало выходить", gameSearchProbes, "confirmQuitWiring", GS,
      (t) => t.replace("quitGame(!0)", "closeModal()")],
    ["confirmQuitWiring: у модалки появился ban-проп", gameSearchProbes, "confirmQuitWiring", GS,
      (t) => t.replace('ConfirmQuitGameModal",{on:', 'ConfirmQuitGameModal",{attrs:{ban:30},on:')],
    ["confirmQuitButtonLabel: «Покинуть лобби» переименована", gameSearchProbes, "confirmQuitButtonLabel", GS,
      (t) => t.replace("Покинуть лобби", "Да, выйти")],
    ["censorshipModeTitles: очередь переименована", gameSearchProbes, "censorshipModeTitles", GS,
      (t) => t.replace('title:"Рейтинг"', 'title:"Рейтинговая"')],
    ["playDisabledBinding: disabled отвязан от очередей", gameSearchProbes, "playDisabledBinding", GS,
      (t) => t.replace(/attrs:\{disabled:!(\w+)\.selectedCensorshipModes\.length\}/, "attrs:{disabled:!$1.queuesOk}")],
    ["inGameModalWiring: выход из модалки перестал слать quit_game", gameSearchProbes, "inGameModalWiring", GS,
      (t) => t.replace('emit("quit_game")', 'emit("leave_game")')],
    ["searchBtnLoaderBinding: лоадер сменил класс", gameSearchProbes, "searchBtnLoaderBinding", GS,
      (t) => t.replaceAll("p-play__profile-game-loader-gradient", "p-play__profile-game-spinner")],
    ["searchDisabledWhileInGame: userInGame больше не запрещает поиск", gameSearchProbes, "searchDisabledWhileInGame", GS,
      (t) => t.replace(/searchDisabled:function\(\)\{return ((?:\w+|this))\.gameSearchDisabled\|\|(?:\w+|this)\.userInGame/, "searchDisabled:function(){return $1.gameSearchDisabled||$1.busy")],
    ["participantsRowBinding: href перестал быть id", gameSearchProbes, "participantsRowBinding", GS,
      (t) => t.replace('"/profile/".concat(n.id)', '"/profile/".concat(n.username)')],
    ["participantsRowBinding: картинка из другого объекта", gameSearchProbes, "participantsRowBinding", GS,
      (t) => t.replace("getUserAvatarUrl(n.avatar_url", "getUserAvatarUrl(e.user.avatar")],
    ["queueParticipantsInModeItem: список ушёл из галочки", gameSearchProbes, "queueParticipantsInModeItem", GS,
      (t) => t.replace('ParticipantsList",{attrs:{participants:e.participants}}', 'QueueCount",{attrs:{count:e.count}}')],
    ["avatarUrlBuilder: адрес аватара переехал", gameSearchProbes, "avatarUrlBuilder", GS,
      (t) => t.replace('"/image/user-avatar?"', '"/image/avatar?"')],
    // room
    ["readyActiveBoundToVoted: active отвязан от voted", roomProbes, "readyActiveBoundToVoted", ROOM,
      (t) => t.replace(/\{active:(\w+(\.\$parent)?)\.votingForGameStart\.voted\}/, "{active:$1.votingForGameStart.inProgress}")],
    ["waitingForGameLabel: стадия ожидания переименована", ruLocaleProbes, "waitingForGameLabel", RU,
      (t) => t.replace('waiting_for_game:"Ожидание начала игры"', 'waiting_for_game:"Подготовка"')],
    ["controlActionLabels: «Завершите речь» переименована", ruLocaleProbes, "controlActionLabels", RU,
      (t) => t.replace('speech_player_finish:"Завершите речь"', 'speech_player_finish:"Закончить"')],
    ["rollerPregameTernary: стадия переименована", roomProbes, "rollerPregameTernary", ROOM,
      (t) => t.replace('"voting_for_game_start"===', '"lobby_gathering"===')],
    ["disbandmentStartsCountdown: роспуск делает больше", roomProbes, "disbandmentStartsCountdown", ROOM,
      (t) => t.replace("startDisbandmentCountdown", "leaveRoomImmediately")],
    ["startStageSetsGameDidStart: коммит пропал", roomProbes, "startStageSetsGameDidStart", ROOM,
      (t) => t.replace("setGameDidStart", "setStageOnly")],
    ["stopGameMatrix: у роспуска появился home", roomProbes, "stopGameMatrix", ROOM,
      (t) => {
        const at = t.indexOf('on("on_stop_game"');
        return t.slice(0, at + 400) + "link_home_redirect" + t.slice(at + 400);
      }],
    ["selfStrikeMatrix: у исключения пропал home", roomProbes, "selfStrikeMatrix", ROOM,
      (t) => {
        const at = t.indexOf('on("on_self_strike"');
        const w = t.slice(at);
        return t.slice(0, at) + w.replace("link_home_redirect", "link_removed");
      }],
    ["sessionDroppedMatrix: у сессии появилась ссылка на поиск", roomProbes, "sessionDroppedMatrix", ROOM,
      (t) => {
        const at = t.indexOf('on("on_session_dropped"');
        return t.slice(0, at + 100) + "link_search_game" + t.slice(at + 100);
      }],
    ["cameraOffBinding: off отвязан от videoTrackAvailable", roomProbes, "cameraOffBinding", ROOM,
      (t) => t.replace("{off:!this.$store.state.videoTrackAvailable}", "{off:!this.$store.state.cameraMuted}")],
    ["roleMenuDirection: ветки поменяны местами", roomProbes, "roleMenuDirection", ROOM,
      (t) => t.replace(
        "roleDisplay?this.$root.Loc.hide_roles:this.$root.Loc.show_roles",
        "roleDisplay?this.$root.Loc.show_roles:this.$root.Loc.hide_roles",
      )],
    ["withoutHoverContinue: класс переехал", roomProbes, "withoutHoverContinue", ROOM,
      (t) => t.replace('class:"without-hover"', 'class:"no-hover"')],
    ["sumRowTitle: «Итог» переименован", roomProbes, "sumRowTitle", ROOM,
      (t) => t.replace('code:"sum",title:"Итог"', 'code:"sum",title:"Сумма"')],
    ["statsCellClasses: title-ячейка сменила класс", roomProbes, "statsCellClasses", ROOM,
      (t) => t.replace(/\["cell","title",(\w+)\.code\]/, '["cell","header",$1.code]')],
    // main.css
    ["tileIsPositioningRoot: плитка перестала быть точкой отсчёта", roomCssProbes, "tileIsPositioningRoot", ROOM_CSS,
      // Без relative у .player наши углы считались бы от документа — плашка
      // улетела бы в угол экрана.
      (t) => t.replace("position:relative", "position:static")],
    ["plateContainerAnchored: контейнер плашки сменил угол", roomCssProbes, "plateContainerAnchored", ROOM_CSS,
      (t) => t.replace("left:.625rem", "right:.625rem")],
    ["cornerMenusAbsolute: угловые контейнеры больше не absolute", roomCssProbes, "cornerMenusAbsolute", ROOM_CSS,
      (t) => t.replace("position:absolute", "position:static")],
    ["statsRowScoped: раскладка строки перестала быть scoped", siteCssProbes, "statsRowScoped", CSS,
      // Сайт «расскопил» правило: наши строки перестают его получать по
      // атрибуту — и таблица держится только на нашем фолбэк-CSS.
      (t) => t.replace(/\.table \.row\[data-v-[a-f0-9]+\]\{/, ".table .row{")],
    ["statsCellScoped: ячейка потеряла flex", siteCssProbes, "statsCellScoped", CSS,
      // Именно `;flex:1`, а не «flex:1»: подстрока живёт и в префиксных
      // -webkit-box-flex/-ms-flex, и наивная замена мутировала бы их.
      (t) => t.replace(";flex:1;", ";flex:none;")],
    ["statsCellWidths: ширины колонок изменились", siteCssProbes, "statsCellWidths", CSS,
      (t) => t.replace("min-width:115px", "min-width:140px")],
    ["deadPlayerBecomesViewer: умерший больше не зритель", roomProbes, "deadPlayerBecomesViewer", ROOM,
      // replaceAll: путь зрителя встречается в окне self_strike дважды
      // (немедленный редирект и ссылка continue_as_viewer).
      (t) => t.replaceAll('"/game?role=viewer&game_id="', '"/spectate?game_id="')],
    ["pauseInitiatorInState: инициатор пропал из состояния игры", roomProbes, "pauseInitiatorInState", ROOM,
      // Единственный источник «кто поставил паузу» — если сайт уберёт поле,
      // фича замолчит, и узнать об этом надо тестом, а не по жалобе.
      (t) => t.replace(/\.pause\.initiatorId/g, ".pause.startedBy")],
    ["pauseInitiatorReachesHandler: id больше не доезжает до обработчика паузы", roomProbes, "pauseInitiatorReachesHandler", ROOM,
      (t) => t.replace("initiatorId:f", "unused:f")],
    ["playerInfoPlate: у плашки пропал сайтовый клик превью", roomProbes, "playerInfoPlate", ROOM,
      // Если сайт уберёт свой onClick, гасить всплытие станет незачем —
      // и это надо заметить, а не гасить чужие клики «на всякий случай».
      (t) => t.replace("showPlayerPreview&&", "noPreview&&").replace("o.showPlayerPreview.apply", "o.noPreview.apply")],
    ["playerNumberBinding: номер отвязан от id игрока", roomProbes, "playerNumberBinding", ROOM,
      (t) => t.replace('["player-number","player-".concat(i.id)]', '["player-number","seat-".concat(i.id)]')],
    ["eliminatedStateClasses: заголосованный больше не помечается классом", roomProbes, "eliminatedStateClasses", ROOM,
      (t) => t.replace('"state-voted"', '"state-lynched"')],
    ["statsFooterSearchLink: «Поиск игры» повёл на главную", roomProbes, "statsFooterSearchLink", ROOM,
      (t) => t.replace('endGameLink:function(){return{link:"/game-search"', 'endGameLink:function(){return{link:"/"')],
    ["gameOverAutoRedirect: авторедиректа больше нет", roomProbes, "gameOverAutoRedirect", ROOM,
      (t) => t.replace('location="/game-search"', 'location="/"')],
    ["streamWindowName: имя окна захвата сменилось", roomProbes, "streamWindowName", ROOM,
      (t) => t.replace('"streamWindow"', '"captureWindow"')],
    // RU
    ["readinessLabels: кнопка получила хоткей в подписи", ruLocaleProbes, "readinessLabels", RU,
      (t) => t.replace('start_game_readiness_button_ready:"Готов"', 'start_game_readiness_button_ready:"R Готов"')],
    ["pauseLabels: «Завершить» переименован", ruLocaleProbes, "pauseLabels", RU,
      (t) => t.replace('end_pause:"Завершить"', 'end_pause:"Закончить"')],
    ["welcomeLabels: зрительская кнопка переименована", ruLocaleProbes, "welcomeLabels", RU,
      (t) => t.replace('start_watching:"Начать просмотр"', 'start_watching:"Смотреть"')],
    ["roleMenuKeysInverted: сайт «починил» инверсию", ruLocaleProbes, "roleMenuKeysInverted", RU,
      (t) => t.replace('show_roles:"Скрыть роли"', 'show_roles:"Показать роли"')],
    ["roleRowTitle: «Роль» переименована", ruLocaleProbes, "roleRowTitle", RU,
      (t) => t.replace('game_stats_role:"Роль"', 'game_stats_role:"Карта"')],
    ["disbandPrefix: префикс отсчёта сменился", ruLocaleProbes, "disbandPrefix", RU,
      // replaceAll: фраза попала в сниппет дважды (окно паузы тоже её задело).
      (t) => t.replaceAll("Игра будет распущена через", "Роспуск через")],
    // Скрыть рейтинг
    ["room mmrLabelClass: класс значка переименован", roomRatingProbes, "mmrLabelClass", ROOM_RATING,
      (t) => t.replace('{class:"mmrLabel"}', '{class:"userRating"}')],
    ["room mmrLabelValue: значок рисует не MMR", roomRatingProbes, "mmrLabelValue", ROOM_RATING,
      (t) => t.replace("value:e.playerView.user.mmr", "value:e.playerView.user.level")],
    ["room previewRatingLines: обёртка карточки переименована", roomRatingProbes, "previewRatingLines", ROOM_RATING,
      (t) => t.replace('{class:"wrapper"}', '{class:"info"}')],
    ["room previewRatingText: ранг ушёл из карточки", roomRatingProbes, "previewRatingText", ROOM_RATING,
      (t) => t.replace('" ранг"', '" уровень"')],
    ["profile mmrLabelClass: класс значка переименован", profileRatingProbes, "mmrLabelClass", PROFILE_RATING,
      (t) => t.replace('return"mmrLabel ".concat', 'return"userRating ".concat')],
    ["profile levelCardMmr: карточка рисует не MMR", profileRatingProbes, "levelCardMmr", PROFILE_RATING,
      (t) => t.replace("value:Number(e.user.mmr)", "value:Number(e.user.level)")],
    ["profile historyMmrCell: класс ячейки ± сменился", profileRatingProbes, "historyMmrCell", PROFILE_RATING,
      (t) => t.replace('staticClass:"profileGames__table-body-row-item-cont-mmr"', 'staticClass:"profileGames__mmr"')],
    ["profile historyMmrColumn: колонка переподписана", profileRatingProbes, "historyMmrColumn", PROFILE_RATING,
      (t) => t.replace('{title:"MMR",key:"mmr"}', '{title:"Рейтинг",key:"mmr"}')],
    // Подтверждение ППК
    ["ppk menuContainer: контейнер меню переименован", roomPpkProbes, "menuContainer", ROOM_PPK,
      (t) => t.replace('{class:"menu__container"}', '{class:"menu__list"}')],
    ["ppk menuItemStartsVoting: пункт больше не запускает ППК", roomPpkProbes, "menuItemStartsVoting", ROOM_PPK,
      (t) => t.replaceAll("startStopVoting", "startOtherVoting")],
    ["ppk votingTitleByType: заголовок не по типу", roomPpkProbes, "votingTitleByType", ROOM_PPK,
      (t) => t.replace('"_voting_title"', '"_title"')],
    ["ppk votingTitleClass: класс заголовка сменился", roomPpkProbes, "votingTitleClass", ROOM_PPK,
      (t) => t.replace('class:"voting__top-title"', 'class:"voting__title"')],
    ["ppk votingRoot: корень голосования переименован", roomPpkProbes, "votingRoot", ROOM_PPK,
      (t) => t.replace('ao("div",{class:d(["voting",', 'ao("div",{class:d(["penalty",')],
    ["ppk votingYesButton: «за» больше не Loc.yes", roomPpkProbes, "votingYesButton", ROOM_PPK,
      (t) => t.replace("o.vote(!0)})},g(this.$root.Loc.yes)", "o.vote(!0)})},g(this.$root.Loc.agree)")],
    ["ppk RU menuLabel: пункт переименован", ruPpkProbes, "menuLabel", RU_PPK,
      (t) => t.replace('vote_for_menu_stop:"ППК"', 'vote_for_menu_stop:"Стоп-игра"')],
    ["ppk RU votingTitle: заголовок переименован", ruPpkProbes, "votingTitle", RU_PPK,
      (t) => t.replace("Проголосовать за ППК?", "ППК?")],
    ["ppk RU yesLabel: «Да» переименована", ruPpkProbes, "yesLabel", RU_PPK,
      (t) => t.replace('yes:"Да"', 'yes:"За"')],
    // Действия по цифрам
    ["pa actionLabels: выстрел подписан другим ключом", roomPlayerActionProbes, "actionLabels", ROOM_PA,
      (t) => t.replace("Loc.aim_player", "Loc.shot_player")],
    ["pa actionRootClick: клик больше не doAction", roomPlayerActionProbes, "actionRootClick", ROOM_PA,
      (t) => t.replace('$emit("doAction")', '$emit("act")')],
    ["pa actionContentClass: обёртка переименована", roomPlayerActionProbes, "actionContentClass", ROOM_PA,
      (t) => t.replace('class:"player-action__content"', 'class:"player-action__body"')],
    ["pa actionLabelSpan: подпись не span", roomPlayerActionProbes, "actionLabelSpan", ROOM_PA,
      (t) => t.replace('yo("span",null,g(o.actionText),1)', 'yo("p",null,g(o.actionText),1)')],
    ["pa actionsContainer: контейнер переименован", roomPlayerActionProbes, "actionsContainer", ROOM_PA,
      (t) => t.replace('["player__actions",', '["player__buttons",')],
    ["pa siteDigitKeysWithoutAction: сайт починил цифры", roomPlayerActionProbes, "siteDigitKeysWithoutAction", ROOM_PA,
      (t) => t.replace("e.doAction(),!1", "e.doAction(e.action),!1")],
    ["pa playerDoActionPassesArg: doAction подставляет текущее действие", roomPlayerActionProbes, "playerDoActionPassesArg", ROOM_PA,
      (t) => t.replace("position:this.id+1,action:e}", "position:this.id+1,action:e||this.playerAction}")],
    ["pa onActionClearsFirst: кнопки снимаются после разбора", roomPlayerActionProbes, "onActionClearsFirst", ROOM_PA,
      (t) => t.replace('"guess"!==e.action&&this.preparePlayersToAction(""),e.action){', 'e.action){')],
    ["pa RU nominate: подпись сменилась", ruPlayerActionProbes, "nominate", RU_PA,
      (t) => t.replace("Выставить этого игрока", "Выставить игрока")],
    ["pa RU vote: подпись сменилась", ruPlayerActionProbes, "vote", RU_PA,
      (t) => t.replace("Проголосовать за этого игрока", "Голосовать")],
    ["pa RU shot: подпись сменилась", ruPlayerActionProbes, "shot", RU_PA,
      (t) => t.replace("Сделать выстрел", "Выстрелить")],
    ["pa RU check: подпись сменилась", ruPlayerActionProbes, "check", RU_PA,
      (t) => t.replace("Раскрыть роль", "Проверить")],
    // Громкость игрока
    ["pv updateVolumeIcon: громкость не v/100", roomPlayerVolumeProbes, "updateVolumeIcon", ROOM_PV,
      (t) => t.replace("var t=this.currentVolume/100;", "var t=this.currentVolume/50;")],
    ["pv menuCallsUpdateVolumeIcon: меню ведёт в другой метод", roomPlayerVolumeProbes, "menuCallsUpdateVolumeIcon", ROOM_PV,
      (t) => t.replace("onPlayerVolumeChanged:o.updateVolumeIcon}", "onPlayerVolumeChanged:o.setPlayerVolume}")],
    ["pv sliderShowsCurrentVolume: ползунок не от currentVolume", roomPlayerVolumeProbes, "sliderShowsCurrentVolume", ROOM_PV,
      (t) => t.replace("volume:i.player.currentVolume,", "volume:i.player.volume,")],
    ["pv sliderMarkup: шкала не 0…100", roomPlayerVolumeProbes, "sliderMarkup", ROOM_PV,
      (t) => t.replace('min:"0",max:"100"', 'min:"0",max:"1"')],
    ["pv sliderEmitsValue: значение пересчитывается", roomPlayerVolumeProbes, "sliderEmitsValue", ROOM_PV,
      (t) => t.replace("parseFloat(e.target.value))", "parseFloat(e.target.value)/100)")],
    ["pv menuContainerClass: контейнер меню переименован", roomPlayerVolumeProbes, "menuContainerClass", ROOM_PV,
      (t) => t.replace('{class:"menu__container"}', '{class:"menu__body"}')],
    ["pv profileLinkHref: ссылка по нику", roomPlayerVolumeProbes, "profileLinkHref", ROOM_PV,
      (t) => t.replaceAll('"/profile/".concat(this.player.playerView.user.id)', '"/profile/".concat(this.player.playerView.user.username)')],
    ["pv profileLinkInMenu: ссылка ушла из меню", roomPlayerVolumeProbes, "profileLinkInMenu", ROOM_PV,
      (t) => t.replace('[yo("a",{href:o.playerProfileLink', '[yo("button",{onClick:o.openProfile')],
    ["pv currentVolumeData: поле переименовано", roomPlayerVolumeProbes, "currentVolumeData", ROOM_PV,
      (t) => t.replace("currentVolume:100,", "volume:100,")],
    ["pv itsMeComputed: своя плитка по-другому", roomPlayerVolumeProbes, "itsMeComputed", ROOM_PV,
      (t) => t.replace("itsMe:function(){return this.id===this.$store.state.playerId}", "isMine:function(){return this.id===this.$store.state.playerId}")],
    ["pv outcryRestores: выкрик не сохраняет громкость", roomPlayerVolumeProbes, "outcryRestores", ROOM_PV,
      (t) => t.replace("this.savedVolume=this.currentVolume,", "")],
    ["pv outcryWatcherRestores: сайт не возвращает громкость после выкрика", roomPlayerVolumeProbes, "outcryWatcherRestores", ROOM_PV,
      (t) => t.replace("&&this.updateVolumeIcon(this.savedVolume)}", "}")],
    // Конец речи и ЛХ
    ["bm skipIsFinishSpeech: подпись skip сменилась", roomBestMoveProbes, "skipIsFinishSpeech", ROOM_BM,
      (t) => t.replace('case"skip":return{label:e.$root.Loc.speech_player_finish', 'case"skip":return{label:e.$root.Loc.end_speech')],
    ["bm skipHasNoSiteHotKey: у skip появилась клавиша сайта", roomBestMoveProbes, "skipHasNoSiteHotKey", ROOM_BM,
      (t) => t.replace('buttonSize:e.buttonSize,onClick:function(){e.runAction(t)}};case"guess"', 'buttonSize:e.buttonSize,hotKey:"S",onClick:function(){e.runAction(t)}};case"guess"')],
    ["bm guessActionLabels: корона переименована", roomBestMoveProbes, "guessActionLabels", ROOM_BM,
      (t) => t.replace("return this.$root.Loc.make_guess_vice;", "return this.$root.Loc.leave_in_charge;")],
    ["bm tileButtonsByMode: режим ролей без сердца", roomBestMoveProbes, "tileButtonsByMode", ROOM_BM,
      (t) => t.replace('["guessCiv","guessMaf"]', '["guessMaf"]')],
    ["bm modesFromActions: режим ролей переименован", roomBestMoveProbes, "modesFromActions", ROOM_BM,
      (t) => t.replace('(e="guessRoles")', '(e="guessBoth")')],
    ["bm modeToggleRepeatClears: повтор больше не снимает режим", roomBestMoveProbes, "modeToggleRepeatClears", ROOM_BM,
      (t) => t.replace("e.playerAction===t?e.playerAction=null:e.playerAction=t", "e.playerAction=t")],
    ["bm modeToggleMarkup: класс активного режима сменился", roomBestMoveProbes, "modeToggleMarkup", ROOM_BM,
      (t) => t.replace("{activated:t===e.$store.state.playerAction", "{selected:t===e.$store.state.playerAction")],
    ["bm RU guessMaf: подпись сменилась", ruBestMoveProbes, "guessMaf", RU_BM,
      (t) => t.replace("Оставить мафией", "Мафия")],
    ["bm RU guessCiv: подпись сменилась", ruBestMoveProbes, "guessCiv", RU_BM,
      (t) => t.replace("Оставить мирным", "Мирный")],
    ["bm RU guessVice: подпись сменилась", ruBestMoveProbes, "guessVice", RU_BM,
      (t) => t.replace('make_guess_vice:"Оставить за главного"', 'make_guess_vice:"Главный"')],
    ["bm RU modeRoles: подпись сменилась", ruBestMoveProbes, "modeRoles", RU_BM,
      (t) => t.replace("Угадать роли", "Роли")],
    ["bm RU modeVice: подпись сменилась", ruBestMoveProbes, "modeVice", RU_BM,
      (t) => t.replace('action_guessVice:"Оставить за главного"', 'action_guessVice:"Корона"')],
    ["bm RU finishSpeech: подпись сменилась", ruBestMoveProbes, "finishSpeech", RU_BM,
      (t) => t.replace("Завершите речь", "Закончить речь")],
    ["bm EN guessMaf", enBestMoveProbes, "guessMaf", EN_BM, (t) => t.replace("Select as mafia", "Mafia")],
    ["bm EN guessCiv", enBestMoveProbes, "guessCiv", EN_BM, (t) => t.replace("Select as civilian", "Civilian")],
    ["bm EN guessVice", enBestMoveProbes, "guessVice", EN_BM,
      (t) => t.replace('make_guess_vice:"Leave in charge"', 'make_guess_vice:"Chief"')],
    ["bm EN modeRoles", enBestMoveProbes, "modeRoles", EN_BM, (t) => t.replace("Guess roles", "Roles")],
    ["bm EN modeVice", enBestMoveProbes, "modeVice", EN_BM,
      (t) => t.replace('action_guessVice:"Leave in charge"', 'action_guessVice:"Crown"')],
    ["bm EN finishSpeech", enBestMoveProbes, "finishSpeech", EN_BM, (t) => t.replace("End the speech", "Finish")],
    // Страница лидеров /ratings
    ["rating columnsOrder: колонка MMR переехала", ratingPageProbes, "columnsOrder", RATING_PAGE,
      (t) => t.replace('{key:"name",title:"Игрок"},{key:"mmr",title:"MMR"}', '{key:"mmr",title:"MMR"},{key:"name",title:"Игрок"}')],
    ["rating headInInner: заголовок вынесен из inner", ratingPageProbes, "headInInner", RATING_PAGE,
      (t) => t.replace('staticClass:"p-rating-table__head"', 'staticClass:"p-rating-table__header"')],
    ["rating rowPlaceCell: место сменило класс", ratingPageProbes, "rowPlaceCell", RATING_PAGE,
      (t) => t.replace('staticClass:"p-rating-table__cell p-rating-table__place"', 'staticClass:"p-rating-table__cell p-rating-table__rank"')],
    ["rating mmrCellLabel: MMR в строке не значком", ratingPageProbes, "mmrCellLabel", RATING_PAGE,
      (t) => t.replace('p-rating-table__amount"},[e("UserMmrLabel"', 'p-rating-table__amount"},[e("span"')],
    ["rating personMmrLabel: значок карточки не по вкладке", ratingPageProbes, "personMmrLabel", RATING_PAGE,
      (t) => t.replace('t.ratingInfo.mmr?e("UserMmrLabel"', 't.user?e("UserMmrLabel"')],
    ["rating personStatistic: блок карточки переименован", ratingPageProbes, "personStatistic", RATING_PAGE,
      (t) => t.replace('staticClass:"p-rating-person__statistic"}', 'staticClass:"p-rating-person__stats"}')],
    ["rating mmrLabelClass: значок без mmrLabel", ratingPageProbes, "mmrLabelClass", RATING_PAGE,
      (t) => t.replace('return"mmrLabel ".concat(this.containerClass)', 'return"userRating ".concat(this.containerClass)')],
    ["rating mmrLabelOnRoot: класс ушёл с корня", ratingPageProbes, "mmrLabelOnRoot", RATING_PAGE,
      (t) => t.replace('expression:"show"}],class:t.contClassname}', 'expression:"show"}],class:"mmr-wrap"}')],
    ["rating userInfoMmrBranch: ключ mmr переименован", ratingPageProbes, "userInfoMmrBranch", RATING_PAGE,
      (t) => t.replace('mmr:{label:"MMR",value:this.toLocaleNumber(n.mmr)}', 'rating:{label:"MMR",value:this.toLocaleNumber(n.mmr)}')],
    ["rating viewerColumns: у зрителей появился MMR", ratingPageProbes, "viewerColumns", RATING_PAGE,
      (t) => t.replaceAll('{key:"points",title:"Мафпоинты"}', '{key:"mmr",title:"MMR"}')],
    ["rating personInMain: карточка вне p-rating-main", ratingPageProbes, "personInMain", RATING_PAGE,
      (t) => t.replace('staticClass:"p-rating-main"},[t.userRatingInfo', 'staticClass:"p-rating-side"},[t.userRatingInfo')],
    ["rating tabsDisabledAttr: вкладки не блокируются", ratingPageProbes, "tabsDisabledAttr", RATING_PAGE,
      (t) => t.replace("attrs:{disabled:t.tabsDisabled}", "attrs:{}")],
    ["rating loadingWired: загрузка не блокирует вкладки", ratingPageProbes, "loadingWired", RATING_PAGE,
      (t) => t.replace("on:{ratingLoading:t.changeTabsDisabled}", "on:{ratingLoading:t.showSpinner}")],
    ["rating rowsWithLoadingEnd: блок снимается до строк", ratingPageProbes, "rowsWithLoadingEnd", RATING_PAGE,
      (t) => t.replace('t.rows=n,t.$emit("ratingLoading",!1)', 't.$emit("ratingLoading",!1),t.rows=n')],
  ];

  test.each(cases)("%s", (_name, probes, probeName, original, mutate) => {
    const mutated = mutate(original);
    expect(mutated, "мутация обязана менять текст — иначе кейс вакуумен").not.toBe(original);
    const before = runProbes(probes, original).find((r) => r.name === probeName);
    const after = runProbes(probes, mutated).find((r) => r.name === probeName);
    expect(before?.ok, "до мутации проба обязана быть зелёной").toBe(true);
    expect(after?.ok, "после мутации проба обязана упасть").toBe(false);
  });

  test("animationDuration: смена длительности видна", () => {
    expect(siteRollerAnimationMs(ROOM.replace(/animationDuration:250/, "animationDuration:400"))).toBe(400);
  });
});
