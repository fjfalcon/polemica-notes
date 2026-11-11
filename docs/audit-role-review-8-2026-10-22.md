# Восьмой независимый аудит: адаптации проб и обычные пути

Начат 21.10.2026, завершён 22.10.2026. Проверен `main`, **`f1fd2e53b797d226548b3d7b42ac2e15ca323f93`**, версия **9.67.0** (`package.json:3`). Исходный промт `docs/audit-role-review-8-2026-10-21.md` сохранён без изменений.

## 1. Сводка

**Тесты подтверждают заявленные исправления частично.** Установлены:

- **Три ослабленные адаптации** из 17 перечисленных в задании групп; **14 эквивалентны текущему замыслу**, неверных адаптаций не установлено. Единица счёта — пункт задания, не assertion и не параметр теста; подробная полярность ниже.
- Дополнительно потерян отдельный full-site visibility control раунда 4. Это четвёртая обнаруженная потеря покрытия, но не второй счёт той же snippet-адаптации.
- **Неверный центральный Spec:** на двух переходных днях он отвергает правильный SHOW и принимает мутанта с неправильным HIDE. Нынешний одиночный S02 исправлен и чувствителен к возврату дефекта.
- **Две незакрытые бытовые границы:** OFF ждёт чужого notes-enable; потерянный D-keyup через blur ломает отпускание следующего native Ctrl+D. Не доказано, что эти пользовательские поломки впервые внесены раундами 6–7: исторический контроль клавиатуры прямо показывает прежний дефект. Новых BLOCKER/HIGH утечек ролей на немутированном HEAD здесь не установлено.

**Оговорка к счёту:** C03 отнесён к эквивалентности только **новому явно ограниченному замыслу**, не полной прежней области теста. Исключённый cancel+stop по-прежнему воспроизводится на HEAD. Исправления C03 нет, поэтому эксперимент «откатить исправление C03» невозможен; его отсутствие не выдано за PASS или mutation kill (§2.4). По строгому критерию задания три ослабления подтверждены именно различающими мутантами исправлений; дополнительное сужение области C03 показано отдельно.

| Пользовательские пункты | Эквивалентны принятому замыслу | Ослаблены | Неверны |
|---|---:|---:|---:|
| Раунд 4: четыре пункта |3|1|0|
| Раунд 5: четыре пункта |3|1|0|
| Раунд 6: четыре пункта |3|1|0|
| Раунд 7: пять пунктов; три source-guard одной группой |5, включая scoped-C03|0|0|
| **Всего17 групп** |**14**|**3**|**0**|

### Обязательные команды

Все исполнены в неизменённой копии HEAD, без изменения assertions, конфигурации и таймаута:

| Команда | Результат |
|---|---|
| `npm run typecheck` | **PASS**, `tsc --noEmit`, exit0 |
| `npm test` | **153 файла / 2600 PASS**, 24,51 с |
| `ROLE_FUZZ_SEEDS=5000 npx vitest run tests/invariants/role-visibility-fuzz.test.ts` | **32 PASS**, все5000×25 шагов и постоянные случаи, 410,73 с |

Логи: `A/typecheck.log:1–4`, `A/npm-test.log:21–24`, `A/fuzz5000.log:5–8`. `ROLE_FUZZ_ONLY` отсутствовал (`A/fuzz-parent-env.json`); диагностическая ветка `role-visibility-fuzz.test.ts:823–825` не сокращала запуск до одного seed.

### Метод, сохранность и обозначения

Далее:

```text
A=/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-review8-20261021
O4=/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit4.6DJMSX/repo
O5=/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit5-20261021/repo
O6=/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit6-26Jyt3/repo
O7=/private/var/folders/3k/3s0rnw9d2pj0fn0tcbwnz2vr0000gn/T/opencode/role-audit7.Ah8L4g/repo
```

Оригиналы сохранились. `A/baseline` — git archive HEAD; `r4/r5/r6/r7/ordinary/spec` — отдельные рабочие копии. Зависимости также скопированы вне репозитория: временные symlink не ведут в исходный `node_modules`. Исполняемые копии оригиналов меняют только пути внешних входов/выходов, если это нужно; изменения ожиданий всегда отделены и названы явно. Мутанты создавались только в копиях, после запусков исходники восстанавливались.

Шесть независимых срезов: четыре раунда адаптаций, обычные пути, дополнительная валидация контрпримера Spec. Основной ревьюер прочитал доказательства, повторил новые бытовые пробы и отдельно проверил два мутанта всей153-файловой suite. Прочитаны AGENTS целиком, инварианты13–14, §2 замысла и §8 отчётов4–7.

`A/integrity-before-report.json`: **363 tracked-файла, 0 различий** с HEAD-копией. Единственная запись в исходный репозиторий — этот отчёт. Production, тесты, настройки, версии и зависимости не менялись; исправлений, коммитов и релиза нет.

Финальная сверка `A/integrity-final.json`: все363 tracked-файла по-прежнему совпадают с HEAD; `git status --short` показывает только `?? docs/audit-role-review-8-2026-10-22.md`. Счёт и разграничения дополнительно независимо проверены в `A/spec/ACCOUNTING.md`.

В таблицах **O** — оригинал аудитора, **A** — постоянная адаптация; **H** — HEAD, **M** — мутант. **P/F** — PASS/FAIL, `11/00/01` — видимость `[своя,напарник]`. **F(shape)** — устаревшая строковая форма source-guard, не runtime-баг. Original, который **утверждает дефект**, должен стать красным после исправления; это не эквивалент желательному regression assertion. Import/setup failure и исходный always-red тест не засчитываются как убийство мутанта.

Для компактности имена `auditN-*` в таблицах означают `tests/unit/<имя>.test.ts`; `role-visibility-fuzz` и `obs-role-latch` — файлы в `tests/invariants/`. Production-сокращения: `src/core/{feature,keyboard,selectors}.ts`, `src/content/features/{auto-start,f5-refresh,player-notes,queue-requeue,obs-record}.ts`, `src/content/panels/obs-panel.ts`, `src/background/obs-client.ts`. «ReportN» — `docs/audit-role-stream-N-2026-10-21.md`; «замысел» — `docs/audit-role-hiding-2026-10-21.md`. Строки оригиналов относятся к O4–O7, строки A/production — к проверенному HEAD.

## 2. Адаптации: четыре клетки и смысловая проверка

### 2.1. Раунд 4

Артефакты: `A/r4/review-artifacts/`. В `inputs` сохранены оригиналы, `patches` — точные diff мутантов, `logs` (**L4**) — команды, выводы и exit codes. `review4-original-*` — копии с путями; `review4-reversed-*` — отдельно обращённые свидетели. После восстановления **8 постоянных файлов /79P**, матрица576клеток/783запуска/8598сравнений,0несовпадений; пять изменявшихся production-файлов восстановлены побайтово (`final-integrity.json`).

