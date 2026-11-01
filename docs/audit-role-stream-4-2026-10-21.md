# Четвёртый внешний аудит видимости ролей — 21.10.2026

## 1. Сводка

**Утверждение «роли никогда не появляются и не исчезают сами» опровергнуто.** На `main`, HEAD `e94cdb988ae3e3d31558ecac2e3e90942eb457e9`, подтверждены **4 блокера направления «в эфир» и 5 высоких нарушений**. Один из четырёх блокеров — **конфликт заданного владельцем оракула с намеренно закреплённым старым поведением**, а не новая регрессия ранее исправленного механизма. Средних и низких production-находок отдельно не насчитывается.

Отдельно от этого счёта: **1 условный транспортный блокер**, **4 семейства контрпримеров SPA-контракта** и ограничения тестового оракула. Их условия ниже не скрыты за общим количеством. Повторяющиеся варианты одной причины не считаются отдельными находками.

Код HEAD совпадает с `080e0ff`; следующий коммит меняет только документацию. Production, исходные тесты, зависимости и настройки оригинала **не изменялись**. Единственная запись в оригинальный репозиторий — этот отчёт. Патчи, архитектурные перестройки, коммиты и релизы не выполнялись и не предлагаются.

### Результаты запусков

| Проверка | Результат |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm test` на неизменённом HEAD | **119 файлов / 1826 PASS**, 18,20 с |
| `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **31 PASS**, 375,93 с; 5000 × 25 шагов плюс закреплённые случаи |
| Независимая матрица настоящих владельцев | **576 клеток, 783 запуска, 8598 сравнений; 70 несовпадений**, все в SPA-подматрицах |
| Повтор матрицы основным аудитором | Те же 70 несовпадений; steady-state и остальные подматрицы чисты |
| Финальный совместный прогон временных `audit4-*` основным аудитором | **18 FAIL / 66 PASS**, 9 файлов; отдельно красный matrix-suite из-за `afterAll` с 70 несовпадениями |
| Независимые контрольные свидетели | **14 PASS**: утверждают наличие дефекта и положительные контроли, не готовность релиза |
| Исторические смысловые откаты `057ded0` / `f3988e6` | **42 опыта: 37 raw killed / 5 survived**; дополнительный API-откат D01 survived |
| Полная исходная suite у каждого survivor | **1826 PASS**; новые аудиторские пробы в знаменатель не включены |
| Chrome 155 | Настоящий reload F5, CSS-каскад, живой Vue/renderer этапов и приём native-команд подтверждены отдельными browser-harness |

18 красных тестов — **не 18 дефектов**: сюда входят параметры одних причин, условные DOM-варианты и конфликт оракула. 70 несовпадений матрицы — тоже не 70 дефектов. Исходные 1826 PASS не смешаны с результатами добавленных проб.

### Артефакты и метод

