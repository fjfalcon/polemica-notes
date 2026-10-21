# Шестой внешний аудит видимости ролей — 21.10.2026

## 1. Сводка

**Гарантия «роли не появляются и не исчезают сами» опровергнута.** Проверен `main`, HEAD `0e518f070fe460cad0cebef7b2883da0e3e4c30a`, версия 9.67.0, после исправлений пятого аудита.

Основной счёт: **3 БЛОКЕРА «в эфир», 2 ВЫСОКИХ «от игрока», 1 СРЕДНЯЯ «от игрока»**. Третий блокер требует описанного межпакетного интервала; первые два воспроизведены с настоящим OBS-клиентом и отдельно в Chrome. Дополнительно: **1 условная ВЫСОКАЯ по same-document контракту новой игры** и **3 условные клавиатурные причины** — два privacy-контрпримера и один HIGH. Они не выданы за установленные обычные QWERTY/live-инциденты.

Счёт — число причин, а не число красных assertions и не число записанных утечек в настоящем OBS Program. Параметры одного механизма не суммируются. Условность серверной последовательности, раскладки, навигации и расписания указана у каждого соответствующего свидетеля.

| Проверка | Результат |
|---|---|
| `npm run typecheck` | **PASS** |
| Исходный `npm test` | **138 файлов / 1990 PASS**, 26,52 с |
| Обязательный исходный `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **Не завершил 5000:** timeout 600000 мс; затем ещё два падения соседних тестов; итого 28 PASS / 3 FAIL, 603,92 с. Это не найденный failing seed |
| Повтор всех 5000 с увеличенным только таймаутом во временной копии | **31 PASS**, все5000×25 шагов и permanent cases; 621,63 с. Assertions/Spec/генератор не менялись; исходный600с gate от этого не назван зелёным |
| Матрица настоящих владельцев | **576 клеток, 1011 запусков, 10014 сравнений, 0 несовпадений** в прежней матрице |
| Новые пробы + повтор двух старых matrix-suites основным аудитором | **130 тестов: 87 PASS / 43 FAIL**, 8 файлов; новые пробы отдельно — 59 PASS / 43 FAIL |
| Chrome 155.0.8059.79 | 16 положительных CSS/pin/faker проверок; оба новых OBS-блокера дают `01` на трёх последовательных rAF, с полным свежим CSS бандла комнаты |
| Новые независимые короткие F-контроли, повтор основным аудитором | **30 PASS**; отдельно добавленный S02-сценарий принят неизменённым Spec: **1 PASS / 31 skipped** по явному `-t` — свидетельство неверного оракула, не исправности ролей |

43 FAIL **не означают 43 дефекта**: в них входят параметры, вспомогательные mocked-OBS швы, искусственный non-cancelable event, синтетический hidden-lobby и command-only хвосты. Они разобраны ниже, а не включены механически в основной счёт.

### Метод и сохранность

Оригинальные production, тесты, зависимости, настройки и версии не редактировались. Единственная запись в репозитории — этот отчёт. Исправления production, перестройка архитектуры, коммиты и релизы не выполнялись и не предлагаются. Намеренные мутации для проверки тестов — только в отдельных временных копиях.

Далее `AUDIT/`:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit6-26Jyt3/
```

`baseline/` — исходная копия для обязательных проверок; `repo/` — копия для новых проб; `fuzz-long/` — отдельная копия с единственной заменой timeout `600_000 → 1_800_000`, без изменения генератора, Spec или assertions. Мутации выполнялись отдельно от shared probe-copy. Пять узких срезов: сайт/фазы, OBS, клавиатура, матрица/lifecycle, оракул/мутации; основной аудитор проверил исходники и доказательства, повторил новые suites и выполнил собственные Chrome-контроли. Шестой независимый reviewer сверил итоговый счёт, серьёзность и соответствие JSON/логам: существенных errata не нашёл; незавершённые на тот момент мутации не объявлял проверенными.

`source-integrity-before-report.json` и контрольный `source-integrity-final.json`: **все 345 tracked-файлов** оригинала, baseline и probe-copy совпали по SHA256; различий нет, `git status` оригинала показывает только новый файл этого отчёта. Новые временные пробы не подменяли старые тесты. Все требуемые production-файлы и перечисленные в задании тесты прочитаны целиком; `native-role-toggle.ts` отсутствует на HEAD, а не пропущен.

Обозначение `01` — `[own hidden, peer visible]`, `00` — обе скрыты, `11` — обе CSS-renderable. Это измеренная DOM/CSS-видимость игрового источника, **не автоматически доказанный пиксель настоящего Program**.

## 2. Самостоятельно перепроверенная модель сайта

Свежие файлы скачаны заново, не приняты на веру из предыдущего аудита:

| `/room/bundle/…` | Байты | SHA256 |
|---|---:|---|
| `main.js` | 1634594 | `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` |
| `style.css` | 144788 | `0fad7192be03b25aff9faab92d943c34ec0018a3ee06cbf660892230f89e7976` |
| `locales/RU.js` | 42054 | `3de756f64f94a4847f666f07830aa3780dbe6b11c7de602aa7923b143ab23fd6` |
| `locales/EN.js` | 28348 | `3e484fc3021bca540433bfd0b2316b0ba5c503d513bf504b8e666f9a22ba389a` |

Это та же сборка сайта, что в пятом аудите. Новые контрпримеры не объясняются drift. Артефакт самостоятельного AST/CSS-прохода — `audit6-site-independent-scan.json`. Ниже offsets — **0-based UTF-8 bytes**, не индексы UTF-16.

### 2.1. Все записи флага и renderer

* `roleDisplay:!0`, byte1201610 — начальное true.
* `updateRoleDisplay:function(e){e.roleDisplay=!e.roleDisplay}`, byte1203979 — единственный writer существующего флага; аргумент игнорируется.
* `commit("updateRoleDisplay",!1)`, byte1337694 — viewer permission; это переворот, не установка false.
* `toggleRolesDisplay:function(){this.$store.commit("updateRoleDisplay")}`, byte1599375; commit byte1599405 — общий путь native D и меню `toggleRoles` (сам menu method byte1486655).
* Player prop byte1399308 — не запись Vuex-state. Других записей/commit-точек флага, сброса при новой игре, смене стадии, `streamerModeStatus` или `forcePlayersVisibility` не найдено.
* `e.role&&!o.isJudge`, byte1418919, и `[[za,e.$store.state.roleDisplay]]`, byte1419196 — живой role-span. Truthy→truthy роль может сохранить root; отсутствие→роль и смена isJudge/плитки пересоздают его. Есть class-binding, но нет конкурирующего visibility/opacity style-binding на этом span.
* vShow `Ha(e,t){e.style.display=t?e._vod:"none"}` — обычный inline display при mount/смене значения. Планировщик Vue буферизует DOM-патч микрозадачей; немедленный MO получает уже DOM-результат, а не синхронное значение store до flush.