| Адаптация; строки O→A в `tests/unit/` | O/H | A/H | O/M | A/M | Вердикт и соответствующий мутант |
|---|---|---|---|---|---|
| `audit4-control-obs` B03 `120–147→119–143`, exact11→actual-DAY invariant |F:cache=null|P|P:DAY11,cacheNIGHT|F:cacheNIGHT; отдельно F на DAY11|**Эквивалентна**. B03 удаляет reset currentScene в `obs-client.ts:295–305`; L4/B03-* |
| H01 `160–174→155–168` |F:11 вместо старого00|P|P, включая последующий контроль|F:00 вместо11|**Эквивалентна**. H01-refined пропускает конец эпохи при OBS-auto OFF и stale-night clamp `auto-start.ts:1251–1259,1377–1384`; H01-refined-* |
| H02 `176–187→170–180` |F:00 вместо дефектного01|P|P:01|F:01|**Эквивалентна**. M сохраняет V-nightShow и снимает позднейший day-deferral `auto-start.ts:1394–1407`; H02-* |
| H04 `199–217→192–210` |F:00 вместо01|P|P:transient11→01|F на+3100/+15100|**Эквивалентна/сильнее**. M снимает post-ACK guard `obs-panel.ts:1442`, phaseNow`:825`, day-deferral `auto-start.ts:1404`; H04-* |
| `audit4-obs-epochs` stale-list `98–111→100–116`, refuse=true |F:законно переключился вNIGHT|P:DAY00|F на старой предпосылке оDAY|F:DAY11|**Эквивалентна безопасности**, лучше изолирована. C01 снимает sequence/session gate записи списка `obs-client.ts:548–563`; C01-* |
| Там же reconnect `113–142→118–147`, refuse=true |F:законная NIGHT-команда|P:DAY00|F уже на настоящемDAY11|F:DAY11|**Эквивалентна**. B03 сохраняет сцену прошлой сессии; B03-* |
| `audit4-site-causality:12–56→14–58`, extraction→snippets |4P|4P|1P/3F|1P/3F|**Эквивалентна прямой H05-пробе**. H05 снова датирует любой неподходящий физическийD; H05-* |
| `audit4-keys-browser:17–117`→`audit4-f5-peek:29–90` |Chrome4P|jsdom3P|Chrome3P/1F|jsdom3P|**Ослаблена**. B02-silent-reload возвращает reload привязанногоF5 без info-лога; B02-silent-reload-* |

**B03 — правильное изменение оракула.** A `audit4-control-obs:140` требует `!(actual==="day"&&anyRoleVisible)`, а не exact00. На H клиент действительно может законно поставить NIGHT и показать11. Отдельный companion убирает только ранние cache-null assertions: H=P при NIGHT11; M=F при DAY11 (`HEAD-B03-invariant.log`, `B03-mutant-invariant.log`). Таким образом, безопасность не стала пустым assertion за ранним cache-check. Liveness из одного этого инварианта не выводится.

**refuse не отключает доставку списка.** `audit4-obs-epochs:37,105,141` возвращает поддерживаемый ignored/not_owner. Настоящие ObsClient/list/event продолжают работать. Без отказа новая NIGHT-команда делает старое требование actualDAY ложным; с отказом остаётся исходный опасный контекст — эфир действительноDAY. Real-transport B03 отдельно проверяет разрешённый success-путь.

**Перекрывающие защиты не скрыты.** Одиночное сохранение H02-pending компенсируется позднейшим phase guard при phaseSwitch ON; O и A ведут себя одинаково. При phaseSwitch OFF обе obs-epochs версии убивают одиночный откат. Для H04 аналогично с panel-only откатом. Полный старый эффект воспроизводился комбинацией защит того же дефекта, а не объявлялся отсутствующим из-за одного компенсированного rollback (`H02-single-*`, `H04-panel-only-*`).

**Фрагменты совпали побайтово:**5585символов hotkeys и403символа vShow — с полным сохранённым bundle SHA `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` (`snippet-equivalence.json`). `return false` на `audit4-site-causality:36` соответствует настоящему wrapper, см.§2.2. Это точность snapshot, не новый live-drift check.

**Дополнительная потеря отдельного full-control.** Не перенесён `O4/tests/unit/audit4-control-site-causality.test.ts:22–41,59–82`: actual Room/Vue/vShow и assertions display/visibility/override. Raw witnesses на H1P/3F; companion с обращённым только expected hidden —4P. M отключает `installRoleDisplayOverride` (`auto-start.ts:558`): прямые O и A snippet-тесты всё ещё4P, но full-control companion4F (`site-display-neutralizer-{original,adapted}.log`). Это **ослабление выпавшего отдельного control**, не доказательство, что замена5585/403символов сама испортила H05-тест. Вся suite на этом M не объявлена зелёной.

**F5: различение настоящего reload потеряно.** Chrome155.0.8059.79 действительно исполнен. Original использует location.reload и sessionStorage-метку нового документа (`audit4-keys-browser:52–61`); A определяет reloaded только по `log.info('f5-refresh',…)` (`audit4-f5-peek:35`). Обычный откат bound-guard (`f5-refresh.ts:28`) убивают обе версии: O3P1F/A2P1F. Отличающий мутант:

```diff
- if (e.defaultPrevented || keyboard.isBound(e.code || "F5")) return;
+ if (e.defaultPrevented || keyboard.isBound(e.code || "F5")) { location.reload(); return; }
```

jsdom пишет `Not implemented: navigation to another Document`, сохраняет документ и даёт3P; Chrome даёт3P1F: `reloaded:true,peeking:false,afterRelease:[1,1]` вместо00. Артефакт `review-artifacts/browser/keys-chrome-BO7msu/result.json`; строки46–62 `B02-silent-reload-original.log`. Это тот же пользовательский вред reload, а не мутация только сообщения лога.

**Основной ревьюер дополнительно проверил этот M всей suite:** в отдельной pristine-копии внесён только указанный diff, затем `npx vitest run --config vitest.config.ts --reporter=json --outputFile=../r4-silent-fullsuite.json`. **2600P, exit0** (`A/r4-silent-fullsuite.{json,log}`). Здесь потеря не компенсирована нынешними офлайн-тестами. Это искусственно возвращённый дефект, не runtime-дефект немутированного HEAD; обычный однострочный rollback guard при этом по-прежнему обнаруживается.

Команды кампейна, cwd `A/r4`:

```sh
python3 review-run.py
python3 review-followup.py
python3 review-layers.py
python3 review-extra.py
AUDIT4_OUTPUT="$PWD/review-artifacts/logs/HEAD-restored-matrix.json" node node_modules/vitest/vitest.mjs run --config review-vitest.config.ts --reporter verbose tests/unit/audit4-*.test.ts
```

Неперечисленные в задании round4-переносы также сверены: dom-timing O/A6P, M-old-phase-scope обе5F1P; keys-adversarial O/A34P, M-no-fake-shield обе33P1F; matrix O/A9P+0/8598расхождений, M-manualReason обе afterAllF с одинаковыми двумя расхождениями. Omitted actual-public-transition companion H3P/M1P2F при том жеB01; уникального survivor именно для этой renderer-пробы не установлено (`L4/B01-*`, `fake-shield-*`, `S3-*`).

