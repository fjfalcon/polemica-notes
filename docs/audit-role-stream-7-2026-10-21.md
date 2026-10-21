# Седьмой внешний аудит видимости ролей — 21.10.2026

## 1. Сводка и границы доказательства

Проверены `main`, HEAD **`d71bc30cdaa7ff2fce55b98a667de3248c13270c`**, версия 9.67.0. Утверждение «роли никогда не появляются и не исчезают сами» **опровергнуто**. Исправления шестого аудита присутствуют; находки ниже — соседние пути, а не пересказ закрытого списка.

Основной счёт: **3 БЛОКЕРА «в эфир», 1 ВЫСОКАЯ «от игрока»**. Обратный эффект одного блокера — постоянное скрытие после выключения настройки — отдельно не суммируется. Дополнительные условные контрпримеры и смежный клавиатурный дефект вынесены из основного счёта: их недоказанные предпосылки названы явно.

«В эфир» здесь означает запрещённую видимость захватываемого игрового источника. Для B01/B03 смоделирован Program=DAY и отдельно измерена видимость в настоящем Chrome. **Настоящие Program-пиксели, установленное расширение и реальный серверный матч не записывались.** Ни один jsdom/transport/CSSOM результат ниже не выдан за такую запись.

| Проверка исходного HEAD | Результат |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm test` | **147 файлов, 2097 PASS**, 22,72 с |
| `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **32 PASS**, все5000×25 шагов; 847,64 с, без изменения таймаута/оракула/генератора |
| Все новые пробы, финальный общий повтор основным аудитором | **516 тестов: 443 PASS / 73 FAIL**, 8 файлов |
| В том числе проверки настоящего frontend/dispatcher | **10 тестов: 8 PASS / 2 условных FAIL**; включены в516, не прибавлены повторно |
| Прежняя матрица настоящих владельцев | **576 клеток, 1011 запусков, 10014 сравнений, 0 расхождений** |
| Новая native-command матрица | **288 клеток, 3600 сравнений, 0 расхождений** |

73 красных теста — **не 73 дефекта**. Это параметры общих причин, условные клавиатурные границы и контроль потери keyup. Подробный счёт находится в §5B/D/F. Конфигурационные пространства старой и новой матриц пересекаются: 576+288 не объявлены числом уникальных настроек. Условные находки: C01/C03/C04 — HIGH, C02 — privacy BLOCKER при наличии readonly-поля; они **не добавлены** к основному production-счёту. Основной счёт не содержит MEDIUM/LOW дефектов именно видимости.

### Сохранность и артефакты

Production, существующие тесты, зависимости, версии и настройки оригинала не менялись. Единственная разрешённая запись в репозиторий — этот отчёт. Исправления, предложения патчей, коммиты и релиз не выполнялись.