Родительский `vShow(connectedToRoom)` — отдельное скрытие. Нейтрализатор child display не отменяет display:none предка, отсутствие span или судейский v-if. Mobile использует тот же Player. Подсказка роли — вложенный `.tooltip > .content`, **не Teleport**; отдельного текущего секретного renderer для mobile/viewer/preview не найдено.

Другие поверхности проверены отдельно: `roleReveal` socket/text около1353797–1353994/1383417 покрывается `SITE.roleRevealNotice`; legacy CardSelect около1559347–1561211 и postgame role-icon около1564779 находятся вне role-span. Современная раздача закрывает legacy modal; актуальная серверная выдача старой карточки и преждевременной приватной postgame-статистики не установлена. Это прежние живые границы, не новые безусловные находки. Код выбирает role-specific звуки `dealingDon/dealingMaf/dealingCiv/dealingCom`; содержимое аудиофайлов и захват дорожки OBS не проверены — визуальное скрытие аудио не доказывает.

### 2.2. Что действительно не так с упрощённой моделью

**Ложный DAY не ограничен следующим timer tick.** `Room.on_start_stage` byte1590421 создаёт callback с `case"evening":return`: после countdown он **не вызывает `setStage`**. `addPauseBeforeStage` byte1435750 по истечении таймера убирает `beforeStageTimer`; `getSubstageText` byte1426347 возвращает старый current DAY. До следующего сетевого stage packet сайт может сохранять `current=День | Речь игрока`, `next=Ночь`, `store.isNight=true` сколько угодно дольше двух секунд. Это опровергает предпосылку комментария `auto-start.ts:1198–1199` и даёт B03. Отдельно реальная obs-panel может закончить эпоху уже за≈500 мс — §3 B03.

Спасительных `body.night/day` в свежем frontend нет: `setIsNight` byte1205429 меняет boolean; прямые body class writers — `fixed` и `mobile-version`, html — fontSize. Ночной boolean сам не является DOM-маркером расширения.

**Hotkeys-js не равен handwritten fuzz matcher.** Подтверждены `keyCode||which||charCode`, 93/224→91, filter(target/srcElement) **до** добавления в `lh`, exact-set matching, Meta-tail, AltGraph, keyup/Meta-up cleanup, focus/registration reset. Modifier synchronization находится внутри принятого filter, а не безусловно на каждом событии. Readonly допускается; обычные INPUT/TEXTAREA/SELECT/contentEditable отвергаются. Текст в обычном чате не засоряет `lh` до фильтра.

`Room.addHotKeys` около1614011 действительно оборачивает принятую команду в `event.preventDefault(),n(),!1`; `useHotKeysModifier` даёт `ctrl+d, command+d`. Сайтовый V работает только при `togglingStreamAvailable`: modern adapter выставляет его в pregame либо для paused judge. Ни любое живое V, ни любой непустой физический pressed-set автоматически не равны принятой команде сайта.

Новый defaultPrevented-подход закрывает прежние Meta-tail/readonly/wrong-profile свидетели. Но identity подавления D осталась физической, identity принятия — логической; источник preventDefault не различается. Их конкретные условные последствия — §4.

## 3. Основные подтверждённые дефекты

### B01 — БЛОКЕР, «в эфир»: уход на DAY под активной V скрывает только свою роль

**Строки:** `src/content/features/auto-start.ts:1236–1247`; `src/content/panels/obs-panel.ts:741–759,1686–1695,1703–1713`; `src/content/role-pin.ts:173–181`.

1. NIGHT, подтверждённая приватная NIGHT-сцена, штатный показ завершён: `11`.
2. D-hide: `00`; V-down на безопасной NIGHT: `11`, `isPeeking=true`.
3. Не отпуская V и **без потери фокуса игрового окна**, перевести OBS на DAY — например, глобальным OBS-хоткеем/Stream Deck. Это не Alt-tab в OBS: blur заранее отпустил бы V.
4. `obs_scene_changed` зовёт heal → обычный `gate`. Peeking-ветка игнорирует gate; общий CSS не ставится. Own-pin применяется, peer остаётся видимым.

Настоящий ObsClient, обычный event-before-ACK, simulated Program=DAY:

```text
DAY +0 / +16 / +100 / +2000 / +12000 мс: 01, expected00
V-up:                                      00
```

**Доказательство:** `audit6-obs-races.test.ts > RED REAL TRANSPORT manual-day while V held…`; disconnect даёт то же `01`, но сам по себе не доказывает публичный Program. Ещё пять вариантов: V начинается на уже подтверждённой NIGHT, пока её show pending, DAY через0/1/16/100/299мс — все красные. Это не намеренное V на заранее небезопасной сцене: новый уход на DAY случился **после** начала peek. Нормальный `beforeDayScene` под V — положительный контроль.

Основной аудитор отдельно исполнил настоящие controllers/observer с полным CSS бандла комнаты в Chrome155: три последовательных rAF дают `scene=day, visible=01`. Артефакт `obs-browser-result.json`. Это браузерная проверка CSS/кадрового окна, не установленное расширение и не записанный настоящий OBS Program.

### B02 — БЛОКЕР, «в эфир»: DAY-retry через список сцен обходит предварительное скрытие

**Строки:** `src/content/panels/obs-panel.ts:1664–1682,1349–1389`; `src/content/features/auto-start.ts:1255–1265`. Реальный producer списка — `src/background/obs-client.ts:507–512,548–562`.

1. Settled NIGHT: `11`, Program NIGHT.
2. Настоящий игровой DAY; нормальный pre-day прячет `00`, но первая DAY-команда получает OBS error600 «Scene not found». Program остаётся NIGHT.
3. Игрок показывает D на приватной NIGHT: `01` — своя под дневным pin, peer открыт; это предусмотренное D/day исключение.
4. DAY-сцена появляется; настоящий `requestSceneList` возвращает текущую NIGHT. `obs_scenes_updated` напрямую зовёт `autoSwitchScene(DAY)`, **без `beforeDayScene`**.
5. На outbound DAY уже `01`; успешные scene-event/ACK переводят Program на DAY, но не закрывают peer. Старое ручное исключение `sceneHide.manualMark` остаётся действующим даже для следующего публичного перехода.

```text
t≈7000: первый DAY отказал, Program NIGHT, 00
t=7500: D-show на private NIGHT, 01
retry outbound / event / ACK: Program DAY, 01
DAY +16 / +100 / +2000 / +12000 мс:        01, expected00
```