### 2.2. Раунд 5

Оригиналы из O5 скопированы как `review8-original-*`. У renderer изменены только пути site/artifacts. Diff: `A/r5/review8/test-diffs.patch`; пары: `pairs.json`. Каждый результат имеет `.json`, `.log`, `.command.txt`. После мутаций восстановлены119production source-файлов (`final-source-integrity.json`).

#### Сайт действительно отменяет принятый хоткей и останавливает всплытие

Свежий и архивный bundle имеют одинаковые1634594байта и SHA `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5`. Настоящий Room.addHotKeys, substring offset1599003 в `review8/site/current-main.js:1`:

```js
_h(i,(function(){return event.preventDefault(),n(),!1}))
```

`review8-site-wrapper-proof.test.ts:9–27` исполняет скачанные Room и hotkeys-js: **2P**, modifier OFF/ON. Внутри role-action уже `defaultPrevented=true`, но `cancelBubble=false`; после возвращённого false библиотека останавливает событие доwindow. Поэтому preventDefault/stopPropagation — не удобство моделей для production-gate.

В handwritten-моделях stop иногда стоит до callback; при return-false отмена происходит после callback. В этих пробах callback только меняет flag/DOM, а MO/атрибуция читают итог после dispatch: различий не установлено. Это не обещание эквивалентности любого throwing/reentrant callback.

Команды, cwd `A/r5`:

```sh
curl --fail --silent --show-error https://polemicagame.com/room/bundle/main.js -o review8/site/current-main.js
./node_modules/.bin/vitest run tests/unit/review8-site-wrapper-proof.test.ts --reporter=json --outputFile=review8/wrapper-proof.json
python3 review8-run.py head
python3 review8-run.py mutant-B02-H01 audit2-keyboard audit2-scene-belt audit3- audit4- role-visibility-fuzz audit5-keys-site-acceptance audit5-site-renderer audit5-transient-day
```

Четыре клетки каждой изменённой модели, числа PASS/FAIL. M-B02-H01 возвращает архивный guessed physical-held-key attribution (`auto-start.ts` old`:592–608,1615–1630,1689–1700`) вместо accepted-marker; остальные phase/OBS/route-механизмы HEAD сохранены. Старые тесты, уже красные на H, не засчитываются как убийцы мутанта.

| Файл:изменённая строка A | O/H | A/H | O/M | A/M |
|---|---|---|---|---|
| `audit2-keyboard-verified:36` |14/2|16/0|16/0|16/0|
| `audit2-keyboard:36` |14/2|16/0|16/0|16/0|
| `audit2-scene-belt:66` |15/16|31/0|31/0|31/0|
| `audit3-keys-lifecycle:86` |14/0|14/0|14/0|14/0|
| `audit3-matrix:115` |11/0|11/0|11/0|11/0|
| `audit3-site-late-mount:42` |5/0|5/0|5/0|5/0|
| `audit4-keys-adversarial:74` |34/0|34/0|34/0|34/0|
| `audit4-matrix:81` |9/0|9/0|9/0|9/0|
| `audit4-site-causality:36` |4/0|4/0|4/0|4/0|
| `role-visibility-fuzz:158–168`, весь файл |26/5|32/0|30/1|32/0|
| `audit5-keys-site-acceptance:30` |6/8|14/0|7/7|7/7|

Вердикт: **эквивалентна настоящему сайту**, но многие старые файлы сами не убивают B02/H01. Реальные killers — семь постоянных acceptance cases (`audit5-keys-site-acceptance:48–91`): swallowed-own/typed-held/Meta-tail, wrong-profile/delayed-mount/Ctrl+Meta, logical KeyJ68. O и A убивают те же семь случаев. Отдельный C03-witness `audit5-fuzz-survivor-C03:40` с corrected return-false: O/H1P1F,A/H2P; M обе0P2F (`mutant-C03.json`): под V действительно меняется native flag.

Чтобы не смешивать модель с новым Spec/S02, отдельно создана копия **старого Spec** с добавлением только двух acceptance-вызовов: H O26P5F/site-only30P1F; M-C03 подV (`auto-start.ts:1745`, убрать только `peeking`) O26P5F/site-only28P3F. Два новых осмысленных FAIL — seed102947 и explicit audit2B02. Оставшийся H-fail — старое правило Spec «короткий день = новая ночь», не ошибка cancel/stop. Команды: `python3 review8-isolate-fuzz.py`, `review8-run.py head-fuzz-model-only review8-site-only`, `mutant-C03-fuzz-model-only review8-site-only`; одноимённые JSON/source.patch.

#### Остальные три группы

| Адаптация/строки A | O/H | A/H | O/M | A/M | Вердикт и мутант |
|---|---|---|---|---|---|
| `audit5-obs-short-races:220–237`, stale DAY/live NIGHT |F на немедленнойDAY|P|F на outbound01|F:staleDAY запрещена|**Эквивалентна/сильнее**; M-B03-full |
| Там же`:239–256`, manualShow при неизвестной фазе |F на старом own11,actual01|P|Та же obsolete premiseF|F на outbound01/expected00|**Эквивалентна**; M-B03-preday |
| Там же`:258–275`, real transport restore |F на немедленнойDAY|P|F на outbound01|F на outbound01|**Эквивалентна**; M-B03-full |
| `audit5-fuzz-policy-conflict:37–70`, P01 |1P1F:устаревшийV11|1P|1P1F:принятый fail-safe00|0P1F:тот же fail-safe|**Эквивалентна решению P01**; M не прячет наступившийDAY подV |
| `audit5-site-renderer:53–92`→`audit5-transient-day:54–124`, весь файл |8P|7P|6P2F|7P|**Ослаблена**; M-B02-H01, потеряны два native integration discriminators |
| Та же замена **только для B01** |8P|7P|5P3F|5P2F|**Эквивалентна B01**; M немедленно заканчивает ночь любымDAY |

**Необязательный outbound не скрывает утечку.** В `obs-short-races:251,270` default00 применяется только при отсутствии DAY-команды. Если она есть, берётся настоящая captured visibility; public-frame assertion обусловлен реальным actualDAY. До restore разрешён лишь документированный unknown-phase own-pin (`:244`, peer должен быть показан), но outbound и public frame требуют **обе00** (`:255`). В stale/live-NIGHT case `:235–236` требуется отсутствие DAY и сохранение живого ночного показа.

Мутанты того же restore-пути: B03-epoch убирает phase/route rejection в `obs-panel.ts:539`, оставляя оба барьера; B03-preday оставляет epochs, но обходит restore-barrier `:588–595` и перекрывающий generic-barrier`:1413–1426`; B03-full объединяет эти защиты, не откатывая соседниеH02/H03. Весь18-case файл: H O15P3F/A18P; epoch O13P5F/A15P3F; preday O15P3F/A17P1F; full O13P5F/A13P5F. Original manual-Show case даже не достигает outbound из-за старой own-role предпосылки — это не выдано за валидный O-kill. Команды: `python3 review8-run.py mutant-B03-{epoch,preday,full} audit5-obs-short-races`; соответствующие JSON/sourcepatch.