Далее `AUDIT/` означает:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit4.6DJMSX/
```

`baseline/` — отдельная нетронутая копия для обязательных команд; `repo/` — production того же HEAD и новые пробы; `mutations/`, `oracle-mutations/` — отдельные мутационные копии. Шесть независимых срезов: сайт, OBS, клавиатура/подмена, матрица/lifecycle, тесты/мутации, контроль доказательств. Основной аудитор прочитал доказательства, повторил все новые suites и перепроверил серьёзные выводы. Финальная сверка **257 tracked входов** `src/tests/package/config`: original, baseline и probe-copy идентичны (`main-final-source-integrity.json`).

Все запрошенные production-файлы и тесты прочитаны целиком соответствующими срезами, не только найдены grep. `src/content/native-role-toggle.ts` и прежний synthetic-key/WeakSet-механизм на HEAD **удалены**, а не пропущены при чтении.

Обозначения: `[own,peer]`, `1` — видна, `0` — скрыта. Видимость означает CSS-renderable игровой источник. **Ни один результат не назван записанным OBS Program-кадром.** Browser-harness исполняет настоящие production-модули, но не установленное расширение с авторизованной живой игрой. Транспортные задержки в пробах управляемые, не измеренная частота в установленном OBS.

## 2. Самостоятельная перепроверка сайта

Заново скачаны публичные room JS/CSS; контрольный ревьюер скачал JS независимо. Версия сайта не изменилась относительно прежних аудитов:

| URL / файл | Байты | SHA256 |
|---|---:|---|
| `/room/bundle/main.js` | 1 634 594 | `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` |
| `/room/bundle/style.css` | 144 788 | `0fad7192be03b25aff9faab92d943c34ec0018a3ee06cbf660892230f89e7976` |

Ниже offsets — **0-based UTF-8 bytes**, не номера строк/UTF-16 offsets. Полные материалы: `site-findings.md`, `site/role-writes.json`, `site/renderer-mutations.json`, `site/parent-trace.json`, `control-findings.md`.

### 2.1. Флаг, renderer и другие поверхности

| Маркер / offset | Независимо установленный факт |
|---|---|
| `roleDisplay:!0`, 1201610 | Начальный Vuex-флаг true |
| `updateRoleDisplay:function(e){e.roleDisplay=!e.roleDisplay}`, 1203979; assignment 1204009 | Единственный writer существующего флага; аргумент игнорируется |
| `commit("updateRoleDisplay",!1)`, 1337694 | `on_connect_room`, только при `canSeeRolesAsViewer` |
| `commit("updateRoleDisplay")`, 1599405 | `toggleRolesDisplay`; вызывают native D и меню `toggleRoles` |
| `roleDisplay:{type:Boolean,default:!0}`, 1399308 | Prop Player, не дополнительная запись Vuex |
| `e.role&&!o.isJudge`, 1418919; `[[za,e.$store.state.roleDisplay]]`, 1419196 | Единственный текущий Player-role span; absence→role монтирует его; truthy→truthy может сохранить root |
| `za={beforeMount…}`, 1128883; `Ha(e,t){e.style.display=t?e._vod:"none"}`, 1129237 | vShow пишет display при mount/смене truthiness, не visibility/opacity |
| `Loc.role_tooltip`, 1419144; `getRoleClasses`, 1413571 | Tooltip внутри role-root; class-binding есть, конкурирующего style-binding роли нет |
| `[[za,r.connectedToRoom]]`, 1621308 | Отдельно скрывается родитель всей комнаты; нейтрализатор ребёнка его не отменяет |

AST и ручная сверка всех 8 `roleDisplay` и 3 `updateRoleDisplay` подтвердили: других записей, сбросов на фазу/новую игру/streamerModeStatus/forcePlayersVisibility в этом bundle нет. Streamer/video-флаги и ночные оверлеи не заменяют скрытие role-span; role z-index=5. CSS `display:flex` совпадает с `SITE.roleDisplayValue`.

Другие поверхности проверены отдельно:

* `roleReveal`, 1383447/1384304: сосед role-span, а не его потомок; действующий общий CSS и fake-shield его покрывают. Серверная приватность конкретной выдачи не установлена.
* Legacy CardSelect, 1347654/1348149, 1559347–1560799: действительно рисует выбранную настоящую роль вне role-span и закрывается с задержкой 1500 мс. Современная раздача идёт другим путём; текущая доставка legacy-событий не подтверждена. Не новая безусловная находка.
* Итоги, 1564735–1564863: самостоятельные role-icon/тексты вне скрытия. Не установлена приватная выдача этих итогов посреди живой игры; публичные итоги не названы утечкой.
* GameInfoBlock RoleIcon, 1448850: конфигурация режима, не секретная роль игрока. Auction/guess/протокол — ставки и предположения. Второй отдельный mobile/viewer/preview renderer текущей секретной роли не найден; mobile использует тот же Player, иногда без собственной плитки.
* Ролевые звуки есть: `toBriefing`/`Hd` выбирают dealingDon/dealingMaf/dealingCiv/dealingCom, `Audio` не гейтится roleDisplay. Это вне предмета **видимости**; дорожка OBS и содержимое MP3 не проверены.

### 2.2. Существенное расхождение модели этапов

**Fuzz моделирует не тот DOM-контракт, на котором основана новая гарантия «до кадра».** `tests/invariants/role-visibility-fuzz.test.ts:214–217` пишет element `.textContent`. Настоящий DesktopRoller, byte 1428666, создаёт label через `bo(" "+v(o.getSubstageText(t))+" ",1)` — **Text vnode**. Runtime `bo` — 1106668; `setText:(e,t)=>{e.nodeValue=t}` — 1115513. Production observer не следит за `characterData` (`src/core/dom.ts:147–157`).

На неизменённых скачанных Vue/компонентах retained-label переход дал **0 production MutationRecord**, тогда как полный observer увидел `characterData` и SVG href. Но обобщать это на любой боевой день нельзя: countdown, nightAction, вставка номера и другие ветки иногда дают спасительную childList-мутацию. Настоящий parent/adapter исполнен отдельно: direct checks→speech и toDay(next=shooted) без countdown воспроизводят пробел, **их точная серверная последовательность не зафиксирована**. Поэтому обычный Textnode-only день оставлен условным, не дополнительным безусловным блокером.

Более сильный и подтверждённый публичным frontend путь — **«Промах»**: adapter 1577072 при `stage.type==="toDay" && day>0 && nextStage.type==="speech"` взводит `mafiaMissedTimeoutId`; Roller.fixedState 1432718 выбирает MAFIA_MISSED; renderer 1436978 заменяет DesktopRoller на RollerFixedState. Получаются **5 childList-мутаций с target `.roller`, ни одна не внутри `.stage/.substage`**. Сам сайт вызывает `on_start_day` и `setIsNight(false)`. Это живой матч, не публичный gameOver. См. B01.

### 2.3. Hotkeys-js

Настоящий dispatcher byte-identical сохранённой fixture. Подтверждены: `keyCode||which||charCode` (1218622); filter **до** добавления в `lh` (1218656); полное множество keys (1219683); синхронизация modifiers по flags; keyup-cleanup; focus очищает `lh`, blur — нет; modifier profile даёт `ctrl+d, command+d` (1614731). Обычный ввод в textarea не оставляет зажатые буквы.

Самописный fuzz всё ещё не моделирует readonly-разрешение filter (1221065), fallback which/charCode, IME229, 93/224→91, Meta-tail/Meta-up, AltGraph и reset `lh` при регистрации. Native V гейтится `togglingStreamAvailable` (1614147): modern adapter разрешает pregame либо paused judge, не любой живой матч. Fuzz считает videoToggles без этого гейта. Сами эти упрощения не насчитаны новыми production-блокерами без визуального свидетеля.

## 3. Подтверждённые находки

### B01 — БЛОКЕР, «в эфир»: «Промах» обходит немедленное дневное скрытие

**Места:** `src/content/features/auto-start.ts:683–708`, особенно `693`; delayed fallback `1173–1180`, `1514–1519`, `1562–1567`; `src/core/dom.ts:130–157,176–202`; `src/core/selectors.ts:704–715`.

1. AutoHide и phaseSwitch ON, OBS-автосцены OFF. Штатный ночной показ завершён, своя и известные роли видны. Стрим может вручную захватывать игру; выключенные автосцены не означают выключенный эфир.
2. Приходит поддерживаемый сайтом roomState `toDay`, day>0, next=speech. Настоящий Room watcher → adapter → on_start_day переводит игру в день и рисует «Промах» **вместо** stage.
3. Immediate observer работает, но проверяет только `mutation.target.closest(SITE.stage)`. У всех пяти записей target — `.roller`. Фазовая ветка их пропускает; `syncSiteFlag` видит неизменный true и тоже не прячет.
4. Общий CSS появляется лишь после обычного rAF/250-мс flush + 150-мс проверки либо секундного опроса. До этого настоящие роли открыты в дневном игровом источнике.

**Доказательства:** `audit4-dom-timing.test.ts > day ended-mafia-missed is hidden by first frame` падает с actual `[1,1]` на +16/+100 мс вместо `[0,0]`. Независимый `audit4-control-public-transition.test.ts` исполняет скачанные Vue, настоящий Room watcher/adapter/phase methods и Roller, а не ручной `innerHTML`: без countdown видны точки 0/16/100/150 мс; с настоящим countdown-путём — также 250/400 мс, скрыты к 750 мс. Это PASS-свидетели нарушения.

В Chrome 155 с настоящими auto-start/SharedDomObserver и скачанным renderer первые **10 последовательных rAF-снимков** после fixedState-монтажа остаются visible; около +163 мс ещё видны обе роли, около +180 мс уже hidden (`browser-live-result.json`). Это CSS/renderer-доказательство кадрового окна, не запись Program. Тайминги не универсальный SLA. Положительный контроль `.textContent` внутри сохранённой `.substage.current` скрывает до кадра. Старый фикс начального phase-only enable работает; найден другой реальный путь смены дня.

### B02 — БЛОКЕР, «в эфир»: разрешённый peek=F5 вызывает чужой reload и теряет возврат скрытия

**Места:** `src/content/features/f5-refresh.ts:19–29`; `src/core/keyboard.ts:85,104–105,177–194`; `src/content/features/auto-start.ts:795–819,826–859`; порядок регистрации `src/content/index.ts:58,69`; popup `src/popup/index.ts:1216–1249,1313–1329`.

1. OBS auto/autoHide/phaseSwitch OFF, native flag=true, peek переназначен на F5. Попап это разрешает; `f5_refresh_fix_enabled` включён по умолчанию и не входит в collision-getters.
2. Наш D явно скрывает весь стол CSS, не меняя native flag.
3. F5-down как peek снимает CSS, `peeking=true`, ставит preventDefault/stopPropagation.
4. Отдельный capture listener **на том же window** всё равно исполняется: stopPropagation его не останавливает. Он без проверки defaultPrevented делает настоящий `location.reload()`.
5. Новый документ теряет hold/snapshot. Native initial flag=true, hiding-настройки OFF; F5-up уже некому возвращать прежний manual hide. Обе настоящие роли остаются видны.

**Доказательство:** `audit4-keys-browser.test.ts > peek=F5 returns manual hide after release with f5-refresh=true`, повтор основным аудитором в Chrome:

```text
beforeDown=[0,0]; afterDown=[1,1]; peeking=true
reloaded=true; после отпускания peeking=false; actual=[1,1], expected=[0,0]
```

`location.reload` не подменён; смена документа подтверждена sessionStorage. Контроль только с f5-refresh OFF: reload отсутствует, release даёт `[0,0]`. Это не предположение о default-action синтетического F5 и не дублирование двух router bindings.

### B03 — БЛОКЕР, «в эфир»: новая OBS-сессия подтверждает NIGHT старого сокета до первого списка сцен

**Места:** `src/background/obs-client.ts:193–209,295–300,462–465,645–651,715–725`; статусный consumer `src/background/index.ts:578–585`; `src/content/panels/obs-panel.ts:522–532,738–775,1326–1329`.

1. Старое соединение знает NIGHT. Нештатный обрыв сбрасывает connected/session/socket, **но оставляет currentScene**. Пока связи нет, стример переводит настоящий Program на DAY.
2. Настоящий reconnect проходит Hello→Identify→Identified: уже connected=true и новый sessionId, но новый GetSceneList ещё pending. В свежий status и persisted connection-state попадает **старая NIGHT с новой сессией**.
3. В это окно F5/новое content-enable запрашивает статус. Restore присваивает currentScene ещё до проверки отсутствующей/чужой persisted phase.
4. После распознавания игровой ночи autoSwitchScene считает NIGHT уже подтверждённой и **не отправляет SetCurrentProgramScene**. Штатный таймер открывает весь стол, хотя actual Program=DAY.

**Доказательство:** `audit4-obs-epochs.test.ts > RED reconnect exposes the previous session NIGHT…` падает: на +6500 мс actual `[1,1]`, expected `[0,0]`, set_scene=`[]`.

Независимый `audit4-control-obs.test.ts` убрал mock `request`: настоящие pending-map/op:6/op:7/10000-мс timeout, реальный `socket.onclose(1006)` и `attemptReconnect`, storage хранит реально записанные объекты. После 6500 мс начальный GetSceneList новой сессии ещё жив, обе роли видны на моделируемом actual DAY. **Старого ответа после более нового события не требуется.** Контроль с актуальным GetSceneList(DAY) до enable не даёт unsafe-показа: выполняется реальная NIGHT-команда и показ только после неё.

Окно медленного списка и попадание content-enable в него — условия; их частота в установленном OBS не измерялась. Подтверждён клиентский fail-open, не записанный живой эфир.

### B04 — БЛОКЕР по заданному оракулу, «в эфир»: пустая night scene разрешает показ даже при disconnect

**Места:** `src/content/panels/obs-panel.ts:625–641,738–775,1321–1324,581–602`; `src/content/features/auto-start.ts:1158–1165`; popup `src/popup/index.ts:1721–1723,2358–2378,2503–2509`.

**Это явный конфликт требований.** Пользовательский оракул разрешает автоматический показ при активных автосценах только на подтверждённой ночной сцене. Код намеренно делает `return !input.nightScene || currentScene===nightScene`, а `tests/unit/obs-night-scene-gate.test.ts:39–41` прямо закрепляет true для `nightScene="",currentScene=null`.

Обычный popup позволяет включить integration+auto до выбора сцен либо выбрать пустой пункт «Выберите сцену»; crafted storage не нужен. При AH=true, phase=false, effective OBS auto=true, nightScene="", disconnected/currentScene=null, actual Program=DAY:

```text
enable +16ms: [0,0]
ещё +6500ms: [1,1], connected=false, currentScene=null, set_scene=[]
expected по пользовательскому оракулу: [0,0]
```

Обе интеграционные пробы `RED oracle conflict: auto ON with unconfigured NIGHT…` и `explicitly clearing NIGHT then disconnecting…` в `audit4-obs-epochs.test.ts` падают на настоящих gate/pin/observer. Второй вариант начинает с настроенной ночи: DAY скрыл роли, пользователь очистил night selection, disconnect сначала сохраняет hide, затем роли открываются сами.

Не утверждается, что rename/delete в OBS автоматически очищает сохранённое имя: этот отдельный сценарий не установлен. Это не неверный состав выбранной сцены — приватная сцена **вообще не подтверждена**. В основной счёт B04 включён потому, что аудит прямо требует считать конфликт оракула находкой; без данного требования это намеренно существующее исключение, не новая регрессия.

### H01 — ВЫСОКАЯ, «от игрока»: настоящий день при OBS auto OFF не заканчивает старую ночную эпоху

**Места:** `src/content/features/auto-start.ts:1035–1064,1094–1097,1154–1169`; `src/content/panels/obs-panel.ts:1430–1462,1649–1678`.

Устойчивая NIGHT → D-hide → выключить только OBS auto → настоящий DAY длится 10000 мс → следующая NIGHT → включить OBS auto. PhaseSwitch всё время ON, actual сцена NIGHT. Auto-start день действительно видел, но obsNightSince не сбросил; выключенный OBS-monitor сохранил old currentTimeOfDay/nightSince. `Math.min` при новом nightShow продолжает считать D **прошлой** ночи решением текущей. Новая ночь +12000 мс: `[0,0]` вместо `[1,1]`; нужен D/новая фаза с включённым OBS-monitor.

Проба: `RED a game day while OBS auto is OFF must end the old manual-night epoch`, независимый WS-контроль подтверждает. Контроли без старого D либо с включённым OBS auto через день показывают штатно. Это не полезное сохранение решения при реконнекте **той же** ночи и не попадание в 2,5-секундный slack.

### H02 — ВЫСОКАЯ, «от игрока / зеркало»: queued nightShow под V переживает более новый beforeDayScene

**Места:** `src/content/features/auto-start.ts:1089–1095,839–857,1158–1169`; producer `src/content/panels/obs-panel.ts:793–817`.

NIGHT settled → уйти DAY (скрыто) → V-down → вернуть NIGHT и держать 3500 мс. Настоящий OBS callback снимает own-pin, а auto-start сохраняет pendingNightShowSince под V. Затем наступает игровой DAY, детектор подтверждает его и шлёт beforeDayScene. Это очищает obsNightSince, **но не pendingNightShowSince**. Дневная сцена не выбрана, либо смена законно отклонена другим владельцем; actual Program остаётся NIGHT. Через 2500 мс отпустить V.

На release дневной CSS сначала возвращается, затем старый queued nightShow снимает его снова, проверив только safe-сцену. Own уже под дневным pin, peer открыт: **`[0,1]` на +16 и ещё +12000 мс**, expected `[0,0]`. Ни D, ни нового Show не было.

Оба варианта `RED queued nightShow under V must not survive a subsequent beforeDayScene` падают. Независимый контроль воспроизвёл **без ownership-мока**, с изначально пустой day scene и заданной night scene. Контроль удержания 100 мс, до появления queued nightShow, остаётся `[0,0]`. Квалификация — устойчивое зеркало, **не доказанный DAY-кадр в Program**, который здесь NIGHT.

### H03 — ВЫСОКАЯ, «от игрока»: старый отрицательный status обходит sceneInfoEpoch

**Места:** `src/content/panels/obs-panel.ts:429–445,1500`; сравнение эпохи стоит только в connected=true ветке.

После disconnect показать floating panel при DOM, удовлетворяющем `hasActiveGameInterface()` (в пробе — синтетические плитки): requestOBSStatus получает disconnected snapshot. Его runtime-ответ отложен. Reconnect и свежее `obs_scenes_updated(NIGHT)` уже приняты, через 6500 мс `[1,1]`. Затем приходит старый отрицательный ответ: `currentScene=null` присваивается **без сверки epoch**. Следующий heal прячет всё; текущая фаза night не меняется, новых scene events нет. Спустя ещё 12000 мс `[0,0]`, background connected/NIGHT, expected `[1,1]`.

Проба `RED stale disconnected panel-status response must not erase reconnected NIGHT` повторена основным аудитором. Это отрицательная UI-status ветка, не уже закрытый positive stale status при enable. Многосекундная задержка транспорта — условие теста, не заявленная обычная скорость браузера.

### H04 — ВЫСОКАЯ, «от игрока / зеркало»: старый NIGHT success больше не портит сцену, но вновь планирует прошедшую фазу

**Места:** `src/content/panels/obs-panel.ts:1339–1343,738–775,581–602`.

DAY → NIGHT-команда действительно выполнена, NIGHT-event принят; её success/ACK ещё pending. Через 2500 мс наступает и подтверждается новый DAY, pre-hide исполнен. Возврат DAY не выполняется (пустая day scene; альтернативно смена владельца с not_owner). Ещё через 2500 мс приходит старый NIGHT success. Исправленный switchScene может правильно не переписать currentScene, но autoSwitchScene **после await** всё равно вызывает scheduleRoleVisibility("night"). Timer пересчитывает сцену, а не текущую игровую фазу.

Через ACK+3100 мс `[1,1]`, затем heal возвращает только own-pin: ещё через 12000 мс **`[0,1]`**, expected `[0,0]`. V не используется.

Проба `RED successful old NIGHT continuation…` красная. Независимый контроль исключил not_owner, использовал заранее пустую day scene и **настоящий задержанный op:7 ACK** до 10000-мс timeout; результат тот же, отправлена всего одна NIGHT-команда. Немедленный ACK — положительный контроль. Actual Program=NIGHT, поэтому high-зеркало, не записанная публичная утечка. Это отдельное позднее продолжение, не старый currentScene-writer и не очередь H02.

### H05 — ВЫСОКАЯ, «от игрока»: печать D или отвергнутый native combo отменяют более новый Show при первом mount

**Места:** `src/content/features/auto-start.ts:1531–1533,600–615,617–650`; гейт роутера `src/core/keyboard.ts:78–81`.

1. Лобби без role-root; autoHide ON, phase/OBS auto OFF, site modifier ON. Ctrl+D действительно скрывает native-флаг; команды разрешены сайтом до раздачи.
2. Через 1000 мс наш D явно показывает: lastOurShow новее native Hide, CSS снят. Native-флаг остаётся false — нейтрализатор это штатно позволяет.
3. Ещё через 1000 мс игрок пишет букву физическим D в textarea, например редакторе заметки; либо жмёт Ctrl+D при другой зажатой клавише. Настоящий native filter/full-key matcher **не принимает** это как toggle. Флаг не меняется.
4. Но document-capture onSiteCommandKey ставит lastSiteRoleCommandAt только по code/alt/shift/repeat — без typing-context и без знания, принят ли combo сайтом.
5. Первая роль монтируется с прежним native display:none. Ложный timestamp новее нашего Show, поэтому guard `:611` не защищает его. Старый false принимается как новое hide, и спустя 12000 мс роль скрыта до следующего действия.

`audit4-site-causality.test.ts`: **3 FAIL / 1 PASS**; после печати проверены задержки mount 100 и **1000 мс (>700)**; после отвергнутой комбинации — 100 мс. Контроль без лишнего ввода оставляет Show. Это не только широкое 700-мс окно: при позднем mount ложная команда всё равно отключает first-mount guard.

Независимые `audit4-control-site-causality.test.ts` и Chrome 155 исполняют настоящий **Room.addHotKeys**, его toggleRolesDisplay, скачанный hotkeys-js и реактивный Vue v-show. Во всех вариантах счётчик native toggle **ровно 1**, native false, computed display=flex. Без лишнего ввода visibility=visible/opacity=1; после лишнего ввода hidden/0 (`control-causality-browser-result.json`). Это соседний обход нового lastSiteRoleCommandAt, не принятая неопределённость чётности Show без ролей.

## 4. Условные результаты — отдельно от основного счёта

### C01 — условный БЛОКЕР, «в эфир»: GetSceneList производит новое ложное NIGHT-событие из старого снимка

`src/background/obs-client.ts:543–550` безусловно пишет currentScene после await, не сверяя sceneEventSeq. Обычные триггеры — SceneListChanged/SceneNameChanged/SceneCreated/SceneRemoved (`502–506`). GetSceneList снимал NIGHT → newer CurrentProgramSceneChanged(DAY) скрыл всё → **старый список** возвращает NIGHT. Он рассылается как новое obs_scenes_updated; content увеличивает sceneInfoEpoch и принимает его как свежую правду. Через 3500 и ещё 12000 мс `[1,1]` на моделируемом actual DAY, реальных NIGHT-команд нет.

`audit4-obs-epochs.test.ts > RED stale GetSceneList NIGHT after a newer DAY event…` падает; свежий список DAY — положительный контроль. Это обход на другом producer, не прежний get_status/ACK guard. **Не измерено, допускает ли конкретный установленный OBS именно такой emission-order старого списка и более нового события.** До этого измерения C01 не включён в основной счёт. B03 выше не требует такого порядка.

### SPA-контракт: четыре семейства, 70 несовпадений

Проверено настоящими владельцами в одном документе (`audit4-matrix.test.ts`). Но текущая публичная UI-навигация использует POST `/game` с hidden game_id, `location.replace` и full location assignment; ID также бывает в query, не pathname. Room-bundle не содержит игрового history-router. Поэтому `/game/1 → /game/2` через pushState — **контрпример заявленного поддерживаемого контракта, не доказанная обычная навигация нынешнего сайта**.

| Семейство / направление / условная серьёзность | Места и свидетель |
|---|---|
| S1: первый room или возврат на тот же pathname пропускает reset; «в эфир», условный блокер | `auto-start.ts:663–680`: fresh возвращается до reset; lastGamePath не очищается при выходе. `/game-search` без stage/ролей → D-show → first room; либо старый room→поиск→тот же room с новой таблицей. Actual `111` на +1/+351/+5351 вместо `000`; 32 mismatch. Изменившийся room-path с AH — контроль |
| S2: phase-only новая таблица открыта до delayed check; «в эфир», условный блокер | `auto-start.ts:679,683–697,1173–1180,1562–1567`: reset прячет только AH, новая stage вставлена subtree с внешним target. +1/+16/+40/+100=`111`, позднее=`000`; 8 mismatch. Та же граница immediate-scope, что B01, но другой trigger |
| S3: старый manual CSS/peek snapshot переживает reset; «от игрока», условная высокая | `auto-start.ts:670–680,511–524,826–845,1691–1709`: timestamps сброшены, cssReason/manual snapshot нет. Новый матч → последняя auto-hide OFF: +4000=`000` вместо `111`. Без автоматики старый manual hide также остаётся; 6 mismatch. По заданному правилу новая игра сбрасывает hide; сохранять manual между играми отдельно не оговорено |
| S4: OBS не получает lifecycle новой комнаты; самопоказ «в эфир» условно, либо «от игрока», высокая | `obs-panel.ts:899–906,1181–1187,738–790,712–729`; auto-start `663–680,1154–1170`. Old pending NIGHT→новая неизвестная фаза: +1…+1000=`000`, +2000…+12000=`111` от старого callback. Settled old NIGHT→новая NIGHT: +8001=`000` вместо `111`, 16 вариантов gap/V/PS. Всего 24 mismatch. Actual Program=NIGHT, публичная утечка не заявляется |

S4 имеет две противоположные внешние формы одной route-lifecycle причины; они не превращены в два новых безусловных OBS-блокера. Обычный F5 уничтожает документ и не равен этим same-document сценариям.

Другие не включённые в счёт условия: обычный Textnode-only day без установленной серверной последовательности (§2.2); legacy CardSelect; повторная viewer-permission на reconnect; реальные orphan update/две копии; неотличимая смена настоящей роли на выбранную fake. Цветовая гипотеза red/black под F не подтвердилась проверенными публичными CSS/Chrome: классы остаются, но измеренного визуального различия нет.

## 5. Доказательная трасса A–F: что проверено и где нет вердикта «чисто»

### A. Писатели, сила и пересоздание узла

| Писатель | Механизм, приоритет и remount |
|---|---|
| Сайт, §2.1 | Обычный inline display через vShow каждой роли; новый узел получает текущий флаг. Родительские display/условное отсутствие отдельны |
| `auto-start.ts:555–560` | `pn-role-display-override`: stylesheet display:flex!important перебивает обычный native inline display:none; переживает remount |
| `auto-start.ts:493–528` | `polemica-role-hide`: visibility:hidden/opacity:0/pointer-events:none!important на role-root и roleReveal; общее скрытие стола; переживает remount |
| `auto-start.ts:437–483` | Legacy inline visibility/opacity/pointerEvents: показ снимает, peek может вернуть. Display не пишется; pinned узлы пропускаются. Сам новый root этот слой не наследует |
| `role-pin.ts:123–181` | Own inline!important и data-pn-role-pin; production OBS использует hidden/release, не visible-пин. Inline!important сильнее stylesheet!important на том же узле |
| `role-pin.ts:49–64,236–277` | `pn-role-pin-shield` + html data-pn-own-role-hidden: свежая own-role скрыта до heal; lift/release снимают атрибут, restore возвращает |
| `role-faker.ts:238–301` | Peer visibility:hidden!important + marker, snapshots хранят priority; E возвращает своё, не чужие CSS/pin |
| `role-faker.ts:54–84` | `pn-role-fake-shield` + html data-pn-role-faked: новые root без fake, настоящий use внутри сохранённой fake, tooltip и roleReveal скрыты до reconcile |

**Чисто в проверенном src:** игровых role-root inline display писателей нет. Отдельный AST-проход перечислил 167 display/cssText/style-setter/Object.assign sinks по всему src (`src-style-writers.json`), а не только три файла latch-теста. Остальные относятся к собственным панелям/попапу, видео, DOM разбора матча, protocol sprite. Проверены generic style helpers match-stats, camera teardown и match-page `#stop` CSS: новых writers текущей роли из них не установлено.