**Доказательство:** `audit6-obs-races.test.ts > RED REAL TRANSPORT scene creation retries public DAY…` — настоящий ObsClient, op6/op7, event-before-ACK, не фиктивный success при not_owner. Тот же retry без D-show — PASS00. Source-контроль: SceneCreated/SceneListChanged/SceneNameChanged/SceneRemoved естественно вызывают `requestSceneList`.

Chrome155 с настоящими controllers и CSS: outbound DAY=`01`, следующие три rAF также=`01` (`obs-browser-result.json`). Это другой caller барьера, не повтор исправленного audit5 restore/pre-day. Ручной показ на остававшейся приватной сцене не является разрешением автоматически вывести его в следующий публичный Program.

### B03 — БЛОКЕР при указанном timing, «в эфир»: ложный DAY всё ещё отменяет ручной HIDE этой ночи

**Строки:** `auto-start.ts:1089–1107,1159–1193,1201,885–886,1038–1041,1064–1066`. Основной профиль: AH+phase ON, OBS auto OFF; настоящий site adapter/Room/Roller, `nightAction=null`.

```text
t= 5001: toNight(countdown8000), настоящий on_start_night
t≈ 8003: штатный show11
t= 8503: D-hide00
t=13003: countdown исчерпан; старый current DAY / next NIGHT, isNight=true
t=15003: DAY_CONFIRM_MS истёк; эпоха реальной ночи ошибочно закончена
t=15504: shooting ТОЙ ЖЕ ночи; current NIGHT
t=18520: новый ночной show11, expected00
t=30520: всё ещё11, новых действий нет
```

**Доказательство:** `audit6-site-runtime.test.ts > real countdown exhaustion before shooting packet, gap=2501`; gaps2001/5000 также FAIL; gaps0/1999 — PASS00. Свежие Vue/Vuex, настоящий Room watcher, modern adapter, phase methods, Player.updateState и Roller; bounded role-renderer использует настоящий скачанный vShow. Animation callback продвигается вручную после соответствующего elapsed time; media/transport/modal вне проверки. Межпакетная задержка управляемая, не telemetry; настоящий серверный матч/Program не записаны. Frontend-путь без setStage доказывает отсутствие обещанного верхнего предела2с, а не частоту этой задержки.

**Соседний обход с настоящей obs-panel:** gap всего1000мс, isNight=true; auto-start ещё не подтвердил DAY, но панель через150+350мс зовёт `beforeDayScene`. `auto-start.ts:1249` сразу делает `endObsNight`, а панель затем создаёт новый nightSince (`obs-panel.ts:1258`). По возврату NIGHT прежний HIDE этой реальной ночи считается вчерашним; её nightShow даёт11. `audit6-site-real-obs.test.ts > actual OBS + real Roller transient preserves manual hide, gap=1000` — FAIL. В этом дополнительном свидетеле повторный показ происходит уже на NIGHT, поэтому **публичный DAY-кадр не заявлен**; это тот же семейный дефект эпохи, не четвёртый блокер.

Не повтор audit5 B01: короткий прежний HIDE-свидетель исправлен и зелёный. Новый предел либо превышает2с по разрешённому frontend-пути, либо обходит guard другим вызывателем конца ночи. Направление «в эфир» означает запрещённое раскрытие захватываемого игрового источника; здесь нет доказательства конкретной сцено-композиции владельца.

### H01 — ВЫСОКАЯ, «от игрока»: короткий переходный DAY теряет последнее ручное SHOW навсегда

**Строки:** `auto-start.ts:1657–1664,1183,1168–1174,1038–1053,868–886`.

Ночь, автоматический show11 → D-hide00 → через100мс D-show11 → настоящий Roller временно возвращает старый DAY → shooting той же ночи. DAY длится0/100/1000/1999мс, то есть укладывается в принятый переходный предел. Его auto CSS прячет00, старая эпоха и manual timestamp правильно сохраняются, но **результат команды SHOW не сохранён**. `nightShowDue()` принимает любое ручное действие этой ночью за запрет показа и останавливает восстановление.

```text
noOBS gap1000:
t= 8503 D-hide; t=8603 D-show11
t=13003 transient DAY00; t=14003 shooting, та же ночь
t=17019 и29019: 00 вместо11
```

**Доказательство:** `audit6-site-runtime.test.ts > real Roller transient-day preserves manual decision… decision=show` — четыре noOBS gaps FAIL; соответствующие HIDE — PASS. `audit6-site-real-obs.test.ts` с настоящей obs-panel — SHOW gaps0/100 FAIL, HIDE-контроли PASS; сцена остаётся NIGHT, новых scene-команд в transient/recovery нет. Не только mocked-port результат.

После отменённого show нет нового таймера; повторный фазовый check видит уже инициализированную ту же NIGHT и выходит. Нужны D/F5/смена фазы. Следовательно это HIGH, не принятое «скрыто до3с» и не средняя временная задержка.

### H02 — ВЫСОКАЯ, «от игрока»: viewer без own-role теряет показ peers после возврата NIGHT

**Строки:** `obs-panel.ts:741–765` (особенно746–752), `600–629`; `auto-start.ts:1274–1279`.

Настоящий transport: own отсутствует постоянно, peer есть. Начальная live NIGHT через direct scheduled apply посылает nightShow, peer виден. DAY-сцена прячет peer. Возврат NIGHT при той же игровой фазе идёт через heal: тот сбрасывает latch, но при нуле own-targets выходит **до schedule/apply/nightShow**. Без nightShow общий CSS peers не снимается.

```text
fresh viewer: ownCount0; initial NIGHT peer1 → DAY peer0
return NIGHT +12000ms: peer0, expected1
own исчезла навсегда после settled NIGHT: тот же результат
```

**Доказательство:** `audit6-obs-races.test.ts > RED REAL TRANSPORT persistent missing own-role fresh-viewer/own-disappears…` — обе FAIL. Пять transient-own-remount gaps0/1/16/100/299 — PASS: свежий latch-фикс действительно чинит их. Новый случай — own **не возвращается вообще**, например у viewer с доступными ролями. Многократный heal повторяет return; нужны ручной D/новая фаза. Привилегия реального authenticated viewer в живом матче не измерялась; механика существующего peer без own доказана, разрешённый сайтом renderer-профиль подтверждён.

### M01 — СРЕДНЯЯ, «от игрока»: guard restore снимает эпохи уже после устаревающего первого await

**Строки:** `obs-panel.ts:1872–1875` ждёт начальный get_status; только затем `526–548` снимает phaseAt/routeAt; `560–589` принимает persisted phase.

Пока первый status pending, monitoring уже распознал live NIGHT и завершил show11. На общем диске к будущему чтению появляется DAY той же OBS-сессии — например, от другой вкладки. Это не невозможный writer: live confirmation сохраняет phase **до** scene command (`1255–1267`), даже если последующий claimSceneOwnership даст not_owner. Завершается первый get_status; restore запоминает уже новую эпоху, поэтому stale() не замечает прежнее live знание и принимает DAY.

