/**
 * Проверка ядра предиктора. Запуск (Node 24+, нативное срезание типов):
 *     node --experimental-strip-types tests/roles-model.test.ts
 *
 * Эталонные числа получены независимой реализацией на Python
 * (research/analysis/condbern.py) — если два независимых кода сходятся
 * до 1e-12, ошибка в формуле маловероятна.
 */
import { seatMarginals, predictBlack, personalLogOdds, NEUTRAL_MODEL } from "../src/core/roles-model.ts";

let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

function close(a: number, b: number, eps = 1e-12): boolean {
  return Math.abs(a - b) <= eps;
}

console.log("seatMarginals");

// 1. Равные веса → равные вероятности, ровно k/n у каждого места.
{
  const p = seatMarginals(new Array(9).fill(0), 3);
  check("равные веса дают k/n", p.every((v) => close(v, 3 / 9)), JSON.stringify(p));
}

// 2. Сумма маргиналов = число чёрных. Это тождество, оно должно держаться
//    при ЛЮБЫХ весах — главная страховка от ошибки в нормировке.
{
  const w = [1.3, -0.7, 0.2, 0.9, -1.1, 0.05, 0.4, -0.3, 0.6];
  const p = seatMarginals(w, 3);
  const sum = p.reduce((s, v) => s + v, 0);
  check("сумма вероятностей = k при произвольных весах", close(sum, 3, 1e-12), `sum=${sum}`);
  check("все вероятности в [0,1]", p.every((v) => v >= 0 && v <= 1));
}

// 3. Монотонность: больший вес места — большая вероятность.
{
  const w = new Array(9).fill(0);
  w[4] = 1.0;
  const p = seatMarginals(w, 3);
  check("место с большим весом вероятнее", p[4] > p[0], `p4=${p[4]} p0=${p[0]}`);
  check("остальные места остаются равными", close(p[0], p[1]) && close(p[1], p[8]));
}

// 4. Вырожденные случаи.
{
  check("k=0 → все нули", seatMarginals([0, 0, 0], 0).every((v) => v === 0));
  check("k=n → все единицы", seatMarginals([0, 0, 0], 3).every((v) => v === 1));
}

// 5. Сверка с Python-эталоном (research/analysis/condbern.py, те же веса).
{
  const w = [0.5, -0.25, 0.75, 0.0, -1.0, 0.3, 0.1, -0.4, 0.2];
  const p = seatMarginals(w, 3);
  const expected = [
    0.44851099763882, 0.25773354406529, 0.52024651171357, 0.31471882360376,
    0.13365409535596, 0.39253300979179, 0.33962431844928, 0.22737193468031,
    0.36560676470122,
  ];
  const maxDiff = Math.max(...p.map((v, i) => Math.abs(v - expected[i])));
  check("совпадает с Python-эталоном", maxDiff < 1e-10, `maxDiff=${maxDiff}`);
}

console.log("predictBlack");

// 6. Нейтральная модель обязана давать ровно базовые доли: если исследование
//    ничего не нашло, панель не имеет права показывать перекос.
{
  const seats = Array.from({ length: 9 }, (_, i) => ({ seat: i + 1 }));
  const p = predictBlack(NEUTRAL_MODEL, seats, 3);
  check("нейтральная модель = базовые доли", p.every((v) => close(v, 1 / 3)));
}

console.log("personalLogOdds");

// 7. Пока модель не прошла валидацию, личная история не влияет ни на что.
{
  const v = personalLogOdds(NEUTRAL_MODEL, 900, 1000);
  check("без GO персональная поправка = 0", v === 0, `v=${v}`);
}

// 8. При активном приоре сжатие работает в нужную сторону.
{
  const model = {
    ...NEUTRAL_MODEL,
    personal_prior_strength: 100,
    validation: { ...NEUTRAL_MODEL.validation, go: true },
  };
  const high = personalLogOdds(model, 60, 100); // 60% чёрных при базе 30%
  const low = personalLogOdds(model, 10, 100);
  const noHistory = personalLogOdds(model, 0, 0);
  check("много чёрных → положительная поправка", high > 0, `high=${high}`);
  check("мало чёрных → отрицательная поправка", low < 0, `low=${low}`);
  check("нет истории → поправка 0", noHistory === 0);
  check("сжатие тянет к нулю", Math.abs(high) < Math.abs(Math.log(0.6 / 0.4) - Math.log(0.3 / 0.7)));
}

console.log(failed === 0 ? "\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : `\nПРОВАЛЕНО: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
