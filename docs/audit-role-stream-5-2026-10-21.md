# Пятый внешний аудит видимости ролей — 21.10.2026

## 1. Сводка

**Утверждение «роли никогда не появляются и не исчезают сами» опровергнуто.** Проверен `main`, HEAD `7bf38df2c75f01e9979c16221d24f1ed87b73f71`, версия 9.67.0 после четвёртого аудита.

Основной счёт: **4 БЛОКЕРА «в эфир» и 3 ВЫСОКИХ «от игрока»**. У одного блокера есть также высокое проявление противоположного направления; это **одна причина**, не две находки. Отдельных средних/низких production-находок в основной счёт не включено.

Счёт означает воспроизведённые дефектные механизмы, **не четыре записанные утечки в настоящем Program**. В B03/B04 задержки API управляемые, их частота в профиле владельца не измерялась. Для B01 установлен исполняемый путь публичного frontend с `nightAction=null`, но не записана серверная игровая сессия. Эти условия не скрыты в общем числе. Условные SPA/legacy/reinjection/layout-сценарии и конфликт V/day перечислены отдельно (§4).

| Проверка | Результат на проверенном HEAD |
|---|---|
| `npm run typecheck` | **PASS** |
| Исходный `npm test`, до новых проб | **127 файлов / 1905 PASS**, 19,27 с |
| `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **31 PASS**, 443,55 с; 5000 × 25 шагов и закреплённые случаи |
| Матрица настоящих владельцев | **576 клеток, 1011 запусков, 10014 сравнений, 483 несовпадения** |
| Прежняя подматрица четвёртого аудита | **8598 / 8598 сравнений совпали** |
| Все новые `audit5-*`, повтор основным аудитором | **37 FAIL / 50 PASS**, 11 файлов; дополнительно красный `afterAll` матрицы |
| Контроль site с восстановленными настоящими side-effect methods | **1 FAIL / 1 PASS**, 6 отфильтрованы |
| Chrome 155, отдельные mechanism-harness | Подтверждены B02/H01, startup B04, Text-node day до первого rAF; это не установленное расширение/запись OBS |
| Исторические мутации `057ded0` / `f3988e6` | **45 опытов: 41 raw killed / 4 survived / 0 errors**; все четыре survivors прошли исходные1905 тестов |

37 красных тестов и 483 несовпадения **не равны** числу дефектов: сюда входят параметры одной причины, условные контракты, намеренно красный буквальный V-оракул и API-only interleaving, недостижимый через штатный FeatureManager. Исходные 1905 PASS с ними не смешаны.

### Метод и сохранность

В оригинале разрешена и выполнена только запись этого отчёта. Production, исходные тесты, зависимости, настройки, версии не менялись; патчи, архитектурные предложения, коммиты, релизы не выполнялись и не предлагаются.

Далее `AUDIT/`:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit5-20261021/
```

`repo/` — отдельная копия с новыми пробами; `mutation-F/` и `oracle-F/` — отдельные архивы исходного HEAD, без одновременно добавляемых проб. Шесть срезов: сайт/фазы, OBS, клавиатура/подмена, матрица/lifecycle, оракул/мутации, независимый контроль. Основной аудитор прочитал доказательства, повторил все новые suites, матрицу и выбранные настоящие site-methods; клавиатурные контрпримеры отдельно проверены в Chrome. Все требуемые файлы прочитаны целиком соответствующими срезами. `src/content/native-role-toggle.ts` **удалён на HEAD**, а не пропущен.

Контроль `source-integrity.json`: **272 tracked production/test/script/package/config входа** оригинала и probe-copy совпали; новые временные пробы не подменяли старые тесты. Существенные трассы приведены ниже, поскольку временные артефакты не являются вечным хранилищем.

Обозначения: `[own,peer]`, `0/1` — роль CSS-renderable скрыта/видна в игровом источнике. В трёхместной матрице — `own,peer,peer`. Видимость значка не приравнивается к доказанному пикселю реального OBS Program.

## 2. Независимая модель сайта

Заново скачаны публичные файлы, выполнены AST-проход и проверка контекстов. Это та же версия сайта, не drift:

| URL suffix | Байты | SHA256 |
|---|---:|---|
| `/room/bundle/main.js` | 1 634 594 | `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` |
| `/room/bundle/style.css` | 144 788 | `0fad7192be03b25aff9faab92d943c34ec0018a3ee06cbf660892230f89e7976` |
| `/room/bundle/locales/RU.js` | 42 054 | `3de756f64f94a4847f666f07830aa3780dbe6b11c7de602aa7923b143ab23fd6` |

Ниже offsets — **0-based UTF-8 bytes**, не строка и не JS UTF-16 index. Артефакты: `site/independent-scan.json`, `site/scan-summary.json`, `site/body-phase-ast.json`, `site/body-phase-contexts.json`, `site-counterargument.md`.

### 2.1. Флаг, его писатели, renderer и другие поверхности

| Маркер / offset | Самостоятельно установленный факт |
|---|---|
| `roleDisplay:!0`, 1201610 | Начальный Vuex-флаг true |
| `updateRoleDisplay:function(e){e.roleDisplay=!e.roleDisplay}`, 1203979 | Единственный writer существующего флага, аргумент игнорируется |
| `commit("updateRoleDisplay",!1)`, 1337694 | Разовое viewer-permission подключение |
| `commit("updateRoleDisplay")`, 1599405 | `toggleRolesDisplay`; callers — native D и меню `toggleRoles` |
| Player prop, 1399308 | Не вторая запись Vuex-state |
| `e.role&&!o.isJudge`, 1418919; store/vShow, 1419216 | Текущий role-span с key=5; отсутствие→роль монтирует узел, truthy→truthy может сохранить root |
| `za={beforeMount…}`, 1128883; `Ha(e,t){e.style.display=t?e._vod:"none"}`, 1129237 | vShow пишет обычный inline display при mount/смене truthiness, не visibility/opacity |
| Tooltip, 1419148 | Внутри role-span; class-binding есть, конкурирующего style-binding visibility/opacity нет |
| Parent `connectedToRoom`, 1621315 | Отдельный vShow родителя; child's display override его не отменяет |
| CSS `.player__role`, 31158 | `display:flex`, z-index 5; видео — сосед, не щит роли |

Проверены все употребления флага и обе commit-точки. Сброса roleDisplay на новую игру/фазу/streamerModeStatus/forcePlayersVisibility в скачанном bundle нет. Они не заменяют скрытие role-span.

Другие поверхности:

* `roleReveal` — соседнее уведомление, socket около 1353994, текст около 1383417. Общий hide CSS и fake-shield его покрывают; нового обхода не найдено. Серверная приватность конкретной доставки не измерена.
* Legacy CardSelect рисует выбранную настоящую карту вне role-span; `on_self_role_defined`/закрытие через 1500 мс около 1348149, selectedRoleCode 1559347–1560551. Modern dealing этот modal закрывает. Текущая доставка legacy-последовательности живым сервером не установлена — **не новый безусловный блокер**.
* Постигровые role-icon/текст около 1564779 — отдельная поверхность. Не установлена выдача приватных итогов посреди матча; публичные итоги не названы утечкой.
* Mobile использует тот же Player, хотя собственная плитка иногда отсутствует. Отдельный текущий secret-role renderer для mobile/viewer/preview не найден. RoleIcon конфигурации режима, auction, guess и ПУ — не доказанный второй вывод настоящей секретной роли.
* Ролевые звуки `dealingDon/dealingMaf/dealingCiv/dealingCom` существуют и не гейтятся roleDisplay. Аудио OBS и содержимое файлов не проверялись: это за пределами **видимости**, а не доказательство полной секретности стрима.

### 2.2. Существенные расхождения с упрощённой моделью

**Hotkeys-js — не просто множество физических code.** Свежая извлечённая fixture: 5605 bytes, SHA256 `53074780c042098d6defc2da190b181a27c756dd827f284148034482774158dd`, byte-identical сохранённой fixture без её первой комментарной строки.