**P01 — разрешение противоречия.** Original параметризовал два несовместимых ожидания одного состояния. Принятый§2`:110–114` требуетDAY00 даже подV; retained case падает прямо в MO turn на M-P01 (`auto-start.ts:1172`: peeking/day return). Удалённый literalV11 красный на H и зелёный на M — не регрессия согласованного поведения. Команда: `python3 review8-run.py mutant-P01 audit5-fuzz-policy-conflict`, `mutant-P01.json`.

**Renderer ослаблен вне B01, но компенсирован другими тестами.** Original`:72–92` исполняет actual Room-hotkey/Vue/vShow: simple Cmd+D control, Meta-tail PTT, typed-held-across-focus. В replacement настоящего wrapper нет. На M-B02-H01 original native cases1P2F, весь renderer6P2F, замена7P. Native flag действительноfalse, но V-release возвращает11 вместо00. **На том же M постоянный `audit5-keys-site-acceptance` даёт7F**: вся suite не пропускает этот старый дефект. Статус report5`:448` обещает закрепление B01, а не полную эквивалентность renderer-файла; B01 подтверждён.

Для прямого B01-отката заменён только `applyRolePhase` архивной реализацией немедленного окончания ночи приDAY (`auto-start.ts:1163–1219`): `python3 review8-run.py mutant-B01 audit5-site-renderer audit5-transient-day`. Оба набора убивают повторный show той же ночи после manualHide; replacement дополнительно проверяет OBS resume.

Прочие переносы без behavioral-адаптаций сверены: control-manager6P, main-boot3P, keys-faker-race4P, matrix-lifecycle15P, matrix-witness13P уO/A, assertions неизменны. В восстановленной копии typecheck и153файла/2600тестов тоже зелёные (`review8/head-full-suite.json`); это повторный контроль, не прибавка к обязательным2600.

### 2.3. Раунд 6

Копии оригиналов из O6 меняют только внешние/artifact-пути. `A/r6/review8/runs.json` содержит точные argv/cwd/exit/assertions; `review8/logs/M-*` (**L6**) — логи, JSON и patch. Драйвер `review8_run.py` выполнялся с аргументами `baseline`, `mutants`, `extra`, `final`.

Настоящие Vue/Vuex/Room/Player/Roller выполнены. Certificate-verified curl заново скачал main.js1634594байта SHA `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5` иRU42054байта SHA `3de756f64f94a4847f666f07830aa3780dbe6b11c7de602aa7923b143ab23fd6` — тот же snapshot6 (`review8/curl-fetch.json`). Предварительная ошибка certificate у Python fetch не засчитана как исполнение или skip; успешные curl/runtime запуски записаны отдельно.

| Адаптация/строки O→A | O/H | A/H | O/M | A/M | Вердикт/мутант |
|---|---|---|---|---|---|
| `audit6-obs-races:237–271→237–266`, чтениеDAY+50ms |2F:outbound undefined|2P|2F:outbound01|2F:outbound01|**Эквивалентна**. B02-day-retry убирает барьер `obs-panel.ts:1413–1426` |
| `audit6-matrix-boundaries:102–128→103–130`, D11→00 |3F только на последнем old11|3P|3F на прежних ранних11|3F на тех же ранних11|**Эквивалентна**. C01-old-site-hide: `lastOurShowAt=0`, `auto-start.ts:736` |
| `audit6-keys-boundaries:89–95→91–97`, исключён cancelable=false |13P1F:толькоfalse|13P|logicalD3P3F;foreignCancel3P1F;pendingOverwrite1P1F|Те же3P3F/3P1F/1P1F|**Эквивалентна ограниченному trusted-input замыслу**; исключённый API-контракт не объявлен исправленным |
| `audit6-site-runtime`26+`site-real-obs`6→`stale-day`5+`obs-stale-day`2 |32P|7P|23P9F|7P;все106audit6-*P|**Ослаблена**. H01-OBS-resume-lost |

**+50ms — ожидание команды, не самолечения.** `HEAD-retry-timing.log`: +0/+16/+29ms sceneNIGHT,commands[],00; +30ms sceneDAY,outboundDAY00; +50ms то же. Outbound assertion не удалён, undefined по-прежнему F. Делегат ждёт30ms (`obs-panel.ts:855–879`), поэтому старое чтение слишком раннее.

**Положительный D-control изменён правильно.** В A `audit6-matrix-boundaries:124–126` всё ещё требуется11 на+16/+12016ms нового стола при native=false и ровно одном native-toggle. Следующий нашD обязан скрыть00. На M обе версии падают именно на неизменённых ранних11, не только на переписанном последнем контроле.

**Noncancelable не выдан за production-исправление.** Сам original report6`:208,216,385` называет synthetic API-кейс не находкой. Retained C02/C03/C04 убивают реальные откаты (`M-C02-physical-only`, `M-C03-foreign-cancel`, `M-C04-pending-overwrite`). Дополнительный API-эксперимент снимает только defaultPrevented requirement: O2P/A1P, syntheticfalse принят. Это не mutation kill production-дефекта: для уже исключённого false отсутствующего исправления нет.

**Различающий survivor замены runtime:**

```diff
// src/content/features/auto-start.ts:1069
- if (resume && nightSceneSafeForRoleShow()) {
+ if (false && resume && nightSceneSafeForRoleShow()) {
```

M отключает только OBS-ветку возврата ранее видимого стола; no-OBS возврат остаётся. L6/M-H01-OBS-resume-lost:

| Набор | H | M |
|---|---|---|
| Original runtime`:71–96,132–156` |26P|20P6F:OBS-existing gaps0/1999/2001/2501 иmanualSHOW gaps0/100 дают00 вместо11 |
| Original real-OBS`:77–89` |6P|3P3F:SHOW gaps0/100/1000 теряется;HIDE-контролиP |
| A `audit6-stale-day:72–147` |5P|5P |
| A `audit6-obs-stale-day:96–117` |2P|2P |
| Все постоянные audit6-* |106P|106P |

Причина: `stale-day:89–102` проверяет SHOW без активной OBS;`:116–133` сOBS проверяет HIDE. Actual-panel replacement `obs-stale-day:51–63` выключает phaseSwitch и не достигает OBS+phase resume. У original real-OBS phaseSwitch ON (`:48`) и оба решения (`:77–89`). Это исходная OBS-сторона H01, не произвольный новый syntax-мутант. Направление возможного возврата дефекта — **от игрока**, не доказанный публичныйDAY-кадр.

**Вся suite этот survivor не пропускает.** Основной ревьюер в pristine-копии внёс ровно этот откат и запустил `npx vitest run --config vitest.config.ts --reporter=json --outputFile=../r6-survivor-fullsuite.json`: **2545P/55F**. Убивают `audit5-transient-day.test.ts:114–124` (1) и `audit7-matrix-transients.test.ts:43–57` (54). `A/r6-survivor-parent-summary.json` фиксирует счёт и восстановление исходника. Ослаблена конкретная round6-замена; утверждение «H01 вообще не защищён» было бы ложным.