Далее `AUDIT/`:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit7.Ah8L4g/
```

`repo/` — полная временная копия. Все пробы, скачанные бандлы, браузерные профили, JSON и логи находятся только там или рядом в `AUDIT/`; исторические мутации выполняются в отдельной копии. Пять специализированных срезов: сайт, OBS, клавиатура/подмена, матрица, оракул/мутации. Шестой независимый проверяющий отдельно атаковал boot-свидетель B02, включая реальный popup-flow. Основной аудитор перечитал критические трассы, повторил все новые suites и выполнил браузерные проверки B01/B03.

`integrity-before.json` и итоговый `integrity-final.json`: **все 355 tracked-файлов** оригинала и копии совпадают с начальным SHA256; различий нет. `git status` оригинала показывает только новый файл этого отчёта. Новые пробы не подменяют старые. Перечисленные в задании production-файлы и тесты прочитаны целиком в соответствующих срезах. `src/content/native-role-toggle.ts` на HEAD **отсутствует**: synthetic-toggle архитектура удалена, WeakSet/synthetic Ctrl+D не существует. Временный loopback-сервер браузерных проб остановлен.

`evidence-manifest.json` содержит SHA256 новых probe-файлов и основных логов/JSON. Заключительный независимый reviewer сверил основной счёт, направления, captured-menu цепочку, все числовые результаты и границы Program-доказательства; существенных errata не нашёл. Отдельный повтор manager/barriers/epoch-loss дал19 тестов:3PASS/16FAIL, как в итоговой таблице.

Обозначения: `00` — обе роли скрыты, `11` — обе CSS-renderable, `01` — own скрыта, peer виден. Это не автоматически означает пиксель в настоящем OBS Program.

## 2. Самостоятельно проверенная модель сайта

Свежие публичные файлы скачаны заново; это та же сборка, а не drift:

| Файл `/room/bundle/…` | Байты | SHA256 |
|---|---:|---|
| `main.js` | 1634594 | `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` |
| `style.css` | 144788 | `0fad7192be03b25aff9faab92d943c34ec0018a3ee06cbf660892230f89e7976` |

Все offsets ниже — **0-based UTF-8 bytes**, не индексы UTF-16. Артефакты: `audit7-site-independent-scan.json`, `audit7-site-report.md`, `repo/tests/unit/audit7-site-{hotkeys,stale-day}.test.ts`.

### 2.1. Все записи флага и все установленные поверхности

| Offset / маркер | Проверенный факт |
|---|---|
| 1201610, `roleDisplay:!0` | Начальное true |
| 1203979, `updateRoleDisplay:function(e){e.roleDisplay=!e.roleDisplay}` | Единственная запись существующего флага; payload игнорируется |
| 1337694, `commit("updateRoleDisplay",!1)` | Разовый viewer permission в on_connect_room; это **переворот**, не set(false) |
| 1599375/1599405, `toggleRolesDisplay` / commit | Другой и последний commit-site; сюда приходят D и меню |
| 1399308, `roleDisplay:{type:Boolean,default:!0}` | Prop Player, не запись Vuex |
| 1418919, `e.role&&!o.isJudge` | Условие существования role-span |
| 1419196, `[[za,e.$store.state.roleDisplay]]` | v-show каждой роли; mount и смена флага |
| 1129246, `Ha(e,t){e.style.display=t?e._vod:"none"}` | Обычный inline display, не important |
| 1419148, `role_tooltip(e.role,o.itsMe)`; 1388664, Tooltip renderer | Подсказка вложена в role-span, не Teleport |
| 1353977/1383412, `addNotification("roleReveal")` / `case"roleReveal"` | «Игрок является …»; покрыто `.notifications-block .roleReveal` |
| 1621315, `connectedToRoom]]` | Независимый v-show предка; override ребёнка его не отменяет |

Других записей/сбросов roleDisplay при новой игре, стадии, streamerModeStatus или forcePlayersVisibility AST/лексический проход не обнаружил. True→true смена role может сохранить root и заменить значок; false→role, isJudge и пересоздание плитки заменяют root. У этого span есть class-binding, но нет конкурирующего visibility/opacity style-binding. Mobile использует тот же Player.

`gameView`/adapter меняют наличие и содержание роли, а не флаг: `gameView:null`1202254, `setGameView`1205965, socket events1339432, Room watcher1588477, adapter1576513, mapper1585162. Отсутствующую роль CSS не создаёт. streamerModeStatus/forcePlayersVisibility меняют overlays/streams/menu (`1204470/1204533`, `showPlayerState`1403414), но не отменяют отдельный role-span.

Поверхности **вне** Player-role: legacy CardSelect (`selectedRoleCode`,1559347–1560551; `on_self_role_defined`,1348149) и postgame `role-icon`1564779. Их существование подтверждено, актуальная серверная выдача секретной legacy-карточки или преждевременной приватной postgame-статистики — нет. Они не названы новыми безусловными утечками. Сайт выбирает role-specific звуки; содержание и реальная OBS-дорожка не проверены, визуальная защита звука не доказывает.

### 2.2. Уточнения прежней модели, существенные для доказательств

1. **Не «модификаторы синхронизируются на каждом событии».** У native dispatcher `xh`1218591 сначала `gh.filter.call(this,e)`1218653; только внутри него insertion1218707 и modifier sync1218747. Обычный чат не засоряет `lh` до фильтра. Readonly разрешён; keyup cleanup1220444 выполняется и после отклонённого фильтром up. Exact-set1219683, Meta-tail1218909, focus-reset1220405 и registration-reset1219735 подтверждены исполнением настоящего кода.
2. Room.addHotKeys1614011 использует `keyCode||which||charCode`; useHotKeysModifier1614716 даёт Ctrl/Command. Принятая обёртка1614813 — `return event.preventDefault(),n(),!1`, то есть cancel+stop. Native V1614119 отменяет событие даже когда camera action запрещён; togglingStreamAvailable у modern adapter доступен в ожидании/наборе или paused judge1583352. Это не любой live V.
3. **DAY/nextNIGHT не доказывает, что день ложный.** Speech adapter1579415 зовёт on_start_day1590326 (`isNight=false`), а mapper1583735 допускает next toNight→evening. Desktop1425257/1426347 тогда рисует настоящий DAY/nextNIGHT, который `staleDayLabel()` считает stale. Обычные toDay→speech и speech→speech дают day/day и корректно подтверждаются. Вред требует, чтобы это был первый/единственный увиденный DAY до следующей ночи; серверная достижимость именно этого условия не установлена (§4C).
4. **Обычный setStage не доказан как 250-мс окно.** `rollerInitialized:false`1432528 имеет только два чтения1436802/1436931 и ни одной установки true. На установленном bootstrap-пути задержка setStage — **0 мс**. Пробы с принудительным true исполняют другую ветку метода; их 250 мс нельзя выдавать за обычный live timing. Фаззер не моделирует этот полноценный Roller, поэтому это уточнение не превращено в самостоятельный runtime-блокер.

Застрявший current после toNight остаётся настоящим frontend-путём: callback `case"evening":return`1591114 не переписывает current после countdown. Но для **двух** экскурсий или clearDAY-префикса в окне OBS нужны дополнительные условия; они разобраны отдельно, а не объявлены естественным следствием любого countdown.

## 3. Основные находки

### B01 — БЛОКЕР, «в эфир»: D/V внутри 30-мс pre-day ожидания обходит новый барьер

**Строки:** `src/content/panels/obs-panel.ts:844–879,1283–1293,1400–1420`; `src/content/features/auto-start.ts:1313–1320,1691–1720`.

`lastPreDayAt` отмечает, когда скрытие **начали**, а не продолжает ли оно держаться. Между ним и отправкой DAY есть await30ms. Новый `autoSwitchScene` пропускает барьер, если эта отметка моложе100ms — даже если игрок за это время уже показал стол.

Настройки: OBS integration/auto ON, AH/phase OFF, штатные D/V; игровая NIGHT и приватная NIGHT до перехода.

```text
t=0:    подтверждён DAY; beforeDayScene скрывает00; началось await30
t=10:   D-show →01 (own под дневным пином), либо V-down →11
t=30:   autoSwitchScene(DAY) считает pre-day «свежим» и шлёт DAY с01/11
+16/32/48/100 после DAY: 01 для D, 11 для V
+200:   доставлен scene event/ACK; V наконец скрывается00
+12с:   D-вариант всё ещё01 — manualMark запрещает heal скрывать peer
```

Человек показывал стол, пока эфир оставался на приватной NIGHT; это **не** разрешение унести его на автоматически наступившую DAY. Нажатие не меняет поколение настроек/комнаты, поэтому autoGeneration guard не помогает.

**Доказательство:** `audit7-obs-barriers.test.ts`, пары `pre-day must remain hidden if KeyD/KeyV starts during render wait` и `REAL ObsClient pre-day … before any scene echo`. Настоящий ObsClient, op6/op7 и scene event; WebSocket-сервер моделирует немедленный переход Program и200-мс задержку ответа. Основной аудитор повторил: четыре FAIL, outbound D=`[false,true]`, V=`[true,true]`; D сохраняется после12с.

Отдельно **Chrome155.0.8059.79**, настоящие production controllers/ObsClient и весь свежий CSS сайта, без установленного расширения: `browser-results.json` подтверждает эти же состояния на DAY+16/+32/+48/+100; D остаётся01 на+2300, V после ответа становится00. События ввода и transport синтетические. Headless virtual-time **не дал rAF-снимков**: это timed CSSOM-проверка многокадрового окна, не измерение compositor/Program.

Отличие от audit6 B02: caller теперь действительно проходит pre-day; его результат отменяется **внутри собственного await**, а timestamp заставляет следующий барьер поверить старому результату.

### B02 — БЛОКЕР, «в эфир»: privacy-настройка, сохранённая во время первоначального запуска, теряется навсегда

**Строки:** `src/core/feature.ts:47–60,96–106`; `src/content/index.ts:56–65`; фактический notes-await — `features/player-notes.ts:391–394,2335–2337`, `player-notes/notes-model.ts:186–187`, `core/notes-store.ts:654–658`.

FeatureManager подписывается на настройки **после await всего первого sync**, не до него. Раннее включение OBS/auto-start исправило старый B04, но не это окно потери новых изменений.

```text
t=0:     прочитано AH=false, phase=false, OBS-auto=false; privacy owners уже включены
t=100:   player-notes ждёт реальный storage.read; роли11
          popup сохраняет AH=true (либо OBS-auto=true при integration ON)
          storage.onChanged доставлен сейчас: manager ещё не подписан
t=500:   чтение заметок заканчивается; start завершается и лишь теперь подписывается
t=12,5с: на диске true, в privacy config старое false; роли11
          поздний updateNotesSettings и посторонний settings patch это не исправляют
