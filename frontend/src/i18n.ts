/**
 * 界面中英双语。用法：t("中文", "English")，或带变量 t("共 {n} 集", "{n} episodes", { n: 3 })。
 * 中英文写在同一处，改文案时不用到处找字典。
 * 当前语言存在 localStorage；第一次打开按浏览器语言自动选。切换语言时整个界面重新渲染。
 */
import { useSyncExternalStore } from "react";

export type Lang = "zh" | "en";

const KEY = "onedragon-lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* 隐私模式等拿不到 localStorage */
  }
  return (navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
}

let current: Lang = detect();
const listeners = new Set<() => void>();
document.documentElement.lang = current === "zh" ? "zh-CN" : "en";

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* 存不了也没关系，本次会话有效 */
  }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  listeners.forEach((f) => f());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function t(zh: string, en: string, vars?: Record<string, string | number>): string {
  const s = current === "en" ? en : zh;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
