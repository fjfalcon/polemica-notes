# Третий внешний аудит видимости ролей — 21.10.2026

## 1. Сводка

**Утверждение «роли не появляются и не исчезают сами» опровергнуто.** На `main`, HEAD `e31947b09e585e45d3a5baa8ebc3d4c15a8e40fb` (9.67.0, «одна власть»), подтверждены **6 блокирующих контрпримеров направления «в эфир» и 2 высоких «от игрока»**. Параметры одной причины не считаются разными находками. Для B05 отдельно оговорена квалификация первоначальной фазовой задержки: по заданному кадровому запрету — блокер; без этого запрета бесспорно средняя задержка >300 мс. При последней трактовке счёт: **5 блокеров, 2 высоких, 1 средняя**.

Это аудит, не исправление: production, прежние tests, зависимости и настройки оригинала не менялись. Единственное изменение оригинального репозитория — этот документ. Патчи, перестройки, коммиты и релизы не выполнялись и не предлагаются.

| Проверка / эксперимент | Результат |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | **109 файлов / 1746 тестов PASS**, 6,88 с |
| `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **30 PASS**, 287,41 с; 5000 × 25 шагов плюс закреплённые случаи |
| Независимая матрица настоящих владельцев | **384 клетки, 5284 запуска, 20 848 сравнений: 12 несовпадений одного B06** |
| Независимый повтор матрицы | Те же 12 несовпадений, 13,54 с; suite FAIL, несмотря на 11 завершившихся test-циклов |
| Центральные + OBS-пробы, повтор основным аудитором | **25 FAIL / 10 PASS**, 35 тестов; параметры и условные кандидаты включены, не 25 дефектов |
| Site + keyboard/lifecycle, повтор основным аудитором | **12 FAIL / 16 PASS**, 28 тестов; часть FAIL условна или вне предмета |
| Независимый контроль трёх центральных механизмов | 6 witness/control-проб подтвердились |
| Настоящий Headless Chrome 155 | Подтвердил B02 без OBS, B05 и H01 по computed DOM/CSS |
| Независимые смысловые откаты 057ded0 / f3988e6 на HEAD | **42 эксперимента: 31 killed / 7 survived / 4 obsolete/equivalent**; каждый survivor пережил исходные 1746 тестов, один относится только к API-контракту |
| Дополнительные проверки пяти из семи survivors | HEAD с 7 новыми временными проверками: **113 файлов / 1753 PASS**; соответствующие мутанты красные. Для двух остальных — исходные прогоны и source-обоснование |

Первые три строки — неизменённый HEAD **до добавления аудиторских проб**. Остальные — отдельные эксперименты в копиях, а не результат того же исходного `npm test`.

**Важно:** зелёный fuzz сосуществует не только с отсутствующими сценариями, но и с ошибкой его эталона: неизменённый `Spec` принимает запрещённый показ B04. Отдельная копия fuzz с единственным добавленным сценарием `sceneOff → autoHideOn → sceneOn → wait` проходит. Это не доказательство правильности сценария — независимый оракул требует скрытие и получает FAIL (§5.F).

Обозначения ниже: `0/1` — скрыто/видно; `[own,peer]` или `011` для своей и двух известных ролей. «В эфир» означает открытый игровой DOM при предписанном скрытии; **реальный Program/композиторный кадр не записывался**. Для B01/B06 отдельно доказано состояние DAY при открытых ролях. Одна только приватная NIGHT-сцена не выдана за записанную утечку зрителям.

Артефакты, далее `AUDIT/`:

```text
/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit3-gV9yhw/
```

В `AUDIT/repo/` — копия HEAD и новые `audit3-*`; отдельная копия используется для мутаций. Это временные, не вечные артефакты. Поэтому существенные последовательности и production-строки приведены здесь. Отчёты пяти независимых срезов: `site-findings.md`, `obs-findings.md`, `keys-findings.md`, `matrix-findings.md`, `tests-findings.md`; повторная атака на центральные доказательства — `central-review.md`. Основной аудитор прочитал доказательства, повторил красные suites и матрицу, а три механизма дополнительно исполнил в настоящем Chrome.

## 2. Модель сайта: независимая сверка

Заново скачаны `https://polemicagame.com/room/bundle/main.js` и `style.css`.

| Файл | UTF-8 bytes | SHA256 |
|---|---:|---|
| `room.js` | 1 634 594 | `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` |
| `room.css` | 144 788 | `0fad7192be03b25aff9faab92d943c34ec0018a3ee06cbf660892230f89e7976` |

Это та же версия сайта, что у двух предыдущих аудитов, а не drift. Ниже offsets — **0-based UTF-8 bytes**, не JS character index. Все записи флага проверены также AST; результаты — `site-ast-writes.json`, контексты — `site-markers.txt`, `site-surfaces.txt`.

### 2.1. Все записи флага, renderer и альтернативные поверхности

| Маркер / offset | Подтверждённое поведение |
|---|---|
| `roleDisplay:!0`, 1201610 | Начальный state=true |
| `updateRoleDisplay:function(e){e.roleDisplay=!e.roleDisplay}`, 1203979; assignment 1204009 | Единственная запись существующего state-флага; аргумент игнорируется |
| `commit("updateRoleDisplay",!1)`, 1337694 | `on_connect_room`, условие `canSeeRolesAsViewer` около 1337627 |
| `commit("updateRoleDisplay")`, 1599405 | `toggleRolesDisplay`; callers — D и меню toggleRoles |
| `roleDisplay:{type:Boolean,default:!0}`, 1399308 | Prop Player, не вторая запись Vuex-state; текущий renderer использует store |
| `role:""`, 1399430; `e.role&&!o.isJudge`, 1418919 | До назначения роли span отсутствует; при truthy-роли появляется; судейская плитка исключена |
| `[[za,e.$store.state.roleDisplay]]`, начало 1419196 | vShow каждой роли; mount применяет текущий флаг |
| `za={beforeMount…}`, 1128883; `Ha(e,t){e.style.display=t?e._vod:"none"}`, 1129237 | vShow меняет display, не visibility/opacity; обновление при смене truthiness |
| `Loc.role_tooltip`, 1419148 | Подсказка внутри role-root, не teleport |
| `d:function(){e.toggleRolesDisplay()}`, 1614401 | D не гейтится стадией, наличием роли или разрешением камеры — важно для H02 |
| `role:s,avatar:t.user.avatar`, modern adapter 1577613/1578083 | Назначает роль, не сбрасывая roleDisplay |
| `vShow(connectedToRoom)`, 1621315 | Отдельное скрытие родителя всей комнаты |

Проверены все 8 текстовых `roleDisplay`, 3 `updateRoleDisplay`, 50 `gameView`. Других записей/сброса флага на новую игру, день, ночь, streamerModeStatus или forcePlayersVisibility не найдено. Эти два последних флага меняют заглушки/видео/меню, не защищают role-span. Ночная overlay ниже role z-index=5 и не заменяет скрытие роли.

У role-root есть class-binding `getRoleClasses`, но нет style-binding, обычно перетирающего наши visibility/opacity. При truthy→truthy может сохраниться span с vnode key=5, обновиться `<use>` и подпись. Mobile использует тот же renderer, хотя свою плитку может вообще не рисовать (1605365). Отдельного mobile/preview/viewer secret-role renderer не найдено. Нейтрализатор `display:flex!important` соответствует CSS `.player__role[data-v-79273408]`, около CSS offset 31159. Он **не отменяет** display:none родителя и не создаёт отсутствующий из-за isJudge узел.