```

Обычный popup не обходит проблему: `popup/index.ts:1734–1759` пишет diff через setSettings, затем1782–1787 рассылает updateNotesSettings. Получатель `player-notes.ts:440–468` меняет только собственные настройки, к тому же регистрируется после notes-await; auto-start/FeatureManager его не обрабатывают. Даже повтор успешной доставки сообщения после boot не помогает.

**Доказательство:** `audit7-manager-boot-settings.test.ts` — **6 FAIL /1 PASS**. Реальные FeatureManager, settings writer/parser, privacy owners, player-notes и SharedDomObserver; моделируется только extension I/O. Две пробы `RED real setSettings and popup broadcast cannot repair lost …` проходят весь сохранённый patch + точный popup-message; лог:

```json
{"realSetSettings":true,"popupDelivered":true,"key":"auto_hide_roles_enabled","persisted":true,"bits":"11"}
{"realSetSettings":true,"popupDelivered":true,"key":"obs_auto_mode_enabled","persisted":true,"bits":"11"}
```

Положительный контроль: тот же patch после законченного boot даёт00. Независимый reviewer подтвердил причину и отсутствие popup-обхода. Задержка чтения управляемая, реальная частота окна не измерена. Доказательство не требует спорного лимита300ms: **сохранённое скрытие не применяется и после конца запуска**.

Обратный вариант той же причины, **ВЫСОКАЯ «от игрока»**: AH=true при boot, OFF сохранён в окне → после12с всё ещё00, нужен повтор изменения/F5. Отдельно не суммируется. Phase-only проба тоже красная для sync/import/direct writer, но не названа обычным popup-сценарием: popup1703–1705 сохраняет phase только вместе с AH.

### B03 — БЛОКЕР, «в эфир»: защита V расходуется первым уходом со сцены и не действует на второй

**Строки:** `src/content/features/auto-start.ts:907–925,657–664,1281–1300`, особенно1296–1298; own-only pin — `src/content/panels/obs-panel.ts:741–781`.

`peekSceneSafe` при первом уходе с NIGHT превращается в false и не перевзводится при возврате сцены. Это теряет факт «данная V началась на безопасной сцене». Принятый через меню ручной SHOW может снова открыть стол под этой V; следующий уход скрывает только own.

Точная последовательность, OBS auto ON, phase OFF:

1. Settled NIGHT11; меню сайта Hide→00, native flag=false.
2. V-down на **безопасной NIGHT**→11.
3. Глобальная ручная DAY без blur→00: первый fail-safe исправно работает и ставит peekSceneSafe=false.
4. Не отпуская V, вернуть NIGHT; подождать4с. Меню сайта Show на приватной сцене переключает native false→true; auto-start принимает решение и открывает11.
5. Снова DAY глобальным OBS-хоткеем/Stream Deck, V всё ещё та же: own-пин срабатывает, peer остаётся виден. **01 на+100 и+12100**, ожидается00.

Это не V, изначально начатая на небезопасной сцене, и не повтор старого audit6 B01: **первый** уход в пробе чистый. Ручной показ происходил на вернувшейся приватной NIGHT, а не был разрешением на будущую DAY.

**Доказательство:** `audit7-obs-barriers.test.ts > REAL ObsClient repeated departure under same safe-started V must protect after native menu Show`, повтор основным аудитором: FAIL01. Настоящие transport/owners; menu-вызов моделирует подтверждённый frontend-путь toggleRoles→toggleRolesDisplay→v-show microtask.

Дополнительная независимая пара `independent captured-site menu chain … post-return Show=false/true` исполняет **сами скачанные** menu method, Room method, Vuex mutation и Vue display writer, включая click по настоящей структуре li/span. Без post-return Show второй уход00 — PASS; с Show01 — FAIL на+100/+12100. Это закрывает сомнение «проба выдумала особую команду меню».

Chrome-повтор с теми же controllers и свежим CSS: `browser-results.json.repeat`: первый DAY00; возвращённая NIGHT и menuShow11; второй DAY01 на0/+16/+32/+48/+100/+250/+2300. Нет утверждения о trusted input, installed world или записи Program.

### H01 — ВЫСОКАЯ, «от игрока»: свежий live-phase refresh при повторном включении OBS обходит staleDayLabel

**Строки:** `src/content/panels/obs-panel.ts:1231–1236` против `1822–1839`; соседний необработанный reader — `1270–1285`.

В обычном evaluateTimeOfDay stale DAY при запомненной NIGHT заменяется на NIGHT. Но повторное включение автосцен читает **сырой** detectTimeOfDay и записывает DAY сразу; затем вызывает pre-day и переключает OBS на DAY. Дальше обычный guard уже не действует: currentTimeOfDay стал day, а он требует night.

```text
settled NIGHT11 → auto OFF
реальный для Roller вид current=DAY / next=NIGHT (старая подпись этой ночи)
+50ms: auto ON, live refresh записывает DAY
+6с:   OBS=DAY, роли00; само не возвращается, пока подпись не сменится на явно ночную
```

**Доказательство:** `audit7-obs-barriers.test.ts > reenable with stale DAY label must not treat remembered NIGHT as a new day` — FAIL: DAY-команда, scene=day и00 вместо private NIGHT/11. После явно ночной подписи роли возвращаются: это не «навсегда при любых событиях», но **не возвращается без требуемой смены фазы/ручного действия**, то есть HIGH по рубрике задания, а не просто MEDIUM задержки6с.

Существенно не само число6с: в этом профиле phaseSwitch=false, и ошибка **меняет запомненную фазу, уводит сцену на DAY и теряет night epoch**, а не просто временно накладывает принятый защитный CSS на stale-подпись. Только ожидание короткого скрытия не было бы достаточным основанием для этой HIGH.

Дополнительный reader того же семейства: DAY-confirmation взведён на clearDAY; через400ms next становится NIGHT; callback1270 повторяет raw detect и подтверждает уже staleDAY. Проба `stale day label arising inside confirmation delay …` тоже красная. **Достижимость именно clearDAY-префикса на настоящем frontend в окне подтверждения350ms не установлена** (§2.2); обычное истечение toNight countdown само её не доказывает.

Обратная сторона установлена дополнительным transport-свидетелем `audit7-obs-epoch-loss.test.ts`: до обхода игрок скрыл00 и прошло3с; ложный DAY при phaseSwitch=false зовёт `endObsNight()` (`auto-start.ts:1305`). После6с stale-подписи приходит явно ночной пакет **той же ночи**; новое nightSince делает прежний Hide «старым», а nightShow открывает11 (`1365–1401`). Control-no-day PASS00; raw-confirm/raw-reenable FAIL11. Финальные Program/client=NIGHT: **публичный DAY-кадр этим дополнительным свидетелем не доказан**, отдельный блокер ему не присвоен. Но это уже не только допустимое «подождать следующего пакета»: пакет меняет ручное решение. Основная HIGH относится к устойчивому нежелательному скрытию/смене сцены выше; направление дополнительного запрещённого SHOW источника — потенциально «в эфир», не «от игрока».

## 4. Условные контрпримеры и исключённые завышения

### C01 — условная ВЫСОКАЯ, «от игрока»: повтор переходного DAY уничтожает сохранённый SHOW

**Строки:** `auto-start.ts:1174–1177,1193–1201,1210–1211,1047–1074`.

PS ON, settled NIGHT; D-hide в8000, D-show8100→11; staleDAY8200→00; NIGHT8800 (restore ждёт11800); второй staleDAY8900 отменяет restore и заново снимает preDayVisible **с временно скрытого DOM**; NIGHT9500. На12516 и24516 всё ещё00, нужно D. Ожидается восстановление11 через3с после последнего transient. Автоматический prior SHOW при OBS даёт тот же результат без D: OBS остаётся NIGHT и не присылает новый nightShow.

`audit7-matrix-transients.test.ts`: manual-семейство **32 FAIL/96**, automatic **16 FAIL/48**; все48 — одна причина. Gap100/600ms красный, gap3000ms зелёный: первый restore уже успевает сработать. Все HIDE-контроли и96 D-recovery controls зелёные. Основной аудитор повторил все459 новых matrix-cases.

**Почему условно:** обычный monotonic toNight→shooting→checks с nightAction=null второго возврата старого DAY не объясняет. Установлен frontend-вход повторным roomState того же toNight (watcher1588477, adapter1578988): новый countdown маскирует старый current, затем expiry вновь его показывает. Но требуется повторный timer.duration **меньше3с**; такую серверную выдачу не измеряли. Нельзя заменить реальный8-секундный countdown искусственными100ms и объявить live-достижимость доказанной. `nightAction` — другой возможный mask, его нужная modern-последовательность также не доказана.

### C02 — условный БЛОКЕР «в эфир» / HIGH «от игрока»: readonly после начала V/F обходит защиту

**Строки:** `keyboard.ts:64–70,90–103`; `role-faker.ts:31–39,149–154`; native readonly-filter, bundle1221065.

Настоящий hotkeys-js допускает readonly input, наш роутер считает его typing и выходит **до** swallowed/V/F/repeat guards. Native=false, hidden00, hide=H; V-down вне поля→11; фокус readonly без window blur; Ctrl+D в поле принят сайтом; V-up оставляет11 на12с вместо00. Вариант F→readonly Ctrl+D→E тоже оставляет настоящие11; repeat и peek=D имеют отдельные красные параметры. Ordinary editable-input контроли чистые.

Пробы: `audit7-keyboard-boundaries.test.ts`, семейства `privacy: ordinary physical D … readonly`, `privacy: peek remapped D …`, `held V … readonly`. **Предпосылка не установлена в текущем UI:** свежий room bundle и extension src не создают readonly input/textarea; его создаёт проба. Поэтому это доказанная граница API/совместимости, **не безусловный текущий production-блокер** и не обычный текст в чате.

### C03 — условная ВЫСОКАЯ «от игрока»: cancel+stop не уникален для команды ролей

**Строки:** `auto-start.ts:606–615,638–647,1770–1795`.

Без roots: настоящий native Hide; +1с наш H-show; +1с wrong-profile Ctrl+D отклонён native, но **другой document listener** делает preventDefault+stopPropagation; +1с mount старого native=false. Новая эвристика записывает ложную команду, оба roots00 и через12с, вместо11. Парные `BOUNDARY unrelated cancel+stop … stop=false/true`: без stop чисто, с ним FAIL.

Именно preventDefault-only случай шестого аудита исправлен. Новый listener намеренно ставит проба; конкретного обычного QWERTY producer в текущем room/extension не найдено. Это честная граница нового признака, не новая безусловная HIGH и не защита от злонамеренного сайта/расширения, которое и без D может переписать DOM.

### C04 — условная ВЫСОКАЯ «от игрока»: настоящий первый увиденный DAY может быть помечен stale

См. §2.2. Исполнены настоящий adapter OA, mapper $A, Room phase methods, Roller.setStage и Desktop text methods из свежего бандла. Native isNight=false при speech/nextNight, а staleDayLabel=true — **подтверждено**. Старая NIGHT/manual Hide → единственный увиденный DAY speech/nextNight20с → genuinely new NIGHT →+12с даёт00 вместо11; настоящая obs-panel вообще не посылает DAY. Контроли day/day подтверждают день и следующую ночь правильно.

`audit7-site-stale-day.test.ts`: два условных FAIL одной семантической неоднозначности. **Не утверждается**, что каждый первый этап дня таков: обычный toDay→speech — day/day. Если до последней speech/nextNight уже было2с однозначного дня, вреда нет. Нужен первый/единственный наблюдённый DAY такого вида; authenticated server/observability факт не установлен. Приоритетный вопрос владельца поэтому имеет ответ «frontend допускает; обычную вредную серверную последовательность доказать не удалось», не «никогда не бывает».

### Не включено в основной счёт

* **Потерянный native keyup:** `keyboard.ts:102–106` пропускает Ctrl+D, но145–148 глотает его D-up при hide=D. Реальный dispatcher сохраняет pressed=[68], последующий native Ctrl+V не работает; hide=H контроль чист. Это подтверждённый смежный keyboard-дефект, но **не MEDIUM видимости ролей**: следующий Ctrl+D с таким set по-прежнему работает; role leak/постоянная role-blindness не доказаны. В рамках одной видимости — LOW/учёт, направление к управлению игрока, не утечка. Не выдан за «зажата посторонняя физическая клавиша»: она уже отпущена, keyup потеряли мы.
* Bootstrap до первого getSettings: notes.css роли не прячет, manager ждёт sync+local до enable. Но свежий frontend перед ролью проходит locale/API/media/Welcome/socket; inline-role-before-DCL путь не найден. У extension-driven Welcome privacy ставится раньше клика. Без измеренного installed-browser timeline это **не новый B04**.
* Continuous settings patches чаще50ms могут откладывать debounce manager, но постоянный обычный writer не установлен; отдельного production-блокера не заявлено.
* Legacy CardSelect, преждевременный postgame, installed update/orphan, дополнительные расширения и несовпадение имени сцены с пикселями длинного fade — границы живой проверки, не вновь найденные безусловные дефекты.

## 5. Трасса A–F: что проверено и где именно чисто

### A. Писатели, сила и пересоздание

| Писатель / источник | Сила, переживание нового узла |
|---|---|
| Сайт, §2.1 | Обычный inline display:none. Новый root получает текущий flag; v-if/hidden ancestor независимы |
| `auto-start.ts:558–563`, pn-role-display-override | Stylesheet display:flex!important сильнее native inline normal; новый root покрыт сразу. Не отменяет display:none предка, отсутствие root, judge v-if |
| `auto-start.ts:496–541`, polemica-role-hide | Visibility:hidden, opacity0, pointer-events:none!important для стола и reveal. Переживает remount |
| `auto-start.ts:440–486`, legacy inline | Visibility/opacity/pointer-events, **не display**; pin-targets пропускает. Сам по себе на новый узел не переносится |
| `role-pin.ts:123–181,206–215` | Own inline!important и data-pn-role-pin; production OBS только hidden/release, не visible-pin. Inline!important сильнее stylesheet!important на том же узле |
| `role-pin.ts:49–64,236–257` | pn-role-pin-shield + html data-pn-own-role-hidden прикрывают новый own до heal; lift/release снимают, restore возвращает |
| `role-faker.ts:52–82,215–313` | Peer inline visibility:hidden!important; shield прячет root без фальшивки, чужой use, tooltip и reveal по html data-pn-role-faked. Новый root/use покрыт до regular reconcile |
| `role-fake-orphans.ts:32–60`; `role-pin.ts:267–276` | Очистка marked сирот; shield без html-атрибута инертен |

Inline important перебивает author stylesheet important; обычный inline проигрывает ему. Visibility потомка может перебить унаследованную hidden, **opacity0 предка** подавляет всё поддерево; вывод только по root опасен. В свежем CSS не найден role-descendant visibility:visible, обходящий щиты.

Основной аудитор сделал новый TS-AST inventory **318 style-sinks по всему src/**: assignment/computed target, cssText, set/removeProperty, set/removeAttribute(style), Object.assign. Display/general helper targets сопоставлены с назначением: match-stats — разбор матча, player-notes — video/собственный UI, protocol-emoji — собственный sprite, popup/panels/FloatingPanel — свои элементы. **Нового inline-display writer игровых role-root нет.** Артефакты `style-sinks.json`, `style-scan-summary.json`, `repo/audit7-style-scan.mjs`. Намеренные сложные alias-обходы таким inventory не объявлены невозможными.

Проверено и чисто: override не показывает скрытого родителя; новые own/root/use/tooltip под щитами не раскрываются до reconcile; E восстанавливает новую настоящую civilian вместо старой sheriff при gaps0/16/500; F→pin и pin→F не снимают privacy друг друга. **11/11 новых shield/lifecycle controls PASS.** B01/B03 не про слабость CSS: необходимый общий барьер просто отсутствует.

### B. Явный перебор

Прежний actual-owner набор, повторённый заново:

```text
AH2 × phase2 × OBS-integration2 × OBS-auto2 × native-modifier2
× phase(day/night/entryNight)3 × scene(NIGHT/DAY/disconnected)3 × nativeFlag2 = 576
```

Реальны auto-start, OBS panel, pin, faker, router, observer; внешние API моделируются. Steady-state D/repeat, V/blur, F/V/E, remount, OFF/ON под V/pending, orphans, route/game_id/new round и teardown: **10014 сравнений без расхождений**. Не значит, что любой interleaving этих осей чист.

Новая матрица genuine native receipt: hide переназначен на H, D/Ctrl+D исполняет **настоящий hotkeys-js** с preventDefault+return-false; native v-show flush — microtask. AH2×phase2×effectiveOBS2×modifier2×phase3×scene3×flag2=**288**, 3600 сравнений без расхождений. Это закрывает часть слабой native-оси старой матрицы, не подменяет все physical/Meta сценарии.

| Новое семейство | Cases | PASS / FAIL | Comparisons / mismatch |
|---|---:|---:|---:|
| Native receipts/settings/phase/scene | 288 | 288 /0 | 3600 /0 |
| Двойной transient после manual HIDE/SHOW | 96 | 64 /32 | 432 /64 |
| Двойной transient после automatic SHOW | 48 | 32 /16 | 144 /32 |
| Clear→stale до подтверждения auto-start | 24 | 24 /0 | 48 /0 |
| Новая identity под V/transient CSS | 3 | 3 /0 | 6 /0 |
| **Всего** | **459** | **411 /48** | **4230 /96** |

В expected отдельно учтены day own-pin при D, F-peer shield, manual-vs-auto CSS и native false при teardown. Новые failure-клетки — C01, не48 причин. Manager B02, 30-ms B01 и повторная scene departure B03 требуют отдельных временных историй и в старой steady-state таблице отсутствуют.

Артефакты: `audit7-matrix-existing.json`, `audit7-matrix-transients.json`, `main-repeat-matrix.json`, `main-new-probes.json`, `audit7-matrix-report.md`.

### C. Время и async

| Цепочка | Проверка / результат |
|---|---|
| Vue microtask→immediate MO→paint | Подписчик реально есть в dom.ts:130–166, включая characterData. Native style/phase adoption до обычного rAF; ошибка смысла stale-label от этого не исчезает |
| 150ms×5 native restore, verify500/retry1000/rearm600 | **Удалены** вместе с synthetic D. Двойных наших toggleEvents нет; старые времена не приписаны нынешнему HEAD |
| Auto night3000, backoff2000, slack2500 | Старые short boundary regressions зелёные; interrupted restoration600/100/600 даёт C01; gap3000 контроль чист |
| DayConfirm2000 | Single stale/clear reversal и manual HIDE сохранены. Подлинность DAY/nextNIGHT не устанавливается одним этим таймером |
| Auto phase immediate/150/interval1000 | CharacterData и replacement Roller обрабатываются немедленно; обычные subscribers text-only не видят. Ретраи не исправят потерянный semantic snapshot |
| OBS debounce150+confirm350 | Новый guard действует в evaluate, но не в raw confirmation/re-enable H01 |
| OBS pre-day30 + fresh100 | **B01**; наличие generation/route guards не доказывает сохранение скрытия в await |
| OBS show3000, retries500 либо250×5, heal2000 | Прежние missing-own/nightShow, remount, disconnect/session/late ACK controls зелёные; **B03** переживает heal и12с |
| Restore first get_status / persisted read | Свежие pre-await phase/route epochs присутствуют; прежние late-status/late-remove/session/ACK witnesses не повторились |
| Manager boot getSettings→all enables→subscribe | **B02**: новая настройка доставлена между последними двумя пунктами, не запаздывает, а теряется |
| Regular rAF/250, hidden fallback500 | Не задерживают immediate, но скрытая вкладка/реальный compositor/OBS доставка остаются browser scheduling границей |

Проверены прежние D через100ms после V-up, повтор V в600ms-окне, D около3000ms и recognition slack; blanket «все таймеры чисты» не поставлен. Свежие пробы добавляют ввод на+10ms внутри pre-day и повторный unsafe gate после первого; именно их не исследует шаг12с фаззера.

### D. Клавиатура

Трасса: window capture router→typing/IME→observers/binding→document capture candidate→настоящий hotkeys-js→document cancel+stop→Vue microtask→immediate adoption; дошедшее до window не считается native receipt. Наших synthetic Ctrl+D/WeakSet нет, нечего «помечать» или обходить в действующей архитектуре.

**Чисто в конкретных прогонах:** ordinary input/textarea/select/contentEditable, first/repeat/up D/V, logical keyCode68 на physical KeyJ под V/F/repeat, accepted D перед rejected D до0timer, CapsLock/RU physical code, modifiers/IME229, blur/visibility/keyup в typing-target, distinct remaps и fake/reset collisions. Новая native matrix проверяет обе modifier-конфигурации. Подмена не снимает общий CSS и её peer shield не поднимается V; E не снимает own-pin. Fake-root/use/tooltip gap0/16/500 и rebound heldV→K чисты.

**Нечисто:** readonly protected-focus и чужой cancel+stop — условные C02/C03; accepted native D-up loss — смежный LOW, не выдуманный MEDIUM role-delay. Новые keyboard suites: **28 тестов,21 PASS/7 FAIL**; основной аудитор повторил. Исходные requested keyboard/pin/faker и все audit6-* —168PASS в этом срезе.

Нативный exact-set действительно ограничивает ЕГО D при реально зажатой посторонней клавише; наш D не зависит от множества. Нельзя из этого делать амнистию потерянному нами keyup. Physical AltGraph/dead keys/OS dialogs/другой layout/IME и истинный keyup другого окна не эмулированы jsdom. Popup запрещает конфликтующие назначения; crafted duplicate storage не выдан за обычный UI-кейс. Полная матрица всех m/l/g/k/r/цифр/F1–F10 с browser default actions не заявлена заново: проверены runtime routing и прежние controls, физические эффекты требуют §6.

### E. Lifecycle

Проверено и чисто в указанных тестах: настоящий FeatureManager prefix search→auto-start→OBS→faker→ready→notes защищает **уже включённые** настройки до delayed-notes; master OFF/ON после старта, individual faker OFF при живой OBS, all-owner teardown, новый путь/game_id/видимый экран набора, первая native=false роль новой игры, V snapshot прошлой игры, delayed show прошлой route. Их зелёный статус **не покрывает** новый patch во время первого start (B02).

При смерти context DOM может сохранить polemica-role-hide, override, оба shield-style, html data-pn-own-role-hidden/data-pn-role-faked, inline pins и data-original-role. Fresh enable чистит marked orphan pins/fake даже при faker OFF; соответствующие controls зелёные. F5 уничтожает документ, это не reinjection поверх старого DOM. Chrome update обычно не внедряет новую копию до F5, старый JS может продолжить DOM-работу без OBS messaging. Баннер orphan-watch не доказывает scene safety; полноценный installed-update не проверен.

Две вкладки имеют разные DOM/модульные состояния и общий OBS/storage. Рассылка сцен идёт всем game tabs (`messaging.ts:86–89`); ownership решает команды, а не автоматически приватность любой захватываемой вкладки. Прежние session/status/order controls чисты; живое двухоконное переключение owner/Program не записано. Новые probes не подменяют not_owner фиктивным успешным переключением: матрица фиксирует scene, transport-пробы используют настоящий ObsClient.

### F. Адекватность оракула и мутации

#### Что действительно проверили5000

Точная обязательная команда на немутированном HEAD завершилась **32PASS за847,64с**, с нынешним штатным бюджетом1800000ms. Таймаут, generator, Spec и assertions не редактировались. `fuzz5000.log` сохранён. Это5000×25 внешних шагов плюс scripted/direct cases, **не**5000 живых игр и не включение замоканных owners.

Каждое ослабление нынешнего1060-строчного файла разобрано отдельно от исторического f3988e6:

| Состояние / HEAD-строки `role-visibility-fuzz.test.ts` | Что утверждает и что пропускает |
|---|---|
| `ptt`, native matcher110–187 | Старые blanket `!ptt`-исключения удалены. Но handwritten matcher не настоящий hotkeys-js: нет полного Meta-tail/AltGraph/readonly/IME/browser key lifecycle. В новой независимой native matrix/VM-пробах настоящий dispatcher, их нельзя приписывать центральному fuzz |
| `held`,556–560,742–770 | held=true и при пустом press; Spec.peek создан только при Spec.hidden, actual isPeeking не сравнивается. Burst принудительно отпускает V/PTT до следующего внешнего шага, долгие удержания через два разных события сцены не проверяются |
| `peekActive` → `spec.peek`,787–788 | При непустом peek **точный expected visibility вообще не сравнивается**; остаются зеркало и flip-limit. «V всё время не показывает ничего» может пройти random+scripted. Vtap40ms583–587 не имеет снимка внутри касания |
| `showDue`,440–443,694–713 | Порядок outer-step, не реальные2000/2500ms. Subactions burst делят step; triggers — Set, теряющий кратность/порядок. Это не независимый таймлайн-оракул нескольких действий вокруг deadline |
| `sceneRestore` → `Spec.sceneHide`,636–650,74–85 | Старой переменной/blanket snapshot-ветки нет, новая модель лучше. Но real OBS замокан: нет own-pin/щита/scene-list retry/ACK/session/owner/restore; real faker всегдаfalse. B01/B03/H01 и F-состояния отсюда не следуют |
| Day/held,624/627 | Дневные ветви обходят обычный peek update; выбранный held-day fail-safe доказывают отдельные focused tests, не exact-output assertion центрального fuzz |
| Sampling,497–508 | 50-ms интервалы до1с и250-ms после; trace[0] без mirror-check, initial trace719 отброшен. Полный pulse между+1000/+1250 невидим. Нет per-action deadline «скрыто до paint/до outbound», только eventual result/flip |
| Burst754–770 | Проверяется mirror послеgap0–299, промежуточные снимки не входят в flip trace, per-subaction V-to-camera invariant отсутствует. Settings/lifecycle/rebind и большинство modifier/repeat variants в burst-pool не входят |

Дополнительно: обычный observer35–49 — no-op; immediate mock **не наблюдает characterData**, а setPhase использует textContent/childList. Boolean root visibility229–234 не проверяет ancestor clipping/opacity, геометрию, glyph-content/use, tooltip/reveal или реальные пиксели. `all()`345 не требует числа targets. Больше seeds не добавляет эти оси.

`obs-role-latch.test.ts` — главным образом строки/regex, не AST/доказательство исполнения. Display guard не покрывает bracket/cssText/setAttribute/helper aliases. Auto-start-accept часто вызывает зарегистрированные callbacks прямо и считает ID override доказательством display; faker-unit вручную вызывает subscribers. Напротив, pin fresh-node units, actual-owner integration, audit5/6 short-window и матрицы дают независимую проверку части этих пробелов. Поэтому «fuzz пропустил» **не** равно «вся suite пропустила».

#### Экспериментально доказанные нынешние слепые места

| Отдельная мутация HEAD | Центральный fuzz | Полная исходная suite |
|---|---|---|
| C06: active V вообще не снимает hide CSS | Random property и26 scripted cases **PASS**. Первый standalone direct V-test в том же файле FAIL; последующие failures могут быть cleanup-cascade | Убита direct/+16/+40 witnesses |
| C07: все роли открыты на32ms между+1127 и+1159 после enable | **Весь файл PASS**, включая random/scripted/direct | **2095PASS/2FAIL**: `audit6-fuzz-short-windows > 32ms pulse cannot hide between …` и audit2-scene-belt |
| C04/C05: убрать real OBS gate/pre-day producer | Весь файл PASS: producer замокан | Убиты real-panel/at-send integration |
| C14: restoreLiftedPins не возвращает shield | Весь файл PASS | Убита `audit3-test-restore-shield > AUDIT3 C01 … next newly mounted own role before heal` |
| C15: pending night timer не проверяет due | Random и scripted FAIL | Убита; нынешние bursts закрывают этот старый пробел |

Это **тестовые мутации**, не дефекты немутированного production. C06 доказывает конкретный held-output пробел; C07 — именно ≥1-кадровый sampler blind spot, а не предположение. Отсутствующий cleanup у standalone examples может увеличивать число красных тестов после первого assertion; эти каскады не считаются независимыми killers.

#### Откаты каждого исполняемого fix-unit двух запрошенных коммитов

Папка отдельного кампейна:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit7-testing-mutations/
```

