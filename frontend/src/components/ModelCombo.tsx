import { useState } from "react";
import { t } from "../i18n";

/**
 * 可输入的模型下拉框。浏览器自带的 datalist 会按输入框里已有的内容过滤，
 * 已经填了 deepseek-chat 时就看不到 deepseek-reasoner；这里点开总是列出全部，打字时才按输入过滤。
 */
export default function ModelCombo({ value, options, placeholder, onChange }: {
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // 打开后用户有没有打过字：打过才过滤
  const q = value.trim().toLowerCase();
  const list = typed && q ? options.filter((m) => m.toLowerCase().includes(q)) : options;

  return (
    <div className="combo">
      <input value={value} placeholder={placeholder}
        onFocus={() => { setOpen(true); setTyped(false); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        onChange={(e) => { onChange(e.target.value); setTyped(true); setOpen(true); }} />
      {options.length > 0 && (
        <button type="button" className="combo-toggle" tabIndex={-1} aria-label={t("展开模型列表", "Show model list")}
          onMouseDown={(e) => { e.preventDefault(); setTyped(false); setOpen(!open); }}>▾</button>
      )}
      {open && list.length > 0 && (
        <ul className="combo-list" role="listbox">
          {list.map((m) => (
            <li key={m} role="option" aria-selected={m === value} className={m === value ? "on" : ""}
              onMouseDown={(e) => { e.preventDefault(); onChange(m); setOpen(false); }}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