Visibility наследуется и может переопределяться потомком; opacity:0 предка подавляет всё поддерево. Display-нейтрализатор не отменяет display:none родителя, не создаёт isJudge-исключённую роль и отсутствующую mobile-плитку. Порядок реального каскада проверен в Chrome: native hidden override, peer/fake, новый root/use, tooltip/reveal. Удалённые synthetic D/WeakSet нельзя атаковать как действующий канал. Это не защита от сайта/другого расширения, способного напрямую менять DOM.

### B. Исполнимая таблица состояний

```text
autoHide(2) × phaseSwitch(2) × obsEnabled(2) × autoScenes(2)
× siteModifier(2) × phase(day/night-transition/bootNight)(3)
× scene(NIGHT/DAY/disconnected)(3) × initialNativeFlag(2) = 576
```

Actual: настоящие auto-start/obs-panel/role-pin/role-faker/keyboard/SharedDomObserver. Моки env/messaging, ненулевая геометрия. Native dispatcher — настоящая fixture, vShow-write моделируется микрозадачей. Transport отвечает допустимым not_owner, чтобы не смешивать независимые оси сцены/фазы; stale transports/restore исследованы отдельно. CSSOM evaluator учитывает important и предков, не один ID.

Независимый baseline expected: при активных автосценах видны все только при night+NIGHT; без них phaseSwitch прячет day/показывает night; без фазового владельца initial скрытие задают AH либо native false. D снимает общий CSS, не дневной own-pin; F оставляет peer-hidden, E возвращает роль. Это формула контракта, не импорт production Spec.

