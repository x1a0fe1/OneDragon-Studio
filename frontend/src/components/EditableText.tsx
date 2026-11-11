import { useEffect, useState } from "react";

/** 失焦即保存的文本框；值没变不发请求。 */
export default function EditableText({
  value,
  onSave,
  multiline = false,
  placeholder,
  rows = 2,
  className,
}: {
  value: string;
  onSave: (v: string) => Promise<unknown> | void;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const [v, setV] = useState(value);
  const [state, setState] = useState<"" | "saving" | "error">("");
  useEffect(() => setV(value), [value]);

  async function commit() {
    if (v === value) return;
    setState("saving");
    try {
      await onSave(v);
      setState("");
    } catch {
      setState("error");
    }
  }

  const cls = `editable ${state} ${className ?? ""}`;
  return multiline ? (
    <textarea className={cls} value={v} rows={rows} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <input className={cls} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}
