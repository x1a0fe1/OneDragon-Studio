import { isActive, Task } from "../api";
import { t } from "../i18n";

/** 任务状态小标签：排队中 / 执行中 / 失败（悬停看原因）。完成的不显示。 */
export function TaskStatus({ t: task }: { t?: Task }) {
  if (!task || task.status === "done") return null;
  if (task.status === "failed" && (task.message === "已取消" || task.message === "Cancelled")) return null;
  const label = { pending: t("排队中", "Queued"), running: t("进行中", "Running"), done: "", failed: t("失败", "Failed") }[task.status];
  return (
    <span className={`badge ${task.status}`} title={task.error || task.message}>
      {label}
      {task.status !== "pending" && task.message ? t("：{m}", ": {m}", { m: task.message }) : ""}
    </span>
  );
}

/** 选择本地图片上传的按钮 */
export function UploadButton({ onFile, label }: { onFile: (f: File) => void; label?: string }) {
  return (
    <label className="file-btn">
      {label ?? t("上传", "Upload")}
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