Главные B03/H01 не потеряны полностью: M-staleDayLabel=false даёт original-runtime21P5F/A-stale3P2F/A-obs1P1F; M-no-resume вообще — original-runtime16P10F/original-realOBS3P3F/A-stale4P1F. Отдельные seam-guards A сильнее originals: M-raw-panel-phase или M-preDay-always-end-night убиваются A, хотя32original runtime-контроля на них зелёные (L6/M-B03-*, M-H01-lost-show). Это не отменяет OBS-resume survivor.

Visibility helpers A (`stale-day:44–45`, `obs-stale-day:65–66`) измеряют толькоvisibility, originals ещёdisplay/opacity. Это утрата механистической проверки, но не отдельный proven survivor. Все четыре изменявшихся source-файла восстановлены (`review8/restored.json`, `source-identity.json`).

### 2.4. Раунд 7

`A/r7/evidence/`: original-vs-adapted.diff, mutant-*.diff, для каждого запуска `.log/.json/.command.json` с argv/cwd/exit/sourceSHA. Original menu выполнен без изменения из `captured-run`, его `../main.js` — сохранённый bundle SHA `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5`. Финальная A-suite63P;127предсуществующих source/test-файлов восстановлены (`integrity-final.json`).

| Адаптация/строки | O/H | A/H | O/M | A/M | Вердикт и мутант |
|---|---|---|---|---|---|
| `audit7-obs-epoch-loss:78–96`, containsDAY→not |0P2F на старой premise|2P|0P2F на конечном11/expected00|0P2F уже на запретнойDAY|**Эквивалентна/сильнее**. H01 возвращает raw detector в `obs-panel.ts:1279,1839` |
| Удалённые menu O`:162–202`, retained `audit7-obs-barriers:148–160` |3P:две captured+retained|1P|1P2F:capturedSHOW иretained01|0P1F:01/expected00|**Эквивалентна B03**, меньше site-provenance. M убирает safe-return rearm `auto-start.ts:1306–1309` |
| C03 O `keyboard-boundaries:72–83`, A`:73–85`, `[false,true]→[false]` |1P1F:stop=true00/expected11|1P;true отсутствует|0P2F|0P1F|**Эквивалентна только принятому ограниченному замыслу**, старая область сужена. M-receipt снимает `!reachedWindow` на `auto-start.ts:611` |
| `audit2-site-model:51–61`, readonlyD наш |F:flag=true вместоoldfalse|P|P:flag=false|F:flag=false|**Эквивалентна владению клавишей**. C02 отменяет readonly exemption `keyboard.ts:69–73` |
| `obs-role-latch:256–268`, phaseNow |F(shape)|P|P|F|**Сильнее**. M отменяет day-correction и применяет `roleTargetFor(timeOfDay)`, `obs-panel.ts:821–826` |
| `obs-role-latch:270–277`, restored |F(shape)|P|F(shape/gate)|F(gate)|**Эквивалентна алиасу**. M обходит scene gate через `restored==="night"`, `obs-panel.ts:578–583` |
| `obs-role-latch:159–182`, detectPhaseAfter |F(shape)|P|F(shape)|F:нет live-confirm gate|**Эквивалентна старому live-gate/сильнее stale**. M снимает `if(!lastDetectWasLive)return` на `obs-panel.ts:1282` |

**C03 не исправлен и не объявлен закрытым.** Original stop=true остаётся красным на H:00 вместо нового ручногоSHOW11; A не собирает этот case — это не PASS. Подлинного «отката исправления C03» нет (`auto-start.ts:606–615`, report7`:448,459`). Более широкий M-receipt ломает также retained stop=false и убивается обеими версиями; нельзя назвать его выжившим мутантом исправления C03. В пробе чужой listener установлен самой пробой; обычного current-site producer такого cancel+stop не установлено. Сужение области документировано, а не скрыто за общей зелёной suite.

**Удаление меню не потеряло B03-discriminator.** Captured SHOW=false на M остаётсяP, captured SHOW=true и retained witness дают01 на второмDAY даже через12s. A моделирует меню bounded-handler/microtask (`audit7-obs-barriers:150`), не исполняет actual Vuex/menu chain: это меньше доказательств происхождения, но исходный дефект по-прежнему обнаруживается.

**Readonly — не принятие нового D сайта.** При default hide=KeyD наш router теперь владеет событием: flag остаётсяtrue, CSS00 послеD/V. M возвращает typing-context для readonly: O становитсяP, A падает на flagfalse; также падают пять readonly protected-focus cases. Обычные editable-поля остаются защищены.

**Source-guards остались source-guards.** Между созданием `restored` и gated-call нет await/перезаписи (`obs-panel.ts:578–583`); helper сохраняет исходный detector и корректирует только known-night/stale interpretation (`:1239–1242`), live-gate остаётся. Старые guards ужеF(shape) на H, поэтому F/F не называется baseline-green убийством M. Дополнительный M-H01 возвращает raw confirmation: O-guard=P, A-guard=F (`mutant-H01-source-anchor.log`), обход новой stale-коррекции не принят. История показывает: phaseNow менялся ещё вround4, restored — вround5, неround7.

Команды runner, cwd `A/r7`; точные argv в соответствующих `.command.json`:

```sh
python3 evidence/run.py head-behavior tests/unit/review8-original-audit7-obs-epoch-loss.test.ts tests/unit/audit7-obs-epoch-loss.test.ts tests/unit/review8-original-audit7-keyboard-boundaries.test.ts tests/unit/audit7-keyboard-boundaries.test.ts tests/unit/review8-original-audit2-site-model.test.ts tests/unit/audit2-site-model.test.ts
python3 evidence/run.py head-invariants tests/invariants/obs-role-latch.test.ts tests/invariants/review8-original-phaseNow.test.ts tests/invariants/review8-original-restored.test.ts tests/invariants/review8-original-detectPhaseAfter.test.ts
python3 evidence/run.py captured-head tests/unit/review8-original-audit7-obs-barriers.test.ts tests/unit/audit7-obs-barriers.test.ts -t 'captured-site|repeated departure'
python3 evidence/run.py mutant-H01 tests/unit/review8-original-audit7-obs-epoch-loss.test.ts tests/unit/audit7-obs-epoch-loss.test.ts tests/unit/audit7-obs-barriers.test.ts -t 'same-night|stale DAY label|stale day label arising'
python3 evidence/run.py captured-mutant-B03 tests/unit/review8-original-audit7-obs-barriers.test.ts tests/unit/audit7-obs-barriers.test.ts -t 'captured-site|repeated departure'
python3 evidence/run.py mutant-C02 tests/unit/review8-original-audit2-site-model.test.ts tests/unit/audit2-site-model.test.ts tests/unit/audit7-keyboard-boundaries.test.ts -t readonly
python3 evidence/run.py mutant-phaseNow tests/invariants/review8-original-phaseNow.test.ts tests/invariants/obs-role-latch.test.ts -t 'scheduleRoleVisibility: цель'
python3 evidence/run.py mutant-restored tests/invariants/review8-original-restored.test.ts tests/invariants/obs-role-latch.test.ts -t 'restore после F5'
python3 evidence/run.py mutant-confirm-live-gate tests/invariants/review8-original-detectPhaseAfter.test.ts tests/invariants/obs-role-latch.test.ts -t 'фолбэчный результат не трогает'
python3 evidence/run.py mutant-C03-receipt tests/unit/review8-original-audit7-keyboard-boundaries.test.ts tests/unit/audit7-keyboard-boundaries.test.ts -t 'BOUNDARY unrelated'
```