| Другая поверхность | Проверка и граница |
|---|---|
| `roleReveal` | Сокет 1353781, текст 1383447, class по notification type 1384304. Сосед span; текущие общий CSS и fake-shield покрывают его. Старые B06/B07 не повторяются. Приватность конкретного серверного события не измерена |
| Legacy CardSelect | selectedRoleCode 1559347, setRole 1560526, on_self_role_defined 1348133; закрывается через 1500 мс. Не покрыт role-selector, но современный dealing не открывает этот путь. Прежний условный live-check, не новая находка |
| Итоги | Отдельные role-icon/текст 1564735–1564863 не скрываются этим CSS. Не установлена выдача приватных итогов живой игры; публичные результаты не названы утечкой |
| Auction / RoleIcon конфигурации / Guess / Protocol | Выбор ставки, конфигурация режима или предположение игрока; не найден второй вывод установленной сервером текущей секретной роли |
| Общие notifications / profile/media preview | Нового штатного secret-role renderer не найдено; произвольный серверный текст не равен доказанной приватной выдаче |

Дополнительная граница гарантии **всего стрима**: сайт имеет ролевые звуковые события. `toBriefing` около 1210056 берёт `h.role`, `Hd` около 1211411 отображает роли в dealingDon/dealingMaf/dealingCiv/dealingCom; `jd.play` создаёт `Audio` около 1209030 без roleDisplay-гейта. MP3 и OBS audio routing не проверялись. Это не включено в счёт аудита **видимости**, но проверка DOM не доказывает секретность аудио.

### 2.2. Настоящий hotkeys-js против модели fuzz

Самостоятельно извлечённый live dispatcher byte-identical fixture после удаления первой комментарной строки: 5605 UTF-8 bytes. Восемь направленных differential-проб — **8 PASS** (`audit3-site-dispatcher.test.ts`).

| Факт | Live marker / offset | Соответствие fuzz |
|---|---|---|
| Filter **до** добавления в lh | `if(gh.filter.call(this,e))`, 1218656 | Верно для обычных полей; чат не оставляет «зажатые буквы» |
| Код из keyCode, затем which, затем charCode | `e.keyCode||e.which||e.charCode`, 1218622 | Fuzz использует keyCode или свой keyCodeOf(code); обе fallback-ветки не воспроизводит |
| Filter target/srcElement, editable; readonly разрешён; activeElement отдельно не проверяется | 1221065–1221204 | readonly/activeElement упрощены |
| Полное множество keys, не только modifiers | `p.sort().join("")===lh.sort().join("")`, 1219683 | Обычная ветка соответствует |
| Синхронизация modifiers по flags; 93/224→91; 229 не добавляется | 1218683–1219204 | Fuzz не точен для IME229, Meta-tail, AltGraph |
| Meta-tail допускает Cmd+D после PTT; Meta-up чистит lh | 1218909; около 1220565 | Не представлено |
| Keyup dispatcher, затем cleanup | 1220444–1220565 | Fuzz только удаляет; callbacks D/V сайта keydown-only |
| Focus чистит; blur не чистит; registration тоже чистит | 1220405; `function gh…lh=[]`, 1219735 | Focus верен; registration отсутствует |
| Native repeat повторно вызывает callback | dispatcher xh | Дедуп делает расширение, не сайт |
| useHotKeysModifier → ctrl+key, command+key | 1614731 | Основная ветка верна |
| Native V только при togglingStreamAvailable | 1614147 | Fuzz увеличивает videoToggles без этого гейта |

Все писатели togglingStreamAvailable проверены: начальное true 1201982, setter 1205057/1205103, legacy transparent_pause отключает около 1341561; modern adapter задаёт `pregame || (isJudge && paused)` около 1583397/1583437. V не безусловный camera-toggle обычного живого матча. D, напротив, без такого гейта.

**Вывод шага 1:** базовые утверждения о Vuex/vShow и основном D подтверждены. Обещание комментария fuzz «ТОЧНАЯ модель сайта» слишком сильное: перечисленные отличия и первоначальное отсутствие role-root не представлены. Сами по себе они не посчитаны новыми production-блокерами без визуального контрпримера; практическое следствие late-mount — H02. Повторная доставка viewer-permission на reconnect остаётся неизвестной, не постулируется как факт.

## 3. Подтверждённые находки

### B01 — БЛОКЕР, «в эфир»: content повторно принимает старую NIGHT-команду после актуального DAY

**Места:** `src/content/panels/obs-panel.ts:393–408`, особенно `406`; `1329–1333`, `757–765`, `1555–1563`. Контраст: исправленный `src/background/obs-client.ts:557–573`.

Ночь начинается, отправлена `set_scene(night)`. OBS успевает на NIGHT, затем стример вручную возвращает DAY. Свежее событие DAY доходит до content и прячет всё. **После него** приходит старый успешный ответ NIGHT. Background event-sequence guard сохраняет у себя DAY, но content `switchScene` после await без проверки эпохи присваивает `currentScene=sceneName`, т.е. NIGHT. Далее ставится 3-секундный показ, гейт перечитывает уже испорченный content-кэш, снимаются пин и общий CSS.

В `audit3-obs-races.test.ts > RED ACK: $channel response arrives +$gap ms after newer DAY` проверены две границы: старый WebSocket ACK и **задержанный runtime-ответ уже завершённой нормальной OBS-команды**. Второму варианту не нужен необычный порядок ACK/event внутри самого OBS. Gap после DAY: 0/50/149/1000 мс.

```text
backgroundScene: day
after3100:      [true,true]
after15100:     [true,true]
commands:       [night]
expected:       [false,false]
```

Никакого реального обратного переключения DAY→NIGHT не было. Heal не лечит ложный кэш и через 15 с. Это **обход закрытого фикса на следующем уровне**, а не заявление, что счётчик background не работает: тест отдельно утверждает его актуальный DAY. Старый get_status вообще не используется. Ручной DAY из второй вкладки также допустим по ownership-правилам, но основной контрпример не зависит от живого двухвкладочного эксперимента. Частота такого транспортного порядка в установленном OBS не измерена; отсутствие защитного порядка в content и последующий устойчивый показ доказаны.

### B02 — БЛОКЕР, «в эфир»: распознавание/реконнект создают «новую ночь» после ручного скрытия этой же ночью

**Места без OBS:** `auto-start.ts:1388–1396`, `975–983`, `701–709`, `851–865`, `881`.

1. Устойчивый день, autoHide и phaseSwitch ON, OBS auto OFF. Роли скрыты.
2. t=0: сайт уже рисует настоящую `.substage.current` «Ход мафии».
3. D показывает, на t=50 мс второй D явно скрывает. Проверено `[0,0]`.
4. После этого расширение распознаёт ночь и ставит `nightAutoShowStartedAt=Date.now()` — **время распознавания**, более позднее, чем ручной hide.
5. Ещё через 3 с 2-секундный backoff уже истёк; `nightShowDue` ошибочно считает решение старым и показывает всё. Через 12 с `[1,1]`.

Это не прежний защищённый D **между распознаванием и callback**: найдено окно **после реального начала ночи, но до распознавания**. Контроль: та же пара D на +1500/+1550 мс сохраняет скрытие. Boot посреди ночи тоже воспроизводит: D-hide +1050 мс, detect +1150, самопоказ +4150.

Пробы: `audit3-adoption.test.ts > RED manual show-hide 50ms after real DOM night begins…`, `RED a single own-D…`; независимые пары в `audit3-review-central.test.ts`. **Headless Chrome 155** с production auto-start/keyboard/SharedDomObserver/role-pin/selectors подтвердил:

```text
night marker +50ms:   visibility=hidden, opacity=0   (обе)
та же ночь +5050ms:   visibility=visible, opacity=1  (обе)
```

**Тот же класс в OBS:** `obs-panel.ts:489–508,1198–1205,1572–1582`; `auto-start.ts:1072–1078`. D-hide после уже завершённого ночного показа → +50 мс disconnect → +50 мс reconnect на той же NIGHT. Reset обнуляет currentTimeOfDay; повторное null→night даёт новую эпоху после D. Через 6,5 с всё открыто. Первоначальное подтверждение также переигрывает D на +100/+499 мс; +500/+501/+600 мс и ручное решение внутри обычного pending-show — положительные контроли. Пробы `RED disconnect…` и `manual hide +%dms…` в `audit3-obs-races.test.ts`.

