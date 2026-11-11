import { isActive, Task } from "../api";

/** 任务状态小标签：排队中 / 执行中 / 失败（悬停看原因）。完成的不显示。 */
export function TaskStatus({ t }: { t?: Task }) {
  if (!t || t.status === "done") return null;
  if (t.status === "failed" && t.message === "已取消") return null;
  const label = { pending: "排队中", running: "进行中", done: "", failed: "失败" }[t.status];
  return (
    <span className={`badge ${t.status}`} title={t.error || t.message}>
      {label}
      {t.status !== "pending" && t.message ? `：${t.message}` : ""}
    </span>
  );
}

/** 选择本地图片上传的按钮 */
export function UploadButton({ onFile, label = "上传" }: { onFile: (f: File) => void; label?: string }) {
  return (
    <label className="file-btn">
      {label}
      <input type="file" accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }} />
    </label>
  );
}

export const busy = (t?: Task) => !!t && isActive(t);