```text
status completion +0:   scene NIGHT, 00
                  +100: scene DAY,   00
                 +2000: scene NIGHT, 00
                 +4000: scene NIGHT, 00
                 +8000: scene NIGHT, 11
```

**Доказательство:** `audit6-obs-races.test.ts > RED settled night must survive late initial status…`; также shared-write и pending-save варианты. Storage-мок применяет успешные записи, а не притворяется no-op. Контроль «одна вкладка уже успешно сохранила NIGHT» — PASS; задержка второго local.get **внутри** restore — PASS, новый epoch-guard её чинит.

Задержка6500мс управляемая; нужен противоречащий persisted payload, а не любой медленный status. Возврат происходит автоматически, зеркала в этом свидетеле нет: **серьёзность понижена до СРЕДНЕЙ**, а не HIGH. Исправленный pre-day прячет всё до ошибочной DAY-команды: публичной утечкой этот вариант не назван.

Тот же поздний epoch-capture имеет дополнительный **SPA/source-contract** эффект: старый status пересекает reset новой комнаты; настоящая старая NIGHT-запись открывает её unknown-table11 на+16/+12016 вместо00. Подтверждено независимо OBS- и matrix-пробами, но Program=NIGHT; это **не дополнительный HIGH/публичный блокер** той же причины.

## 4. Условные находки и незасчитанные гипотезы

### C01 — условная ВЫСОКАЯ «от игрока»: native Hide прошлой игры заново принимается в новой

**Условие:** same-document новая игра, без полного reload. **Строки:** `auto-start.ts:692–727,749–752,615–643,671–673,799–806`.

AH/phase/OBS OFF. В старой игре настоящий accepted Ctrl+D скрывает native flag=true→false и наш CSS00. Новая identity корректно распознана; reset снимает CSS, сбрасывает siteFlag и lastOurShowAt. Сайт свой roleDisplay при новой игре **не сбрасывает**. Первый новый root с прежним display:none прочитывается как новое программное Hide; старое решение снова становится manual CSS.

`audit6-matrix-boundaries.test.ts > old accepted NATIVE Hide cannot become first-mount hide of new identity path/query/repeat-round` — три FAIL: `00` на+16/+12016 вместо11; новый наш D даёт11 при **том же** native=false и ровно одном native toggle. Это не перенос принятой F и не CSS-only D старых матриц. Старый native флаг не новый скрывающий setting; буквальное правило «новая игра — скрывает только настройка» нарушено.

Текущий frontend обычно делает full-document `/game` переходы; живой same-document маршрут/повторный серверный матч не записан. Поэтому это **условный HIGH по прямо заявленному контракту**, отдельно от основного счёта обычных production-путей. Pathname/query/repeat-round — варианты одной причины.

### C02–C04 — клавиатурные границы нового defaultPrevented-подхода

Actual dispatcher из свежего bundle, настоящие router/auto-start/faker/pin/mic-sync/observer; v-show в этих пробах — microtask renderer. `audit6-keys-boundaries.test.ts`: 7 FAIL / 7 PASS, из FAIL один искусственный non-cancelable кейс **не находка**. Основной аудитор повторил suite. Ни физическая альтернативная раскладка, ни приоритет двух trusted input tasks над нулевым таймером здесь не измерены.

| Причина / строки | Точная последовательность и результат | Квалификация |
|---|---|---|
| C02: защита native D физическая, принятие логическое. `keyboard.ts:70–101,133–136`; `auto-start.ts:1675–1680,1758`, против `601–611,1714–1723` | Hide=H, peek=V, fake=F, reset=E, native plain d, flag=false. Event `code=KeyJ,keyCode=68` под V доходит до native Show; V-up оставляет11. Под F тот же Show снимает общий hide; после E настоящие роли11. Repeat на таком logical D тоже переключает native. Через12с открыто; physical KeyD контроли00 | **Условный БЛОКЕР «в эфир»**, если реальная раскладка/браузер даёт эту пару. Это обратная граница audit5 KeyJ: обычное принятие исправлено, подавление V/F/repeat — нет |
| C03: чужой preventDefault принят за команду ролей. `auto-start.ts:606–611,639–643,1714–1718` | Без roots: genuine native Hide; +1с H-show; +1с отвергнутый wrong-profile Ctrl+D, отменённый другим listener; +1с mount старого native=false. First и+12с00 вместо11. Контроль без cancellation11. Настоящий mic-sync даёт такую cancellation на distinct mic=KeyJ/logical D при native ctrl+d; дублирующихся назначений нет | **Условная HIGH «от игрока»**. Для ordinary QWERTY текущий другой D-canceller сайта не установлен; конкретный real-mic witness требует той же непроверенной layout-пары |
| C04: единственный pending slot теряет принятую команду. `auto-start.ts:1717–1722,639–640` | Без roots: H-show; native D accepted Hide; microtask; **до0timer** следующий отвергнутый Ctrl+D перезаписывает pendingRoleKey; mount false. Старый timer identity-check уже no-op. +16/+12016:11 вместо00; без второго D00 | **Условный БЛОКЕР «в эфир»** при таком browser task order. Красный fake-timer scheduling witness не выдан за измеренные два физических нажатия в Chrome/Firefox |

Непринятый non-cancelable synthetic keydown может выполнить native callback без defaultPrevented, но обычный browser keydown cancelable и wrapper вызывает preventDefault. Этот красный API-кейс исключён из дефектов. Наших synthetic D/Ctrl+D и WeakSet/suppression слоя на HEAD нет; их безопасность не обсуждается как действующий механизм.

### Проверенные и отклонённые кандидаты

* **Живая F между играми** — принятый замысел до E (`audit1:505`, `audit2:425`), а не новый HIGH. Три реальные owner-контроли pathname/query/repeat-round зелёные; E возвращает настоящую **новую** civilian вместо старой sheriff и показывает peers.
* **Ложная скрытая `.new-stage`** даёт красный synthetic boundary, но свежий renderer создаёт её через v-if только при voting_for_game_start. Настоящие adapter→Room.updatePlayer→Player.updateState очищают роли в том же Vue-flush, где появляется pregame: собственный control PASS. Секретная role из reconnect-handshake раньше fresh roomState серверно не подтверждена. В блокеры не включено.
* **30мс pre-day continuation** после OFF→ON/смены комнаты действительно отправляет старую DAY-команду: boolean guard не различает поколения (`obs-panel.ts:1255–1267`). Outbound в пробах00; запрещённого визуального эффекта не доказано. Это command/lifecycle boundary вне основного счёта видимости, не искусственный medium/privacy-blocker. Оставить OFF — PASS.

## 5. Доказательная трасса A–F: что именно проверено и чисто

