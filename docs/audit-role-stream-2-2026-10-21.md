# Второй внешний аудит видимости ролей на стриме — 21.10.2026

## 1. Сводка и границы утверждений

**«Проблем нет» опровергнуто на текущем HEAD. Гарантии безопасного скрытия ролей нет.**

Проверен `main`, `1f3b544b7102610090d9a67e34bca2c8a0ed0504`, потомок `4f9a8cc`. Версия — 9.67.0. Исходный рабочий каталог перед аудитом чистый. Production, настройки, зависимости и тесты в оригинале не изменялись; единственная добавленная в оригинал сущность — этот отчёт. Проверки, пробы и независимые мутации выполнялись во временных копиях.

Основной счёт — **7 блокирующих контрпримеров «в эфир» и 5 высоких «от игрока»**. Из блокеров B06/B07 относятся к тексту `roleReveal`: открытое DOM/CSS-состояние доказано, реальная доставка и приватность конкретного серверного события не проверены. Их нельзя пересказывать как снятую на видео утечку приватной проверки. H04 — воспроизведённое ночное зеркало и конфликт послойных правил с общим оракулом; H05 — временное, не вечное зеркало. Отдельно установлен **высокий дефект контракта изолированного teardown OBS**, не обычного выключения интеграции через попап. Средних/низких самостоятельных production-дефектов в основной счёт не добавлено; недостатки тестов перечислены отдельно.

| Проверка неизменённого HEAD | Результат |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | **102 файла, 1650 тестов PASS**, 6,98 с |
| `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **27 тестов PASS**, 294,35 с; 5000 случайных сценариев × 25 шагов плюс закреплённые сценарии |
| Мутационный профиль: 9 штатных suites | **171 PASS** на HEAD; обычный fuzz — 60 seeds |
| Откаты смысловых фиксов `057ded0`/`f3988e6` | **50: 42 killed, 8 survived**; дополнительный временной C01 тоже survived |
| Повтор прежних независимых проб | **130 PASS / 2 FAIL** после пересмотра устаревших assertions; оба остатка разобраны ниже |
| Расширенная матрица четырёх настоящих владельцев состояния | **384 клетки, 3264 запуска, 10 392 сравнения** совпали с послойным оракулом; он допускает H04, поэтому это не «нет зеркала» |

Дополнительная типизация **самих тестов** на чистой копии (`npx tsc --noEmit -p tests/tsconfig.json`) не проходит: TS2722 в `tests/invariants/role-visibility-fuzz.test.ts:499` и `tests/unit/auto-start-accept.test.ts:539` — вызов possibly undefined `update`. Это существующая диагностика, не падение обязательной production-типизации и не самостоятельный дефект видимости; лог `tests-typecheck-clean.log`.

Базовые `npm test` и fuzz запущены до добавления новых аудиторских тестов. Их зелёный результат не включает и не опровергает красные пробы ниже. Процент уверенности в конце — уверенность в отрицательном вердикте, **не процент покрытия**.

Артефакты обозначены далее как `AUDIT/`:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-stream-audit-2.nwLbha/
```

В `AUDIT/repo/` — копия production и новые пробы; `mutants/`, `mutants-probes/` — отдельные копии для откатов; `rerun-old/` — повтор первого аудита. Это временные, не гарантированно вечные артефакты. Для существенных выводов ниже приведены также самодостаточные последовательности, строки production и результаты assertions. Семь независимых срезов использовались для поиска; выводы сверялись по исходникам и повторным запускам, не принимались по числу сообщений агентов.

## 2. Модель сайта проверена заново

Скачаны `https://polemicagame.com/room/bundle/main.js` и `/room/bundle/style.css`.

| Файл | Размер, UTF-8 bytes | SHA256 |
|---|---:|---|
| JS | 1 634 594 | `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` |
| CSS | 144 788 | `0fad7192be03b25aff9faab92d943c34ec0018a3ee06cbf660892230f89e7976` |

JS совпал с первым аудитом. Ниже смещения **0-based UTF-8 bytes**, не индексы символов JS. Писатели проверены также через AST; контексты сохранены в `AUDIT/markers.txt`, `site-ast-writes.txt`, `role-surfaces.txt`, `game-view-markers.txt`, полный разбор — `site-model.md`.

### 2.1. Флаг, рендер, остальные поверхности

| Маркер / offset | Независимый результат |
|---|---|
| `roleDisplay:!0`, 1201610 | Начальное значение true |
| `updateRoleDisplay:function(e){e.roleDisplay=!e.roleDisplay}`, 1203979 | Всегда инверсия; аргумент игнорируется |
| Assignment 1204009 | Единственная запись существующего `roleDisplay` |
| `on_connect_room`, commit 1337694 | `canSeeRolesAsViewer` вызывает тот же toggle с аргументом `!1`, а не setter |
| `toggleRolesDisplay`, 1599375/1599405 | Второй и последний commit; вызывается D и событием меню `toggleRoles` |
| `e.role&&!o.isJudge`, 1418974 | Единственный текущий Player role-span; постоянный vnode `key:5` |
| `[[za,e.$store.state.roleDisplay]]`, 1419216 | Общий `v-show` для всех ролей; prop Player `roleDisplay` в этом renderer не используется |
| `za`, 1128883; `Ha`, 1129237 | vShow меняет только display; updated проверяет смену truthiness; mount применяет текущий флаг |
| `Loc.role_tooltip(e.role,o.itsMe)`, 1419148 | Tooltip внутри role-span, не телепортирован |
| `on_start_night/day`, 1590227/1590326 | Меняют фазу/номер, не roleDisplay |
| `streamerModeStatus`, 1204509; `forcePlayersVisibility`, 1204576 | Иные state-флаги; не сбрасывают roleDisplay и не защищают role-span |
| `gameView`, 1205991; modern roomState 1339476 | Современный state адаптируется в Player; возможны mount/unmount и patch существующего role-root, не только полная замена |
| `vShow(connectedToRoom)`, 1621315 | Родитель всей комнаты может исчезнуть при disconnect; это отдельный путь невидимости, отсутствующий в fuzz-модели |

Все 50 текстовых вхождений `gameView` проверены по потребителям. Всего `updateRoleDisplay` — 3 вхождения: определение и два commit; текстовых `roleDisplay` — 8, из них два внутри `roleDisplayText`. Других писателей/сброса на новую игру, фазу или streamer-mode в скачанном бандле не найдено.

У роли нет style-binding, переписывающего наши visibility/opacity при обычном обновлении. Есть class-binding `getRoleClasses`; truthy→truthy роль может сохранить span и обновить SVG/текст. `isJudge` исключает span. Mobile использует тот же Player renderer, а свою плитку иногда вообще не рисует; отдельного mobile secret-role renderer не найдено. Профильный preview получает профильные поля, не игровую роль; media preview — камера. Ночная/стримерская заглушка не защищает роль: CSS z-index роли 5, state-overlay 1, контейнер видео — сосед.

Дополнительные поверхности:

- **`roleReveal`**, `on_reveal_role` около 1353797, текст около 1383447: сосед role-span, не его ребёнок; срок обычно 3000 мс. `SITE.roleRevealNotice` соответствует живой разметке. Фикс покрывает общий CSS и faker, но не все пути скрытия — B06/B07.
- **Legacy выбор карты**: `on_choice_self_role`/`on_self_role_defined` около 13478xx/13483xx; выбранная настоящая карта может оставаться до 1500 мс вне role-селекторов. Современный dealing закрывает этот modal; доставка legacy-последовательности не доказана. Не переобъявлено новым блокером.
- Итоговая таблица около 1564735–1564863 отдельно рисует роли. Данных о выдаче ею приватных результатов живой игры нет; публичные итоги не названы утечкой.
- Protocol/guess, статическая справка ролей и auction-варианты не установлены как второй источник текущей секретной роли.