## 3. Эталон фаззера

### Каждое изменение: выводимость из замысла и происхождение

История проверена: `git show <commit> -- tests/invariants/role-visibility-fuzz.test.ts docs/audit-role-hiding-2026-10-21.md`; `A/spec/history-{0e518f0,d71bc30,906cd32}.diff`. Мыслительный источник автора из git недоказуем: ниже **логическая выводимость из текущего документа**, не утверждение независимого проектирования до production.

| Изменение, строки текущего fuzz | Оценка |
|---|---|
| transient<2000ms — та же ночь,609–615 |Выводимо из замысла`:116–121`; порог появился в документе и Spec вместе в0e518f0. Независимость происхождения числа не доказана |
| beforeDayScene rearm,630–633 |Выводимо из`:122–126`: каждый новый публичныйDAY требует скрытия заранее; старый manualSHOW не разрешает следующий переход |
| transient при phaseSwitch не заканчивает OBS-ночь,613–615 |Выводимо из сохранения ручных решений той же ночи`:116–126`. Но mock404–415 всё ещё немедленно ставит unsafe при любомDAY — это не точная интеграция двух recognizers |
| resumeShow,464–466,616–626,707–709 |Семантика из`:116–121`; **реализация модели неполна**, см. контрпример. Сходство полей с production само по себе не доказывает копирование |
| timeout1800000,827–828 |Не изменение Spec/expected, только бюджет;5000×25 не сокращено |
| ROLE_FUZZ_ONLY,823–825 |Replay-фильтр, не expected. Ненулевое значение действительно заменяет5000 одним25-step сценарием; обязательный запуск был без него |

Итак, перечисленные **правила выводимы из текущего замысла**; оснований утверждать установленное недобросовестное копирование нет. Но это не делает реализацию Spec правильной. В906cd32 production научился переносить ожидающий resume через второйDAY, а центральный Spec вообще не менялся.

### Контрпример: Spec принимает неправильный HIDE

Замысел `docs/audit-role-hiding-2026-10-21.md:116–121,133–134`: переходный день не заканчивает ночь, ранее видимый стол возвращается, если игрок больше не решал. AH/phase ON, OBS OFF, ночь. После штатного show игрок делает D-hide→D-show; далее `day→night→day→night`, gap100ms; затем ожидание12s. Все дневные подписи короче2s.

HEAD `auto-start.ts:1213–1215` переносит ещё не исполненный возврат через второйDAY. Spec `role-visibility-fuzz.test.ts:621–626` на второмDAY читает свой пока скрытый промежуточный state;`:618` затирает resumeShow,`:707–709` его не применяет.

Добавлены только testcases к побайтовому HEAD-фаззеру, без изменения Spec/mocks/production (`A/spec/make-probes.py`, сохранённый `review8-probes.ts:1062–1085`):

```sh
# cwd A/spec
python3 make-probes.py
npx vitest run tests/invariants/role-visibility-fuzz.test.ts -t 'REVIEW8|S02|найденные сценарии' --reporter=json --outputFile=spec-head.json
```

**27P/1F**,6skipped: все26 постоянных найденных сценариев и прямой независимый intent-checkP, новый runScenarioF:

```text
#1 hide pre=111 post=000 spec=0 flag=true
#2 hide pre=000 post=111 spec=1 flag=true
#3 burst[day,night,day,night]@100 pre=111 post=111 spec=0 flag=true
итог не по замыслу: видно111, ждали0
```

Обратный M: только `const resumePending=false` на `auto-start.ts:1213` вместо сравнения меток. Тот же `-t 'REVIEW8|S02'`, `spec-double-mutant.json`:

| Проверка | H | M без переноса возврата |
|---|---|---|
| Текущий Spec, двойной переход |F: требует000 вместо правильного111|P: принимает дефект000 |
| Прямой §2-оракул, тот же переход |P111|F000 |
| Постоянный одиночный S02 |P|P |

V в последовательности нет. Это **дефект доказательной модели, не runtime-дефект HEAD**, который здесь работает правильно. Вход допустим собственным генератором (`:742–746`, burst до4элементов), физически невозможных нажатий нет. Живая серверная достижимость именно двух столь быстрых возвратов не доказана — такое же ограничение честно записано у C01 report7`:184–192`. Контрпример достаточен против полноты oracle на его собственном пространстве, но не выдаётся за записанный live-инцидент.

### Найденные сценарии и S02 отдельно

Все26 постоянных scripted cases (`:836–951`)P. Оригинальный `O6/tests/unit/audit6-fuzz-S02-spec.test.ts:1039–1055` — **свидетель неверного старого Spec**, не желаемого000. Его prefix побайтово совпал с fuzz0e518f0 (`original-s02-integrity.json`). Команды: `npx vitest run tests/unit/review8-original-s02.test.ts -t AUDIT6-S02 --reporter=json --outputFile=original-s02-{head,mutant}.json`; `python3 run-spec-mutants.py`.

| Одиночный S02 | H | M: `resumeShowMark=null` на `auto-start.ts:1200` |
|---|---|---|
| Original со старым Spec |F:111/expected000|P000 |
| Постоянный с исправленным Spec |P111|F:000/expected111 |

На M26постоянных случаев дают25P1F — именноS02 (`s02-no-resume.json`). **Одиночное исправление действительно защищено.** Повторный переход дополнительно защищает `audit7-matrix-transients.test.ts:43–54`, но центральный Spec его моделирует наоборот. Независимая проверка доказательства — `A/spec/VALIDATION.md`; исходники восстановлены (`restoration.json`).

Другие границы не выданы за новые runtime-находки: под `spec.peek` итоговая видимость вообще не сравнивается, только зеркало (`:787–788`); Vtap не измеряется внутри40ms (`:583–587`); mock observer не наблюдает characterData (`:35–45`); OBS и faker замоканы (`:66,74–86`).5000 не доказывают единое соответствие всем владельцам и отсутствие кадра между50/250ms снимками (`:498–507`).

## 4. Обычные пути: найденное и проверенное

Основной ревьюер повторил новые немутированные пробы из `A/ordinary`:

```sh
npx vitest run tests/unit/audit8-ordinary-manager.test.ts tests/unit/audit8-ordinary-keys.test.ts tests/unit/audit8-site-renderer.test.ts --reporter=json --outputFile=../ordinary-parent-repeat.json
```

**8P/5F**, те же две причины, что в `ordinary/audit8-ordinary-final.log`. Это не пять дефектов. Код не изменялся.

### F01 — MEDIUM, функциональность: OFF ждёт чужой notes-enable