Подтверждены `keyCode||which||charCode` (1218622), filter **до** добавления в `lh` (1218656), exact set matcher, синхронизация modifiers из flags, keyup cleanup, focus-reset, registration-reset. Но Meta-tail около **1218909** отбрасывает предыдущую постороннюю клавишу для Cmd-комбинации. Поэтому утверждение «при любой зажатой посторонней клавише native D не принимается» **не универсально для Cmd+D**. Это не только тестовая неточность: новый production `heldKeys` опирается на неё — B02.

Фильтр readonly, `target/srcElement` вместо дополнительного activeElement, IME229, 93/224→91, Meta-tail/Meta-up, fallback which/charCode не представлены точно в handwritten fuzz. Native V доступен только при `togglingStreamAvailable`: modern adapter — pregame либо paused judge, а не любая живая фаза. Fuzz увеличивает video-counter без этого гейта.

**Фаза — не атомарная смена одной подписи.** Настоящий DesktopRoller использует Text vnode и может после снятия countdown временно вернуть **старый DAY current при настоящем `isNight=true`**. Приоритет current над next превращает это в ложную смену игровой эпохи — B01. Сайт не выставляет спасительный `body.night`: из всех body/html class/style writers найдены только `fixed` (1573992/1574070), `mobile-version` (1616955), fontSize html (1606142/1606562). Все шесть употреблений `isNight` проверены; `setIsNight` (1205429) лишь присваивает boolean, app монтируется в `#app`.

Комментарий fuzz «ТОЧНАЯ модель сайта» сильнее действительного покрытия. Сам по себе неполный simulator не назван новой утечкой; ниже отдельно приведены конкретные production-контрпримеры, использующие расхождения.

## 3. Основные подтверждённые дефекты

### B01 — БЛОКЕР, «в эфир»: ложный DAY из настоящего Roller отменяет ручное скрытие этой ночи

**Места:** `src/content/features/auto-start.ts:736–760,1046–1096,1110–1129,846–850,988–1023,1220–1227,1242–1248`.

Условия: AH и phaseSwitch ON, OBS auto OFF; настоящий renderer в ветке `nightAction=null`. Не требуется переназначение клавиш, подделка storage или синтетический D.

1. Настоящий adapter обрабатывает `speech → toNight → shooting`. `toNight` вызывает настоящий `on_start_night`, `isNight=true`, но `on_start_stage("evening")` **не заменяет старый currentSubstage**. Это поддерживаемый frontend путь, byte 1579010, mapping 1583822, phase methods около 1590227/1590421.
2. В current рисуется countdown «До смены этапа», в next — «Ночь». Детектор уже считает это ночью; штатный ночной показ завершён.
3. Примерно на +3500 мс этой ночи игрок нажимает D: `[0,0]`.
4. На +6500 мс приходит `shooting`, **ещё до окончания 8-секундного countdown**. `removePauseBeforeStage` (1436149) убирает его подпись; `setStage` (1436743) обновляет current только следующим timer-task. На промежуточном Vue/MO-проходе current снова **«День | Речь игрока»**, next/temp уже ночные, `isNight=true`; `on_start_day` не вызывался.
5. Новый immediate subscriber исправно доставляет эту мутацию. `detectRolePhase` выбирает current DAY; `applyRolePhase` пишет `lastDaySeenAt` и обнуляет ночь. Следующая настоящая ночная подпись начинает «новую ночь».
6. D старше новой эпохи минус 2500 мс ошибочно признан прошлым. Через новые 3 с автоматика удаляет manual hide. На +3016 и +12000 мс после shooting: **`[1,1]`, ожидалось `[0,0]`**. При OBS listener с исходным правильным nightSince новый clamp также теряет эпоху; это отдельно проверено на шве, не выдано за полный OBS-run.

**Доказательство:** `audit5-site-renderer.test.ts > manual hide belongs to the same real night: next-packet-before-countdown-end` и `normal-countdown-end` падают. Исполнены свежескачанные Vue/Vuex, оригинальные Room watcher/adapter/phase methods и Roller. В `site/trace-next-packet-before-countdown-end-real-side-effects.json`:

```text
t=8504:  D-hide, isNight=true, nightAction=null → 00
t=11504: MO current=старый DAY; isNight=true  → 00
t=11504: следующий MO current=NIGHT          → 00
t=14521: второй автоматический night-show   → 11
t=23505: без нового действия                → 11
```

Основной аудитор проверил контраргументы body/night и side-effect stubs. При восстановлении **оригинальных** `preparePlayersToAction`, `addOrUpdateNotification`, `removeNotification`: **1 FAIL / 1 PASS**. No-countdown и ручное решение в последних 2,5 с — положительные контроли. Граница: не обобщается на каждую aiming/detection-ветку и не объявляется записанной живой серверной последовательностью. Это не повтор уже исправленного «Промах»: здесь immediate работает, но принимает переходный DOM за настоящий день.

### B02 — БЛОКЕР, «в эфир»; также HIGH «от игрока»: `heldKeys` расходится с реально принятым native действием

**Места:** `auto-start.ts:592–608,624–647,832–850,890–917,1615–1628`; `src/core/keyboard.ts:78–106`.

Новый tracker записывает **все** физические non-modifier code на window, включая то, что router проглотил или native filter отверг. Native `lh` содержит другое множество и дополнительно применяет Meta-tail. Это одна false-negative причина, два направления вреда.

**Блокирующая последовательность:** ночь, phaseSwitch ON, ночной показ уже завершён, site modifier ON. Удержать Backquote/PTT → Meta-down → Cmd+D → отпустить D/Meta/PTT. Настоящий Room.addHotKeys / hotkeys-js **принимает Hide**, Vuex roleDisplay=false, vShow выполнен, `[0,0]`. Наш tracker видит Backquote и отвергает отметку команды. Hide принимается как программный, без нового manual timestamp. Затем V-down показывает роли; **V-up ошибочно считает положенным автоматический night show и оставляет `[1,1]`** на +16 и +12000 мс. Native flag остаётся false, все клавиши отпущены.

**Доказательство:** `audit5-site-renderer.test.ts > accepted native hide stays hidden after V: Meta-tail-PTT` — FAIL; actual downloaded dispatcher, Room.addHotKeys, toggleRolesDisplay, mutation и реактивный vShow. Контроль simple Cmd+D — PASS. Аналогичный новый контрпример с удержанной буквой textarea использует filter-before-keys; для физической клавиатуры Ctrl+D должен прийти **до следующего автоповтора после ухода из textarea**, иначе native set может пополниться буквой.

**Независимый Chrome 155:** `browser-keys-result.json`: control после V=`00`, Meta-tail после V=`11`; в обоих native toggle ровно 1 и roleDisplay=false. Настоящие auto-start/router/observer, точная native fixture, микрозадача vShow; не installed extension/Program recording.

**Обратное высокое проявление:** legal hide=H, native modifier ON. Native false; H-show → H-down скрыть и держать H (нажатие сайту не отдано) → Ctrl+D. Сайт действительно принимает Show, native true и ровно один toggle, но наш heldKeys содержит H. Show не принимается: **`00` через 12 с вместо `11`**. Проверено `audit5-keys-site-acceptance.test.ts > accepted native Show must take effect: swallowed-hide-held`, повторено в Chrome: native pressed before D=`[]`, flag=true, фактическая картинка=`00`; контроль без H=`11`. Meta-tail даёт и такое направление. **Дополнительной HIGH в счёте нет**, причина уже B02.

### B03 — БЛОКЕР, «в эфир»: stale DAY restore — ещё один caller публичной сцены без pre-hide напарников

**Места:** `src/content/panels/obs-panel.ts:522–568`, особенно await `534`, присваивание фазы `548`, own-only hide `563`, `autoSwitchScene` `566`; команда `1320–1360`. Нормальный барьер `808–833` вызывается из `1231`/`1714`, но **не из restore**.