| Группа | Запуски | Сравнения | Mismatch |
|---|---:|---:|---:|
| Baseline/native, D, V/blur, F/V/E+icon, remount во всех клетках | 576 | 8064 | **0** |
| Каждый ah/ps/oe/oa OFF/ON под V, pending/settled | 64 | 128 | **0** |
| Marked orphan pin/fake, новое enable/V/release | 8 | 32 | **0** |
| Изолированный/общий teardown под V | 64 | 128 | **0** |
| SPA/reset/reason/old-night/witnesses | 71 | 246 | **70** |
| **Всего** | **783** | **8598** | **70** |

Чисто **в нулевых группах**, не всё декартово произведение всех последовательностей. Settings-подматрица использует native=true/modifier=false; не заявлено пересечение каждого тумблера с каждой миллисекундой, каждым remap и каждым состоянием сервера. Те же результаты получены повторно агентом и основным аудитором.

### C. Время и асинхронность

| Цепочка / окно | Результат |
|---|---|
| Vue flush microtask → immediate MO → paint | Для наблюдаемой мутации действительно до rAF; не спасает отсутствующую запись или неверный target — B01 |
| Старые native restore150×5 / verify500 / retry1000 / rearm600 | **Удалены**, не «чисты при зелёном fuzz». Синтетического двойного D нет |
| Auto night3000, manual backoff2000, slack2500 | Старые pending-manual контроли проходят; OBS epoch через OFF-day — H01, ложная native-команда — H05 |
| Scene-deferred2000 | Остался код; при auto=false scene-safe=true, при auto=true callback отдаёт показ OBS раньше этой ветки. Недостижимую ветку не «оживляли» противоречивым mock |
| Phase150/interval1000, initial2000 | Начальный synchronous enable/update исправен; реальная miss-subtree смена всё ещё delayed |
| OBS detect150+confirm350, pre-day30 | Нормальный pre-day и повторный enable днём проходят; stale completion после await — H04 |
| OBS visibility3000, retries500/250 до5, heal2000 | Обычный night return без starvation чист; H02 — старая очередь, H03 — отрицательный status, B03 — ложная свежесть сессии |
| Status/ACK/list, disconnect/reconnect | Guards старого positive status/SetScene работают; отрицательная ветка, GetSceneList и old-session cache исследованы отдельно |
| Regular rAF/250, background fallback500 | Immediate не ждёт regular throttle, но без характерной мутации нечего доставлять |