`src/core/feature.ts:57–66` получает storage-патч и через50 ms запускает раннее обновление и очередь. Но`:79–89`, особенно`:83`, пропускает владельца, который теперь OFF (`!isEnabled`); ранний путь вообще не вызывает disable. Единственный disable`:159–167` ждёт проход очереди на `await f.enable(ctx)` (`:134–145`). Реальный блокирующий enable заметок: `src/content/features/player-notes.ts:391–394,2335–2337`, чтение `src/core/notes-store.ts:654–658`.

1. Реальные владельцы очереди и записи уже работают; startup завершён, statistics OFF.
2. Включить statistics: настоящий notes-enable ждёт управляемое чтение storage.
3. Сохранить master OFF либо OFF конкретной фичи; событие действительно доставлено.
4. После400 ms, при незавершённом чтении, заменить ранее принятую карточку очереди кнопкой Play.
5. Реальный queue observer делает **два новых клика** за1500 ms. Отдельно запущенная расширением запись через12 s после OFF всё ещё не получила `record_stop`; после разрешения notes-read stop приходит за100 ms.

```text
MASTER_OFF_QUEUE  {offKey:extension_enabled,saved:false,notesPending:true,clicks:2}
MASTER_OFF_QUEUE  {offKey:requeue_after_lobby_fail_enabled,saved:false,notesPending:true,clicks:2}
MASTER_OFF_RECORD {offKey:extension_enabled,saved:false,notesPending:true,commands:[]}
MASTER_OFF_RECORD {offKey:obs_auto_record_enabled,saved:false,notesPending:true,commands:[]}
```

Очередь держит старую true-конфигурацию и ресурсы (`queue-requeue.ts:880–884,1019–1043,1092–1125`); запись останавливается только в disable (`obs-record.ts:69–79`). Измерены настоящие DOM-клики и исходящие content-команды, не HTTP-зачисление в очередь или файл OBS. Popup не даёт trusted-backoff страницы; клики считаются только после OFF. После разрешения чтения очередь удаляется из activeIds и12 s больше не кликает.

Это окно игнорирования OFF, не навсегда потерянная настройка. Длительность ограничена чужим await; верхняя реальная storage latency не измерена. Ожидающий очереди disable существовал до раунда7: **не приписываю появление всего дефекта новому коммиту**, но раннее обновление исправлено односторонне и не доказывает своевременный OFF вне ролей. Потери заметок и утечки ролей здесь не доказаны.

### K01 — LOW, незакрытая клавиатурная граница через blur

`src/core/keyboard.ts:111–114` добавляет physical code в stoppedDown;`:160–163` съедает соответствующий keyup;`:171–176` на blur/hidden отпускает удержания, но не завершает старое владение D.

1. Наш plain D-down забран; KeyD находится в stoppedDown.
2. Blur, клавишу отпустили в другом окне, keyup сюда не пришёл. Focus правильно чистит native pressed-set сайта.
3. Новый Ctrl+D полностью нажали и отпустили здесь. Down разрешён и принят сайтом.
4. Новый keyup съеден старой записью; Control-up оставляет phantom68.
5. Следующий nativeCtrl+V отвергнут exact-set matching, хотя физически клавиши отпущены.

`A/ordinary/tests/unit/audit8-ordinary-keys.test.ts:13–20`:

```text
actual   {nativeD:1,nativeV:0,afterRelease:[68],finalPressed:[68]}
expected {nativeD:1,nativeV:1,afterRelease:[]}
```

Настоящий dispatcher проверен против свежего сайта, KeyboardRouter настоящий; D-handler — no-op для изоляции маршрутизации. Это не принятое «посторонняя физическая клавиша всё ещё зажата»: focus уже очистил её, затем наш устаревший учёт отравляет следующее полностью отпущенное событие. Подходящий D-up/focus убирает phantom; запрещённый SHOW или вечный HIDE не доказаны. Native V полезен в лобби при разрешённом тумблере камеры. Реальная OS-доставка потерянного keyup в Chrome/Firefox не измерена; условие lost-up явно сохранено.

**Проверена историческая причинность.** В копию подставлен только keyboard.ts из `906cd32^`, после запуска восстановлен. `npx vitest run tests/unit/audit8-ordinary-keys.test.ts --reporter=json --outputFile=../keyboard-pre-round7.json`: до раунда7 **2P2F** — lost-up и обычный Ctrl+D control; HEAD **3P1F**. Раньше keyup глотался безусловно при наличии binding. Новый учёт исправил обычный путь, но не соседний. **K01 не объявлен впервые внесённой регрессией**; это оставшаяся часть прежнего пользовательского вреда (`git show 906cd32 -- src/core/keyboard.ts`, `A/keyboard-pre-round7.{json,log}`).

### staleDayLabel и обычный настоящий день

`A/ordinary/tests/unit/audit8-site-renderer.test.ts` исполняет неизменённые функции свежих modern-adapter/Room/Roller/Desktop, не предположения о текстах. Обе проверки прошли (`audit8-site-renderer.json`):

| Adapter stage/nextStage | isNight | Desktop current/next | staleDayLabel |
|---|---|---|---|
| speech/toNight |false|День\|Речь игрока /Ночь|true|
| speech/speech |false|День\|Речь игрока /День\|Речь игрока|false|

Свежий main SHA `1c8aedd9784d9a552452555c44d7dce47148512ffba5b90c79da7b29e23093b5`; команда `curl -fsSL https://polemicagame.com/room/bundle/main.js -o room-current.js`, аналогично скачан RU. AST/UTF-8 offsets: `site-scan.json`, `site-ast-readable.txt`. Dispatcher длиной5595символов совпал с captured fragment (`fresh-hotkeys-comparison.json`; иная граница extraction, не drift относительно5585 в R4).

Следовательно, **staleDayLabel не доказывает, что DAY ложен** — это признано в `src/core/selectors.ts:746–756`. Auto-start не подтверждает такой день (`src/content/features/auto-start.ts:1245–1259`), OBS сохраняет известную NIGHT (`obs-panel.ts:1239–1241`). Но полная серверная последовательность «первый/единственный увиденный день именно такой, прежний ручной HIDE переносится следующей ночи» не записана. Последняя речь обычного дня после уже ясного дня этого не доказывает. Поэтому принятый C04 не пересчитан как новая безусловная находка; обычная полная игра не объявлена неизбежно сломанной.

### Проверено и чисто — конкретный объём

22 непересекающихся существующих файла: **708P** (658+50), `ordinary/audit8-existing-controls.log`, `audit8-additional-controls.log`. Это не прибавка к2600 npm-test.