1. OBS на приватной NIGHT, session та же; startup чтение persisted phase снимало DAY и ещё pending. Во время await обработчики DOM/клавиатуры и monitoring уже живы.
2. Либо live NIGHT распознаётся и через 4 с обе роли штатно открыты, либо игрок вручную показывает на приватной NIGHT на +100 мс, чтение возвращается на +200 мс.
3. Старый ответ присваивает DAY поверх более новой live-фазы. Restore ставит **только own-pin**, затем сам отправляет `SetCurrentProgramScene(DAY)` без общего `beforeDayScene`.
4. **Уже на outbound `[0,1]`**. Program **в симуляции OBS** стал DAY, ACK успешен; при управляемой задержке доставки scene-event content на +100 мс ещё **`[0,1]`**, ожидалось `00` до команды. Доставленный scene-event скрывает peer; последующий периодический heal также способен закрыть окно.

**Доказательство:** три красных случая `audit5-obs-short-races.test.ts`: `stale DAY restore…`, `short DAY restore…`, `REAL TRANSPORT RED: delayed DAY restore…`. Последний использует настоящий ObsClient.connect, pending-map, op:6/op:7 и **обычный event-before-ACK** от socket. Контроль `REAL TRANSPORT CONTROL: normal live DAY path…` с тем же transport/delivery даёт `00` на outbound и после ACK.

100 мс — контролируемый delay, не telemetry; старого OBS-ответа **после нового OBS-event** не требуется. Отсутствие pre-hide на outbound установлено независимо от длительности доставки. Инверсия — старый persisted NIGHT после live DAY отправляет лишнюю NIGHT-команду — тоже красная, но не считается вторым блокером: тот же unguarded restore фазового снимка. Это соседний caller после прежнего settings/re-enable фикса, не повтор закрытого ACK-случая.

### B04 — БЛОКЕР, «в эфир», при указанных timing-условиях: OBS-only защита ждёт чтения заметок

**Места:** `src/core/feature.ts:47–60,96–106`; порядок `src/content/index.ts:56–81`; `player-notes.ts:391–395,2332–2337`; настоящий local get `src/core/notes-store.ts:654–658`; `auto-start.ts:1594–1643`; `obs-panel.ts:286,656–667,1663–1681,1743–1746`.

Настройки уже успешно прочитаны: master ON, statistics ON, OBS integration+auto ON, AH/phase OFF. NIGHT не подтверждена; OBS может быть disconnected при продолжающемся захвате игры публичной сценой.

Настоящий FeatureManager последовательно `await enable`: ранний auto-start включился, потом player-notes ждёт local notes, **OBS-фича ещё не запущена**. Ранний auto-start знает только свои AH/phase, а экспорт OBS пока сообщает `autoModeEnabled=false`. Ни общего hide, ни пина нет. Роли, уже имевшиеся или **смонтированные во время этого await**, открыты.

`audit5-main-boot.test.ts`: на +100 мс active=`auto-start,player-notes`, картинка=`11`, hideCSS=false; expected=`00`. Независимый `audit5-control-manager.test.ts` сохраняет **весь настоящий префикс** search/auto-start/auto-ready/player-notes и повторяет master **OFF→ON через реальный settings coalescer**: оба RED. Фичи после notes до OBS не могут спасти окно: их enable ещё не вызван из-за последовательного await. После release notes настоящий OBS стартует и скрывает обе роли.

Контроли PASS: AH ON; phase ON в день; statistics OFF; OBS OFF, когда показ законен. Совместно **3 FAIL / 6 PASS**. В Chrome 155 с настоящими manager/фичами и полным `notes.css` новые роли видны в **трёх последовательных rAF**: display:flex, visibility:visible, opacity:1; после release скрыты. Артефакты `control-findings.md`, `control-browser-result.json`.

**Граница:** 100 мс browser-storage latency и удержание в Chrome искусственные, не live-замер. Это подтверждённое неограниченное чужим await окно, не утверждение о его частоте. Проба **не требует скрытия до инъекции/чтения настроек**, и не считает master OFF утечкой. Исключения «во время загрузки заметок OBS-only приватность не действует» в оракуле нет.

### H01 — ВЫСОКАЯ, «от игрока»: отвергнутые modifier-комбинации всё ещё создают ложную команду

**Места:** `auto-start.ts:604–608,635–647,1615–1616`.

Лобби без ролей; legal hide=H, AH ON, native profile **plain D**. Native D действительно выключает flag; +1 с H явно показывает наш слой; +1 с Ctrl+D **сайтом отвергнут**, toggle count остаётся 1, flag=false. Но новый `siteAcceptsRoleKey` проверяет alt/shift и физические non-modifiers, **не проверяя native modifier profile**; timestamp команды обновлён. Первая role mount несёт старый display:none, guard более нового нашего Show отключён, всё скрывается до нового D/фазы.

`audit5-keys-site-acceptance.test.ts > rejected native combination…`: wrong-profile-ctrlD, late-mount **1000 мс (>700)** и simultaneous Ctrl+Meta+D — **3 FAIL**. Все дают `00` на первом +16 и после +12016 вместо `11`; no-extra-command PASS. Ctrl+Meta+D не равно ни native Ctrl+D, ни Cmd+D, но tracker выкидывает оба modifiers. Chrome повторил wrong-profile/late-mount: native toggle=1, flag=false, control=`11`, лишний отвергнутый Ctrl+D=`00`.

Браузерное bookmark UI untrusted-пробой не воспроизводилось; >700-мс witness показывает, что простое ожидание/закрытие UI не погасит неправильную first-mount причинность. Это новый обход H05 по другой комбинации, не повтор уже закрытой печати D/физически зажатого PTT.

### H02 — ВЫСОКАЯ, «от игрока»: отсутствие собственной плитки теряет следующий ночной показ навсегда

**Места:** `obs-panel.ts:718–735`, особенно ранние выходы `722–723`; `577–591`; scene event `1615–1623`; общий peer CSS `auto-start.ts:1169–1190`.

Устойчивая NIGHT, видны обе роли, latch=visible. Сайт временно убирает own tile. Приходит DAY scene-event: общий gate немедленно прячет peers, но own targets нет, поэтому heal выходит, **сохранив visible latch**. Own remount → до regular DOM-heal приходит NIGHT. Новый heal видит «нет hidden-пина + cached visible» и считает всё выполненным; `nightShow` не отправляет. Общий CSS, поставленный уходом сцены, остаётся.

На NIGHT+12000 мс **`00` вместо `11`**; последующие 2-секундные heals повторяют тот же early return. V/status/new game не нужны.

`audit5-obs-short-races.test.ts`: foreground gaps **0/1 мс FAIL**, **16/100 мс PASS**; настоящий client transport при gap=1 FAIL. Для hidden tab с нормальным 500-мс flush **100-мс gap тоже FAIL**. Контроль с сохранённым own-root при тех же двух scene-events PASS. Частота такого remount/order живьём не измерена; сами ordinary DOM/event interleavings не запрещены контрактом.

### H03 — ВЫСОКАЯ, «от игрока / зеркало»: поздний remove старого disconnect сбрасывает новую settled NIGHT

**Места:** `obs-panel.ts:499–519` — runtime reset после `await storage.local.remove`; caller `1632–1642`.

Settled NIGHT → disconnect; удержать completion удаления `obs_auto_scene_state`. Немедленная защита disconnect работает. Reconnect со свежей NIGHT → спустя 6500 мс обе роли видны. Теперь завершить **старый remove**: его продолжение без epoch-guard обнуляет свежие currentTimeOfDay/latch и вызывает heal. Фаза неизвестна → own-pin скрывает свою роль, хотя новая NIGHT подтверждена; peers остаются открыты.

Красный `late disconnect storage cleanup must not erase a newer settled private night`:

```text
после старого completion: +0 / +100 / +2000 мс → 01
                         +6000 мс           → 11
expected на всех точках:                        11
```

Это **не вечное скрытие**, а многосекундное зеркало вне D/day исключения, поэтому HIGH по заданной иерархии. Управляемый медленный storage completion — условие пробы, не нормальная/измеренная latency. Здесь reconnect смоделирован свежим status/event, не новым socket; ошибочное продолжение находится в настоящем consumer producer после await, а не в уже исправленном отрицательном get_status.