Проверены 0/1/16/40/50/100/149/150/250/300/350/400/500/600 мс, 2/2,5/3/3,1/3,5 с и ожидание 12–15 с в перечисленных пробах. Это не исчерпывание всех interleavings. Обычные D через 100 мс после release, быстрый повтор V и старые исправленные гонки остаются зелёными штатными/новыми контролями.

Immediate вызывается до ownRoots-фильтра и без regular cap4000 (`dom.ts:130–145`); его собственная вставка CSS может породить ещё batch, но равный siteFlag и initialized phase делают запись идемпотентной. Самоподдерживающаяся петля не обнаружена. Отдельный Chrome-бенч unrelated class-мутаций: 1000/4000/10000 записей — около **0,2/0,7/2,3 мс** между sentinel-подписчиками (`browser-result.json`). Это одно измерение на этой машине, не гарантия для слабого CPU/реального storm.

### D. Клавиатура

Чисто в исполненных пробах: стандартные D/V, first/repeat/up, Shift, CapsLock после отпускания, русский key при physical code; Ctrl/Meta/Alt-repeat включённого hold; blur/visibility release; input/textarea/select и IME isComposing/229. Физические dead-key/AltGraph/IME/browser UI в двух установленных браузерах не объявлены проверенными.

Для m/l/g/k/r, 0–9, F1–F10 перебраны различные легальные hide/peek/fake/reset, modifier/repeat и embedded native dispatcher. Router-сценарии чисты **без отдельной f5-refresh**; B02 показывает предел такого теста. Pause/outcry/clip с различными нормальными bindings не меняют role-hold. Одинаковые router назначения попап запрещает; crafted-storage коллизии не названы разрешённым сценарием. Mic-sync входит в collision-getters.