Группируется как одно семейство неверной эпохи распознавания, а не отдельный дефект на каждый параметр/модуль. По замыслу ручное решение принадлежит **игровой ночи**, не только отрезку после присваивания внутренней переменной. Синхронное защитное скрытие самого disconnect работает; ошибка позже, при reconnect.

### B03 — БЛОКЕР, «в эфир»: восстановленная ночь вообще не получает эпоху; возврат сцены отменяет D

**Места:** `obs-panel.ts:512–550`, `1171–1177`, `591`; `auto-start.ts:1072–1078`.

F5 посреди ночи, свежий persisted NIGHT той же OBS-сессии, OBS на NIGHT. Restore заполняет currentTimeOfDay, но **не nightSince**. Последующее распознавание той же фазы возвращается без её инициализации. После установившегося показа игрок D скрывает роли; +50 мс вручную DAY, +50 мс NIGHT. Через штатные 3 с роли открываются сами.

При новом `nightShow` выражение `nightSince ?? Date.now()` даёт **текущее время вместо начала этой ночи**. Оно новее ручного hide, поэтому manual-CSS удаляется.

`audit3-obs-races.test.ts > manual hide survives night→day→night…`:

```text
restored=true:  actual [true,true], expected [false,false]  FAIL
restored=false: actual [false,false]                      PASS
```

Это отдельная причина относительно B02: не новая эпоха на распознавании, а отсутствующая эпоха и fallback при каждом возврате сцены. Фаза игры не менялась. Правило «ночь показывает всё» имеет явное исключение manual hide этой ночью; оно и нарушено.

### B04 — БЛОКЕР, «в эфир»: autoHide, включённый при закрытом гейте, снимается как старый сценовый CSS

**Места:** `auto-start.ts:1035–1037`, `1609–1614`, `794–798`, `512–523`, `1081–1083`.

1. Ночь распознана, всё видно; autoHide=false, phaseSwitch=false, OBS auto=true.
2. Уход NIGHT→DAY создаёт общий CSS; sceneHide запоминает `cssWasPresent=false`.
3. +50 мс включить autoHide. По явному оракулу это **ручное решение прятать на эту ночь**; manual timestamp действительно обновляется.
4. +50 мс вернуть NIGHT. На +3100 мс всё видно, хотя autoHide всё ещё ON, ручного show не было.

Сравнение эпох здесь **правильное**, но в manual-ветке nightShow прежний `sceneHide` считает CSS исключительно своим. Новый autoHide оставил `cssReason="auto"`; строки 1082–1083 удаляют защиту.

`audit3-obs-races.test.ts > settings: enabling auto-hide with scene gate already closed=%s…`: true FAIL; контроль autoHide **до** ухода сцены — PASS. Это не спорный autoHide-only первоначальный вход ночью: настройка включена вручную уже в этой ночи.

**Ошибка эталона:** fuzz `specNightShow` (`:451–457`) повторяет ту же развилку с `had.cssPre` и reason. Скрипт `sceneOff → autoHideOn → sceneOn → wait` в неизменённом Spec проходит (`fuzz-oracle-control.log`), хотя независимая production-проба выше требует и не получает скрытие. Увеличение seed этот дефект не обнаружит, пока его результат разрешён самим эталоном.

### B05 — «в эфир»: фазовое скрытие без autoHide при включении запаздывает более кадра и 300 мс

**Места:** `auto-start.ts:1428–1432`, `1449`, `1471`, `1087–1094`, `1566–1569`; day-hide `985–986`.

День, native flag=true, autoHide OFF, phaseSwitch ON, OBS auto OFF. При включении нет первоначального синхронного применения фазы: autoHide ничего не делает, первый обычный интервал зовёт phase-check через 1000 мс, затем debounce 150 мс. В допустимом тихом окружении:

```text
t=0/16/149/300/500/999/1000/1149ms: [true,true]
t=1150/1200ms:                      [false,false]
```

`audit3-adoption.test.ts`: `RED phase-only enable…`, `RED enable phase-only midgame…`, `RED phase-only boot full timing trace`. При update ON на t=2500 роли ещё видны спустя +301 мс. Независимый witness/control подтверждает; **Chrome** показывает обе visible/opacity1/display:flex на +500 мс. Контроль native false скрыт сразу.

**Серьёзность оговорена, не спрятана:** по заданному запрету любого кадра с предписанно скрытой дневной ролью — **БЛОКЕР**. Если владелец отдельно разрешает первичное распознавание phase-only и считает его только latency, это **СРЕДНЯЯ**, >300 мс. В оракуле такого разрешения не дано, поэтому основной счёт использует кадровое правило. 1150 мс — воспроизведённый плохой порядок, **не универсальная длительность полной сборки**: мутации других фич или OBS-gate могут ускорить проверку. Предыдущий B09 исправлял autoHide ON и первые 100 мс; здесь другой самостоятельный phase-only путь.

### B06 — БЛОКЕР, «в эфир»: повторное включение автосцен обходит pre-day защиту

**Места:** `obs-panel.ts:1649–1657`, `1295–1334`; нормальный pre-day путь `1185–1213`, особенно `1206`; повторный day-return `1171–1177`; `auto-start.ts:1026–1047`.

autoHide=false, phaseSwitch=false; OBS auto ON; фаза день, текущая сцена NIGHT. Это допустимо, например при ручном выборе NIGHT или другом владельце автосцен. Fresh boot +8 с скрывает всё. Выключить OBS auto **или** OBS integration, дать установиться `[1,1,1]`; включить обратно без D/смены фазы.

Update с уже известным днём напрямую зовёт `autoSwitchScene(day)` и schedule. `hideRoleBeforeDaySceneSwitch` находится только в подтверждении **смены** фазы, поэтому здесь не вызывается; текущая NIGHT считается safe и общий CSS не создаётся.

Два проявления одной причины:

* При допустимом `ignored:not_owner`: через **6 с** `011` — own hidden-пин, peers видны. Это не дневное исключение D: D не нажимали.
* При успешной команде DAY: **на outbound `111`**, на +100 мс после ACK фактического DAY — **`011`**, ожидалось `000`. Независимое scene event доставлено +200 мс; на +300 уже `000`.

200 мс — управляемая задержка канала события, не телеметрия OBS. Проба не подменяет неуспешную сцену успешным ACK: mock меняет фактическую сцену на DAY до ответа. Доказаны отсутствующий барьер перед outbound и открытые peers до события, не записанный видеокадр.

`audit3-matrix.test.ts:361–375`, `counterexample confirmation`. Полная матрица и независимый повтор: 4 persistent mismatch + 8 outbound/+100 mismatch = **12**, один дефект. Клетки `ah0-ps0-oe1-oa1-m0/1-day-night-n1`, оба тумблера. Focused повтор также красный. Это соседний обход исправленного pre-day на нормальной смене фазы, не отрицание того исправления.

### H01 — ВЫСОКАЯ, «от игрока»: Show в меню под V теряется, если под V уже вернулся CSS

**Места:** `auto-start.ts:512–527`, `601–612`, `749–774`, `975–986`.

Ночь, phaseSwitch ON, OBS OFF; native flag=false, ночная автоматика уже показала роли. D скрыть → V удерживать, роли видны → наступает день и ставит **новый реальный CSS под V** → нажать menu Show (native false→true) → отпустить V.

Immediate subscriber правильно видит input и смену флага. Но peeking-ветка Show только сбрасывает `peekRestoreHidden/Inline`, не убирая уже вставленный CSS. На release `restoreCss=false`, поэтому CSS не снимается. День уже распознан, повторная phase-проверка ничего не меняет. Через 12 с роли скрыты, нужен новый D/смена фазы.

`audit3-adoption.test.ts > RED site show under V after actual night-to-day CSS…`; вариант autoHide ON под V — та же причина. Независимый настоящий menu click-handler и контроль **без** нового day-CSS: без CSS PASS/show, с CSS устойчивое hide. **Chrome**: после release +1 с обе display:flex, visibility:hidden, opacity0. Старые H01–H03 были о belt/таймерах; здесь их нет — новое владение вставленным под V stylesheet.