## 4. Подтверждённые границы и конфликт политики — отдельно от основного счёта

### 4.1. SPA/identity/legacy: исполнимый контракт, не доказанная штатная навигация текущего сайта

Публичный текущий frontend использует full-document `/game` переходы, часто с game_id в query; pushState игрового router не установлен. Поэтому эти красные проверки **не выданы за обычные live-инциденты**. При этом это не амнистия заявленному SPA-контракту и не уже принятые «два pushState без мутации».

| ID, направление / условная серьёзность | Точный контрпример, production-строки, доказательство |
|---|---|
| C01, «в эфир», условный БЛОКЕР | AH/phase OFF, OBS auto ON, actual modeled DAY, старый стол `00`. Новый pathname+table: immediate `checkGameRoute` (`auto-start:687–725`, особенно 700/721) обнуляет sceneHide и снимает CSS; own shield остаётся, peers открыты до regular OBS route check (`obs-panel:1387–1405,1425–1427`). На +16 мс **01**, позже00. `audit5-matrix-witness > unsafe DAY new room…` FAIL; AH/phase ON controls PASS. Safe NIGHT/unknown variants могут остаться011, это зеркало, не публичный DAY leak |
| C02, направление «в эфир» источника, условный БЛОКЕР/высокий перенос старого решения | Old NIGHT timer pending + V; выход в search с DOM replacement, **доставленным MO**, +40 мс возврат на тот же pathname и новые roots без phase. Auto-start reset увидел выход, OBS regular subscriber склеил две мутации и выхода не увидел. Старый timer path-string совпал, queued nightShow возникает уже после reset. V-up через12с даёт **11 и ещё12с11** вместо00 (`obs-panel:773–790,1387–1405`; auto-start:905–922,1155–1161). Gaps1/16/40/100 FAIL, 251/500/1000/2500 PASS; explicit day PASS. Program в свидетеле NIGHT: публичная утечка не доказана |
| C03, «от игрока», условная ВЫСОКАЯ | Старый поддерживаемый **legacy inline** hide, V lifts → новая комната/новые roots, AH/phase/OBS OFF → V-up пишет старый `peekRestoreInline` на новую own-role: **01 навсегда**. `auto-start:710–722,894,909`; `matrix-witness > old legacy inline…` FAIL. Обычный fresh production initial legacy hide не создаёт; CSS-only control PASS |
| C04, «от игрока», условная ВЫСОКАЯ | Сохранён **настоящий F-produced DOM** при смерти runtime; новая копия с faker OFF не вызывает единственный `sweepOrphanFake` (`role-faker:91–111,486–489`, manager:89–106). isFaked=false, old own=#godfather, peer hidden/shield, V не показывает peer, E не связан. `matrix-witness > conditional new runtime…false` FAIL; fresh faker ON PASS. Обычный F5 уничтожает DOM, Chrome update автоматически новую копию не внедряет: штатная достижимость не доказана, прежний общий orphan-риск не пересчитан новым безусловным дефектом |
| C05q, оба направления, условные БЛОКЕР/ВЫСОКАЯ | Query `/game?game_id=410→411` **с новой DOM table**, pathname прежний: оба новых route guards не сбрасывают игру (`auto-start:687–694`, `obs-panel:1387–1392`). AH-only old D-show остаётся11 вместо00; без автоматики old D-hide остаётся00 вместо11. +16 и +12016 мс. Это same-document contract probe, не доказанный текущий site router |
| C05r, оба направления, условные БЛОКЕР/ВЫСОКАЯ | Та же комната, terminal ended4с → pregame10с → новый dealing, URL прежний. AH-only/без автоматики сохраняют старые Show/Hide/V. Поддержка повторной комнаты прямо описана production (`obs-panel:98–103,898–907`), но authenticated повторный серверный запуск не измерен. **С видимым ended AH+phase и OBS-only восстанавливаются**, их не называют повсеместно сломанными |
| C06, «в эфир» источника, условный БЛОКЕР | Pending persisted restore old room → новый pathname/unknown phase/reset уже скрыл00 → старый get completion напрямую restore/release/nightShow даёт11 на+16. `obs-panel:534–566`; `audit5-obs… > SPA CONTRACT RED: old pending restore…` FAIL. Это ещё один эффект B03 unguarded restore, не отдельный primary root cause; Program=NIGHT |

Машинная матрица содержит все исходы, включая промежуточные unsafe/unknown/V варианты, не только выбранные свидетели: `main-matrix-confirm.json`.

### 4.2. Короткое окно нового phaseNow: панель ещё не знает о дне, который уже увидел auto-start

`obs-panel.ts:789–790`; `auto-start.ts:1164–1167,1220–1227,1242–1248`. На +2900 мс ночного pending-show приходит настоящий DAY DOM. Immediate auto-start уже скрывает00 и заканчивает ночь. Через116мс старый OBS timer ещё видит панельную NIGHT, шлёт nightShow; clamp старой эпохи к lastDaySeenAt позволяет удалить свежий дневной CSS. Источник **11 на day+116мс**, на day+1116 снова00; day за600мс до timer — PASS.

`audit5-obs-short-races.test.ts > game day in final 100ms…` FAIL. **Эфир в этой пробе остаётся приватной NIGHT до нормального pre-day барьера**; публичного DAY-кадра не доказано. Риск — условный БЛОКЕР «в эфир» при захвате этого источника, а не ещё один доказанный публичный leak в основном числе. Это обход по ещё не подтверждённой фазе, не старый late-success после уже известного панели DAY.

### 4.3. Не подтверждённые физически/серверно варианты и отвергнутый API-only счёт

* `code=KeyJ,keyCode=68` принят native как D, а наш code-gate не принимает Show — красная event-contract проба. **Условная HIGH «от игрока»**; физические Dvorak/Colemak/Firefox события не измерены.
* F уже active, real same-root sheriff→civilian, ещё до regular reconcile через1мс нажать **F**, затем после600мс E: вернётся stale sheriff. `role-faker.ts:405–448` не захватывает новый real перед очередным F; новый E-capture уже поздно. **Условная HIGH «от игрока / неверная настоящая роль»**, не privacy-flash. Не принятая same-as-fake неоднозначность: old true=sheriff, new true=civilian, fake до/после=godfather/mafia. Direct E, поздний F и новый root PASS. Легальная same-root серверная смена своей роли не установлена.
* Direct `obsPanelFeature.update(OFF)` во время её pending `enable()` краснеет, но **штатный FeatureManager сериализует эти вызовы**. Это API-contract-only, не popup production-дефект. DOM/scene/key события во время enable, напротив, не сериализованы manager и используются в B03.
* Legacy CardSelect, повторный viewer permission/reconnect, настоящая смерть/двойное внедрение content, долгие OBS transitions — прежние живые границы, не новые безусловные находки без доказанной доставки.

### 4.4. P01 — конфликт оракула: «под V видно всё» против намеренного day fail-safe

Направление **«от игрока»**; **HIGH при буквальном безусловном V-правиле**, но это **не новый production-регресс/блокер**. В основном счёте отдельно: **1 конфликт требований**.

Пользовательский оракул не задаёт приоритет между «V удерживается — видно всё» и «день — скрыто». Его явные исключения D/own-pin, F+V и новая игра под V не разрешают обычную смену дня в той же игре. Старый замысел, напротив, явно допускает гашение peek днём (`role-pin.ts:217–224`, существовало до обоих проверяемых коммитов; auto-start:747–760 прямо называет это fail-safe).

Новый свидетель: night-show11 → D-hide00 → Vdown+16=11, isPeeking=true → retained Text-node DAY → **в том же MO и на+16:00, isPeeking=true**, V физически не отпущена. Буквальное «под V всё видно» — FAIL; прежний fail-safe — PASS. `audit5-fuzz-policy-conflict.test.ts`: **1 FAIL / 1 PASS**. В копии исходного fuzz только добавлена последовательность `hide→Vdown→day→Vup→wait`: неизменённый Spec **PASS**, поскольку итог под spec.peek пропущен. Это не разрешение конфликта тестом; тест избегает решения. Изменения политики или патчи здесь не предлагаются.