Повторность `canSeeRolesAsViewer` на reconnect и серверная семантика reveal остаются неизвестными: повторный permission-connect механически перевернул бы флаг, но повторную серверную выдачу не измеряли.

### 2.2. Настоящий hotkeys-js и оставшиеся расхождения fuzz

В независимых keyboard/menu-пробах исполнялся **извлечённый неизменённый hotkeys-js этого бандла**, а не только его самописный двойник.

| Маркер / offset | Поведение |
|---|---|
| `if(gh.filter.call(this,e))`, 1218656 | Фильтр **до** добавления клавиши в `lh`; обычный чат не оставляет «зажатые» буквы |
| Filter 1221065 | Target/srcElement, INPUT/TEXTAREA/SELECT/contentEditable; readonly разрешён, activeElement отдельно не проверяется |
| 1218683/1218727 | 93/224 нормализуются в Meta=91; keyCode 229 не вставляется |
| 1218847 | Модификаторы синхронизируются из flags события |
| 1218909/1219204 | Особая обработка Meta-tail и AltGraph |
| `p.sort().join("")===lh.sort().join("")`, 1219683 | Сопоставляется целое множество зажатых клавиш |
| 1220444/1220565 | Keyup сначала вызывает dispatcher, потом cleanup; настоящий `key="Meta"` на keyup очищает всё множество |
| 1220405 | Window focus сбрасывает lh; blur сам по себе — нет |
| `useHotKeysModifier`, 1614731 | Регистрация `ctrl+key, command+key`; повторные keydown тоже вызывают callback |
| `togglingStreamAvailable`, 1614147 | Native V переключает видео лишь в разрешённом режиме; modern adapter разрешает pregame или paused referee |

Текущий fuzz уже исправил старые ошибки: фазы задаются `.substage.current`, маршрут `/game/1`, фильтр editable стоит до downKeys, добавлены серии 0–299 мс. Прежнюю критику body.day/night и старого порядка фильтра к новому HEAD не применяю.

Но модель всё ещё **не точная**: readonly, Meta-tail, AltGraph, 229, полный keyup-dispatch, сброс при регистрации, viewer-connect, родительский display и patch truthy-роли не представлены. Native V смоделирована без `togglingStreamAvailable`. Например реальный Meta-tail позволяет Cmd+D после ранее зажатой PTT, а упрощённая модель считает сочетание заблокированным. Это подтверждённый differential-control, не отдельная доказанная утечка.

Серьёзное следствие неверной полноты модели — B02: сайт получает modified-repeat удерживаемого V, а сценарий и оракул этого не проверяют. Условный readonly-контрпример приведён отдельно; штатного такого поля в комнате не найдено.

## 3. Находки текущего HEAD

Обозначение состояния `[own,peer]`: 1 — роль видна, 0 — скрыта. Направление и серьёзность указаны для каждого пункта. Под «в эфир» понимается видимый захватываемый игровой DOM на сцене с игрой; реальный кадр OBS не записывался.

Финальная независимая перепроверка основных файлов проб, из `AUDIT/repo/`:

```sh
npx vitest run tests/unit/audit2-scene-belt.test.ts tests/unit/audit2-keyboard-verified.test.ts tests/unit/audit-site-model.test.ts tests/unit/audit2-obs-async.test.ts
```

**26 FAIL / 36 PASS, 62 теста, 732 мс**, лог `AUDIT/final-confirmed-probes.log`. Это намеренно красные проверки желаемого поведения плюс положительные контроли: параметризованные варианты и дубли не считаются отдельными дефектами; readonly-кандидат и изолированный teardown не смешаны с обычными сценариями. Исправленная Meta-проба PASS. Для основной B02 используется именно `audit2-keyboard-verified.test.ts`, не исходная предварительная версия с неверным Meta-key.

### B01 — БЛОКЕР, «в эфир»: старый `get_status` отменяет уже обработанный unsafe-gate

**Места:** `src/background/index.ts:578–583`; `src/content/panels/obs-panel.ts:503–542,618–620,1704–1707`; запись visible-пина — `src/content/role-pin.ts:136–145`.

Предусловия: ночь, автосцены ON, сохранена свежая ночная фаза той же OBS-сессии, native roleDisplay=true. Автосмена ролей может быть OFF.

1. t=0: enable запрашивает статус; background снимает `st=obs.getStatus()` **до await** настроек/проверки пароля. В снимке — night.
2. t=50 мс: OBS реально ушёл на day; новое `obs_scene_changed(day)` обработано, роли скрыты, own-pin hidden.
3. t=200 мс: старый ответ со снимком night доезжает. Restore без проверки порядка записывает `currentScene=night` и восстанавливает ночную фазу; строка 539 немедленно ставит own-pin visible!important.
4. `autoSwitchScene(night)` считает night уже активной и ничего не отправляет. Реальный OBS по-прежнему day. Heal опирается на испорченный кэш и не исправляет его.

Проба `tests/unit/audit2-obs-async.test.ts > AUDIT2-OBS-ASYNC`, лог `AUDIT/obs-async.log`:

```text
+201ms: [visible, hidden]
+12s:   [visible, visible]
actualScene: day; sceneCommands: []
expected own hidden; received visible
```

200 мс — управляемая задержка пробы, не измеренная задержка production. Необходимый порядок ответа и события допустим существующими независимыми async-каналами; запись старого снимка до await есть в production. Утечка не ограничена одной микрозадачей или коротким кадром.

### B02 — БЛОКЕР, «в эфир»: Ctrl/Alt во время V оставляют V «зажатой» у сайта после физического отпускания

**Места:** `src/core/keyboard.ts:64–74,106–109,150–163`; `src/content/features/auto-start.ts:1571–1589,1599–1604`.

Сайтовая опция модификатора ON; роли native-hidden:

1. V down показывает роли, исходный V сайту не виден.
2. Пока V удерживается, нажать Ctrl либо Alt и дождаться V-repeat. Роутер выходит по modified/altKey **до** swallowRepeat; повтор доходит до сайта и добавляет 86 в lh.
3. Отпустить V и модификатор. V-up подавлен нашим hold-роутером, поэтому сайт не удаляет 86. Страховочный CSS пока скрывает роли.
4. Подсмотреть ещё раз и отпустить; D показать снимает CSS. Следующий D скрыть не срабатывает: сайт видит V+D вместо D.
5. После отпускания **всех физических клавиш** и ожидания 12 с рольDisplay=true, обе роли видны. До window focus или иной очистки состояние не чинится.

`audit2-keyboard-verified.test.ts > RED active V with later ctrlKey/altKey repeat`, лог `keyboard-verified.log`:

```text
held: [86]; flag: true; snapshot: [true,true]
expected [false,false]
```

Это хуже принятого ограничения PTT: препятствующая клавиша **больше не удерживается физически**, а команда скрыть оставляет открытое. Вариант Meta **исключён**: первая проба неверно задавала `key="MetaLeft"`; после исправления на настоящий `key="Meta"` Meta-up очищает lh и контроль проходит. Ctrl и Alt остались красными.

### B03 — БЛОКЕР, «в эфир»: назначение другой нашей функции на исходный сайтовый D раскрывает роли

**Места:** `src/core/keyboard.ts:64–78`; `src/content/features/role-faker.ts:295–327,436–441`; `src/content/features/outcry-hotkey.ts:80–89`; допустимость разных назначений — `src/popup/index.ts:1238–1249`.

Разные, разрешённые попапом клавиши: hide=G, reset=D, fake=F. Native роли скрыты. F меняет содержимое, не показывает скрытое — правильно. D должен только сбросить подмену: reset снимает fake/щит, но событие идёт дальше к native hotkeys. Сайтовый D показывает все настоящие роли. Наблюдатель `keyboard.observe(KeyD)` не вызван: binding на D есть, хотя событие фактически не забрано.