Там `057ded0/` и `f3988e6/` — **git archive соответствующего коммита**, каждый откат одиночный, полная suite — именно его снимка. Нынешняя архитектура удалила synthetic D/restore: их не «воскресили» в HEAD и не выдали исторический результат за нынешний. Для15 нынешних counterparts/probes выполнен отдельный HEAD-кампейн. Каждый mutant имеет `results/<ID>/{mutation.diff,result.json,suite.json,suite.log}`; полный inventory с exact killing assertions — `audit7-mutations.md`, `mutation-results.md`, machine JSON `all-results.json`.

| База | Исходная suite | Mutants | Убиты | Выжили |
|---|---|---:|---:|---:|
| 057ded0 | 1604/1604PASS | 19 | 14 | 5 |
| f3988e6 | 1624/1624PASS | 48 | 32 | 16 |
| HEAD counterparts/probes | 2097/2097PASS | 15 | 15 | 0 |
| **Итого** | | **82** | **61** | **21** |

**Все исторические survivors названы**, не спрятаны за общим mutation score:

| ID | Одиночный откат, переживший всю suite своего снимка |
|---|---|
| A03 | Снова считать native display частью нашего inline-hidden слоя |
| A16 /A17 /A18 | Терять priority initial snapshot /late-peer snapshot /restore visibility подмены |
| A19 | Faker observer решает heal по native display вместо visibility |
| B01 | Пустой peek поглощается вместо pass-through |
| B06 | Старый settings/phase-only возврат legacy inline слоя |
| B08 | Ночной show перевзводится даже когда не due |
| B10 | Pending timer игнорирует nightShowDue |
| B19 | Scene consumer не отписывается при disable |
| B20 /B21 | Удалить real OBS heal /pre-day notifications |
| B26 | Не сбрасывать diagnostic deferred-log latch |
| B29 | Restore поднятого пина не перевзводит shield |
| B31 | У synthetic Ctrl+D нет финальной очистки ctrl-флага |
| B35 | Modified D не блокируется под fake |
| B38 /B39 | Safe scene restore игнорирует manual change /ownership автоматического показа |
| B45 | Modified native D не отменяет pending hide restore |
| B46 /B47 | Scene snapshot переживает выход из ночи /safe return |