## 5. Доказательная трасса A–F: что проверено и где вердикта «чисто» нет

### A. Все писатели и таблица силы

| Писатель / file:line | Слой / remount / приоритет |
|---|---|
| Сайт, §2 | Обычный inline display каждой role через vShow; новый root получает current flag. Родитель connectedToRoom и отсутствие role/isJudge отдельны |
| `auto-start.ts:555–560` | `pn-role-display-override`: stylesheet display:flex!important сильнее обычного native inline display:none; переживает root replacement |
| `auto-start.ts:493–528,532–548` | `polemica-role-hide`: visibility:hidden/opacity0/pointer-events:none!important на role и roleReveal, единственное общее скрытие стола; remount защищён заранее |
| `auto-start.ts:437–483` | Legacy inline visibility/opacity/pointerEvents; show снимает, peek может вернуть; pinned цели пропущены. Сам по себе новый root не наследует старые inline свойства |
| `role-pin.ts:123–181` | Own inline!important + data-pn-role-pin; **production OBS вызывает hidden/release, не visible**. Inline!important сильнее stylesheet!important на том же узле |
| `role-pin.ts:49–64,236–277` | `pn-role-pin-shield` + html data-pn-own-role-hidden: заранее защищает новый own root; lift/release снимают root attribute, restore возвращает |
| `role-faker.ts:238–301` | Peer inline visibility:hidden!important + data-pn-fake-hidden, priority snapshots; E/disable возвращают свои значения, не снимая чужой CSS/pin |
| `role-faker.ts:54–84` | `pn-role-fake-shield` + html data-pn-role-faked: root без data-original-role, чужой use, tooltip и reveal скрыты до reconcile; inline!important и descendant visibility оцениваются отдельно |

Visibility наследуется, но ребёнок может задать свою; opacity0 role-предка подавляет всё поддерево. Display override не создаёт отсутствующий span, не раскрывает скрытого display:none родителя и не отменяет pin/fake opacity/visibility. Поздний порядок таблиц не побеждает inline!important; «последняя запись» сама по себе не таблица силы.

**Проверено и чисто в текущем src:** новых inline display writers игровых role-root не найдено **по всему src**, не только в трёх latch-файлах. Свежий TS AST-список `style-sinks.json` проверил **181 sink**: прямые/computed style assignment, cssText, setAttribute(style), set/removeProperty, Object.assign. Generic match-stats helper относится к таблице разбора; panel-chrome — к собственным панелям; player-notes display — к видео; protocol-emoji — к своему sprite. Scoped `#stop` CSS на match-page не новый writer текущей роли. Это ревью известных sinks, не доказательство невозможности любого намеренного alias обхода.

Каскад и новое монтирование проверяют matrix и прежние pin/faker suites; computed CSS в настоящем Chrome подтверждён для B02/H01/B04. Нейтрализатор другого независимого секретного site-hide на том же span в скачанном renderer не обнаружен (§2). Синтетических D/Ctrl+D, native WeakSet и suppression250 на HEAD нет; атака на них как живой канал бессмысленна.

### B. Явная исполнимая таблица состояний

```text
AH(2) × phaseSwitch(2) × obsEnabled(2) × obsAuto(2)
× siteModifier(2) × phase(day/night-transition/bootNight)(3)
× scene(NIGHT/DAY/disconnected)(3) × initialNativeFlag(2) = 576
```

Actual — настоящие auto-start, obs-panel, role-pin, role-faker, keyboard, SharedDomObserver. Моки env/storage/transport; native dispatcher настоящий, vShow-write микрозадачей. CSSOM evaluator учитывает stylesheet!important, inline!important и display/opacity предков; geometry задаёт и rect, и offsetWidth/Height. Fake performance-clock между запусками монотонен; ранний артефакт rewind устранён, не использован как находка.

Независимая baseline-формула: при effective OBS auto видны все только при night+NIGHT; без него phaseSwitch определяет день/ночь; без фазовой власти initial hide задают AH/native false. D снимает общий hide, не дневной own-pin; F оставляет peers hidden, V под F их не открывает, E возвращает содержимое. Это явный контракт, не импорт production Spec.

| Подматрица | Запуски | Сравнения | Mismatch |
|---|---:|---:|---:|
| 576 steady cells: native, D/repeat, V/blur, F/V/E+icon, root remount | 576 | 8064 | **0** |
| Каждый AH/phase/OBS/OBS-auto OFF/ON под V, pending/settled | 64 | 128 | **0** |
| Marked orphan pin/fake, fresh faker ON | 8 | 32 | **0** |
| Изолированный/общий teardown под V, +6/+12с | 64 | 128 | **0** |
| Прежние SPA/reason/old-night сценарии | 71 | 246 | **0** |
| Новые OBS route: first/changed/back × phase × V × scene | 108 | 864 | **394** |
| Legacy inline V snapshot, новые/сохранённые roots | 8 | 16 | **8** |
| Old pending NIGHT, same-path короткий выход/возврат | 24 | 240 | **2** |
| Тот же путь, exit gaps1…2500 × AH × explicit-day/unknown | 32 | 128 | **16** |
| Настоящий saved F DOM, fresh faker OFF/ON | 8 | 48 | **11** |
| Query/repeat identity × ended/no-ended × owners × show/hide/V | 48 | 120 | **52** |
| **Всего** | **1011** | **10014** | **483** |

Основной аудитор повторил: те же 483 несовпадения. **Чисто ровно в нулевых подматрицах**, не всё произведение всех возможных миллисекунд, remap, серверных состояний и комбинаций настроек. В частности полный путь FeatureManager и неожиданный intermediate site DOM проверялись отдельно — B04/B01; 576 steady cells их не обещают.

### C. Время, очереди, гонки и стоимость immediate

| Цепочка / окно | Проверенный результат |
|---|---|
| Vue microtask → immediate MO → paint | При корректном phase DOM скрывает до первого rAF; B01 показывает, что «немедленно» не означает «верно истолковано» |
| Старые native restore150×5, verify500, retry1000, rearm600 | **Удалены** вместе с native synthetic-toggle архитектурой; двойного native D на одно намерение больше нет |
| Auto night3000, backoff2000, recognition slack2500 | Обычный manual-pending защищён; false day создаёт новую эпоху — B01; false-negative manual — B02 |
| Auto scene-deferred2000 | Код остался, но при OBS auto callback отдаёт показ OBS до этой ветки, без OBS gate=true. Недостижимую ветку не оживляли противоречивыми mocks |
| Phase150/interval1000, startup deferred2000 | Synchronous AH/phase enable и обычный Text day проходят; полный startup до OBS — B04 |
| OBS detect150+confirm350, pre-day30 | Нормальная дневная команда скрывает peers заранее; restore caller обходит барьер — B03 |
| OBS visibility3000, retry500/250×5, heal2000 | Starvation одинакового pending закрыт; отсутствующий own-target даёт новый latch-hole — H02 |
| Новый phaseNow / late NIGHT success | Уже подтверждённый панелью день защищён; ещё не подтверждённый день auto-start имеет короткое окно §4.2 |
| status/list/session/ACK | Прежние guards latest sceneEventSeq/session, negative status и currentScene=null проходят. Stale persisted **phase** и remove continuation не защищены теми же guards — B03/H03 |
| Regular rAF/250, hidden-tab500 | Не задерживает immediate; но сохраняет различие наблюдаемой route/own-remount истории — H02/C01/C02 |

Проверены, в соответствующих probes, 0/1/16/40/50/100/116/149/150/200/250/251/300/350/400/500/600/1000/2500/2900/2999/3000/3016/3500 мс, многосекундные delayed API и ожидание12с. Не заявляется исчерпание всех interleavings. Обычный D через100мс после V-up, повтор V через50мс, modifier-repeat активного peek — прежние контроли зелёные; это не оправдание новых native acceptance дыр.