Альтернативная достижимая конфигурация: hide=G, outcry=D; кнопки выкрика нет. Ожидаемый no-op превращается в показ ролей native D.

Пробы `audit2-keyboard.test.ts > RED supported reset=D...`, `RED supported outcry=D...`, лог `independent-key-scene-site.log`:

```text
reset=D: faked=false, flag=true, visible=[true,true]
outcry=D: flag=true, visible=[true,true]
expected hidden [false,false]
```

Обратный вред того же класса: hide=G, fake=D при видимых ролях даёт `[0,0]` вместо `[1,0]`; после F содержимое фальшивое, но сайт сам спрятал его. Это высокий эффект «от игрока», не дополнительная независимая причина в счётчике. Не путать с известным `fake=Digit1 → doAction`: здесь доказана именно видимость настоящих ролей.

### B04 — БЛОКЕР, «в эфир»: разрешённый hide=Enter показывает роли при вводе новой строки

**Места:** `src/core/keyboard.ts:26–29,59`; `src/content/features/auto-start.ts:1599–1604`; захват назначения — `src/popup/index.ts:1238–1249`.

Назначить hide на Enter, оставить native роли скрытыми, открыть textarea заметки/чата и нажать Enter. `producesText("Enter")=false`; typing-гейт пропускает событие. Handler отправляет синтетический D **на document**, поэтому native фильтр поля ввода его уже не исключает. Через 1 с все роли видны.

`audit2-keyboard.test.ts > RED supported hide=Enter...`:

```text
INPUT ENTER TRACE: flag=true; snapshot=[true,true]
expected [false,false]
```

Пропуск Enter как общий факт уже упомянут в AGENTS §6. Новое здесь — конкретный воспроизведённый блокирующий role-stream-сценарий разрешённого назначения, а не заявление о неизвестной ранее строке кода.

### B05 — БЛОКЕР, «в эфир»: клик по hint D в пункте меню не учитывается как ручное скрытие

**Места:** `src/core/selectors.ts:281`; `src/content/features/auto-start.ts:1643–1657,736–741,819–854`.

Ночь, phaseSwitch ON, ночной показ уже завершён, сцена safe. В меню «Скрыть роли» нажать именно видимую подсказку D, затем V down → через 100 мс V up.

Живой сайт около byte 14877xx рисует `li` с обработчиком toggleRoles и отдельные `span.text`/`span.hint`. Hint кликабелен, pointer-events:none нет. `closest(SITE.roleMenuClickable)` выбирает сам span.hint, текст которого D, а не родительскую подпись. Native li скрывает роли, но `lastManualRoleActionAt` не меняется. Отпускание V считает ночной показ всё ещё положенным и **не возвращает скрытие**.

`audit-site-model.test.ts > AUDIT: menu hint click is a manual hide, V should restore it`, с настоящим извлечённым hotkeys:

```text
после menu-hide: [false,false]
после V-up +2s: flag=true; [true,true], ожидалось [false,false]
```

Контроль клика по `span.text` той же li проходит. Это не прежний исправленный B03 о переназначенном D — новый DOM-target путь обычного меню.

### B06 — БЛОКЕР по заданному оракулу, «в эфир»: native-hidden значки не скрывают `roleReveal`

**Места:** `src/content/features/auto-start.ts:616–626,1571–1604,876–883`; `src/core/selectors.ts:153–159`; живой renderer уведомления — byte 1383447/1418660.

autoHide OFF, phaseSwitch OFF. D скрывает видимые роли через roleDisplay; общий CSS при этом не ставится. При доставке `on_reveal_role` соседнее уведомление «Игрок является …» остаётся видимым примерно 3 с. Флаг vShow относится к role-span, не sibling.

Две независимые пробы — `audit-site-model.test.ts > AUDIT roleReveal after hide (CSS=false)` и `audit2-native-notice.test.ts > AUDIT2-NATIVE-NOTICE`:

```text
roles=[false,false]; CSS=false
roleReveal: visibility=visible, display=inline, opacity=1
expected visibility=hidden
```

Тот же notice под autoHide CSS=true скрыт — исправленный selector действительно работает. Неполон **native-hide путь**, а не selector. После V временный belt тоже снимается на native-confirm, так что проблему не устраняет.

**Ограничение серьёзности:** доказано нарушение прямого требования скрывать уведомление вместе с ролями. Получает ли конкретный reveal приватное или уже публичное знание, и когда сервер доставляет его конкретной роли, без живого матча не установлено. Утечка секретной проверки зрителям не выдана за измеренный факт.

### B07 — БЛОКЕР по заданному оракулу, «в эфир»: native-confirm удаляет CSS закрытого сценового гейта

**Места:** `src/content/features/auto-start.ts:824–851,880–882,1197,1210–1223`; самолечение — `1204–1207`; опрос — `src/content/panels/obs-panel.ts:1385–1388`.

1. Ночь, ночная сцена; игрок скрывает роли D.
2. V down; пока V удерживается, OBS переходит на day. Под V канал сцены выходит без действий.
3. V up ставит beltCss; sceneHide запоминает CSS как уже существовавший, но не принимает владение им.
4. Через 150 мс native-confirm видит display:none и удаляет CSS, несмотря на закрытый сценовый гейт.
5. Значки по-прежнему native-hidden, **но roleReveal открыт до следующего 2-секундного heal**. Доставка mutation-batch уведомления production-подписчикам пробу не исправляет.

`audit2-scene-belt.test.ts > PROBE B-C ... (phase=false/true)`:

```text
V-up +200/+1800/+1900ms:
expected notice visibility [hidden,hidden,hidden]
received                  [visible,visible,hidden]
```

Здесь отдельный дефект владения fresh `beltCss`/`sceneHide`, не просто native-hide из B06: защитный сценовый CSS уже был установлен, затем сам снят. Утечки значков в этой пробе **нет**. Серверная оговорка B06 относится и сюда.

### H01 — ВЫСОКАЯ, «от игрока»: native D/Ctrl+D отменяет cleanup belt и оставляет роли скрытыми

**Места:** `src/content/features/auto-start.ts:1631–1633,1607–1612,850,880–882`.

Native-hidden → V down → V up → через **1/50/100/149 мс** Ctrl+D при сайтовой опции модификатора. Observer отмечает ручное действие и отменяет restore-таймер, но не убирает временный belt. Сайт показал роли, CSS остаётся без владельца/cleanup.

`audit2-scene-belt.test.ts > PROBE H-A...` и `PROBE H-A-remap...`:

```text
через 12s: native flag=true; CSS=true
expected [true,true], received [false,false]
```

То же происходит с исходным простым D сайта при hide=G. Обычный наш D чист: он ещё и снимает CSS. На +150/+151/+300/+600 мс после завершённого подтверждения native Ctrl+D проходит контроль.

### H02 — ВЫСОКАЯ, «от игрока»: повторное V меняет временный belt на постоянный CSS

**Места:** `src/content/features/auto-start.ts:636–639,758–765,780,824–825,850`.

Native-hidden → V down/up → повтор V через **1/50/100/149 мс** → отпустить. Второй peek принимает belt за обычное CSS-hide. На отпускании `hideAllRolesCSS()` сбрасывает beltCss=false; следующая belt-установка обнаруживает уже существующий тег и возвращается. Native-confirm больше не снимает его.

После всех ретраев игрок показывает роли своим native Ctrl+D; через 12 с native flag=true, но `[0,0]` вместо `[1,1]`. Проба `PROBE H-B...` в `audit2-scene-belt.test.ts`; контроль повторного V на +150/+300/+600 мс проходит.

Это новая **потеря показа**, не исправленный прежний B01 с раскрытием после повторного V. Для точного воспроизведения не нужна удержанная PTT.

### H03 — ВЫСОКАЯ, «от игрока»: меню «Показать роли» всё ещё проигрывает старому возврату V

**Места:** `src/content/features/auto-start.ts:1643–1657,876–899`; чистый путь D — `1564–1568`.