### H02 — ВЫСОКАЯ, «от игрока»: первый native-hidden mount отменяет более новое наше Show

**Места:** `auto-start.ts:578–599`, `618–625`, `1388–1394`, `1436–1439`.

Штатно достижимая последовательность, не неизвестный viewer-reconnect:

1. Лобби до раздачи: roleDisplay=true, role-root отсутствует; autoHide ON, phaseSwitch OFF, OBS auto OFF. CSS стоит, siteFlag=null. Сайтовая опция modifiers ON.
2. Native Ctrl+D скрывает флаг. D сайта не гейтится наличием роли/стадией. Пока роли нет, расширение изменения не наблюдает.
3. Через секунду обычный **наш D** явно показывает: снимает CSS, native false не меняет.
4. Назначается первая роль. vShow монтирует её с прежним display:none.
5. `siteFlag===null` → первое false безусловно принимается как новое hide, создаёт manual-CSS. Никакого нового решения игрока/смены flag не было.
6. Через 12 с скрыто до отдельного D/другого условия.

`audit3-site-late-mount.test.ts:76–88`, настоящий hotkeys-js, неизменённый vShow/Ha живого бандла и настоящий SharedDomObserver:

```text
AUDIT3 LOBBY CTRL+D -> D -> FIRST ROLE {nativeFlag:false, hideCss:true}
expected hideCss=false
```

Гейт отсутствия роли подтверждён Player `role:""`/условием renderer; native D без стадийного гейта и отсутствие reset флага при старте проверены по live JS (§2). Поэтому это не только произвольный crafted DOM. Контроли: известный false **при уже существующей роли**, затем D-show и remount — PASS; первый true-mount — PASS. Три FAIL — формы одного first-false дефекта. Это не старый viewer V/H07.

## 4. Условные результаты и исключённые находки

Не добавлены к 6 B / 2 H:

1. **IME F6 — условный блокер «в эфир».** `keyboard.ts:38–42,69–102`; `auto-start.ts:1388–1394`. Разрешён hide=F6, textarea, compositionstart, `code=F6,key=Process,isComposing=true,keyCode=229`. Router считает F6 не редактирующей, не проверяет composition/229 и открывает CSS-hidden роли на +16 мс и +12 с. `audit3-keys-lifecycle.test.ts > AUDIT3-IME` красный. Это реальный обработчик такого события, **не измерение того, какой installed IME/браузер физически доставляет F6 странице**. Обычные D/V/F/E в textarea — положительный контроль. По заданной иерархии при подтверждении физической доставки — блокер, не «высокая конфиденциальность».
2. **Faker-blocker всё ещё отменяет Enter/Tab/стрелки/удаление в поле.** `role-faker.ts:30–36,167–175` использует producesText вместо editsText: router правильно отступает, следующий listener отменяет default. Шесть FAIL `AUDIT3-EDIT`; E/disable снимает проблему. Это дефект ввода, **вне единственного предмета видимости**, не средняя ролевая находка.
3. **Два остатка «E возвращает текущую роль».** `role-faker.ts:349–355,306–327`: новая настоящая роль равна выбранной fake → realHref пуст и E возвращает старую; либо E до delayed observer теряет новое значение. `AUDIT3-REAL-E`, `AUDIT3-QUICK-E` красные. Нужна не установленная живьём truthy→truthy смена своей роли на том же root; это уточнение границы уже известного класса, не два новых unconditional дефекта.
4. **Restore обходит 3-секундный барьер.** `obs-panel.ts:549,591` немедленно release/nightShow при persisted NIGHT + status NIGHT; +16 мс уже видно. `RED restore: restored NIGHT still waits…` красный. Временной контрпример доказан, но для давно приватной стабильной NIGHT это не доказательство зрительского кадра; при осознанном исключении для restore меняется замысел. Не смешано с B03.
5. **Окно 700 мс — эвристика, не причинность.** Программный show через 50 мс после постороннего click принимается за ручной. Центральная проба красная по более сильной причинной спецификации. Но штатный программный **show** в таком порядке требует ещё не измеренной повторной permission-connect доставки; fail-safe первый viewer-hide работает. Новым доказанным live-блокером не названо.
6. **Решение при полном отсутствии ролей может потеряться.** Центральные first-true Show/поздний hide >700 мс имеют механические контрпримеры. В основной счёт включён только H02 с отдельно установленным обычным Ctrl+D→D→раздача путём. Остальные не умножают счёт без собственной достижимости.
7. **SPA новая игра не перевзводит autoHide** в пробе с pushState и новой table. `auto-start` не route-resetится, но сам pushState не доказывает реальную same-document навигацию сайта. Оставлено условным. Fake до E через SPA — уже согласованный замысел.
8. **Orphan/две живые копии:** прежние условные риски остаются границей, не новыми находками. Sweep работает только при новом enable, не доказывает безопасность старого осиротевшего Chrome-контекста, не получающего OBS events. F5 — новый документ, update extension без F5 — другое событие.

## 5. Доказательная трасса A–F: что чисто, а что нет

### A. Писатели, сила и переживание замены узла

| Писатель, file:line | Механизм / сила / remount |
|---|---|
| Сайт, §2 | Vue vShow пишет обычный inline display каждой роли; mount применяет текущий флаг; родительский display отдельно |
| `auto-start.ts:553–562` | `pn-role-display-override`: stylesheet display:flex!important сильнее обычного inline display:none; охватывает все текущие role-span; переживает remount |
| `auto-start.ts:492–547` | `polemica-role-hide`: visibility:hidden, opacity0, pointer-events:none!important на роли и reveal; единственное активное общее hidden; переживает remount |
| `auto-start.ts:436–472,479–483` | Inline visibility/opacity/pointerEvents: снятие legacy слоя и его возврат после V; pinned узлы пропускает; обычный inline слабее stylesheet!important; новый root его не наследует |
| `role-pin.ts:123–181` | Own inline!important плюс data-pn-role-pin. Exported visible-ветка существует для API/tests, **OBS в production её не вызывает**, только hidden или release |
| `role-pin.ts:49–64` | `pn-role-pin-shield` + html `data-pn-own-role-hidden`: свежая own-role hidden/opacity0 до heal; lift/release снимают атрибут |
| `role-faker.ts:235–290` | Peer visibility:hidden!important и маркер; inline!important сильнее stylesheet!important на том же узле; reset возвращает priority snapshot |
| `role-faker.ts:51–81` | `pn-role-fake-shield` + html `data-pn-role-faked`: новые роли без fake, чужой use внутри сохранённого fake-root, tooltip-text и roleReveal скрыты; remount защищён до reconcile |

Важно: visibility наследуется, но дочернее правило может задать собственную visibility; opacity0 предка подавляет всё поддерево. Таблица display не отменяет opacity/visibility и не показывает скрытого родителя. Результат каскада не выводился только из style-ID: матрица сопоставляет CSSOM/matches/priority и родителей; Chrome-контроль проверил фактические computed значения.

**Проверено и чисто в текущем src:** наши текущие игровые role-root не получают inline display. По всему src проверены display-писатели и style/cssText пути: остальные относятся к своим панелям/попапу/таблице разбора/видео/спрайту protocol, не текущей role. Не ограничились тремя файлами source-latch. `native-role-toggle.ts` и `core/synthetic-keys.ts` на HEAD удалены; синтетических D/Ctrl+D и их WeakSet теперь нет. Их нечего «прочитать на HEAD» или атаковать как действующий канал. Сохранённые старые упоминания в комментариях не исполняются.

Нейтрализатор не обходит isJudge, отсутствие mobile-плитки или родительский connectedToRoom. Все найденные альтернативные поверхности и ограничения перечислены в §2.1; «любой мыслимый role-renderer исключён» не утверждается.

### B. Явный исполнимый перебор