### A. Писатели и сила слоёв

| Писатель, HEAD file:line | Механизм / пересоздание / сила |
|---|---|
| Сайт, §2 | vShow каждой роли пишет обычный inline display. Root replacement получает актуальный flag; родитель connectedToRoom и v-if/isJudge независимы |
| `auto-start.ts:558–563` | `pn-role-display-override`: stylesheet display:flex!important сильнее обычного inline display:none; новый root покрыт заранее |
| `auto-start.ts:496–531,535–541` | `polemica-role-hide`: visibility:hidden/opacity0/pointer-events:none!important всех role и roleReveal; единственное общее скрытие стола; переживает remount |
| `auto-start.ts:440–477,483–486` | Legacy inline visibility/opacity/pointerEvents; не display. Pin-targets пропускаются; сам inline на новый root не переносится |
| `role-pin.ts:123–181,206–215` | Own inline!important и data-pn-role-pin. Production OBS применяет hidden/release, **не visible-pin**. Inline!important сильнее stylesheet!important на том же узле |
| `role-pin.ts:49–64,236–257` | `pn-role-pin-shield` / html data-pn-own-role-hidden защищает свежий own до heal; lift/release снимают, restore возвращает |
| `role-faker.ts:52–82,215–247,274–313` | Peer inline visibility:hidden!important со snapshot priority; fake-shield по html data-pn-role-faked скрывает root без фальшивки, чужой use, tooltip и reveal; новый root/use прикрыт до regular reconcile |
| `role-fake-orphans.ts:32–51`; `role-pin.ts:267–276` | Очистка marked следов прежней копии; CSS shield без html-атрибута инертен |

Visibility наследуется, но явная visibility потомка может её перебить; opacity0 предка подавляет всё поддерево. Нельзя судить только по root или порядку последней записи. В свежем CSS сайта нет собственного `visibility:visible` на role-потомках; единственное visibility-правило относится к multiselect search-copy.