Native-hidden → V down → V up → через **100 мс** нажать «Показать роли». Меню действительно показывает роли и обновляет manual mark, но restore-таймер не отменяется. На +150 мс он снова переворачивает native flag в false; через 12 с роли всё ещё скрыты.

Два независимых исполнения: `audit2-scene-belt.test.ts > PROBE H-E...` и `audit2-keyboard.test.ts > RED site menu show...`:

```text
menu +1ms: flag=true
+12s: flag=false; [false,false], ожидалось [true,true]
```

Исправленный обычный D в том же окне проходит — закрытие прежнего H01 оказалось неполным для другой формы того же ручного решения.

### H04 — ВЫСОКАЯ, «от игрока»: одни автосцены плюс autoHide дают устойчивое ночное зеркало

**Места:** `src/content/panels/obs-panel.ts:539,606–609,676–693`; `src/content/role-pin.ts:136–145`; `src/content/features/auto-start.ts:912–916,616–626`.

OBS auto ON, autoHide ON, phaseSwitch OFF, native flag=true. Восстановить ночь на ночной сцене и ждать 12 с. AutoHide CSS остаётся; OBS выставляет свою роль visible!important. **Своя показана, напарники скрыты бессрочно до ручного действия/изменения условий.**

`audit2-scene-belt.test.ts > PROBE H-D...`: CSS=true, ownPin=visible, браузерное состояние `[1,0]`, ожидалось согласованное скрытие. Отдельный настоящий **headless Chrome** подтвердил каскад в `AUDIT/chrome-cascade.log`:

```json
{"own":{"visibility":"visible","opacity":"1"},"peer":{"visibility":"hidden","opacity":"0"}}
```

Это не артефакт jsdom. Исключение оракула разрешено дневному own-pin при D, не такому ночному режиму. АвтоHide без phaseSwitch не обязано повторно прятать ручной показ, но здесь ручного показа вообще не было.

**Оговорка о замысле:** это одновременно конфликт требований: независимый OBS-пункт предписывает ночной own-show, autoHide-only не предписывает ночной peer-show, blanket-пункт запрещает ночное зеркало. Матрица честно получает `100` из послойных правил. H04 фиксирует наблюдаемое противоречие общему оракулу, не выдаёт неустановленный приоритет настроек за однозначно выбранный владельцем.

### H05 — ВЫСОКАЯ по критерию зеркала, «от игрока»: возврат ночной сцены сначала показывает только напарников

**Места:** `src/content/panels/obs-panel.ts:676–693,702–739,1528–1535`; `src/content/features/auto-start.ts:1219–1233`.

Ночь уже идёт, autoHide OFF, phaseSwitch OFF, автосцены ON. Исходно всё видно. Уйти с night на day — обе роли скрыты. Вернуть night: sceneHide снимает peer-CSS сразу, но own hidden-пин сменится visible лишь через **новые 3000 мс**, хотя новой ночи не было.

`audit2-obs-async.test.ts > AUDIT2-OBS-RETURN`: на +301 мс `[hidden,visible]` вместо `[visible,visible]`; source задаёт 3000 мс, затем показ возвращается.

Это **не вечное скрытие**. Высокая квалификация использует второе условие заданной шкалы: разные состояния своей роли и сокомандников вне дневного D-исключения. Если временное зеркало считать только задержкой, этот пункт имеет среднюю серьёзность (>300 мс); фактические состояние и длительность от выбора названия не меняются.

### L01 — ВЫСОКАЯ в контракте изолированного teardown, «от игрока»

**Места:** `src/content/panels/obs-panel.ts:1731–1761`; контраст с настройкой — `1585–1592`; владельцу CSS нужно уведомление `src/content/features/auto-start.ts:1219–1233`.

При живом auto-start и phaseSwitch OFF уйти ночью с night на day, затем вызвать **только `obsPanelFeature.disable()`**. Пины сняты, autoMode=false, подписки/опрос сняты, но последнего уведомления scene gate нет. CSS в auto-start остаётся. Через 12 с обе роли скрыты, исходно были видны; сам возврат не придёт.

`audit2-obs-async.test.ts > AUDIT2-OBS-DISABLE`: expected `[visible,visible]`, actual `[hidden,hidden]`.

Проверка изолированного teardown прямо требовалась в шаге E. **Не обычный UI-дефект выключения OBS:** `update(obs_auto_mode_enabled=false)` уведомляет gate и проходит контроль; общий мастер-выключатель выключает также auto-start. Поэтому L01 вынесен из основного счёта пользовательских сценариев.

## 4. Условные риски, отклонённые находки и неоднозначности

Эти пункты **не включены** в 7 B / 5 H.

1. **Запоздалый ACK команды сцены — потенциальный блокер «в эфир».** `src/background/obs-client.ts:553–563`: SetNight → событие Night → более новое событие Day → старый ACK SetNight снова записывает и рассылает Night. Проба `audit2-obs-client-order.test.ts > AUDIT2-OBS-ACK` красная: expected currentScene=day, actual night. Далее `obs-panel.ts:1528–1535` и gate доверяют ложной night. У протокола SetCurrentProgramScene нет response-field текущей сцены. Проверка доказывает ошибку обработки такого порядка, но **производимость порядка именно установленным OBS не измерена**. Не дублирует B01: здесь портится background-кэш, а не старый runtime snapshot при enable.
2. **Подмена, truthy→truthy смена своей настоящей роли — потенциальные blocker/high.** При сохранённом root Vue может вернуть настоящий tooltip; use-щит его не накрывает до observer. Реальный SharedDomObserver даёт видимое окно +50 мс, потом чинит. Снимок data-original-* при этом остаётся старым; E возвращает прежнюю роль через 5 с вместо новой. `role-faker.ts:71–78,307–325,337–353,383–394`; красные `audit2-fake-lifecycle.test.ts > BLOCKER candidate...` и `HIGH: new true role...`. Renderer допускает patch, но **легитимная серверная смена своей роли с одной truthy на другую не доказана**. Это не закрытый сценарий E → новая роль → F → E.
3. **Readonly-input — потенциальный блокер «в эфир».** Наш router считает любой INPUT typing, embedded hotkeys разрешает readOnly. Native D не отмечает manual epoch, ночной V раскрывает спрятанное. Реальный dispatcher дал красную пробу, но штатного такого поля в room bundle не найдено. Самодельное/инжектированное поле не выдаётся за обычный пользовательский сценарий.
4. **Legacy orphan-peer — условная высокая «от игрока».** Старый faker ставил hidden!important без нового `data-pn-fake-hidden`. Свежая копия очищает только маркированные peers; при реинъекции поверх такого DOM E не показывает peer. Красный остаток старой пробы; marked current-version контроль проходит. Обычный Chrome update **не реинъектирует** новую копию; это ограничивает достижимость.
5. **Осиротевший живой Chrome content не получает свежую сцену.** `src/content/index.ts:253–262`, `src/core/messaging.ts:14–18,38–54`, `src/content/orphan-watch.ts:83–101`: новый sweep сработает только при реальном новом enable, а браузер обычно не внедряет новую копию до F5. Старый ночной controller может продолжать доверять night после утраты messaging; баннер сам не меняет роли. Сам механизм документирован, но live update + запись эфира не проверены. Нельзя считать sweep доказательством закрытия этого иного сценария.
6. **Две живые копии:** fresh sweep убирает старый DOM-пин, старый живой controller затем ставит его снова через heal. Механическая проба есть; штатная двойная инъекция не доказана. Две обычные вкладки — это не две копии в одном DOM.
7. **Href-only «утечка» в jsdom отклонена.** Когда href настоящий, а xlink ещё fake, selector engine jsdom ошибочно учитывает xlink при `[href$=fake]`. В настоящем headless Chrome use-щит сразу скрывает настоящий href; когда fake href сохранён, изменение только xlink не раскрывает изображение. Остаток старой пробы не объявлен production-blocker.