`audit3-matrix.test.ts` исполняет настоящие auto-start, obs-panel, role-pin, role-faker, keyboard, SharedDomObserver, selectors; **моки только env/messaging**. Native dispatcher — неизменённый hotkeys-js, vShow-момент моделируется микрозадачей, геометрия ненулевая. Persisted restore вынесен в отдельные пробы.

```text
autoHide(2) × phaseSwitch(2) × obs_enabled(2) × obs_auto_mode_enabled(2)
× useHotKeysModifier(2) × boot(day/night)(2)
× scene(night/day/disconnected)(3) × native flag(2) = 384

A = obs_enabled && obs_auto_mode_enabled
baseline:
  A          ? nightPhase && nightScene :
  phaseSwitch? nightPhase :
               !(autoHide || !initialNativeFlag)
```

Это expected, не формула из observed actual. Initial native-hidden принимается как manual-причина, но не ручное действие этой ночью; положенный nightShow его пересиливает. Дневное own-pin исключение задаётся отдельно для явного D, а не разрешается любому зеркалу.

| Группа | Fresh запусков | Сравнений | Mismatch |
|---|---:|---:|---:|
| Baseline +8000, native неизменён, override | 384 | 1152 | 0 |
| D, +120/+3180, три repeat | 384 | 2304 | 0 |
| V tap/hold/blur, exact restore | 1152 | 5376 | 0 |
| F/F+V/Vup/E, содержимое | 384 | 3072 | 0 |
| Полная замена roots до callback и после heal | 384 | 1152 | 0 |
| Roots под F, щиты, fake/E, reveal | 384 | 2688 | 0 |
| autoHide/phase OFF→ON; manual hide + все настройки OFF | 1152 | 2304 | 0 |
| Program site hide/show, menu Show | 384 | 1536 | 0 |
| Scene return +2999/+3500, manual hide | 96 | 480 | 0 |
| Все автоматические настройки OFF под V | 384 | 384 | 0 |
| OBS/auto OFF→ON | 192 | 384 | **4** |
| Успешная DAY-команда, outbound/+100/+300 | 4 | 16 | **8** |
| **Всего** | **5284** | **20848** | **12** |

**Чисто ровно в нулевых группах таблицы**, не всё декартово произведение возможных событий. В частности матрица не покрывает manual action до распознавания, persisted-night epoch, delayed command responses, все индивидуальные settings под V, неизвестный первый flag, IME, orphan/два реальных окна. Эти зоны исследованы направленно либо честно остались условными. Исторические H04/H05 ночного зеркала в обычном устойчивом профиле больше не воспроизводятся; B06 — иной путь.

### C. Время, порядок и общая MutationObserver-линия

| Окно на этом HEAD | Проверка / вывод |
|---|---|
| Vue microtask → MutationObserver → paint | Настоящие vShow/dispatcher извлечены; immediate subscriber исполняется до rAF. Не читали синхронный display после commit как уже применённый flag |
| Старые restore 150 мс ×5, verify500, retry1000, rearm600 | **Удалены из auto-start**, а не «проверены зелёными»: нет синтетического native restore/belt; старые гонки не возвращены под другими именами |
| Night-show 3000; manual backoff2000 | Ручной D после recognition внутри pending защищён; до recognition — B02 |
| Scene-deferred show 2000 | Код остался; при активных OBS-сценах автопоказ передан OBS, без них гейт открыт. Старый PTT не является оправданием неправильного результата нашего CSS-D |
| Phase debounce150, interval1000, initial deferred2000 | B05, короткое B02-окно. Первоначальные callbacks не обещают скрытия до первого кадра |
| OBS phase150+350, pre-day30 | Нормальный phase-change предварительно прячет; update-путь повторного включения — B06 |
| OBS visible delay3000; heal2000; hidden retries250 до5 | Старое 2с/3с starvation не воспроизведено; обычный scene return согласован; B01/B03/B04 относятся к неверной правде/владению, а не starvation |
| Runtime response / scene event / restore await | B01; старый get_status и background ACK guards в своих штатных regression-контролях проходят |
| SharedDomObserver regular rAF/250; background500 | Немедленный канал не ждёт этого троттлинга. Его цикл по пачке и проверка флага идемпотентны: вставка CSS даёт новый batch, но равный siteFlag не перепринимается |

`core/dom.ts:130–157` зовёт immediate до накопления regular pending и до фильтра ownRoots. `onRoleDomImmediate` (`auto-start.ts:630–641`) сканирует пачку до первой relevant записи, делает максимум один read flag за вызов. Самоподдерживающаяся петля от этого пути не обнаружена; **его стоимость на реальном шторме и слабой машине не измерена**. Отсутствие dropped-buffer для immediate — не доказательство frame-time бюджета.

Проверены короткие интервалы 0/16/40/50/100/149/150/301/499/500/501/600/1000 мс, границы 2999/3000/3500, ожидание 12–15 с, несколько каналов ACK. Обычный D +100 мс после V, быстрый повтор V, active modifier-repeat, manual pending-night после recognition — чисты штатными и независимыми контролями. Все возможные async-интерливинги исчерпанными не названы.

### D. Клавиатура и коллизии

**Проверено и чисто в исполненных пробах:** стандартные D/V, первые/повторные/keyup события, Ctrl/Alt/Meta-repeat включившегося peek, русский key при физическом code, Shift, обычный textarea, CapsLock после отпускания, blur/visibility release, remap native D, собственный дневной pin, F+D no-op/toast, F не открывает hidden, V под F не показывает peers, E/disable возвращают свои изменения, не чужой CSS/pin.

Трасса: router на window capture (`keyboard.ts:69–103,130–147`); typing editsText проверяется до действия; включившийся hold глотает повтор в любых modifiers; простой зарегистрированный D не отдаётся сайту; незабранный/modified D наблюдается `handleSiteRoleKey`, сайт меняет flag, результат принимает immediate subscriber. D под V/F подавляется. Пустой V отдаётся native callback; пустой peek=D — нет. При binding на D router подавляет и его keyup; это не основание объявлять lh сайта точной копией физической клавиатуры.

Новые положительные проверки active remapped peek: **m,l,g,k,r, 0–9, F1–F10** не доходят до настоящего embedded dispatcher; корректная перестановка hide/peek через свободную клавишу и смена peek-key во время удержания возвращают CSS/pin. Одинаковые назначения запрещены попапом; crafted-storage last-registration-wins не переобъявлен разрешённым сценарием. Fake=Digit1 → doAction известен и вне видимости; не добавлен в счёт. Pause/outcry/D-reset штатные старые пробы проходят.

Синтетические клавиши/WeakSet удалены целиком, поэтому нет текущего пути «наш Ctrl+D сделал bookmark или побочное действие». Это не гарантия против другого расширения/сайта, прямо меняющего DOM, не проверка trusted browser F-key defaults и не матрица физических IME. Новые границы IME и отдельного faker typing-listener описаны в §4.

### E. Жизненный цикл

**Чисто в пробах:** normal F/E и F/disable сохраняют display сайта, priority snapshot и чужой pin/CSS; marked orphan sweep не снимает live-pin этой копии; полная root-замена под fake не показывает настоящую роль до callback; swap peek-key отпускает прежнее удержание; isolated faker disable оставляет живой peek; isolated OBS disable уведомляет gate и больше не оставляет прежний L01; обычные все-settings-OFF под V сходятся.

**Не чисто:** reconnect/начальное распознавание — B02; restored night — B03; settings с уже закрытым gate — B04; OBS re-enable — B06; V через day с последующим site Show — H01; первый mount — H02.

Source-трасса смерти контекста:

* Обычный F5 уничтожает документ, styles/html-атрибуты и модульные карты; это не то же, что смерть extension context.
* При смерти JS в старом документе `polemica-role-hide`, `pn-role-display-override`, оба shield-style, html `data-pn-own-role-hidden` / `data-pn-role-faked` и inline/data-* остаются DOM-объектами.
* Новый auto-start enable вызывает `sweepOrphanPins`; новый faker enable — `sweepOrphanFake`. Они чистят маркированные пины/fake; style shield без html-атрибута инертен. Общий hide/override не являются доказанно переинициализированным ручным состоянием прежней копии.
* `content/index.ts:253–262` и `orphan-watch.ts:83–101`: Chrome обычно **не внедряет новую копию до F5**. Старый controller может жить без сообщений OBS; баннер не скрывает роли. Sweep новой копии не лечит отсутствие самой копии. Реальный Chrome/Firefox update не испытывался.
* Две вкладки имеют отдельный DOM/module state, общий background/OBS. Scene ownership не доказательство безопасности захватываемой другой вкладки; отдельной новой ошибки claim-сериализации не найдено. Ручная смена другой вкладкой — допустимый источник B01. Две живые копии одного content в одном DOM — не две вкладки и остаются условными.

### F. Адекватность тестов и мутации

Полностью прочитаны требуемые production-файлы и fuzz/latch/auto-start-accept/role-pin/role-faker/keyboard/obs-night tests, относящиеся integration и audit2-пробы. `native-role-toggle.ts` на текущем HEAD отсутствует по архитектурному решению, не проигнорирован.

**Что действительно улучшилось:** фазы задаются разметкой стадий, обычный editable filter перед pressed-state, есть короткие burst, actual immediate MutationObserver, принятие site hide/show. Это не прежняя body.day/night или synthetic-native модель.

**Чего fuzz всё ещё не доказывает:**

* OBS заменён `auto/safe` и 2с poll; faker всегда false. Импорт role-pin не создаёт настоящих пинов без владельца OBS. Нет реального persisted restore, epochs/ACK, own pin-shield, fake/use/tooltip-priority в случайном прогоне.
* `visible()` (`:223–231`) смотрит inline и наличие style-ID, не содержимое/каскад CSS, родителей, геометрию, reveal/tooltip/use. Мутация тела hide stylesheet может остаться невидимой этому helper.
* `buildTable` создаёт роли **до enable** (`:368–370,461–462`); siteFlag-null/первая роль не моделируется. Rerender заменяет одну при остальных существующих: H02 не появится от большего seed.
* 12 с между обычными шагами исключают D между реальной ночью и распознаванием. Burst-пул (`:712–714`) ограничен V/PTT/rerender/wait, не содержит night/settings/sceneOn/modified-D. Больше seed не добавляет отсутствующий тип события.
* В обычном settle первый снимок после microtask, затем 50 мс до 1 с и 250 мс далее. Мигание короче 50 мс/250 мс может попасть между выборками; первый init checked только после 12 с пропускает B05. Burst имеет снимок после gap 0–299 мс и не общий flip-counter.

Каждое запрошенное ослабление проверено **на текущем тексте**, не переписано из старого отчёта:

| Имя / нынешний эквивалент | Оценка |
|---|---|
| `ptt`, :486–508,586–592,704,724–727 | Сейчас в основном состояние ввода/доступность native D, не прежний blanket bypass итогового CSS-oracle. Принятый отказ native combo при физически зажатой PTT оправдан; физическое/readonly/IME состояние остаётся упрощённым |
| `held`, :486,549–558,701–715 | Выбирает допустимые down/up; фактическая власть передана `spec.peek`. Наличие физического held не равно настоящему active peek/pin |
| `showDue` → `autoShowDue`, :437–440,562,679–682 | Сравнивает номера больших шагов, не время реального recognition/callback внутри шага. B02-окно не выражено. V-release исключение допускает положенный ночной show по замыслу; не является доказательством корректной эпохи |
| `peekActive` | Такого прежнего идентификатора больше нет; эквивалент `spec.peek` задаётся из spec.hidden при Vdown. `:753–754` под ним итог не сравнивается, только зеркало: «обе скрыты под V» может пройти. Настоящие pin/faker отсутствуют; матрица отдельно проверяет steady hold |
| `sceneRestore` | Прежний идентификатор удалён; вместо него `spec.sceneHide` с cssPre/manualStep. Это **не независимое доказательство владения**: `specNightShow` копирует плохую развилку B04. Добавленный scripted-сценарий проходит без правки существующих assertions, хотя противоречит прямому manual-hide оракулу |

Конкретный контроль ложного эталона:

```sh
npx vitest run tests/unit/audit3-fuzz-oracle.test.ts -t AUDIT3-ORACLE
# 1 PASS / 30 skipped: копия штатного файла, только добавлен сценарий
# cfg: autoHide=false, phase=false, OBS=true, phase=night, flag=true
# actions: sceneOff, autoHideOn, sceneOn, wait
```

Пропущенные 30 tests здесь результат `-t`, не skip обязательного 5000-прогона. Эта дополнительная PASS — свидетельство **принятия запрещённого исхода эталоном**, не положительная проверка hidden-инварианта. Независимая B04-проба с explicit expected hidden падает.

#### Мутационный эксперимент — откаты по одному

Прочитаны оба полных diff. Для экспериментов использована отдельная `AUDIT/mutant-repo`, не общая копия и не оригинал. Перед каждым откатом возвращались **только собственные изменённые файлы из начальных снимков**, применялся один смысловой дефект. Сначала relevant suites; если зелёные — весь исходный `npm test`, 1746 тестов. В мутационных запусках fuzz использует штатные **60 seeds**, не 5000 на каждом мутанте; обязательный 5000-прогон выполнен отдельно на неизменённой базе. Старые числа 40/50 двух аудитов не выдаются за повтор: механизм сильно изменён, удалённые пути отмечены отдельно.

Окончательная матрица после двух контрольных дополнений: **42 исторических эксперимента = 31 killed + 7 survivors + 4 obsolete/equivalent**. Один survivor относится только к exported API-контракту, без доказанного текущего production-caller сценария. В сырых exit-кодах 32 красных/10 зелёных: один красный helper уже не вызывается production, ещё три зелёных отката эквивалентны новой конструкции. Поэтому не все зелёные названы пользовательскими дефектами и не все красные — живой защитой production.

Обозначения: F=fuzz, L=obs-role-latch, A=auto-start-accept, P=role-pin, R=role-faker, K=keyboard, O=obs-role-integration. **M-A/M-B/M-C ниже — ID мутантов, не production B/H этого отчёта.** Логи/patches: `mutation-logs/`; итог всех 42 — `final-coverage.json`, `final-coverage.md`; этапы — `tests-findings.md`, `mutation-coverage-addendum.md`, `mutation-results.json`, `lifecycle-results.json`; скрипты — `run-mutations.py`, `run-lifecycle-mutations.py`, `run-coverage-addendum.py`, `run-final-four.py`. Это смысловые откаты на HEAD, не слепой revert старого commit.