Трасса: window capture router → typing/IME gate → swallowed hold / binding / KeyD observer → document capture command timestamp → native document hotkeys → Vue flush → immediate adoption. Новая ошибка этой трассы — H05: доход до document **не доказывает**, что native принял команду. Ошибка второго window listener — B02. Обычные не-D fake/reset могут вызвать также native-функцию сайта; известное fake=Digit1→doAction вне предмета и не насчитано заново.

F не открывает hidden; V под F не раскрывает peer; D/modified-D под F не снимают защиту; пять F-циклов/E и re-render/shields/namespaced xlink/tooltip проверены. «Новая true-role равна выбранной fake» — принятая неотличимость, не новая находка.

### E. Lifecycle

Чисто: обычный F/E и F/disable возвращают свои снимки, native display/priority и чужой CSS/pin сохраняются; новый root/use под fake защищён до callback; смена peek-key отпускает старый hold; marked orphan sweep не снимает live pin этой копии. Отдельный teardown auto-start/OBS/faker и общий teardown под V в 64 запусках не оставили поздних хвостов на +6/+12 с. Каждая включённая скрывающая настройка отдельно OFF/ON под V проверена в заданной подматрице.

Нечисто: B02 настоящий reload из peek; B03 reconnect-свежесть; H01 OFF через новый день; H02/H04 переживший новую фазу pending; H03 поздний status. SPA source-контракт не полон — S1–S4, но реальная full-document навигация не выдана за SPA.

Смерть content-context не равна F5: DOM сохраняет общий hide/override, оба shield-style, html data-pn-own-role-hidden/data-pn-role-faked, inline/data-* на узлах. Новая копия при enable чистит маркированные orphan-пины/подмену; shield-style без html-атрибута инертен. Chrome обычно не внедряет новую копию до F5 (`content/index.ts:253–262`, `orphan-watch.ts:83–101`), старый JS может лишиться OBS messaging; баннер не доказывает fail-safe скрытие. Без реального update это прежняя условная граница, не новая насчитанная утечка. Полный F5 уничтожает DOM/карты. Две вкладки не делят DOM, но делят OBS/фон; ownership сам по себе не доказывает безопасность захватываемой другой вкладки.

### F. Адекватность tests и мутации

**Улучшения признаны, не обнулены:** computed visibility вместо ID; короткие bursts теперь включают phase/scene/D/Ctrl+D; AH проверяется сразу; прежние A11/B17/B21/B22/C01 survivors теперь убивают перенесённые audit3-tests. Настоящие OBS/faker есть в других suites, хотя не в случайном fuzz.

| Ослабление | Проверенный предел |
|---|---|
| `ptt` | Старого blanket bypass больше нет; ограничивает генератор/native combo. Наш CSS-D обязан работать. Физические особенности native engine упрощены |
| `held` | Состояние физической клавиши управляет генерацией, не доказывает фактическое включение peek |
| `showDue` → autoShowDue | Номера шагов вместо Date.now/slack; deferred triggers агрегируются после settle, не независимым эталонным планировщиком. Все точные epoch/race окна не моделируются |
| `peekActive` → spec.peek | Заводится из spec.hidden; под ним итоговая проверка пропускается (`:754–755`), остаётся зеркало. «Обе скрыты под V» может пройти runScenario |
| `sceneRestore` → spec.sceneHide | Старое ослабление заменено reason/cssPre/manualStep, но реальные OBS очередь/ACK/pin/restore не исполняются в fuzz |
| Vtap | Down→40 мс→up без отдельной проверки обязательной видимости внутри 40 мс |
| 12 с и sampling | Одиночные шаги всё ещё settle12s, выборка50/250; burst gap0–299. Это не дедлайн ≤300 и не запрет каждого кадра. Между выборками возможна невидимая тесту вспышка |
| Модель сайта | Handwritten hotkeys, искусственный `.textContent`; не полный Vue/renderer и не все штатные события/модификаторы |
| OBS/faker | В fuzz safe/auto/2с poll и всегда faker=false: нет настоящего pin, shields, F/use/tooltip, session/list/status/ACK. Импорт role-pin не создаёт пины без владельца |

Контрольные oracle-мутации: Q01 «V вообще не снимает CSS» пережил основной random/runScenario набор, но убит standalone V assertion того же файла; Q02 пустой hide stylesheet — 31 FAIL; Q03 пустой override — 6 FAIL; Q04 искусственный 50-мс CSS-gap между +1000/+1250 — **31 PASS fuzz**, но полная suite **1823 PASS / 3 FAIL**. Последнее доказывает кадровую слепоту конкретного fuzz, не слепоту всей suite и не наличие такого искусственного окна в HEAD.