Неоднозначности оракула:

- Буквальное «F показывает фальшивку» конфликтует с явным «F не показывает скрытые роли». Применён уточнённый приоритет: F меняет содержимое, V не показывает peers под F. Прежний H06 поэтому не баг.
- «V пока держишь показывает всё» конфликтует с комментарием `role-pin.ts:221–224`: подтверждение дня вправе перепинить hidden под V. Это прямо задуманная в коде fail-safe политика, но исключения нет в списке владельца. Не названо новой доказанной утечкой.
- Абсолютное «не ночная сцена прячет все» конфликтует с общим правом ручного D показать peers: текущий sceneHide уважает manualMark, а own-pin остаётся. Нельзя одновременно требовать безусловный gate и безусловный ручной показ всех. В положительных проверках использована сформулированная также в fuzz уступка ручному действию; B01/B07 не зависят от неё.
- Одинаковые hide/peek вытесняют регистрацию; попап запрещает такой выбор. Диагностическая crafted-storage проба не посчитана новым разрешённым сценарием. Системные F-клавиши/модификаторы браузера и другие расширения не получили вымышленной гарантии.

## 5. Доказательная трасса «проверено и чисто» по A–F

### A. Полная карта писателей и сила слоёв

| Писатель / файл:строки | Механизм | Сила; замена role-root |
|---|---|---|
| Сайт, маркеры §2 | roleDisplay → vShow display; connectedToRoom на родителе | display:none подавляет все visibility-слои; mount применяет актуальный флаг |
| `native-role-toggle.ts:25–44` | Две маркированные пары D/Ctrl+D | Единственный наш путь переключить флаг; ровно одна pair подходит чистому lh |
| `auto-start.ts:509–533` | Inline visibility/opacity/pointerEvents; pinned узлы пропускает | Обычный inline слабее stylesheet!important; при замене теряется |
| `auto-start.ts:636–651` | `<style id=polemica-role-hide>` | Общий hidden/opacity0!important, переживает замену; слабеe inline!important |
| `role-pin.ts:123–155,173–181` | Own inline!important, data-pn-role-pin | Сильнее stylesheet-щитов на том же узле; замена теряет inline/маркер |
| `role-pin.ts:49–63` | pn-role-pin-shield + html data-pn-own-role-hidden | Сразу прячет свежий own-root; при lift/visible атрибут снимается |
| `role-faker.ts:236–269` | Peer visibility hidden!important; data-pn-fake-hidden | E возвращает snapshot priority; замена теряет inline, но остаётся щит |
| `role-faker.ts:56–81` | pn-role-fake-shield + html data-pn-role-faked | Прячет новые roles/reveal; отдельное use:not защищает внутреннюю замену иконки |

Visibility наследуется, поэтому правило непосредственно на `<use>` может перебить inherited visibility, а opacity родителя подавляет рисование всего поддерева. Нельзя судить о силе щита только по видимости role-root. Own inline visible!important сильнее stylesheet hidden!important — подтверждено не только моделью, но и Chrome (§H04).

**Проверено и чисто:** наши писатели текущих игровых role-root не пишут display; проверен не только список трёх файлов latch-теста, но все display-писатели src. Protocol-emoji скрывает свой SVG sprite, role-marker рисует ручной read, summary/crossover/history не установлены как writer текущей секретной роли. `player-notes.ts:2285–2293` касается #stop SVG только под match-page, не текущей роли живого стола. Native display сохраняется через F/E, lift/release и disable faker. Щиты защищают полную замену root; Chrome-контроль подтверждает href/use защиту.

### B. Таблица состояний и границы перебора

Исполнена независимая матрица `tests/unit/audit2-state-matrix.test.ts`:

```text
autoHide(2) × phaseSwitch(2) × obs_enabled(2) × obs_auto_mode_enabled(2)
× useHotKeysModifier(2) × boot(day/night)(2)
× scene(night/day/disconnected)(3) × native roleDisplay(2) = 384
```

Night здесь — **свежий вход посреди ночи**. Baseline снимается через 8000 мс. Для сохранения независимой scene-оси connected OBS отвечает на автоматическую смену допустимым `ignored:not_owner`, disconnected — отказом: не имитируется успешный ACK без смены сцены. Настоящие auto-start, role-pin, obs-panel, faker, keyboard/native-toggle/synthetic-keys/selectors. Моки только env/DOM/messaging; DOM callbacks вызываются явно, геометрия ненулевая. Видимость учитывает совпавшие CSSOM-правила и priority, не только наличие style-ID.

Закрытая форма baseline-таблицы задаёт expected **для каждой из 384 клеток**. `A=obs_enabled && obs_auto_mode_enabled`, `safe=!A || scene==night`, `P=phaseSwitch`, `H=autoHide`, `N=исходный native flag`:

```text
Nfinal = (P && night && safe) ? true : N
peerHidden = P ? (!night || !safe) : (H || !safe)
peerVisible = Nfinal && !peerHidden
ownVisible = A ? (Nfinal && night && safe) : peerVisible
```

Это **послойный** expected, не подмена запрета зеркала. Actual совпал во всех baseline: 262×`000`, 118×`111`, 2×`011`, 2×`100`. Последние `100` — H04 для двух modifier modes. Дневные `011` — independent own-pin при приватной night scene и выключенных общих hiding-настройках; не доказанная утечка на игровую дневную сцену. Они также не спрятаны фильтром.

| Группа свежих запусков | Сценариев | Expected/actual сравнений | Что проверено |
|---|---:|---:|---|
| Baseline +8000 мс | 384 | 384 | Формула выше |
| D +120/+2680 мс | 384 | 768 | Toggle native/CSS; own OBS-пин остаётся |
| Три D-repeat, шаг 20 мс | 384 | 1152 | Только первый переход |
| V hold +40/+340; up +800/+3300 | 384 | 1536 | Подъём/возврат применимых слоёв, night-show исключение |
| То же, отпускание через blur | 384 | 1536 | Эквивалент отпускания |
| V tap 40 мс; release +40/+3340 | 384 | 1152 | Послойный возврат |
| F; F+V; V-up; E | 384 | 1536 | Content fake, peers до E скрыты, V не сильнее fake |
| Замена всех role-root: сразу / heal | 384 | 1176 | Скрытые не открываются до callback |
| autoHide OFF/ON, изначально ON | 192 | 384 | Независимые phase/scene слои |
| phaseSwitch OFF/ON, изначально ON | 192 | 384 | Переинициализация фазы |
| OBS auto OFF/ON, effective ON | 96 | 192 | Снятие/возврат gate/pin |
| OBS enabled OFF/ON, effective ON | 96 | 192 | Выключенный OBS не оставляет effective auto |

Итого 3264 отдельных запуска: baseline — отдельные 384 запуска; D-repeat выполняется внутри тех же 384 запусков D и не суммируется как новый блок. Сравнений 10 392. Матрица — 7 тестов, вместе с семью профильными suites — **122 PASS**. Все actual/expected строки (~1,7 МБ), runtime смешанных клеток и команды: `AUDIT/state-matrix-results.json`, `state-matrix.md`, `state-matrix-run.log`.

**Чисто по этой таблице**, не по всему произведению событий: steady-state, обычные D/V/blur/F/E, root replacement, отдельные OFF/ON соответствуют послойным правилам. В ней нет PTT, remap, меню, modified-repeat, settings под V, SPA/orphans, viewer/mobile, reveal, успешной сцено-смены и scene return; это отдельные пробы/source-трассы. CSS/pin создаются production-кодом, не перебираются произвольными snapshots. Все async-интерливинги не объявлены исчерпанными.

### C. Время и async