| Мутант | Возвращённый дефект | Итог / реальная защита |
|---|---|---|
| M-A01 | isNativeRoleHidden только #stop | Obsolete: P красный, production callers нет |
| M-A02 | Inline-show удаляет display сайта | Killed A/L/F |
| M-A03 | Inline-hide пишет display:none | Killed **только source guard** |
| M-A04 | Visible-pin снимает display | Killed P/L |
| M-A05 | Lift снимает display | Killed P/L |
| M-A06 | Release возвращает stale display | Killed P/L |
| M-A07 | Faker скрывает peers через display | Killed R/L |
| M-A08 | E возвращает stale display | Killed **только source guard**; corrected mutant с обоими snapshot-путями |
| M-A09 | Adoption скрытия ищет только #stop | Killed F/A |
| M-A10 | Нет реальной нейтрализации display | Killed **только source guard**; одного F недостаточно |
| M-A11 | E теряет исходный visibility!important | **SURVIVED весь npm test** |
| M-B01 | Active hold-down доходит сайту | Killed F/K |
| M-B02 | Active hold-repeat доходит сайту | Killed K; F зелёный |
| M-B03 | Active hold-up доходит сайту | Killed K; F зелёный |
| M-B04 | Пустой hold глушит native camera | Killed K; F зелёный |
| M-B05 | V-up не возвращает CSS при настройках OFF | Killed F/A |
| M-B06 | V-up игнорирует manual эпоху ночи | Killed F/A |
| M-B07 | V-up передаёт sceneSafe=true | Equivalent: последующий sync gate немедленно возвращает CSS |
| M-B08 | Site D не manual | Killed F/O |
| M-B09 | Наш обычный D-repeat доходит сайту | Killed F/K |
| M-B10 | Ctrl+D-repeat доходит сайту | Killed F/O |
| M-B11 | Own hidden-pin блокирует показ peers | Killed A/O/F |
| M-B12 | Night callback без manual-epoch guard, backoff2000 оставлен | F/A зелёные; **killed только полным набором, audit2-scene-belt** |
| M-B13 | Нет подписки auto-start на gate | Killed F/O |
| M-B14 | Heal OBS не сообщает gate | Killed **только O**, F/L зелёные |
| M-B15 | Нет beforeDayScene | Killed **только O**, F/L зелёные |
| M-B16 | Unsafe gate не скрывает после manual | Killed F/O |
| M-B17 | V-up без немедленного sync gate | **SURVIVED весь npm test** |
| M-B18 | Нет hidden-pin CSS shield | Killed P, F/L зелёные |
| M-B19 | Нет fake CSS shield | Killed R, F зелёный |
| M-B20 | Teardown stopPeek вместо stopPeek(true) | Equivalent: disable всё равно синхронно снимает CSS, позднего D нет |
| M-B21 | NightShow не снимает scene-only CSS после manual Show | **SURVIVED весь npm test** |
| M-B22 | Disable не отписывает scene listener | **SURVIVED весь npm test** |
| M-B23 | E/disable оставляет fake shield | Killed R |
| M-B24 | Release оставляет pin shield | Killed P |
| M-B25 | Lift оставляет pin shield | Killed P |
| M-C01 | RestoreLiftedPins не возвращает shield | **SURVIVED весь npm test** |
| M-C02 | Нет reset deferred-log при новой фазе | Equivalent: единственный true-writer флага теперь недостижим |
| M-C03 | Site Ctrl/Cmd+D пропущен под V | Killed: 2 FAIL / 75 PASS, включая F |
| M-C04 | Site Ctrl/Cmd+D пропущен под F | **SURVIVED**: targeted 70 PASS и весь npm test |
| M-C05 | Release не удаляет swallowed-state | Killed: 7 FAIL / 67 PASS, K/F/audit2 |
| M-C06 | Устаревшая off-функция может очистить новый listener | **SURVIVED API-контракта**: 73 targeted PASS и весь npm test; действующий пользовательский lifecycle не доказан |

**Семь survivors — пробелы проверки, не семь новых production-багов HEAD. Первые четыре:**

* **M-B17:** под V выключена последняя hiding-настройка, эфир уходит с NIGHT, V-up. На мутанте peers открыты до следующего poll; на HEAD скрываются сразу. Проверка должна быть непосредственно после keyup, не через 12 с.
* **M-B21:** ночью D-hide→D-show, уход/возврат сцены. Manual Show требует снять только scene-only hide; мутант оставляет всё скрытым.
* **M-B22:** isolated auto-start disable при живой OBS panel; последующее scene event воскрешает CSS уже выключенного consumer.
* **M-A11:** peer имел visibility:visible!important до F; E на мутанте возвращает visible без priority. Это точность cleanup, не доказанная текущая утечка.

Новые временные тесты `audit3-test-survivors.test.ts`, `audit3-test-faker-priority.test.ts`, `audit3-test-real-obs.test.ts` дают **HEAD PASS / соответствующий mutant FAIL**. Последний использует настоящие OBS/observer/router/faker, mocks только окружения/транспорта/log/toast: M-B17 actual `[false,true]` вместо `[false,false]`; M-B21 `[false,false]` вместо `[true,true]`; M-B22 создаёт style после disable. Этот этап дал 1752 PASS с шестью новыми проверками.

Последующая сверка полноты исторического diff добавила ещё три survivors:

* **M-C01:** `pinOwnRole(hidden) → lift → restore → новая root-замена`. Без повторного включения shield новый узел виден сразу, до observer. Старый P-тест после restore проверял тот же уже inline-hidden узел, не следующий remount; F вообще не моделирует пины. Targeted 52 PASS и исходные 1746 PASS; новый `audit3-test-restore-shield.test.ts` даёт HEAD PASS / mutant FAIL (`visible` вместо `hidden`). Не дубль M-B25: тот проверял снятие, этот — возврат щита.
* **M-C04:** modified D под F достигает observer через router; отдельный faker-blocker пропускает Ctrl/Cmd. После удаления только isRoleFaked-guard нет дублирующего заслона. Site flag может изменить CSS под подменой. Исходные тесты откат принимают; независимого нового witness-теста для этого survivor не добавлено, отличие и достижимость установлены source-трассой `keyboard.ts:87–91 → auto-start.ts:1408–1413` и `role-faker.ts:30–36`.
* **M-C06:** `offA=setListener(A); setListener(B); offA()` на мутанте удаляет B, на HEAD сохраняет. Это не globally equivalent API-откат. Но в текущем production единственный setter-caller — auto-start с синхронным disable/off до нового enable; stale-off после замены у этого caller не доказан. Не назван пользовательской утечкой. Нового изолированного proof-теста нет.

**Итог после восстановления всех production-мутантов:** 113 файлов / **1753 PASS**, семь дополнительных временных проверок; новые witness-тесты есть для **пяти**, не всех семи survivors. Исходные 1746 и усиленные 1753 не смешаны в survival-знаменателе. У M-C02 dead/equivalent установлен по коду: callback раньше возвращается при autoScenes=true; при autoScenes=false nightSceneSafe всегда true, значит флаг не может стать true. Противоречивым mock это не «оживляли».

Отдельные **oracle-мутанты**, не в числе 42:

| Мутация | Fuzz | Полный штатный набор |
|---|---|---|
| Q01: startPeek не снимает CSS | Случайный test зелёный; полный F красный на трёх прямых V-тестах | Уже убит полным F |
| Q02: ROLE_HIDE_CSS пуст, ID сохранён | **30 PASS** | 41 FAIL / 1705 PASS |
| Q03: override пуст, ID сохранён | **30 PASS** | 24 FAIL / 1722 PASS |
| Q04: открыть CSS на 50 мс между +1050 и +1100, между снимками 1000/1250 | **30 PASS** | 3 FAIL / 1743 PASS по другим взаимодействиям |

Последние результаты показывают именно слабость одного fuzz: вся сюита эти мутанты всё же убивает. Q01 подтверждает нынешний bypass `spec.peek`, Q02/Q03 — фиктивный CSS по ID, Q04 — кадровую слепую зону. Это не подмена runtime-находок мутациями.

**Удалённые исторические механизмы:** native-hide fallback150, вторая Ctrl+D-пара, synthetic WeakSet вместо suppression250, faker-пропуск own synthetic D, tracked/native-toggle выбор и пять прежних nativeHidden-call sites теперь не исполняются. Им нельзя честно устроить «однострочный откат» без возвращения удалённой архитектуры. Смысл чтения site hide/нейтрализации и own-pin/peers проверен M-A09/A10/B11; прочее отмечено obsolete, не выдано за пережившие тесты живые регрессии. Exported isNativeRoleHidden остался только с тестовым caller.

На выбранной гранулярности логических исправлений оба исторических diff сверены повторно; все дополнительно поименованные guards испытаны C01–C06. Это **не доказательство каждого AST branch**: отдельно не мутировался каждый CSS-selector/call site одного правила, все значения таймеров/логов и все комбинации настроек. Технические reset, существовавшие до этих двух коммитов, не названы отдельными их исправлениями; удалённые механизмы не воскрешались ради killed-счёта. Ограничения не скрыты за числом 42.