**CharacterData/performance, отдельный Chrome155:** `browser-result.json`, настоящие auto-start/SharedDomObserver. Ночной11 → retained Text-node DAY: первые **три rAF00**. 100 последовательных Text-изменений таймера дали ровно100 immediate callbacks, idle100мс — **0** новых callbacks; самоподдерживающаяся петля не обнаружена. Между sentinel callbacks вокруг production immediate: unrelated Text batches1000/4000/10000 записей — примерно **0,7/1,3/2,5мс** на этой машине. Это не weak-CPU SLA и не все active-phase batches. Immediate не имеет regular cap4000/ownRoots-фильтра; characterData обычным subscribers не доставляется (`dom.ts:130–166`). Свои записи остаются идемпотентными на проверенном пути.

### D. Клавиатура

Трасса: window capture router → typing/IME gate → hold/binding/KeyD observer → независимый window heldKeys tracker → document capture command mark → native document hotkeys → Vue flush → immediate adoption. StopPropagation на window не отменяет соседний window listener; новый F5 `keyboard.isBound` guard это учитывает.

**Проверено и чисто в перечисленных regressions/клетках:** D/V first/repeat/up, Shift, Ctrl/Alt/Meta repeat активного V, русский key при physical code, CapsLock после отпускания, textarea/input/select/contentEditable и IME229/isComposing, blur/visibility release, пустой V/native camera при доступности, пустой peek=D не отдаётся native D; F не показывает hidden, F+V не показывает peers, E/disable восстанавливает своё. Старый F5 conflict не воспроизвёлся. Целевые прежние keyboard/pin/faker/auto-start/audit2/3/4 controls — **160 PASS**, site controls — **24 PASS**.

Для site m/l/g/k/r/цифр/F1–F10 проверены прежние разрешённые различные remaps и router-сценарии, не все физические browser-default actions. Popup коллизии запрещает; crafted storage одинаковых binding не выдан за разрешённый обычный профиль. Native functions на remapped не-D F/E могут дополнительно вызываться — это само по себе не новый дефект видимости. Настоящие dead-key/AltGraph/IME/OS dialogs, keyup в другом окне и физические альтернативные layout требуют живой проверки.

**Нечисто:** accepted/rejected native команды не совпадают с новым gate — B02/H01. Readonly «site принимает, мы не считаем» — **заранее принятое ограничение**, не пересчитано. Сайт/другое расширение, которое прямо меняет DOM, не противник, от которого удалённый WeakSet когда-либо давал конфиденциальность. На HEAD нет наших синтетических Ctrl+D, следовательно нет действующего вопроса об их bookmark/default побочном эффекте.

### E. Lifecycle

**Чисто в проверенных подматрицах:** все 64 original individual/all teardowns под V на+6/+12с; каждый скрывающий setting отдельно OFF/ON в64 run-settings; новая игра с AH/phase по прежним 246 сравнениям; marked own-pin/fake orphan sweep при включённом fresh faker; обычные F/E/F-disable, сохранение чужого CSS/pin/priority; changed-path old timer в прежних сценариях. Это не все окна pending restore/remove и не все варианты отсутствующих узлов.

**Нечисто:** B04 целый старт/master enable, H02 отсутствие own между scene-events, H03 reconnect после pending remove, B03 async restore, C01/C02 короткий route/V с разной историей владельцев, C03 legacy V snapshot, C05 game identity.

При смерти content-context DOM сохраняет hide/override, оба shield-style, html `data-pn-own-role-hidden`/`data-pn-role-faked`, inline/data-* на roles. Щиты без html-атрибута инертны. Fresh enable чистит marked pin, faker sweep запускается только при enable faker — C04. **F5 уничтожает документ**, это не reinjection поверх старого DOM. Chrome обычно не внедряет новую копию автоматически после extension update (`content/index:253–262`, `orphan-watch:4–13,83–101`); старый JS может остаться без OBS messaging. Баннер не доказывает безопасность ролей; installed update/Firefox требует ручной сессии. Прежний общий условный orphan-риск не представлен как новая безусловная утечка.

Две вкладки не делят DOM/pin-состояние, но делят OBS/background и общий persisted phase. Ownership не равен приватности захватываемого другого окна. Настоящий двухоконный захват не проверен; `not_owner` в матрице — реальный отказ команды, а не фиктивный успешный switch.

### F. Адекватность тестов и мутации

| Ослабление | Проверенный предел актуального fuzz |
|---|---|
| `ptt` | Blanket exemption убран; управляет генератором/native set. Нет Meta-tail/modifier-down/up/input-held веток — B02 |
| `held` | Sent physical down, не факт успешного startPeek. Нет реального pin owner, burst принудительно отпускается; не все длинные held sequences |
| `showDue` → autoShowDue | Индексы12-секундных шагов, а не Date.now/slack2500. Burst subactions одного шага; deferred Set агрегирован после settle, не независимый scheduler |
| `peekActive` → spec.peek | Заводится из Spec.hidden, не actual isPeeking/liftPins. Под ним итоговый compare пропущен; одинаково скрытые роли удовлетворяют mirror. Vtap не проверяет обязательную видимость внутри40мс — P01/Q01 |
| `sceneRestore` → spec.sceneHide | reason/cssPre/manualStep улучшены, но OBS safe/auto/2с poll — mock. Нет настоящих pin/shields, sessions, restore/status/list/ACK, владения и отдельного phase recognizer |
| Sampling | +50мс до1с, затем250мс; first trace без mirror-check, flips только ordinary actions, не bursts. Между выборками может целиком пройти show-hide pulse |
| Site DOM | Все роли уже существуют до enable, setPhase через textContent/childList, handwritten hotkeys; immediate mock **без characterData**, в отличие от production. Нет late first mount, старого DAY countdown, полной потери own, route/меню |
| CSS oracle | Computed style лучше прежнего ID-only и убивает пустой CSS, но не доказывает ancestor/clip/tooltip/use/reveal/Program pixels |

`obs-role-latch.test.ts` — **source slices/regex**, не поведение/AST. Он полезен как tripwire, но наличие guard-строки не связывает её с правильной эпохой/узлом/производителем. Глобальный AST-просмотр A дополняет запрет display; «нет inline display» не означает «нет новых B/H».

Свежие контрольные oracle-мутации в отдельной копии:

| Мутация | Результат |
|---|---|
| Q01, startPeek не снимает общий CSS | **26 runScenario PASS**; целый fuzz28PASS/3FAIL, независимая short-probe красная на+16мс |
| Q02, пустой hide stylesheet с прежним id | **0PASS/31FAIL** fuzz |
| Q03, пустой override с прежним id | **25PASS/6FAIL** fuzz |
| Q04, искусственно снять hide на +1050…1100мс | **31PASS fuzz**, но полная исходная suite **1902PASS/3FAIL**; новая short-probe красная |

Q04 — **не существующая утечка HEAD**, а доказательство слепоты конкретного sampling. Полная suite её убивает. У Q01 raw3FAIL не три независимых killers: два standalone V-теста валятся отдельно, третий «сайт сам скрыл роли» отдельно PASS. После упавшего assertion standalone cases не доходят до cleanup; общий afterEach очищает timers, но не feature/listener/peeking, загрязняя следующий тест. runScenario использует finally. Это реальная граница интерпретации kill-count, не скрытое ослабление результата.

#### Каждый исторический смысловой откат по одному

Каждый откат отдельно применён к архиву **этого HEAD**, не к production shared-copy и не слепым revert целого коммита. Основные42 мутации: **34 файла / 426 baseline PASS**, включая committed audit2/3/4, fuzz с дефолтными60 seeds, **не5000**. Дополнительные A12/A13 проверены сокращёнными targeted-профилями, D01 — только `audit4-survivors`; полный профиль или fuzz на них не заявляется. Каждый survivor затем прошёл полные **127 файлов / 1905 PASS**. После восстановления mutation-copy — снова **1905 PASS**. Все45 опытов завершены; apply/syntax/import/timeout/infrastructure errors — **0**. Наличие assertion в afterAll матрицы не выдавалось за load-error; у каждого killed есть также failed testcase. Четыре oracle-контроля Q01–Q04 в45 не включены.