#### Каждый исторический смысловой откат по одному

Каждый заново применён к этому HEAD в отдельной mutation-copy. Targeted-профиль: **26 файлов / 347 baseline PASS**, включая все committed audit2/audit3-пробы; fuzz60 seeds, не5000 на каждом мутанте. Survivors затем получили весь исходный npm test. Новых audit4-probes среди killers нет. Слепой revert целого старого commit не выполнялся. Source-guard kill не назван поведенческим browser-proof.

K — killed, S — survived; A=auto-start-accept, L=obs-role-latch, F=fuzz, P=role-pin, R=role-faker, Kb=keyboard, A2/A3=указанные committed audit2/audit3 suites. ID ниже — **мутанты, не находки**.

| ID / commit | Возвращённый смысловой дефект | Итог / реальная защита |
|---|---|---|
| A01 / 057ded0 | Native-hidden helper только #stop | K: P; **helper больше не вызывается production**, не защита live adoption |
| A02 | Inline show снимает display | K: L/A/F |
| A03 | Inline hide пишет display:none | K: source L |
| A04 | Visible pin снимает display | K: L/P |
| A05 | Lift снимает display | K: L/P |
| A06 | Release возвращает stale display | K: L/P |
| A07 | Faker прячет peers через display | K: L/R |
| A08 | E возвращает stale display, оба snapshot-пути | K: source L |
| A09 | Adoption не читает native display:none | K: F/A и другие |
| A10 | Нет реальной нейтрализации native display | K: F/L и другие |
| A11 | E теряет visibility priority | K: A3-test-faker-priority |
| B01 / f3988e6 | Active hold-down доходит сайту | K: F/Kb |
| B02 | Active hold-repeat доходит сайту | K: A2-keyboard-verified/Kb |
| B03 | Active hold-up доходит сайту | K: Kb |
| B04 | Пустой hold глушит native camera | K: A2-keyboard-verified/Kb |
| B05 | V-up не возвращает CSS при settings OFF | K: F/A |
| B06 | V-up игнорирует manual-night | K: F/A |
| B07 | V-up передаёт sceneSafe=true | **S, 1826 PASS**; последующий синхронный gate компенсирует видимость; глобальная эквивалентность всего state не доказана |
| B08 | Native modified D не отмечается manual | K: F/другие; синтаксически невалидный первоначальный опыт исключён, корректный перезапущен |
| B09 | Default D-repeat доходит сайту | K: F/Kb |
| B10 | Modified D-repeat доходит сайту | K: F |
| B11 | Own hidden-pin блокирует общий Show | K: A2-keyboard-verified/A/F |
| B12 | Night callback игнорирует manual старше backoff2000 | K: F/A2-scene-belt |
| B13 | Нет подписки auto-start на scene gate | K: F/OBS integrations |
| B14 | Heal не уведомляет gate | K: A2-obs-async/OBS integrations |
| B15 | Нет pre-day notification | K: outbound-day A2-obs-async/OBS integration |
| B16 | Scene-off не скрывает после manual | K: F/OBS |
| B17 | Нет sync scene на V release | K: A3-adoption/A3-test-real-obs |
| B18 | Нет pin shield | K: P/A2-fake-lifecycle |
| B19 | Нет fake shield | K: R/A2-fake-lifecycle |
| B20 | stopPeek(true) заменён обычным stopPeek | **S, 1826 PASS**; старый native-хвост удалён, возможный новый sceneHide-state эффект не разрешён witness-пробой; не объявлен эквивалентным |
| B21 | NightShow не снимает scene-only hide | K: A3-test-real-obs |
| B22 | Disable оставляет scene listener | K: A3-test-real-obs |
| B23 | E/disable оставляет fake shield | K: R/A2-keyboard |
| B24 | Release оставляет pin shield | K: P/A2-obs-async |
| B25 | Lift оставляет pin shield | K: P/A3-keys-lifecycle |
| C01 / f3988e6 | RestoreLiftedPins не перевзводит shield | K: A3-test-restore-shield |
| C02 | Нет reset deferred-log | **S, 1826 PASS; obsolete/equivalent**: true-writer теперь недостижим |
| C03 | Site modified D пропущен под V | K: F/другие |
| C04 | Site modified D пропущен под F | **S, 1826 PASS**; действующий guard не закреплён этим исходным гейтом |
| C05 | Release не удаляет swallowed-state | K: Kb/F/A2 |
| C06 | Старая off-функция стирает новый listener | **S, 1826 PASS**; API-контракт, production stale-off единственного consumer не установлен |

**Итого 37 raw K / 5 S:** B07, B20, C02, C04, C06. Дополнительный D01 из f3988e6 — убрать try/catch из notifyRoleSceneGate — тоже **S / 1826 PASS**, API fault-containment, не новый баг HEAD. A01 — raw K мёртвого production helper; нельзя превращать 37/42 в процент защиты пользователей. Удалённые native-dispatch, Ctrl+D-пара, marker/suppression250, native restore150×5, rearm600 и tracked-toggle перечислены как **obsolete**, не возвращены целой старой архитектурой ради красивого killed-счёта.

Точные patches/команды/kill assertions: `mutation-results.json`, `mutation-logs/`, `tests-findings.md`. После снятия мутаций обе копии чисты по tracked inputs; финальный исходный прогон снова **119 файлов / 1826 PASS**. Survivors — пробелы/избыточность/API-границы тестов, **не пять новых production-дефектов**.

## 6. Что нельзя доказать без живой игры; точный ручной чек-лист

Без установленного расширения и живой комнаты не доказаны: серверные permission/reveal/card/phase sequences, реальная доставка keyboard/default actions/IME, Chrome/Firefox extension update, две реальные вкладки/ownership, OBS latency/emission-order/transition pixels и захваченные Program-кадры. rAF/computed style не заменяют покадровую запись.

Проверять **локальной записью, не публичным эфиром**, одновременно окно игрока и Program, отдельно Chrome и Firefox. Нужны собственные сохранённые настройки и чистый профиль, 60/30fps покадровый просмотр с метками времени.