- Настройки при запуске доходят до ready auto-start до завершения настоящего notes-read. Повторные ранние и очередные updates в испытанных владельцах не удваивают подписки. OFF→ON после разрешения await сходится; record_start остаётся один, notes-listener не остаётся. Без pending-enable master OFF выключает record/activeIds за100 ms. Прямых map-write `playerNotes/tagCustomColors` в lifecycle-пробе нет; полный аудит заметок из этого не следует.
- Существующие recording-route/clip, queue state machine и mic hotkeys зелёные; это не закрывает F01.
- Readonly, logicalkeyCode68, editable-поля, V/F/repeat и обычный nativeCtrl+D-keyup проходят selected tests. Physical layout/IME/AltGraph не проверены браузером.
- Существующие pre-day D/V в30 ms, настоящий ObsClient delayed-echo, повторный safe-V departure, raw-stale reenable/confirmation/epoch-loss зелёные. Синхронный последний барьер — `obs-panel.ts:1421–1425`; поколения настроек/маршрута у await —`:1292–1299,1414–1419,1850–1855`. Нового превышения300 ms из-за штатного30 ms-барьера в этих пробах не установлено; повтор скрытия перед DAY соответствует намерению нового публичного перехода.
- `resumeShowMark` переносит второй stale (`auto-start.ts:1213–1215`), возврат зависит от неизменённой manualMark (`:1047–1048`); safe-return под V перевзводит peekSceneSafe (`:1300–1309`). В этих прогонах новой запрещённой role-reveal нет.

## 5. Принятые ограничения: точность описания

| Ограничение | Сверка с кодом/пробами |
|---|---|
| Readonly из report4`:441` |Исторически принято, затем исправлено report7`:457`. На HEAD не активная амнистия: D наш, flag сайта не меняется (§2.4). Представлять старый status как текущий было бы неверно |
| Неизвестная фаза при OBS — own-pin, D не показывает свою |Честно заявлено в замысле`:153–155`, report5`:470`; переписанная предпосылка не разрешает peer на outboundDAY (§2.2) |
| Чужой cancel+stop C03 |Честно заявлен report7`:448,459`; оригинал по-прежнему F, не «исправлено». Обычного producer не найдено (§2.4) |
| Первый настоящий DAY с next NIGHT C04 |Frontend-возможность подтверждена, серверная/live-последовательность и частота нет. Report7`:460` называет условие и перенос старого HIDE; guard действительно не различает два смысла (§4) |
| «Переходный день прячет стол до3с» |**Неточная верхняя граница**, если читать как полную длительность: эксперимент дал4999 ms; допустимо лишь как3 s после возврата NIGHT |
| Застрявшая подпись сколько угодно долго |Report6`:406` это явно принимает. Без следующего пакета новая ночь не подтверждается; это не обещание total≤3s |
| Принятая посторонняя зажатая клавиша мешает native D |Не оправдывает K01: там физического зажатия уже нет, focus очистил native-set, а последующий keyup потерял наш router (§4) |
| Две pushState без DOM между ними; obs-panel обычный subscriber |Замысел`:155–157` явно сужает наблюдаемость. Здесь не выданы за проверку всех server/SPA последовательностей |

**Измерение4999 ms:** `python3 measure-limits.py`, затем `npx vitest run tests/invariants/role-visibility-fuzz.test.ts -t 'REVIEW8 transient day measured'` из `A/spec`:1P. `limit-measured.json` содержит `hiddenAtMs:4998,visibleAtMs:4999,final:[true,true,true]`. DAY длится1999 ms, после NIGHT взводится новый таймер3000 ms (`auto-start.ts:1174–1177,1193–1201`). Контекст замысла`:116–121` допускает отсчёт после возврата NIGHT, поэтому это двусмысленное описание границы (`:153–154`, report5`:470`), **не доказанная умышленная нечестность и не самостоятельное нарушение runtime-таймера**.

Итого: условный C04 не превращён без серверного доказательства в «обычный случай всегда»; C03 не скрыт как исправление. Но общий тезис «уже готовые фичи сразу принимают любые настройки» недостаточен для OFF, и «только у забранных нажатий» без границы через blur не гарантирует корректный следующий keyup — подтверждены F01/K01, не покрытые перечисленными амнистиями.

## 6. Вердикт и уверенность

**Частично, уверенность98% в этом выводе — не процент покрытия и не вероятность инцидента.**

Обращённые свидетели, отказ владения, cancellation/stop, допустимый own-pin, P01, +50 ms, новый D-control и переписанные source-anchors имеют проверяемое основание. Но три запрошенные замены слабее оригиналов; различающий F5-mutant переживает **все2600** нынешних тестов. Два других ослабления компенсированы отдельными постоянными тестами, что не позволяет объявлять весь набор слепым. Центральный Spec имеет прямой H/M-контрпример, несмотря на зелёные5000. Обычные OFF/keyup границы подтверждены повтором, но не ложно названы новыми безусловными блокерами видимости ролей или впервые внесёнными регрессиями.

До100% не доводят отсутствие installed-extension/live игры, настоящих Program-кадров/fade, физической OS-доставки клавиш/раскладок, двухоконной OBS-сессии и server-частоты условных фазовых последовательностей. Chrome-пробы проверяют реальные CSS/reload-механизмы, не установку расширения или фактический эфир. Typecheck/2600/5000 действительно зелёные; из этого **не следует**, что все адаптации и весь oracle эквивалентны замыслу. Исправлений и предложений патчей этот отчёт не содержит.

## 7. Статус исправлений (22.10.2026, после отчёта)

| Находка | Статус | Что сделано |
|---|---|---|
| Ослаблена: F5 (раунд 4) | исправлено | `audit4-f5-peek` ловит любую навигацию (jsdomError виртуальной консоли), не только запись в лог; мутант «тихий location.reload» убит |
| Ослаблена: рендерер (раунд 5) | исправлено | `audit8-native-accept-v` — настоящие hotkeys-js и vShow из фрагментов бандла и обёртка Room.addHotKeys: принятое сайтом скрытие (Cmd+D, Meta-tail PTT, набранная клавиша через фокус) держится после V; мутант без учёта принятой команды убит |
| Ослаблена: OBS-возврат (раунд 6) | исправлено | В `audit6-stale-day` добавлен случай автосцены + автосмена + ручной показ; мутант `false && resume` в OBS-ветке убит |
| Потерян full-control нейтрализатора (раунд 4) | принято | Нейтрализатор display покрыт `obs-role-latch` и интеграционными тестами; полный рендерер сайта в репозиторий не кладём (бандл 1,6 МБ) |
| Spec: двойная переходная подпись | исправлено | Spec переносит ожидающий возврат через второй переходный день; сценарий закреплён в «найденных», мутант без переноса убит |
| F01: OFF ждёт чужого enable | исправлено | FeatureManager во время прохода сразу выключает фичи, ставшие OFF (мастер и отдельные); бытовые пробы аудитора — постоянные `audit8-ordinary-manager` (контроль OFF→ON теперь ждёт стоп и новый старт записи) |
| K01: залипание D через blur | исправлено | blur/скрытие вкладки очищает учёт забранных нажатий D; `audit8-ordinary-keys` |
| Формулировка «до 3 с» | исправлено | В промте: стол возвращается через 3 с ПОСЛЕ возврата ночи (вместе с днём — до ~5 с) |

Все различающие мутанты отчёта убиты новыми/усиленными тестами. 156 файлов тестов, typecheck, фаззинг 5000 — зелёные.