K — killed, S — survived. A* — `057ded0`; B*/C*/D01 — `f3988e6`. Это ID **мутаций**, не номера production-находок выше. В таблице указан хотя бы один действительный killer; полные имена assertions, отдельные patches/команды/JSON — `F-final-mutation-summary.json`, `mutation-F-results.json`, `mutation-F-logs/`, `extra-F-results.json`, `oracle-F-results.json`.

| ID | Смысловой откат | Итог / защита |
|---|---|---|
| A01 | Native-hidden только #stop | K: role-pin; **retired helper без production caller**, не live-гарантия |
| A02 | Inline show снимает native display | K: latch/fuzz/auto-start и интеграции |
| A03 | Inline hide пишет display:none | K: **только source-latch** |
| A04 | Visible pin снимает display | K: latch/role-pin |
| A05 | Lift снимает display | K: latch/pin/audit4-matrix |
| A06 | Release возвращает stale display | K: latch/pin/audit3-matrix |
| A07 | Faker скрывает peers через display | K: latch/faker |
| A08 | E возвращает stale display, initial/late snapshots | K: **только source-latch** |
| A09 | Adoption не узнаёт native display:none | K: fuzz/auto-start/late-mount и интеграции |
| A10 | Нет настоящего override native hidden | K: fuzz/latch/OBS/site интеграции |
| A11 | E теряет visibility priority | K: audit3-test-faker-priority |
| A12 | inlineHidden принимает native display:none за наш hide | K: fuzz |
| A13 | Show возвращает stale display из snapshot | K: latch/fuzz/auto-start |
| B01 | Active hold-down доходит native | K: fuzz/keyboard/audit2/3/4 |
| B02 | Active hold-repeat доходит native | K: keyboard/audit2/audit4 |
| B03 | Active hold-up доходит native | K: keyboard |
| B04 | Пустой hold глушит native camera | K: keyboard/audit2 |
| B05 | Release не возвращает CSS при settings OFF | K: fuzz/auto-start/audit4 и другие |
| B06 | Release игнорирует manual-night | K: fuzz/auto-start/интеграции |
| B07 | Release всегда получает sceneSafe=true | **S, 1905PASS**; последующий синхронный gate компенсирует visible output |
| B08 | Modified native D не отмечается manual | K: fuzz/audit2 |
| B09 | Default D-repeat отдаётся сайту | K: fuzz/audit3-matrix |
| B10 | Modified D-repeat отдаётся сайту | K: fuzz |
| B11 | Own hidden-pin блокирует общий Show | K: auto-start/audit2/3/4 |
| B12 | Night callback переигрывает manual старше backoff2с | K: fuzz/audit3-adoption |
| B13 | Нет scene subscription auto-start | K: fuzz/OBS интеграции |
| B14 | Heal не уведомляет общий gate | K: OBS integrations/audit4-survivors |
| B15 | Нет pre-day notification | K: outbound-day OBS integrations |
| B16 | Scene-off не прячет после manual | K: fuzz/OBS интеграции |
| B17 | Нет scene sync на V-release | K: audit3-adoption/real-obs/audit4-matrix |
| B18 | Нет pin shield | K: pin/audit2-fake-lifecycle/restore-shield |
| B19 | Нет fake shield | K: faker/audit2/3/4 |
| B20 | Teardown вызывает stopPeek() вместо stopPeek(true) | **S, 1905PASS**; старый native async tail удалён, синхронный disable компенсирует |
| B21 | NightShow не снимает scene-only hide | K: audit3-test-real-obs/survivors |
| B22 | Disable оставляет scene listener | K: audit3-test-real-obs |
| B23 | E/disable оставляет fake shield | K: faker/audit2/3/4 |
| B24 | Release оставляет pin shield | K: pin/OBS integrations |
| B25 | Lift оставляет pin shield | K: pin/audit3/4 |
| C01 | RestoreLiftedPins не перевзводит shield | K: audit3-test-restore-shield |
| C02 | Phase не сбрасывает deferred-log flag | **S, 1905PASS; obsolete/equivalent**: true-writer недостижим |
| C03 | Modified native D разрешён под active V | **S, 1905PASS; неэквивалентный пробел tests**, отдельное доказательство ниже |
| C04 | Modified native D разрешён под F | K: **audit4-survivors** |
| C05 | Release не чистит swallowed-state | K: keyboard/fuzz/audit2 |
| C06 | Старая off-функция стирает новый gate-listener | K: **audit4-survivors** |
| D01 | Notify listener без exception containment | K: **audit4-survivors**, escaped sentinel exception — failed testcase |

**Итого41K/4S.** Базовый42-case набор дал38K/4S; дополнительные A12/A13/D01 — все K. Это свежий запуск: прежний audit4 C03 был killed, **на данном HEAD он действительно survived**. Ни старый kill, ни старые survivors не перенесены как текущие результаты.

**C03 HEAD-pass/mutant-fail свидетель:** `audit5-fuzz-survivor-C03.test.ts`, настоящий native dispatcher. Native flag=false, AH/phase OFF. Vdown включает peek; Ctrl+D под ним HEAD подавляет, мутант пропускает и незаметно меняет native parity false→true. Обе версии под V показывают11, после V-up обе скрыты00 — простая проверка пикселей это пропускает. Следующий принятый Ctrl+D: HEAD false→true показывает11, мутант true→false оставляет00. Две независимые проверки (zero native toggles под V и следующий Show): **HEAD2PASS, C03mutant2FAIL**. Это доказанный gap исходных тестов, **не production-баг неизменённого HEAD**.

Для B07/B20 не установлен новый visible counterexample; компенсация не названа доказательством глобальной эквивалентности всех внутренних reason/timestamps. C02 — недостижимая лог-ветка. A01 — тест мёртвого helper; A03/A08 — source-only. Поэтому41/45 нельзя превращать в «91% безопасности пользователей».

Финальный `F-final-source-integrity.json`:266 tracked-входов совпали с HEAD в original/shared/oracle/restored-mutation копиях. Новые probes не входили в killers исходного профиля. Основной аудитор отдельно повторил HEAD2PASS C03 вместе со всеми87 новыми тестами.

Удалённые synthetic D/Ctrl+D pair, WeakSet/suppression250, synthetic-faker bypass, tracked/native toggler, native restore150×5/verify500/retry1000/rearm600 — **obsolete архитектура**, не survived/killed возврат целого модуля ради числа. Текущие смысловые преемники испытаны там, где существуют. API/source-only kills не названы пиксельным доказательством. Survivor не равен production-дефекту неизменённого HEAD.

## 6. Что невозможно доказать без живой игры; ручной чек-лист

Не проверены installed-extension миры/обновления двух браузеров, реальные server phase/card/permission sequences, распределение storage/runtime latency, физические IME/layout/default actions, настоящие OBS transitions и **записанные Program кадры**. Headless computed/rAF — доказательство renderer-механики, не захваченного стрима. Нельзя честно обещать100% по конечному набору offline сценариев.

Проверять **локальной записью, не публичным эфиром**, Chrome и Firefox отдельно. Одновременно видеть игровой источник/окно игрока и Program; 60/30fps покадровый просмотр, отметки D/V/фаз/сцен; сначала реальные сохранённые настройки владельца, затем контрольный профиль.