| Действие | Должно быть на экране / в записи |
|---|---|
| AH+phase ON, OBS auto OFF; завершить настоящую ночь промахом | Ни одного дневного кадра с own/peers/reveal; скрытие уже на первом кадре «Промах» |
| Обычная ночь→утро с разными nightAction/countdown, записать MutationRecord | Установить реальную Textnode-only последовательность; роли скрыты к первому дневному кадру |
| Peek=F5, f5-refresh ON; D-hide → F5-hold → release | Это именно peek; после release исходное hide, нет незапрошенного reload и открытого хвоста |
| OBS NIGHT → обрыв → вручную DAY во время разрыва → reconnect + F5 до ответа списка | До свежего подтверждения приватной сцены скрыто всё; старый NIGHT другой session не разрешает show |
| Активные auto/integration с незаданной NIGHT; либо явно очистить NIGHT и разорвать связь | По данному оракулу все роли остаются скрыты, в Program не происходит auto-show |
| NIGHT, D-hide → OBS auto OFF → DAY → новая NIGHT → auto ON | Показ новой ночи приходит без D/F5; старое ночное D её не блокирует |
| NIGHT→DAY→V-down→NIGHT, держать >3 с→игровой DAY→V-up; day scene пустая/другой владелец | После DAY `[own hidden, peer hidden]`, нет устойчивого зеркала от queued nightShow |
| Показать OBS panel при disconnect; reconnect во время status request | Запоздалый отрицательный status не стирает новую NIGHT и не прячет роли навсегда |
| NIGHT-command/event в пути → новый игровой DAY → поздний ACK | Старый успех не создаёт ночной show после day; own и peer остаются согласованы |
| В лобби modifiers ON: Ctrl+D hide → наш D show → написать «в» в заметке → раздача | Первое native-hidden монтирование не отменяет последний явный Show; повторить с посторонней зажатой клавишей и Ctrl+D |
| Переименовать другую сцену/GetSceneList параллельно ручному NIGHT→DAY | Зафиксировать фактический response/event order; старый список не возвращает кэш/роли на NIGHT при actual DAY |
| D через 50–100 мс после V-up; быстрый V, modifiers/repeat/PTT/Alt-tab | Exact restore, без мигания и позднего самопереключения |
| Каждый тумблер по одному под V и в ночном pending, затем disable каждой фичи | Выключенные auto-слои не воскресают; manual сохраняется; чужие живые слои не уничтожаются |
| F→hover/check/root/use replacement→E; F+V | Настоящие use/tooltip/reveal не проступают; peer скрыт под F, E возвращает текущую роль |
| Viewer reconnect, legacy/modern dealing, публичные итоги | Установить повторность permission и приватность поверхностей вне span; не путать публичный результат с секретом |
| F5, новая игра той же комнаты, extension update ночью/под V | Различить новый документ и живой orphan; нет старых активных щитов и устаревшего доверия NIGHT |
| Две вкладки одной комнаты/разных игр, активная/свёрнутая, захват другой вкладки | Ownership/сообщения не раскрывают захватываемый DOM; реальные handoff измерены |
| Длинный fade >3 с и Studio Mode | Имя NIGHT не принимается за доказательство отсутствия игрового изображения в transition-кадрах |
| Ролевая раздача со звуком | Отдельно проверить захватываемую аудиодорожку: визуальный CSS её не защищает |

## 7. Вердикт

**К релизу с гарантией «роли никогда не появляются и не исчезают сами» сборка не готова; уверенность в отрицательном вердикте — 99%.**

Основание — повторяемые production-контрпримеры, независимые свидетели/положительные контроли, скачанные настоящие Vue/Room/renderer/hotkeys и реальный Chrome. Это уверенность в **опровержении**, не процент покрытия и не обещание отсутствия других багов. До 100% не доводят отсутствие авторизованной живой игровой/OBS-записи, физической проверки обоих браузеров и исчерпывающей проверки серверных/транспортных последовательностей. Зелёные 1826 тестов и 5000 сценариев этого противоречия не устраняют.

## 8. Статус исправлений (21.10.2026, после отчёта)

Все 18 красных проб аудитора воспроизведены на HEAD до правок и зелёные после. Пробы перенесены постоянными тестами `tests/unit/audit4-*` (записи файлов — только по `AUDIT4_OUTPUT`); пробы с полным бандлом сайта (1,6 МБ: настоящий Vue/Room/«Промах») прогнаны с обращёнными утверждениями и не коммитились — hotkeys-js и vShow взяты из сохранённых фрагментов `tests/fixtures/bundle-snippets/`.

| Находка | Статус | Что сделано |
|---|---|---|
| B01 «Промах» | исправлено | Немедленный детектор фазы реагирует на роллер, этап, `.ended` и класс body/html (`SITE.rolePhaseHost`, добавленные/удалённые узлы); общий наблюдатель доставляет characterData **только немедленным** подписчикам — Text-узел подписи этапа тоже до кадра (§2.2 условный день закрыт). На настоящем Vue-рендере сайта скрыто уже в том же батче MO |
| B02 peek=F5 | исправлено | Фикс F5 не трогает клавишу, назначенную нашим хоткеем (`keyboard.isBound`) и уже обработанное событие; проверено и в настоящем Chrome |
| B03 сцена старой сессии | исправлено | Разрыв сокета обнуляет `currentScene`: новая сессия знает сцену только из своего GetSceneList/события |
| B04 ночная сцена не выбрана | исправлено (fail-closed) | При автосценах без выбранной ночной сцены автопоказа нет (показать — D); подсказка в попапе. Прежний закреплённый тест переписан |
| H01 день при выключенных автосценах | исправлено | День, распознанный автосменой, заканчивает ночь OBS; начало ночи раньше этого дня заменяется нашим распознаванием ночи |
| H02 nightShow под V после дня | исправлено | `beforeDayScene` и распознанный день очищают и очередь nightShow под V |
| H03 устаревший отрицательный статус | исправлено | Эпоха `sceneInfoEpoch` сверяется и в ветке «не подключено» |
| H04 поздний успех NIGHT | исправлено | Показ после успеха смены сцены — только если ночь ещё идёт; таймер видимости пересчитывает и фазу |
| H05 печать D / отвергнутая комбинация | исправлено | Команда ролей сайту — только та, что он примет: не поле ввода, не IME, D — единственная зажатая не-модификатор (свой учёт зажатых на window) |
| C01 устаревший GetSceneList | исправлено | Ответ списка не пишет текущую сцену, если за время запроса пришло событие сцены или сменилась сессия |
| S1 первая/та же комната | исправлено | Новая игра — любой вход в комнату с другого пути |
| S2 стол без маркеров этапа | исправлено | Немедленный детектор видит вставку этапа; при сбросе фаза применяется сразу |
| S3 ручное/снимок V между играми | исправлено | Сброс: скрывает только настройка (и под V, зажатой в прошлой игре) |
| S4 OBS и новая комната | исправлено | obs-panel сбрасывает фазу/начало ночи/отложенный показ при смене комнаты (подписчик и 2-с опрос), отложенный показ сверяет путь |
| Мутанты C04/C06/D01 | закрыты тестами | `audit4-survivors.test.ts` |
| B07/B20/C02 | оставлены | Компенсированы последующим синхронным гейтом / удалённый путь / недостижимо |

Матрица аудитора: **576 клеток, 783 запуска, 8598 сравнений — 0 несовпадений** (было 70). Мутации исправлений: 21 одиночный откат — 19 убиты, M19/M20 (сброс фазы obs-panel в подписчике / проверка пути в таймере) перекрывают друг друга и 2-с опрос; парой и тройкой убиты. M8/M9 одиночно убиты только source-guard, парой — поведенческими H04. Полный набор 127 файлов / 1905 тестов, typecheck, build — чисто.

Принятые ограничения нового кода: D в readonly-поле сайт принимает, мы командой не считаем (направление «от игрока»); две смены pushState без мутации DOM между ними — один переход. Живой игрой и записью Program не проверялось — чек-лист §6 остаётся в силе.