Остальные исторические единицы **убиты**: A01–A02,A04–A15; B02–B05,B07,B09,B11–B18,B22–B25,B27–B28,B30,B32–B34,B36–B37,B40–B44,B48. Это включает native display detectors/writers, initial/observer/reset faker display, activated hold down/repeat/up, CSS restore, synthetic identity, D repeat/manual guards, scene hide/manual snapshot/defer, pin/faker shield enable/lift/release/teardown. Exact diffs исключают путаницу номеров с шестым аудитом.

Survival **не доказывает неэквивалентность**: часть изменений перекрыта другими, B26 вообще о диагностике. Для двух отдельно установлена baseline-green/mutant-red разница новыми witness-tests в четвёртом pristine archive, не добавленными в suite-under-test:

* **B10:** manual Hide за2150ms до pending night-show — уже вне2с recent backoff, но всё ещё решение этой ночи. Baseline PASS, только B10 FAIL; историческая suite1624PASS этого не ловила.
* **B29:** restoreLiftedPins, затем **ещё одно** пересоздание own до heal. Baseline PASS, только B29 FAIL; inline на уже перепиненном узле скрывал отсутствие shield от прежней unit-проверки.

Нынешние точные counterparts C14/C15 обоих survivors убиты (§выше), старые разрывы не названы нынешними багами. Остальные current trials C01–C05,C08–C13 также убиты полной suite; **10/15** прошли весь fuzz-file, **11/15** — random property. C01 удаляет display-detector, который auto-start теперь не вызывает: его unit-kill не является доказательством live privacy-path.