Дополнительная диагностика, **вне счёта видимости**: тестовый `npx tsc --noEmit -p tests/tsconfig.json` уже на исходном HEAD даёт TS2307 в `tests/unit/audit2-obs-client-order.test.ts:42` (`../../../src/background/obs-client`). Production typecheck PASS; standalone Vitest этого файла 13 PASS. Ошибка исходная, не из добавленных проб. Следовательно зелёный Vitest не доказывает отдельный TypeScript-гейт tests. Лог `mutation-logs/HEAD-tests-typecheck.log`.

## 6. Что нельзя доказать без живой игры; ручной чек-лист

Ни jsdom, ни browser harness без установленного расширения не измеряют server permission/reveal semantics, compositor/OBS кадры, transitions/Studio Mode, межконтекстную доставку реального браузера, physical IME/defaults или обновление установленного расширения. Headless Chrome подтвердил **реальные CSSOM/таймеры production-модулей**, а не полноценный extension E2E; mocks перечислены в `browser-build.mjs`, сам тест — `browser-entry.ts`, результат — `browser-result.json`.

Проверять **локальной записью**, не публичным эфиром. Одновременно смотреть окно игрока и записанный Program; покадровый просмотр 60fps/30fps, отметки времени. Отдельно Chrome и Firefox, реальные сохранённые настройки владельца и чистый профиль.

| Действие | Что должно быть на экране и в записи |
|---|---|
| Начать ночь, сразу D показать→спрятать до 150–500 мс распознавания; ждать 12 с | Свою и peers больше не открывает таймер |
| Ночью D-hide → disconnect/reconnect OBS без смены игры | До явного show остаётся скрыт весь стол, reconnect не создаёт новую ручную эпоху |
| F5 посреди ночи → D-hide → NIGHT→DAY→NIGHT | Через 3 с не отменено ручное hide |
| Night-command в пути → вручную DAY; повторить при двух вкладках | Поздний success не открывает ни own, ни peers на фактическом DAY |
| Уход на DAY → autoHide ON → обратно NIGHT | Новое ручное скрытие не снимается как сценовый CSS |
| День, autoHide/phase OFF; OBS OFF→ON на NIGHT | Все роли и reveal скрыты **до** outbound DAY и первого кадра игрового Program |
| Включить phase-only днём при autoHide OFF | Нет открытого промежутка; отдельно измерить первоначальный deadline, а не только steady state |
| V держать через ночь→день → native menu Show → V-up | Позднейшее Show остаётся; роли не застревают скрытыми до нового D |
| В лобби modifier ON: Ctrl+D hide → наш D show → раздача | Первый root не отменяет более новое Show |
| V tap/repeat/PTT/modifiers/Alt-tab; D через 50–100 мс после V-up | Exact restore, без хвостовых открытых кадров и самопереключений |
| Обычная ночь/D-hide; scene return +2999/+3500 мс | Все роли открываются согласованно после задержки, кроме сохранённого manual hide |
| Все тумблеры по одному под V и в pending-show | Выключенные auto-слои не воскресают; manual не снимается |
| F → настоящая проверка/новая игра/root-patch → hover → E | Настоящий use/tooltip/reveal не проступает; E показывает текущую роль, не старый snapshot |
| IME-конвертация с назначенными F-клавишами; Enter/стрелки под F | Ввод не становится Show, отдельный blocker не отменяет редактирование |
| Viewer connect/reconnect, modern/legacy раздача, итоги | Уточнить permission-repeat, CardSelect и приватность reveal; отделить публичные результаты |
| Длинный fade >3 с, Studio Mode, ручные переходы | Имя NIGHT не принимается за доказательство исчезновения игрового изображения во всех оставшихся transition-кадрах |
| SPA/новая игра/F5/extension update посреди V/ночи | Различить новый документ и orphan; нет старых активных щитов и слепого доверия NIGHT |
| Две вкладки одной комнаты, активная/свёрнутая, захват другой вкладки | Ownership и события не раскрывают захватываемый DOM |
| Ролевые игровые звуки при раздаче | Установить, содержит ли захватываемая дорожка знание роли; визуальный CSS этого не гарантирует |

## 7. Вердикт

**К релизу с гарантией «роли никогда не появляются и не исчезают сами» сборка не готова; уверенность в отрицательном вердикте — 99%.**

Это уверенность в опровержении, не процент покрытия и не обещание отсутствия других дефектов. Основание — повторяемые production-контрпримеры, нормальные и независимые контроли, точная live-модель базовых писателей, настоящий Chrome и выявленное ошибочное разрешение в Spec. До 100% не доводят отсутствие живого установленного Chrome/Firefox + OBS и серверной/кадровой проверки условных путей.

---

## 8. Ответ и статус находок (21.10.2026, после фиксов)

Пробы аудита перенесены в `tests/unit/audit3-*.test.ts` (бандл сайта — фикстуры `tests/fixtures/bundle-snippets/room-hotkeys.txt` и `room-roles.txt`; матрица пишет результаты только при `AUDIT3_OUTPUT`). Сняты: witness-пробы, утверждавшие уже закрытые дефекты, и условные пункты, оставленные как есть. В пробах меню у кнопки «menu» заменён текст на настоящий пункт сайта («Скрыть роли»/«Показать роли»): решения сайта теперь связываются только с его командами ролей (см. §4 п.5).

| ID | Статус | Что сделано |
|---|---|---|
| B01 | исправлено | Ответ на нашу же команду смены сцены не перетирает более новое событие сцены (эпоха и в `switchScene`) |
| B02 | исправлено | Эпоха ночи — игровая, а не момент распознавания: запас 2,5 с на распознавание; у автосцен — самое раннее начало ночи до наступления дня (реконнект/подтверждение не начинают «новую ночь») |
| B03 | исправлено | У восстановленной после F5 ночи есть начало; плюс то же «самое раннее начало» |
| B04 | исправлено | Включённое при закрытом гейте авто-скрытие помечает CSS как не только сценовый — возврат сцены его не снимает (и эталон fuzz исправлен) |
| B05 | исправлено | Фаза применяется сразу при включении и при включении автосмены посреди игры; плюс смена этапа распознаётся немедленным подписчиком, до кадра (в начале каждого дня прежде было до ~1,15 с) |
| B06 | исправлено | Повторное включение автосцен днём идёт через защиту «перед дневной сценой» |
| H01 | исправлено | Показ с сайта под V снимает и CSS, поставленный под V |
| H02 | исправлено | Первая роль, смонтированная скрытой, не перебивает наш более новый показ, если после него не было команды ролей сайту |
| §4 п.1 IME | исправлено | Набор через IME (isComposing / keyCode 229) — не хоткей |
| §4 п.2 подмена и правка текста | исправлено | Блокировщик подмены — по тем же клавишам правки текста, что роутер |
| §4 п.3 E до флаша | исправлено | E сначала схватывает новую настоящую роль; случай «новая роль = выбранная фальшивка» — граница (неотличимо) |
| §4 п.4 restore без 3 с | оставлено | Восстановление после F5 на устойчивой ночной сцене показывает сразу — замысел |
| §4 п.5 окно 700 мс | исправлено | Решение сайта связывается только с его командами ролей: D/Ctrl+D, дошедшие до сайта, и клик по пункту меню ролей |
| §4 п.6 решение без ролей | частично | Поздно увиденное скрытие датируется командой игрока; показ без ролей (неизвестная чётность переключений) — граница |
| §4 п.7 SPA | исправлено | Новая игра в том же документе сбрасывает состояние скрытия и перевзводит авто-скрытие (проверка в немедленном подписчике) |
| §4 п.8 орфаны | условные | Без изменений |
| Мутанты M-B17/B21/B22/A11/C01 | закрыты тестами | Witness-тесты аудитора перенесены (audit3-test-*) |

Случайный прогон: эталон B04 исправлен, видимость считается по вычисленному стилю (пустое правило с тем же id больше не проходит), серии включают фазы, сцены, ручные D и Ctrl+D, отложенные эффекты эталона собираются по поводам всего шага.