| Окно | Где | Результат аудита |
|---|---|---|
| Vue flush microtask | site vShow; helper D | Изображён отдельно от флага; не читали синхронный display как подтверждённый новый флаг |
| Restore 150 мс × до 5 попыток | auto-start:876–899 | Обычный D на 1/50/100/149/150/300/450/600 мс чист; native D/меню/повтор V — H01–H03; scene ownership — B07 |
| Перевзвод 600 мс после V | auto-start:862–864 | Ручное скрытие этой ночью не переигрывается; повтор V после завершённого confirm чист |
| Night-show 3000; verify500; retry1000/700 | auto-start:966–1045,1246–1256 | Положительные контроли текущего HEAD проходят; мутации выявили незакреплённое pending/manual окно |
| Scene-deferred 2000; backoff manual2000 | auto-start:975–999 | Сам отказ при PTT допустим, но не вечный мусор в lh после отпускания — B02 |
| Phase check150; interval1000 | auto-start:1237–1258,1667–1671 | Оба новых фазовых детектора реально вызываются; полная модель roller не заменена body-классами |
| OBS confirm150+350; pre-day30 | obs-panel:1099–1200,757–782 | B05 первого аудита закрыт, проверен момент outbound day; сохранённый current night/next day не открывает peers |
| OBS roleDelay3000; heal2000 | obs-panel:676–755,1385–1388 | Starvation прежнего H02 закрыт; теперь есть H04/H05 и старые status/ACK snapshots |
| SharedDomObserver rAF/250; background500 | core/dom.ts:78,151–176 | Идемпотентный текущий heal не создаёт доказанной петли; таймер/observer не доказательство отсутствия открытого первого кадра |

Сами анонимные 500/1000/2000-мс хвосты не названы отдельными production-дефектами без видимого контрпримера. Ночной pending callback и guard ручного решения подвергались отдельным HEAD-pass/mutant-fail пробам. Повторная смена фазы/disable/settings исследована штатными и дополнительными пробами; не заявлено, что все async-интерливинги исчерпаны.

### D. Клавиатура

**Проверено и чисто:** обычные D/V с обоими modifier modes, простой D-repeat, Ctrl+D-repeat без смены модификатора внутри активного V, native D после hide-remap, русский key/code, Shift/Russian V, обычный текстовый ввод в textarea, CapsLock после отпускания, blur и утраченный V-up, пустое V в разрешённом camera-контроле. Дневное исключение own-pin при D сохраняется. F + обычный D — no-op/toast; F главнее V; E возвращает состав.

Пометка событий — WeakSet в одном content-модуле; новое событие с теми же полями метку не получает. Синтетические down/up отсекаются роутером, не отпускают физическое peek=D. Сайт/другое расширение, которое может прямо менять DOM, не считается противником, от которого WeakSet защищает роли. Cross-world identity в настоящих Chrome/Firefox не измерялась; её поломка не заявлена. Наш синтетический Ctrl+D не выполняет браузерную закладку как trusted default action; реальные browser menus/F1–F10 в этой сессии не испытывались.

Непокрытые обычными controls пути конкретизированы B02–B05 и H01/H03; остальные remap-site побочные функции не посчитаны дефектами видимости без раскрытия/скрытия.

### E. Жизненный цикл

**Проверено и чисто в исполненных пробах:** live touched hidden/visible/lifted пины переживают sweep той же копии; orphan fake cleanup не снимает live own-pin/щит; включение auto-start при живой F сохраняет fake; marked current-version orphan пины и fake-DOM подчищаются; полный root replacement с настоящим OBS/faker возвращается к той же фальшивке. F+V → выключение автосцен и фазового скрытия → disable faker → V-up сходится. Обычный F/E, F/disable, disable faker под V, native-hidden round-trip проходят.

SPA fake сохраняется до E — согласованный новый замысел, не дефект. Полный F5 уничтожает старый документ/щиты; новая копия начинает с новых настроек. Замена только extension-контекста не равна F5 и не гарантирует запуск sweep — условные пункты §4. Изолированный auto-start disable имеет teardown-режим peek; изолированный faker возвращает его собственные изменения; **изолированный OBS disable — L01**. Стандартное выключение автосцен через update не имеет L01.

Две вкладки не разделяют role-pin/DOM-state, но разделяют OBS/background и асинхронные ответы. Владение сценой не приравнено к доказательству безопасной картинки другой вкладки; две живые вкладки и реальное browser update остались в ручном чек-листе.

### F. Адекватность tests и мутации

Прочитаны полностью требуемые fuzz/latch/unit-файлы. Важное улучшение: реальные `obs-role-integration.test.ts` теперь убивают удаление уведомлений heal/pre-day. Но в **случайном fuzz** `obs-panel` заменён флагом safe и 2с-опросом, faker всегда false, onDomChange пуст. Импорт настоящего role-pin не означает наличия пинов: их владелец замокан. Fuzz сам не проверяет приоритет inline!important, щиты, F, реальный OBS roleDelay и stale ответы. Дополнительная матрица/пробы выше закрывают часть, не все комбинации.

`visible()` в fuzz (`:205–211`) читает display/inline и наличие общего CSS-ID, не computed cascade, содержимое stylesheet, родителей, геометрию, tooltip/use/reveal. Текст роли может быть открыт при зелёном зеркале значков — B06/B07.

Каждое запрошенное ослабление:

| Ослабление, строки fuzz | Оценка, что не доказывает |
|---|---|
| `ptt`, 363,599,608,614,646–650,667,683,703,713 | Отказ D при физически зажатой клавише разрешён. Часть проверок показа отключается и для CSS-only; deadline безопасного возврата не задан. Но устойчивое скрытие вне night всё же проверяется: это не «PTT отключает всю безопасность». C01 ниже показывает кадровую дыру; B02 — настоящий дефект за пределами принятого ограничения |
| `held`, 361,378,414–421,662–664 | Физический down, не реальный isPeeking. Фазовый case пропущен и для пустого hold. Глобальные инварианты с peekActive сужают старую дыру; настоящий OBS pin/faker отсутствует |
| `showDue`, 379,545–568,617,627,646–651,681–683 | Теперь включает manual/phase и scene-safe в разрешении показа: Vtap-исключение сужено. Номер большого шага не моделирует время callback; B06/B09 выжили в pending-окне |
| `peekActive`, 378,381,534,587,598,607,623,674,677,696,726 | Выведен из held и прежнего снимка, не ответа startPeek. Реальный visible-pin может сделать peek активным при видимых ролях, faker держит peers отдельно. Передача пустого V пропущена — B04-мутант |
| `sceneRestore`, 461–469,628–645,685–691 | При уходе сцены под V beforeSceneOff обнуляется; sceneChangedDuringHold без sceneRestore оставляет safe-итог не заданным. Unsafe-скрытие проверено, exact-restore — нет. Это дыра оракула, не дополнительный runtime-баг без контрпримера |

В простом шаге снимки: после microtask, далее +50 мс до 1 с, потом +250 мс до 12 с. Зеркало проверено не на первом trace[0], а лишь на периодических снимках. Flip-counter не задаёт deadline первого изменения. В burst снимок лишь после gap (0–299 мс), общего flip-counter нет. Сам burst-pool не содержит night, sceneOn, переключения настроек и modified-D. Увеличение seed не добавляет отсутствующие виды взаимодействий.

#### Мутационный эксперимент

Каждый смысловой откат применялся **по одному к текущему HEAD в отдельной копии**, не revert всего коммита. Профиль неизменён: fuzz, obs-role-latch, auto-start-accept, role-pin, role-faker, keyboard, оба obs-night, obs-role-integration — 9 файлов / 171 тест на базе. Для каждого сохранены diff, команда, JSON Vitest и kill assertion: `AUDIT/mutation-results.json`, `mutation-*-logs/`; развёрнутый разбор — `mutation-results.md`. Production восстановлен, SHA зафиксированы в `mutation-final-integrity.json`.

K = killed штатным профилем, S = survived. **Номера мутантов не совпадают с номерами production-находок.**