Для каждого mutant выполнялась стандартная детерминированная **60-seed** suite, **не5000-seed**. Один общий5000 был выполнен только на исходном HEAD основным аудитором. Таймаутов/setup errors в mutation-кампейне нет. Source после каждого отката восстановлен; итоговые byte-comparison всех118/119 historical и119HEAD source-files с git archive — ноль различий (`restoration-verification.json`).

**Честная граница «каждого фикса»:** исполняемые behavioral units разделены вплоть до priority/scene subbranches/cleanup; type-only/import/comment/version и дублирующие reset assignments без отдельного эффекта не мутировались. Catch/log notifier и identity-comparison самого unsubscribe отдельно не fault-injected; consumer cleanup и оба producer-sites проверены. Исторические synthetic-path fix-units не имеют буквального one-hunk current rollback. Следовательно это подробный двухснимочный кампейн +15HEAD counterparts, **не доказательство исчерпания всех произвольных мутаций HEAD**.

#### Финальный счёт новых немутированных проб

`main-all-probes.json`, повтор основным аудитором в общей копии:

```sh
# Рабочая папка — AUDIT/repo, НЕ оригинальный репозиторий.
npx vitest run tests/unit/audit7-*.test.ts
```

| Файл `tests/unit/` | PASS / FAIL |
|---|---:|
| audit7-manager-boot-settings | 1 /6 |
| audit7-obs-barriers | 1 /8 |
| audit7-obs-epoch-loss | 1 /2 |
| audit7-matrix-transients | 411 /48 |
| audit7-keyboard-boundaries | 10 /7 |
| audit7-keyboard-shields | 11 /0 |
| audit7-site-hotkeys | 5 /0 |
| audit7-site-stale-day | 3 /2 |
| **Итого** | **443 /73** |

