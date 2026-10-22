/**
 * Страница «Моя картинка» (avatar.html): выбор своего изображения для
 * карточки поиска и фото своего профиля (просьба владельца 22.10.2026).
 *
 * Отдельная страница, а не попап: в Firefox окно выбора файла закрывает
 * попап. Картинка декодируется браузером (createImageBitmap — любой
 * поддерживаемый растровый формат, SVG не принимаем), ужимается на canvas
 * до OWN_AVATAR_MAX_SIDE и сохраняется data:-строкой в storage.local
 * (@core/own-avatar). После сохранения источник переключается на «своя».
 */
import { setSettings } from "@core/settings";
import {
  OWN_AVATAR_MAX_CHARS,
  OWN_AVATAR_MAX_SIDE,
  clearOwnAvatar,
  isValidOwnAvatar,
  loadOwnAvatar,
  saveOwnAvatar,
} from "@core/own-avatar";

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
/** Больше этого исходник не читаем: 25 МБ хватит любой фотографии с телефона. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function setStatus(text: string, kind: "" | "error" | "ok" = ""): void {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.className = kind ? `status ${kind}` : "status";
}

function showPreview(src: string | null): void {
  for (const id of ["pv_card", "pv_profile"]) {
    const frame = $(id);
    if (!frame) continue;
    frame.textContent = "";
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      frame.append(img);
    } else {
      frame.textContent = "нет картинки";
    }
  }
}

/** Размер после ужатия: длинная сторона ≤ max, пропорции сохраняются. Чистая функция. */
export function fitSize(w: number, h: number, max = OWN_AVATAR_MAX_SIDE): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Файл → ужатая data:-строка. WebP, если браузер его кодирует, иначе JPEG. */
async function encode(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const { w, h } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas недоступен");
    ctx.drawImage(bitmap, 0, 0, w, h);
    for (const [type, quality] of [
      ["image/webp", 0.86],
      ["image/jpeg", 0.86],
      ["image/jpeg", 0.7],
    ] as const) {
      const url = canvas.toDataURL(type, quality);
      // toDataURL молча отдаёт PNG, если тип не поддержан, — проверяем сами.
      if (url.startsWith(`data:${type};`) && isValidOwnAvatar(url)) return url;
    }
    throw new Error("слишком большая картинка");
  } finally {
    bitmap.close();
  }
}

function setup(): void {
  const input = $<HTMLInputElement>("file");
  const save = $<HTMLButtonElement>("save");
  const remove = $<HTMLButtonElement>("remove");
  if (!input || !save || !remove) return;
  let pending: string | null = null;

  void loadOwnAvatar().then((value) => {
    showPreview(value);
    remove.hidden = !value;
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    pending = null;
    save.disabled = true;
    if (!ACCEPTED.has(file.type)) {
      setStatus("Нужен файл JPG, PNG, WebP или GIF.", "error");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setStatus("Файл больше 25 МБ — выберите поменьше.", "error");
      return;
    }
    setStatus("Готовлю картинку…");
    try {
      pending = await encode(file);
      showPreview(pending);
      save.disabled = false;
      const kb = Math.round((pending.length * 3) / 4 / 1024);
      setStatus(`Так она будет выглядеть (${kb} КБ). Нажмите «Сохранить».`);
    } catch {
      setStatus("Не получилось прочитать картинку — попробуйте другой файл.", "error");
    }
  });

  save.addEventListener("click", async () => {
    if (!pending || pending.length > OWN_AVATAR_MAX_CHARS) return;
    save.disabled = true;
    try {
      await saveOwnAvatar(pending);
      await setSettings({ own_avatar_source: "custom" });
      pending = null;
      remove.hidden = false;
      setStatus("Сохранено. Обновится на открытых вкладках сайта сразу.", "ok");
    } catch {
      save.disabled = false;
      setStatus("Не удалось сохранить — попробуйте ещё раз.", "error");
    }
  });

  remove.addEventListener("click", async () => {
    try {
      await clearOwnAvatar();
      await setSettings({ own_avatar_source: "site" });
      pending = null;
      save.disabled = true;
      remove.hidden = true;
      showPreview(null);
      setStatus("Своя картинка убрана — показывается фото с сайта.", "ok");
    } catch {
      setStatus("Не удалось убрать — попробуйте ещё раз.", "error");
    }
  });
}

setup();