| ID / commit | Независимый смысловой откат | Итог / ключевой контроль |
|---|---|---|
| A01 / 057ded0 | Native hidden только #stop | K: fuzz V не показал |
| A02 / 057ded0 | Display:none считается нашим inline | K: fuzz зеркало |
| A03 / 057ded0 | Inline-show снимает display | K: latch + fuzz |
| A04 / 057ded0 | Inline-hide пишет display:none | K: только source/latch |
| A05 / 057ded0 | Visible-pin снимает display | K: role-pin + latch |
| A06 / 057ded0 | Lift снимает display | K: role-pin + latch |
| A07 / 057ded0 | Release возвращает stale display snapshot | K: role-pin round-trip |
| A08 / 057ded0 | Faker скрывает peers через display | K: faker + latch |
| A09 / 057ded0 | E теряет visibility priority | **S**; дополнительная priority-проба убивает |
| A10 / 057ded0 | D из CSS не шлёт native toggle | K: fuzz/auto-start |
| A11 / 057ded0 | Restore V проверяет лишь #stop | K: source/latch count |
| A12 / 057ded0 | Night-show проверяет лишь #stop | K: fuzz/auto-start |
| A13 / 057ded0 | Night verify проверяет лишь #stop | K: только source/latch count |
| A14 / 057ded0 | Own-state проверяет лишь #stop | K: fuzz |
| A15 / 057ded0 | Faker reset возвращает stale display | K: latch |
| B01 / f3988e6 | Активный hold-down идёт сайту | K: fuzz |
| B02 / f3988e6 | Активный hold-up идёт сайту | K: keyboard |
| B03 / f3988e6 | Repeat активного hold идёт сайту | K: keyboard |
| B04 / f3988e6 | Пустое V всегда поглощается | **S**; доп. auto-start callback → camera-counter |
| B05 / f3988e6 | Старый rehide без scene/manual intent | K: fuzz |
| B06 / f3988e6 | Native-hide после V возвращается всегда | **S**; доп. pending-night +16мс |
| B07 / f3988e6 | StopPeek перевзводит ночь без manual-check | **S**, избыточно: оставшийся callback guard |
| B08 / f3988e6 | Нет CSS fallback native restore | K: fuzz |
| B09 / f3988e6 | Night callback не уважает manual всю ночь | **S**; доп. решение внутри pending-night |
| B10 / f3988e6 | Нет Ctrl+D пары | K: modifier/fuzz |
| B11 / f3988e6 | Нет handler-guard own synthetic | **S**, избыточно: router отсекает раньше |
| B12 / f3988e6 | Faker blocker глотает own synthetic | K: faker |
| B13 / f3988e6 | Возврат suppression250мс | K: H01 fuzz; reset окна учтён |
| B14 / f3988e6 | Физический default D идёт сайту | K: modifier/fuzz |
| B15 / f3988e6 | D-repeat не подавлен | K: fuzz |
| B16 / f3988e6 | Ctrl/Cmd+D не manual | K: fuzz |
| B17 / f3988e6 | setRoleVisibility решает по tracked | K: auto-start/fuzz |
| B18 / f3988e6 | Нет подписки auto-start на gate | K: fuzz |
| B19 / f3988e6 | Heal OBS не уведомляет gate | K: настоящий OBS integration |
| B20 / f3988e6 | Нет pre-day уведомления | K: outbound-day assertion |
| B21 / f3988e6 | Нет hidden-pin shield | K: role-pin |
| B22 / f3988e6 | Lift оставляет shield | K: role-pin |
| B23 / f3988e6 | RestoreLiftedPins не возвращает shield | **S**; доп. повторная root replacement после restore |
| B24 / f3988e6 | Release оставляет shield | K: role-pin |
| B25 / f3988e6 | Нет fake shield | K: faker |
| B26 / f3988e6 | Teardown оставляет fake shield | K: faker |
| B27 / f3988e6 | StopPeek-disable возвращает hide | K: teardown fuzz |
| B28 / f3988e6 | StopPeek не sync scene return | K: Vup/fuzz |
| B29 / f3988e6 | NightShowDue игнорирует manual epoch | K: fuzz |
| B30 / f3988e6 | Scene return никогда не снимает CSS | K: fuzz |
| B31 / f3988e6 | Нет reset deferred-scene log | **S**, только наблюдаемость |
| B32 / f3988e6 | Rehide predicate игнорирует scene safe | K: auto-start/fuzz |
| B33 / f3988e6 | Rehide predicate всегда hidden | K: auto-start |
| B34 / f3988e6 | Own synthetic-down идёт в router | K: fuzz |
| B35 / f3988e6 | Own synthetic-up идёт в router | K: keyboard/fuzz |
| C01 / дополнительный | Belt отложен на 40 мс | **S**; доп. проверка +16мс убивает |

**Восемь основных survivors**: A09, B04, B06, B07, B09, B11, B23, B31. Пять неэквивалентных получили **HEAD PASS / mutant FAIL** контроль; B07/B11 — дублирующие защиты, B31 — лог. Временной C01 тоже неэквивалентен. Старые OBS-survivors и suppression250мс теперь killed — реальное улучшение.

Три **средних пробела регрессионной защиты**, не production-баги HEAD: ручное решение внутри первого night-pending (B09) и краткое rehide перед положенным show (B06); задержка belt на кадр (C01); повторная замена root после возврата shield (B23). Два **низких пробела**: пустое V не проверено через production auto-start callback (B04), priority peer-стиля после E (A09). У каждого исполнимый контроль. Для C01: native-hidden → V → PTT down → V up; на +16 мс HEAD скрыт, мутант открыт, хотя все 171 штатных тестов зелёные.

**Чисто для killed-мутантов**: соответствующие защиты наблюдаются этим профилем. Source-count kill A11/A13 и regexp kill A04 не объявлены победой поведенческого fuzz; эти стражи частично текстовые. Мутации не доказывают отсутствие новых B/H текущего HEAD.

## 6. Повтор первого внешнего аудита

Из прежних артефактов `role-audit.PgJciF/` перенесены **только** независимые тесты, hotkeys-fixture и viewer wrapper в `AUDIT/rerun-old/`, не старый production. 128 production/config/script файлов совпали с новым HEAD по SHA256. Точные команды, имена проб и все пересмотренные assertions — `AUDIT/old-probes-rerun.md`.

| Старые ID | На новом HEAD | Почему |
|---|---|---|
| B01 | PASS, включая +16/+149 мс, PTT и быстрый второй V | Синхронный belt, нет прежнего открытого хвоста |
| B02 | PASS | Synthetic keyup не отпускает физический peek=D |
| B03/B04 | PASS | Native D observer учитывает manual; repeats подавлены |
| B05 | PASS на outbound day, в т.ч. feedback до ACK и через 200 мс | beforeDayScene не зависит от старого current-phase |
| B06 | PASS на +500 мс | Синхронный hide и повторный heal после cleanup |
| B07/B08/B09 | PASS | Gate без phaseSwitch; не снимается другая hiding-настройка; enable скрывает сразу |
| H01 | PASS для прежнего обычного D | Отменяется restore timer; новые native/menu ветки — H01/H03 настоящего отчёта |
| H02/H03 | PASS на +15/+30 с | Не перевзводится одинаковый pending pin; фазовая инициализация восстанавливается |
| H04/H05 | PASS | Update уведомляет gate; выключенное CSS-hide не возвращается старым peek-снимком |
| H06 | Не баг по уточнённому оракулу | F меняет содержимое без показа скрытого |
| H07 | PASS 4/4; старый exact viewer wrapper 4/4, 16 snapshots | Native probe берётся с любой роли при отсутствии своей |