**Проверено и чисто:** самостоятельный TS-AST список **316 style-sinks по всему src/** — assignments, computed-target styles, cssText, setAttribute(style), set/removeProperty, Object.assign; display-писатели и generic helpers сопоставлены с целями. Нового inline display writer игровых role-root нет. Match-stats касается таблицы разбора, player-notes — video, protocol-emoji — собственного sprite, FloatingPanel/popup/panel-chrome — своего UI. Разница с числом sinks прежнего аудита — шире гранулярность текущего сканера, не число новых role-writers. Динамические alias-обходы намеренно враждебного кода этим списком не доказываются невозможными.

В Chrome155 отдельный actual pin/faker harness: **16/16 PASS** — override vs native display, скрытый предок, table hide, приоритет inline!important, pin shield после remount в3 rAF, lift/restore/release, fake shield для нового namespaced use, faker-disable peer restore. Артефакты `a-chrome-result.json`, `style-sinks.json`. Это не основание назвать B01/B02 чистыми: там барьер просто не ставится. CSS-наблюдения относятся к указанным таблицам стилей и механике DOM, не к полному installed профилю со всеми сторонними стилями.

### B. Явная таблица состояний

```text
AH(2) × phaseSwitch(2) × OBS-integration(2) × OBS-auto(2)
× native modifier(2) × phase(day/night/bootNight)(3)
× scene(NIGHT/DAY/disconnected)(3) × native flag(2) = 576
```

Actual — реальные auto-start, obs-panel, role-pin, role-faker, keyboard, SharedDomObserver; state слоя порождается их действиями, а не произвольной перестановкой флагов. CSSOM evaluator учитывает !important и предков. Независимая baseline-формула: при effective OBS auto весь стол виден только night+NIGHT; без него phaseSwitch определяет day/night; без phase/OBS initial hide задают AH/native false. D/day own-pin и F — явные исключения; V под F peers не открывает.

**Чисто в прежней исполнимой таблице:** 576 steady cells с D/repeat/V/blur/F/V/E/remount, settings OFF/ON под V/pending, marked orphan cleanup, individual/all teardown, прежние routes/identity — **10014 сравнений, 0 расхождений**, повторено основным аудитором. Machine rows: `audit6-matrix-baseline.json`, оси/числа — `audit6-matrix-summary.json`.

Это не все клетки нового event-time произведения: нет scene-list retry после private Show, manual DAY под V, постоянного отсутствия own, принятого native=false через новую identity, настоящего промежуточного Roller DOM. Именно отдельные новые пробы сделали их красными. Старый baseline native callback не всюду повторяет wrapper preventDefault; обычный наш D там глотается раньше сайта. Поэтому зелёная matrix modifier-ось не выдана за полное доказательство native acceptance; для неё есть отдельные actual dispatcher/Room пробы.

### C. Время и асинхронность

| Цепочка | Проверенный результат / предел |
|---|---|
| Vue microtask → immediate MO → paint | Нормальные display/phase изменения принимаются до кадра; ошибка распознавания реального transient DOM остаётся B03/H01 |
| Старые native restore150×5, verify500/retry1000/rearm600 | **Удалены** с synthetic-toggle архитектурой; двойного нашего D на одно намерение нет |
| Auto night3000, manual backoff2000, recognition slack2500 | Прежний manual-Hide pending чист; сохранённый SHOW после короткого DAY теряется; long/OBS-confirmed false DAY стирает HIDE |
| DayConfirm2000 / obsNightResume / obsShowAwaitingNight | Прежние7 transient regressions PASS; новый SHOW и другой endObsNight producer — красные. Pending OBS show не открывает уже распознанный DAY в lead0/1/16/100/299мс controls |
| Phase immediate +150 / interval1000 | Работающий immediate не устраняет ложную семантику старого current. CharacterData обычным subscribers не доставляется |
| OBS detect150+confirm350 / pre-day30 | Нормальный caller и restore pre-day проходят; list retry не зовёт барьер. 30мс tail через новое поколение — отдельно command-boundary |
| OBS show3000 / retry500 или250×5 / heal2000 | Короткие own-remount gaps0/1/16/100/299 чисты; постоянно нулевые targets блокируют peer signal. Без private Show list-retry чист |
| Initial get_status / persisted get / late remove / scene epochs | Старый второй-await/late-remove/status/event/ACK дефекты зелёные; первый-await до guard — M01 |
| Regular rAF/250, hidden fallback500 | Не задерживает immediate; не является доказательством всех subframe/route/async историй |

Нормальные заданные задержки сами по себе не объявлены дефектами. Проверялись 0/1/16/40/50/100/149/150/200/250/251/299/300/350/500/600/1000/1999/2001/2501/2999/3000мс, многосекундные storage/status задержки и ожидание12–15с. Не заявлено исчерпание всех interleavings. Обычный D через100мс после V-up, повтор V через50мс и modifier-repeat старых regressions проходят; C04 касается другой очереди — ещё не принятого pending event без role-root.

### D. Клавиатура

Трасса: window capture router → typing/IME gate → hold/binding/physical KeyD observer → document capture pending command → настоящий hotkeys-js → defaultPrevented после dispatch → Vue flush → immediate flag adoption. Synthetic-events/WeakSet слоя нет.

**Проверено и чисто:** D/V first/repeat/up, Shift, Ctrl/Alt/Meta-repeat уже активного V, русский key при стабильном physical code, CapsLock, обычные input/textarea/select/contentEditable, IME229/isComposing, blur/visibility release, пустой V/native camera при доступности; peek=D пустым сайту не отдаётся. Accepted native Ctrl/Cmd+D, Meta-tail PTT, readonly и ordinary logical-D adoption пятого аудита зелёные; rejected wrong-profile/лишние modifiers не становятся командой без чужого cancellation.

F/E и переписанный root/use/tooltip, быстрый F после real-role change, priority cleanup, запрет D под F, F+V peer shield проходят. Непроверенная физическая code/keyCode-пара не выдана за обычную русскую раскладку: русский KeyD остаётся тем же physical D.

Регистрационный порядок проверен по настоящему entry: auto-start → OBS → faker до поздних pause/outcry/mic/clip. Popup запрещает duplicate assignments; crafted-storage одинаковые binding не названы штатным дефектом. Различные remaps m/l/g/k/r/цифры/F1–F10 проверены прежними router/feature-контролями; все физические browser-default actions не измерены. Native side action на non-D remap сам по себе не дефект видимости. Реальные dead keys/AltGraph/IME/layout/OS dialogs и утраченный keyup требуют ручного браузерного контроля. **Нечисто** в условных C02–C04; не подтверждённый browser-task порядок остаётся условным.

### E. Жизненный цикл

**Чисто в конкретных прогонах:** настоящий FeatureManager и весь текущий prefix search→auto-start→OBS→faker→auto-ready→player-notes при задержанном notes-read: cold boot и master OFF→ON дают00; OBS и F уже включены до завершения notes. `cfg.obsAutoExpected` и новый порядок закрывают прежний startup B04. Реальный manager выключает faker при живой OBS без снятия её privacy; master OFF снимает всех владельцев, message subscriptions=0, результат стабилен через12с.

Выход→возврат в ту же identity с доставленным MO, old pending nightShow/V, gaps0/1/16/40/100/251/500мс — PASS. Query/hash без изменения game_id не сбрасывают manual hide. Обычные AH/phase/OBS toggle и isolated/all teardown под V входят в зелёную matrix; это не универсальная амнистия await-продолжений. Native=false reset C01 и first-status restore M01 — новые соседние пути.

При смерти content-context DOM сохраняет `polemica-role-hide`, override, оба shield-style, html data-pn-own-role-hidden/data-pn-role-faked и inline/data-* ролей. Fresh enable чистит marked orphan pins и теперь fake даже при faker OFF; соответствующий новый orphan-контроль PASS. **F5 уничтожает документ**, это не reinjection поверх старого DOM. Обычный Chrome update не обязан внедрить новую копию; старый JS может остаться без OBS messaging. Баннер orphan-watch не доказывает приватность. Unmarked legacy/две живые копии/установленное обновление остаются прежними условными границами, не пересчитаны новыми блокерами.

Две вкладки имеют разные DOM/module состояния, но общий OBS и persisted phase. Ownership не равен безопасности другой захватываемой вкладки; M01 показывает конкретный shared-key шов. Реального двухоконного Program и смены owner в живой игре не записано.

### F. Адекватность тестов и мутации

#### Что означает 5000

Оба обязательных обычных гейта выполнялись в нетронутой baseline-copy: typecheck PASS, npm test1990PASS. Первый точный5000-прогон упёрся в явный testcase budget600000мс, не в model assertion с найденным seed. После timeout ещё две соседние проверки покраснели; это не две новые production-находки. Асинхронный loop не использует cancellation signal, а standalone cleanup после assertion может быть пропущен.

Повтор `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` в **другой** копии завершился: **31 PASS, 621,63с**. Единственный diff файла — timeout `600_000 → 1_800_000` на строке810. Не сокращались seed, шаги, паузы, assertions и Spec. Поэтому все5000 действительно исполнены, но стандартный600с gate на этой машине в этом запуске не прошёл. Логи `fuzz5000.log`, `fuzz5000-long.log` сохранены отдельно.

#### Каждое ослабление нынешнего fuzz

| Имя / строки `role-visibility-fuzz.test.ts` | Оценка на текущем HEAD |
|---|---|
| `ptt`, 489–491,508–512,589–596,718,739–744 | Прежнего blanket-исключения по PTT уже нет. Это состояние генератора/native matching. Но handwritten dispatcher не имеет полного Meta-tail/AltGraph/readonly/which/charCode/IME поведения; источник истины в новых keyboard-пробах — свежий настоящий dispatcher |
| `held`, 489,552–561,714–750 | Физический down не означает successful startPeek. Burst начинается без hold и принудительно отпускает V/PTT; не все длинные held-истории генерируются. Настоящего владельца pin нет |
| `showDue` → `autoShowDue`, 438–441,565–576,603–614,680–697 | Manual/night order — номер шага, не production time/slack2500. Поддействия burst делят step; deferred эффекты агрегированы Set после settle. Новое transient-day правило не сохраняет последнее manual SHOW — H01 принимается эталоном |
| `peekActive` → `spec.peek`, 340,553,613,654–663,770–771 | Peek выводится из Spec.hidden, не ответа настоящего startPeek/liftPins. Под ним **нет итогового сравнения видимости**, только зеркало. «Все скрыты под обычной V» и «все видны под наступившим днём» могут пройти. Vtap40мс не проверяет видимость внутри касания |
| `sceneRestore` → `spec.sceneHide`, 339,443–459,616–619,665–674 | cssPre/manualStep/reason и rearm сильнее старого oracle, но OBS — mock safe/auto/listener. Нет actual pin/shields, missing-own, двух фазовых recognizers, list retry, restore/status/session/ACK/owner. Это не интеграция всех писателей |
| Sampling, 494–504,746–748,758–763 | Первое trace[0] без mirror-check; дальше50мс до1с, затем250мс. Burst снимается после gap0–299мс без общего flip-count. Полный pulse между снимками невидим; гарантии одного кадра нет |

Дополнительно: mock immediate observer35–45 **не наблюдает characterData**, настоящий dom.ts наблюдает; setPhase меняет textContent/childList вместо retained Text vnode. Все роли строятся до enable; нет первой late mount, полного исчезновения own, SPA/new round/menu. Computed root-style лучше ID-only oracle, но не проверяет предков/use/tooltip/reveal/геометрию. `isRoleFaked` всегда false; импорт role-pin без владельца OBS не создаёт pin-state.

#### Неверный Spec доказан без мутации production

В побайтовую копию исходного fuzz добавлен **только** scripted testcase:

```ts
// night, AH=true, phaseSwitch=true, native=true, OBS=false
["hide", "hide", { burst: ["day", "night"], gap: 100 }, "wait"]
```

`audit6-fuzz-S02-spec.test.ts -t AUDIT6-S02`: **1 PASS /31 skipped**, повторено основным аудитором (`main-repeat-S02-spec.json`). Исходные1037 строк, mocks, Spec и assertions не менялись. Второй hide — manual SHOW. На day строка613 зовёт hideSpec; transient night607–609 сохраняет прежнюю ночь; autoShowDue=false по manualStep;695–696 не восстанавливают show. Итог772–773 **требует уже ошибочное00**. V в сценарии вообще нет: это не только peek-skip. Так текущий oracle активно принимает production HIGH H01, подтверждённый независимо настоящим Roller. Больше seeds не исправляет неверное expected. По критерию задания это **блокер доказательства «тесты подтверждают замысел»**, не дополнительная runtime-утечка: production-корень уже учтён как H01, двойного счёта нет.

#### Искусственные sensitivity controls — не production-дефекты HEAD

Каждая инъекция отдельно в oracle-copy; immutable исходный gate и новые correctness-пробы различены:

| Мутация | Нынешний fuzz | Другие доказательства |
|---|---|---|
| Q01: startPeek не снимает общий CSS | runScenario-only **26 PASS**; весь fuzz28PASS/3FAIL | Два standalone V-test самостоятельные killers; третий FAIL — contamination. Новые short-пробы дают15FAIL |
| Q02: пустой hide CSS, ID сохранён | **0PASS/31FAIL** | Computed oracle действительно видит содержимое скрытия |
| Q03: пустой native override, ID сохранён | **25PASS/6FAIL** | Native display override не проверяется одним присутствием тега |
| Q04: открыть CSS на32мс, +1127…1159 между снимками1000/1250 | **31PASS** | Независимый sentinel FAIL на+1127; полный исходный gate убивает:1989PASS/1FAIL, audit2-scene-belt |
| Q05: наступивший day не прячет уже удерживаемую V | **31PASS** | Нарушен **принятый P01**, не открытый конфликт. Независимые retained-Text day probes дают5FAIL; полный исходный gate убивает:1989PASS/1FAIL, audit5-fuzz-policy-conflict |

Изоляция Q01 проверена fresh отдельными запусками: disable-alone FAIL, spectator-alone FAIL, следующий «сайт сам скрыл роли» **PASS**. `afterEach:794–797` чистит timers, но не feature/listener; standalone930–991 делают disable/dispose только после assertion. Поэтому raw failed-count не равен числу независимых killers. runScenario776–781 имеет finally. Это дефект тестовой диагностики, не новая runtime-утечка; типичная причина дополнительных красных строк после budget timeout.

**Проверено и чисто в новых независимых controls:**30PASS на немутированном HEAD, повторено основным аудитором. Это PTT/activeV/native parity с gap0/1/16/49/149/299, retained-Text day fail-safe, manual-Hide около1999/2000/2001 и recognition-slack2499/2500/2501, release после scene-return, pin-only teardown/re-enable и unsafe-release. Их OBS seam явно mock; они не отменяют красные actual-owner B01–B03/H01–H02.

#### Исторические откаты

Окончательная таблица45 одиночных исторических мутаций добавляется по завершении отдельного прогона. Незавершённые строки не объявлены K/S. Уже проверенные survivors и отдельные новые witnesses описаны ниже; это не новые production-дефекты HEAD.

* **B07**, release подставляет sceneSafe=true: все исходные1990 тестов PASS, но новая независимая `audit6-fuzz-B07-window.test.ts` даёт **HEAD4PASS / мутант4FAIL**. Старое day manualMark отличается от sceneHide; V получает новое nightShow; до V-up сцена снова unsafe. Неправильный show на release оставляет peer1, последующий sync сознательно не лечит из-за manualMark. Значит, «синхронный gate всегда компенсирует» не доказательство глобальной эквивалентности.
* **B20**, teardown вызывает stopPeek() вместо stopPeek(true): исходные1990PASS; `audit6-fuzz-B20-lifecycle.test.ts` — **HEAD4PASS / мутант2PASS2FAIL**. Pin-only V после manual peer-show; normal stopPeek заново создаёт sceneHide уже после его teardown-cleanup; этот old mark переживает новый enable и мешает privacy/startup guard. AH=true компенсирует, AH=false — нет. Это не глобально эквивалентный откат и не баг немутированного HEAD.

`obs-role-latch.test.ts` — source slices/regex, не AST/поведение; source-only kills отмечаются отдельно. Мутация retired `isNativeRoleHidden` убивается unit-тестом, хотя production caller отсутствует. Удалённые synthetic D/Ctrl+D, WeakSet/suppression250, native restore150×5/verify500/retry1000/rearm600 не «воскрешаются» ради числа: это obsolete архитектура, а не survived живой фикс.

## 6. Что невозможно проверить без живой игры; чек-лист владельцу

Не измерены installed-extension миры/обновления Chrome+Firefox, реальные server deliveries/latency, физические раскладки/IME/default actions, настоящий OBS transition/Studio Mode, compositor и **записанные Program кадры**. Ни jsdom, ни headless CSS/rAF не доказывают все эти контракты.

Проверять **локальной записью, не публичным эфиром**. Одновременно записать игровой источник/окно игрока и Program; покадровый просмотр60/30fps, отметки нажатий, phase/current/next, scene/outbound/ACK. Отдельно оба браузера, реальные сохранённые настройки и контрольный профиль. Ниже ожидаемый замысел, **не обещание текущего HEAD его исполнить**.

| Действие | Должно быть на экране и в Program |
|---|---|
| На NIGHT D-hide→V держать; переключить DAY глобальным OBS-хоткеем/Stream Deck без blur | Own, peers и roleReveal сразу скрыты и под V; ни одного открытого кадра DAY |
| Повторить с disconnect OBS под V | Весь стол fail-closed, не own/peer зеркало; V-up не оставляет открытого хвоста |
| DAY-сцена недоступна; после отказа D-show на приватной NIGHT; создать/переименовать сцену так, чтобы retry стал возможен | До повторной DAY-команды весь стол00; после event/ACK/12с тоже00 |
| speech→toNight с countdown; D-hide; задержка следующего пакета после countdown >2с, затем shooting | Это та же игровая ночь; HIDE сохраняется; повторный show не открывает source/Program |
| То же с OBS auto, transient DAY≈1с | Панель не стирает ручную эпоху этой ночи; ночной возврат не открывает вручную скрытое |
| Settled NIGHT: D-hide→D-show; естественная короткая старая DAY-подпись → shooting | После допустимой краткой защиты, не позже3с после возврата NIGHT, снова11; не требуется D/F5 |
| Viewer без own-role: settled NIGHT → ручная DAY → обратно NIGHT | После задержки OBS peers видны снова без D/смены фазы; то же после постоянного исчезновения own |
| Задержанный startup status + другая вкладка с DAY той же OBS-сессии | Поздний restore не скрывает ночные роли и не включает DAY посреди живой NIGHT |
| Если сайт поддерживает same-document: native Ctrl+D-hide → другая game_id / повторный матч | Без скрывающих настроек старый native=false не вносит старое hide; новый стол11; F отдельно сохраняется до E по принятому замыслу |
| D/V first/repeat, PTT, Ctrl/Cmd, Shift/Alt, readonly, IME, утраченный keyup, альтернативная физическая раскладка | Accepted native решения приняты ровно раз; запретные V/F/repeat не меняют native parity; нет залипания после отпускания |
| Каждый AH/phase/OBS-auto/integration OFF/ON под V и в +2,9с pending | Выключенное auto не воскресает, manual сохраняется, own/peers согласованы кроме явных исключений |
| F/E, новая роль/root/use/tooltip/reveal; новая игра до E | Нет настоящего значка/подсказки под fake; E возвращает актуальную роль новой игры, не старую |
| Cold boot/F5/master OFF→ON с медленным storage; update/reload расширения под F/V | После включения privacy нет startup-окна; отличать новый документ от orphan; нет stale shields/visible-pin/слепого доверия NIGHT |
| Две вкладки, owner сменился, захват другой вкладки, свёрнутое окно | Безопасна именно захватываемая вкладка; not_owner не выдаётся за успешную сцену |
| Длинный fade>3с/Studio Mode; modern/legacy раздача, viewer reconnect, postgame/mobile | Имя NIGHT не доказывает исчезновение game-пикселей перехода; альтернативная поверхность не раскрывает секрет; публичные итоги отделены от приватного |
| Раздача с захватом звука | Отдельно установить, различимы ли role-specific звуки в записанной дорожке; CSS этого не гарантирует |

## 7. Вердикт

**К обещанию «роли никогда не появляются и не исчезают сами» сборка не готова; уверенность в отрицательном вердикте — 99%.**

Это уверенность в **опровержении**, не процент покрытия и не вероятность инцидента. Основание — повторённые новые контрпримеры на неизменённых production-модулях, настоящий скачанный renderer/dispatcher, настоящий ObsClient transport и отдельные Chrome CSS/rAF-контроли двух публичных DAY-путей. До100% не доводят отсутствие installed/live/Program записи и неизвестная частота timing-условий. Зелёные1990 исходных тестов и прежняя матрица эти новые пути не проверяют.

## 8. Статус исправлений (21.10.2026, после отчёта)

До правок на HEAD воспроизведены все 43 красных пробы. После правок все зелёные, кроме исключённого самим аудитом контракта «некэнселябельный синтетический D» (не перенесён). Пробы перенесены постоянными тестами `tests/unit/audit6-*`; пробы с полным бандлом сайта (`audit6-site-runtime`, `audit6-site-real-obs` — настоящие Vue/Room/Roller) прогнаны и не коммитились; B03/H01 закреплены собственными `audit6-stale-day` и `audit6-obs-stale-day`. Модели сайта в тестах доведены до настоящей обёртки: принятый хоткей — `preventDefault` и `stopPropagation`.

| Находка | Статус | Что сделано |
|---|---|---|
| B01 DAY под V | исправлено | Уход эфира с ночной сцены, случившийся уже под V (хоткей OBS, разрыв), прячет весь стол и под V. V, начатая на уже небезопасной сцене, — выбор игрока |
| B02 повтор DAY через список сцен | исправлено | Барьер pre-day — внутри `autoSwitchScene`: любой путь к дневной сцене прячет стол и ждёт кадр. Перевзвод сценового скрытия на каждом `beforeDayScene` (аудит №5) закрывает и старое ручное исключение |
| B03 застрявшая подпись дольше 2 с | исправлено | `staleDayLabel` (current — день, next — ночь): такая подпись прячет, но ночь не заканчивает ни в auto-start, ни в obs-panel (эфир остаётся на NIGHT). При автосмене фаз `beforeDayScene` эпоху ночи не стирает. Если однозначность наступает позже — подтверждение дня взводится тогда |
| H01 ручной показ после короткого дня | исправлено | Стол, видимый до неподтверждённого дня, возвращается через 3 с, если игрок с тех пор не решал (ручной показ и ночной показ — одинаково) |
| H02 зритель без своей роли | исправлено | Без своей плитки показ (nightShow) всё равно планируется |
| M01 эпохи restore | исправлено | Эпохи фазы и маршрута снимаются до первого `get_status` |
| C01 флаг сайта прошлой игры | исправлено | Наше решение о столе новой игры новее флага сайта (`lastOurShowAt` при сбросе) |
| C02 логический D | исправлено | Роутер и защита D сайта узнают его и по keyCode 68 |
| C03 чужой preventDefault | исправлено | Командой считается D, который сайт ещё и остановил: дошедший до window — не принят |
| C04 два нажатия до таймера | исправлено | Прежний кандидат учитывается до замены |
| Скрытая `.new-stage` | исправлено | Новая игра — только по видимому экрану набора |
| Хвост pre-day через выкл/вкл/комнату | исправлено | Поколение настроек и эпоха маршрута у продолжений; повторное включение автосцен берёт живую фазу |
| S02 эталон фаззера | исправлено | Spec возвращает стол после переходного дня; сценарий S02 закреплён. Бюджет 5000 — 1 800 000 мс |
| Мутанты B07/B20 | закрыты тестами | `audit6-fuzz-B07-window`, `audit6-fuzz-B20-lifecycle` |

Мутации исправлений: 17 одиночных откатов — после добавления трёх тестов (застрявшая подпись с автосценами, obs-panel на настоящих модулях, поздняя однозначность дня) убиты все 16; семнадцатый (проверка `defaultPrevented` до сайта) оказался избыточным при признаке «дошёл до window» и вредным (терял принятую сайтом команду) — удалён. 147 файлов тестов, typecheck, build; фаззинг 5000 — зелёные.

Принятые ограничения нового кода: застрявшая подпись прячет стол до следующего пакета сайта (≥3 с, «от игрока»); настоящий первый этап дня с ночным следующим этапом ночь не заканчивает до смены этапа. Живой игрой и записью Program не проверялось — чек-лист §6 в силе.