| Действие | Ожидание на экране/в записи |
|---|---|
| AH+phase ON, OBS auto OFF; speech→toNight с countdown; после ночного show скрыть D, ждать shooting/конца countdown | Manual hide остаётся на всю **эту** ночь; own/peer/reveal не открываются повторным night-show. Записать current/next/temp и nightAction; отдельно игрок без действия/зритель |
| Устойчивая ночь, modifier ON: PTT+Meta→Cmd+D hide→отпустить всё→V tap | После V-up обе роли снова скрыты и остаются скрыты12с; сравнить simple Cmd+D без PTT |
| hide=H, modifier ON: native hide→H-show→H-down держать→Ctrl+D Show | Реально принятый native Show показывает весь стол без нового D/F5; тест вне OBS day pin |
| Лобби без roles, plain-D профиль/hideH: D-hide→H-show→Ctrl+D→закрыть bookmark UI→раздача | Отвергнутая сайтом комбинация не отменяет последнее Show; повторить Ctrl+Meta+D и mount позднее700мс |
| F5/start либо master OFF→ON; только OBS auto, statistics ON, webSocket disconnected/не NIGHT; новые роли | После начала enabled-настроек нет окна открытых own/peer во время загрузки заметок; сравнить AH ON/statistics OFF. Измерить реальную latency, не подставлять100мс как факт |
| F5 на NIGHT при persisted DAY, во время restore показать D; либо live NIGHT успевает распознаться | До любой DAY-команды обе роли/reveal скрыты. Старый phase restore не направляет дневную сцену с открытыми peers; записать outbound/ACK/event порядок |
| Ночная роль-плитка пересоздаётся; быстро NIGHT→DAY→NIGHT, отдельно фоновая вкладка | После подтверждённой NIGHT+3с обе роли видны без D/F5; временное отсутствие own не теряет nightShow |
| Disconnect→reconnect на NIGHT, параллельно медленный storage/нагруженный профиль | После settled show нет нового own-hidden/peer-visible зеркала от старой очистки; сверить поздние storage completions |
| DAY наступает за0…500мс до окончания ночного show timer | Источник не открывает заново дневные роли; проверить Program и время подтверждения OBS-фазы отдельно |
| Настоящий «Промах», retained Text-stage, ночная пауза/возобновление | Первый дневной кадр уже hidden; пауза не создаёт ложный день/новую ночь, manual hide не теряется |
| Каждый AH/phase/OBS-auto/integration OFF/ON под V и на+2,9с pending; disable каждой фичи | Снятые автоматические слои не воскресают; manual остаётся; own/peers согласованы, кроме явного D/day pin и F |
| Реальный выход/возврат в ту же комнату; query game_id/повторный матч, если поддерживается same-document | Установить actual navigation/server путь. Новая игра не наследует manual/V/OBS pending старой; на первом кадре действует новый privacy режим |
| Extension update/reload во время F/V/ночного show, затем F5; Chrome и Firefox | Различить orphan и новый документ; нет stale shields/visible-pin/ложной роли; баннер не считать подтверждением приватности |
| F→реальная проверка/смена своей роли/новая игра; быстро F→E, hover | Под F не мигает настоящий use/tooltip/reveal; E возвращает **актуальную** настоящую роль. Установить, бывает ли same-root real change |
| Две вкладки одной игры, разные активные/свёрнутые окна, смена scene owner | Безопасна именно захватываемая вкладка; отказ not_owner не считается подтверждённой NIGHT |
| OBS длинный fade/studio mode/manual transitions >3с, disconnect в переходе | Имя NIGHT не выдаётся за исчезнувшие пиксели игрового источника; в фактическом Program нет кадров с приватными ролями |
| Legacy/modern раздача, viewer reconnect, roleReveal, postgame/mobile | Проверить реальные альтернативные выдачи и приватность; CardSelect вне role-span не раскрывает секретную карту посреди захвата |

Для P01 отдельно требуется однозначный выбор ожидаемого приоритета **день против уже удерживаемой V**. Аудит зафиксировал конфликт, не выбрал новую политику за владельца.

## 7. Вердикт

**К релизу с гарантией «роли никогда не появляются и не исчезают сами» сборка не готова; уверенность в отрицательном вердикте — 99%.**

Основание — независимые повторяемые контрпримеры на неизменённом production, настоящие скачанные site renderer/dispatcher/adapter, настоящий OBS-client transport и отдельные Chrome-контроли. 99% — уверенность в опровержении общей гарантии, **не вероятность пользовательской утечки и не процент покрытия**. До100% не доводят отсутствие installed/live/Program записи и неизвестная частота timing-условий. Зелёные1905 тестов,5000 seeds и убитые исторические мутанты не отменяют этих контрпримеров.

## 8. Статус исправлений (21.10.2026, после отчёта)

До правок на HEAD воспроизведены все 37 красных проб и красная матрица (483 несовпадения). После правок — все зелёные; матрица аудитора **10014 сравнений — 0 несовпадений**. Пробы перенесены постоянными тестами `tests/unit/audit5-*`. Пробы с полным бандлом сайта (`audit5-site-renderer`, настоящий Vue/Room/Roller) прогнаны и не коммитились; B01 закреплён собственным `audit5-transient-day.test.ts`. Модели сайта в тестах переведены на настоящее поведение обёртки хоткеев (`preventDefault` на принятом хоткее).

| Находка | Статус | Что сделано |
|---|---|---|
| B01 ложный день роллера | исправлено | День прячет сразу, но заканчивает ночь (эпоха ручных решений, ночь OBS, `lastDaySeenAt`) только продержавшись 2 с. Переходная подпись — та же ночь; при автосценах показ этой ночи возвращается сам (`obsNightResume`). Эталон фаззера обновлён |
| B02/H01, §4.3 KeyJ | исправлено | Команда ролей сайту = D (keyCode 68), дошедший до document, после которого обёртка хоткеев сайта вызвала `preventDefault`. Модель зажатых клавиш удалена: Meta-tail, проглоченные/набранные клавиши, чужой профиль модификатора, Ctrl+Meta+D, readonly-поле и не-QWERTY решает сам сайт |
| B03, C06 | исправлено | Снимок фазы из storage устарел после любого живого знания фазы (`phaseEpoch`) или смены комнаты (`routeEpoch`); дневной — через pre-day. Попутно найдено пробой и исправлено: ручной показ отключал перевзвод сценового скрытия, и `beforeDayScene` его не возвращал — теперь каждый переход на дневную сцену перевзводит скрытие |
| B04 | исправлено | Автосцены, включённые настройкой, прячут стол с включения auto-start, не ожидая obs-panel; obs-panel и подмена включаются сразу после auto-start; obs-panel лечит пин при старте слежения |
| H02 | исправлено | Нет своей плитки — латч видимости своей роли сбрасывается, следующий возврат ночи шлёт nightShow |
| H03 | исправлено | Сброс состояния при разрыве OBS — синхронно, до ожидания storage |
| §4.2 | исправлено | nightShow, пришедший при распознанном автосменой дне, откладывается до ночи |
| C01 | исправлено | Сброс новой игры при автосценах прячет стол и заново сверяет гейт сцены |
| C02 | исправлено | Смена комнаты в obs-panel видна немедленным подписчиком; отложенный показ сверяет эпоху маршрута, не строку пути |
| C03 | исправлено | Снимок легаси-инлайна V не переезжает в новую игру |
| C04 | исправлено | Следы подмены прежней копии чистятся и при выключенной подмене (`role-fake-orphans.ts`) |
| C05q/C05r | исправлено | Ключ игры — путь + `game_id`; экран набора после идущего матча — новая игра в той же комнате (auto-start и obs-panel) |
| §4.3 F→F | исправлено | F под подменой сначала схватывает новую настоящую роль |
| P01 | решено как fail-safe | День (и уход на дневную сцену) прячет стол и под удерживаемой V; оракул промта уточнён |
| Мутант C03 | закрыт тестом | `audit5-fuzz-survivor-C03` |

Мутации исправлений: 25 одиночных откатов — 23 убиты после добавления двух тестов (beforeDayScene под V, game_id в query); N13/N19/N23 — перекрывающиеся слои (B04: лечение при старте и `obsAutoExpected`; новая игра в obs-panel: подписчик и 2-с опрос; сброс при автосценах: CSS и сверка гейта), каждая пара убита. 138 файлов / 1990 тестов, typecheck, build — чисто. Фаззинг 5000 сценариев зелёный после уточнения эталона (Spec: переходный день, перевзвод на beforeDayScene; `ROLE_FUZZ_ONLY=<seed>` повторяет один сценарий).

Принятые ограничения нового кода: переходный «день» короче 2 с прячет стол до 3 с («от игрока»); при автосценах до первой распознанной фазы своя роль под пином. Живой игрой и записью Program не проверялось — чек-лист §6 в силе.