Две старые базовые матрицы — **32/32** каждая; одна с настоящим hotkeys, computed styles и ненулевой геометрией. Сырые старые tests дали 102 PASS/25 FAIL: большинство красных assertions ожидало старый баг, старый механизм полного root-hide либо прежний F/SPA-оракул. После обоснованной адаптации — **130 PASS/2 FAIL**: conditional unmarked legacy orphan-peer и опровергнутый в Chrome jsdom href-selector artifact (§4). Это не «25 оставшихся дефектов» и не замалчивание красных тестов.

## 7. Что без живой игры не доказать; ручной чек-лист

Пробы подтверждают production JS, DOM, CSS, native dispatcher и некоторые реальные браузерные CSS-свойства. Они **не записывают compositor/OBS-кадр**, не доказывают серверную семантику и не заменяют обновление установленного расширения в двух браузерах.

Проверять **локальной записью**, не публичным эфиром; одновременно видеть окно игрока и записанный Program. Сначала чистые настройки/профиль, затем реальные сохранённые настройки владельца. Chrome и Firefox проверять отдельно, camera/PTT/modifier modes — отдельно. Для кадровых требований нужны покадровый просмотр 60fps/30fps и отметки времени, а не только «на глаз».

| Действие | Ожидание на экране / в записи |
|---|---|
| Ночная игра, F5; во время запуска уйти с night на day | Поздний статус не показывает роли на day; никакая роль/надпись не остаётся открытой |
| V удерживать → Ctrl/Alt → автоповтор V → отпустить всё → V tap → D показать/скрыть | Последний D скрывает всё, не нужен Alt-tab/focus для «лечения» |
| hide=G, reset=D; native-hide → F → D | Настоящие скрытые роли не раскрываются при reset |
| hide=G, outcry=D, выкрик недоступен | No-op не раскрывает роли |
| hide=Enter; написать многострочную заметку | Enter не раскрывает стол и не меняет скрытие |
| Ночью скрыть через hint D в меню, затем V tap | На отпускании исходное скрытие возвращается |
| Native-hide → V up → Ctrl+D/меню Show через 50–100 мс | Более новое решение показать сохраняется дольше 12 с |
| Native-hide → V up → второй V через 50–100 мс → позднее native-show | Не остаётся вечный CSS-hide |
| V удержана → уйти на дневную сцену → отпустить; получить reveal/check | Нет открытого текста роли между 150 мс и следующим heal |
| D-hide без автонастроек; получить roleReveal | Значки и относящийся к ним текст скрыты вместе; отдельно установить публичность события |
| autoHide ON, phase OFF, OBS auto ON; вход посреди ночи | Не возникает ночного `[own visible, peers hidden]` |
| Ночь без phaseSwitch; night→day→night | Сценовое скрытие снимается согласованно, нет необъяснённого 3с-зеркала |
| Current night/next day; OBS day command | Своя роль, peers и reveal уже скрыты **до** появления игрового Program |
| OBS разрыв/reconnect во время V и без V; быстрые ручные смены сцен во время ACK | Роли не следуют устаревшему night; проверить реальный порядок событий/ответов |
| OBS длинный fade/переход >3 с, Studio Mode, переход вручную | Не принять смену имени Program за доказательство исчезновения игрового изображения в оставшихся кадрах transition |
| F → настоящая проверка/пересадка/новая игра, hover над ролью → E | Не мигает настоящий tooltip/use; E возвращает актуальную, не старую роль; сначала подтвердить достижимость root-patch |
| Viewer reconnect с canSeeRolesAsViewer; modern/legacy раздача | Флаг не инвертируется неожиданно; CardSelect не раскрывает настоящую карту на сцене с игрой |
| Переключать autoHide/phase/OBS auto по одному под V и во время night pending | Не воскресают выключенные слои; ручное ночное решение не переигрывается |
| SPA из комнаты/обратно, новая игра, F5, обновление extension посреди ночи/V | Различить новый документ и orphan content; нет старых щитов/visible-пинов и ложного доверия night |
| Две вкладки одной комнаты, переключение активной, свёрнутое окно | Смена владельца/события OBS не раскрывают роли захватываемой вкладки |

## 8. Вердикт

**К релизу с утверждением «роли никогда не появляются и не исчезают сами» сборка не готова; уверенность в отрицательном вердикте — 99%.**

Основание — повторяемые контрпримеры на текущем production, включая устойчивый показ всего состава после явного скрытия, извлечённый настоящий hotkeys-js, независимые контроли и реальный Chrome CSS-check. До 100% не доводит отсутствие записанных игровых/OBS-кадров, серверной проверки условных путей и исчерпывающего перебора всех async/browser-состояний. Зелёный fuzz и 42 убитых мутанта этого не доказывают.

Production-патчей, архитектурных перестроек, коммитов, релизов и предложений исправления в рамках аудита не выполнялось.

---

## 9. Ответ и статус находок (21.10.2026, после перестройки)

Решение владельца: **«одна власть»** — видимостью ролей управляет только наш CSS; флаг сайта нейтрализован правилом стилей (inline display по-прежнему не пишем), его смена принимается в наш слой немедленным подписчиком (до кадра); синтетический D сайту удалён целиком (модули native-role-toggle и synthetic-keys). Второе решение: ночная сцена OBS — видны все роли (H04). Пробы этого аудита перенесены в `tests/unit/audit2-*.test.ts` (настоящий hotkeys-js сайта — фикстура `tests/fixtures/bundle-snippets/room-hotkeys.txt`); все проходят, кроме перечисленных ниже как замысел.

| ID | Статус | Что сделано |
|---|---|---|
| B01 | исправлено | Эпоха сведений о сцене: ответ `get_status`, запрошенный до события сцены, сцену не трогает; фон снимает статус после ожиданий |
| B02 | исправлено конструкцией | Синтетического D нет — «зажатая» у сайта V нашему D не мешает; плюс включившееся «подсмотреть» сайту не видно в любых сочетаниях и повторах |
| B03 | исправлено | Любая наша привязка на D забирает клавишу у сайта |
| B04 | исправлено | Клавиши правки текста (Enter, Tab, стрелки…) в полях ввода хоткеями не срабатывают |
| B05 | исправлено конструкцией | Меню сайта не разбираем по тексту: смена флага сайта вслед за кликом принимается как решение игрока |
| B06/B07 | исправлено конструкцией | Любое наше скрытие — CSS, уведомление прячется всегда; страховки, снимавшей CSS, больше нет |
| H01–H03 | исправлено конструкцией | Нет страховки и ретраев возврата — нечему переигрывать ручное решение |
| H04 | исправлено по решению | Ночная сцена — видно всё; пин своей роли только прячет, показ = снять пин + `nightShow` |
| H05 | исправлено | Возврат ночной сцены: своя и напарники открываются вместе по `nightShow` (после той же задержки 3 с, что и при первом показе: переход сцены OBS); проба «без задержки» снята как замысел |
| L01 | исправлено | Выключение obs-panel уведомляет гейт сцены |
| §4 п.1 (ACK) | исправлено | ACK смены сцены не перетирает более новое событие (счётчик событий в obs-client) |
| §4 п.2 (подмена) | исправлено | Подсказка роли под подменой скрыта щитом; новая настоящая роль (в т.ч. через xlink:href) запоминается и возвращается по E |
| §4 п.3 (readonly) | исправлено конструкцией | D сайта из readonly-поля — смена флага, принимается как решение игрока |
| §4 п.4–6 (орфаны, две копии) | условные | Без изменений: не воспроизводятся штатно |
| H-D (проба) | замысел | Решение владельца — ночная сцена показывает всех |
| Матрица состояний | заменена | Её формула послойная (старая модель); эталонная модель замысла — в role-visibility-fuzz (Spec), 5000 сценариев |

Замысел, уточнённый по ходу: скрытие, принятое от сайта, считается «ручным» по причине (выключение наших настроек его не снимает); включение авто-скрытия посреди игры — ручное решение «прятать» на эту ночь; при автосценах днём скрыты все роли, а не только своя.