Ни мутации, ни новые failing assertions не включены в2097 исходных PASS. Ни5000, ни конечная матрица не доказывают мигание невозможным во всех неисполненных interleavings; это было бы сильнее их оракула.

## 6. Что без живой игры/OBS проверить нельзя; точный чек-лист

Не измерены authenticated server sequences/latency, installed isolated/page worlds, реальное обновление Chrome/Firefox, physical клавиатура и захваченные **Program-кадры**, Studio Mode/fade и композиция источников. Headless Chrome/CSSOM и настоящий client с simulated server их не доказывают.

Только **локальная запись, не публичный эфир**. Сохранить настройки профиля, записывать игровой источник и Program отдельно, отмечать input/current/next/outbound/scene event/ACK; смотреть покадрово30/60fps. Повторить в Chrome и Firefox, в рабочем профиле и контрольном. Это ожидаемый замысел, а не обещание нынешнего HEAD:

| Действие | Экран игрока / записанный Program |
|---|---|
| NIGHT→DAY; D-show или V-down именно между pre-day hide и DAY-command | До DAY-команды00 и ни одного открытого own/peer/reveal кадра DAY; D не оставляет01 |
| V начата на safe NIGHT; DAY→NIGHT; не отпускать V; менюShow на private NIGHT; снова DAY глобальным OBS hotkey без blur | Первый **и второй** уходы00; нет01 после второго |
| Во время первоначального loading заметок сохранить AH ON либо OBS-auto ON | Сохранённая настройка действительно закрывает00; после загрузки и12с остаётся00; поздний popup-message не нужен |
| В том же окне выключить последнюю скрывающую настройку, без manual hide | После применения11; старый автоматический CSS не остаётся доF5 |
| Настоящий toNight countdown истёк, старый currentDAY/nextNIGHT ещё висит; OBS-auto OFF→ON | Память NIGHT не заменяется ложным DAY, сцена остаётся приватной; восстановление по замыслу, без ручного D |
| D-hide ночью; повторить предыдущую последовательность, затем настоящий shooting той же ночи | Скрытие этой ночи сохраняется; auto-show не объявляет старое ручное решение «вчерашним» |
| Два естественных stale/mask excursions менее3с друг от друга, prior manual SHOW; отдельно automatic SHOW+OBS | После допустимой защиты11 через3с, не застрявшее00; prior HIDE остаётся00 |
| Записать первый настоящий DAY: native stage, nextStage, current/next, game day; затем NIGHT | Реальный DAY заканчивает старую night epoch; новое ночное show не подавлено вчерашним Hide. Установить, бывает ли первым speech/nextNight |
| ClearDAY меняет next на NIGHT внутри350ms OBS confirmation | Pending callback не включает публичную DAY по stale подписи |
| Default hide=D, site useHotKeysModifier ON: Ctrl/Cmd+D полностью нажать/отпустить, затем native camera/PTT key | Отпущенный D не остаётся в pressed-set и не блокирует следующую native команду |
| Ordinary chat, readonly если такое поле реально есть, IME/dead/AltGraph/RU; V/F и repeat при смене фокуса поля | Typing не меняет роли; защищённые holds/repeats не доходят до native role-toggle; после release/reset исходное00 |
| Все AH/phase/OBS-auto/integration OFF/ON под V и в pending+2,9с; D+100ms после V-up | Manual сохраняется, авто выключенного владельца не воскресает, own/peer согласованы кроме явного day-pin/F исключения |
| F/E; замена own/root/use/tooltip/reveal; новая настоящая роль до E | Ни настоящего значка, ни подсказки/roleReveal под fake; E возвращает текущую роль, а не старую |
| Viewer без own: NIGHT→DAY→NIGHT; reconnect OBS под V; две вкладки и смена owner | Peer-only nightShow работает; любой новый unsafe уход fail-closed именно в захватываемой вкладке |
| F5 устойчивой NIGHT; update/reload расширения под V/F; SPA/new game_id/повторный матч | Отличать новый документ от orphan; нет старых shields/visible-pin, решений прошлой игры или слепого доверия прошлой OBS-сессии |
| Длинный fade>3с/Studio Mode; mobile/viewer/legacy CardSelect/postgame; запись звука раздачи | Имя NIGHT не равно безопасным пикселям; альтернативная поверхность не выдаёт секрет; role-specific звук оценить отдельно от CSS |

## 7. Вердикт

**К обещанию «роли никогда не появляются и не исчезают сами» HEAD не готов; уверенность в отрицательном вердикте — 99%.**

Это уверенность в **опровержении**, не вероятность инцидента и не процент покрытия. Основание — воспроизводимые независимые запрещённые истории настоящих owners, отдельная проверка boot writer/popup-flow и Chrome CSSOM двух DAY-путей. До100% не доводят отсутствие installed/live/Program записи и неизвестная частота timing-предпосылок. Зелёные2097 исходных тестов не означают, что эти истории были проверены.

## 8. Статус исправлений (21.10.2026, после отчёта)

До правок на HEAD воспроизведены все 73 красных пробы. После правок зелёные все, кроме двух осознанно принятых условных границ (C03 — чужой обработчик, повторяющий cancel+stop обёртки сайта; C04 — подлинный первый день вида «день / следующий — ночь»). Пробы перенесены постоянными тестами `tests/unit/audit7-*` (пробы с полным бандлом сайта — `site-hotkeys`, `site-stale-day`, захваченная цепочка меню — прогнаны и не коммитились). Две пробы потери эпохи требовали в предпосылке, чтобы DAY была отправлена; после исправления она не отправляется — предпосылка заменена на «не отправлена».

| Находка | Статус | Что сделано |
|---|---|---|
| B01 D/V в кадре pre-day | исправлено | Перед командой дневной сцены барьер повторяется синхронно (последнее слово), независимо от «свежести» прошлого |
| B02 настройки во время запуска | исправлено | FeatureManager подписывается на изменения ДО первого прохода; пока проход ждёт чужой enable, уже включённые фичи получают патч сразу. Общий дефект, не только ролей |
| B03 повторный уход под V | исправлено | Возврат эфира на ночную сцену под той же V перевзводит защиту |
| H01 сырое распознавание | исправлено | Все чтения фазы obs-panel (обычное, подтверждение, повторное включение) — через поправку на застрявшую подпись |
| C01 двойная застрявшая подпись | исправлено | Ожидающий возврат стола переносится через второй такой «день» |
| C02 readonly | исправлено | Поле только для чтения — не ввод (как у фильтра сайта): защиты V/F/повтора действуют |
| Потерянный keyup D | исправлено | Отпускание забирается только у нажатий, забранных у сайта; Ctrl/Cmd+D уходит сайту целиком |
| C03 чужой cancel+stop | принято | Обработчик, неотличимый от обёртки сайта; в текущем сайте/расширении не найден |
| C04 подлинный «день / ночь» первым | принято | Сервером не подтверждено; вред — только «от игрока» (ручное скрытие прошлой ночи переходит на следующую) |

Мутации исправлений: 9 из 9 убиты. 153 файла / 2600 тестов, typecheck, build, фаззинг 5000 — зелёные.
