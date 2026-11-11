import { Fragment, useEffect, useState } from "react";
import { api, Task } from "../api";
import { TaskBadge } from "./EpisodePage";
import { t } from "../i18n";

export default function TasksPage() {
  const [list, setList] = useState<Task[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => api.tasks().then((ts) => alive && setList(ts)).catch(() => {});
    tick();
    const h = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  return (
    <div className="page wide">
      <h1>{t("任务队列", "Task Queue")}</h1>
      <p className="muted small">{t("所有耗时操作都在后台排队执行，失败会自动重试（配置类错误不重试）；文本和生图生视频分两条队列，互不耽误；关掉网页不影响，后端重启后会接着跑。", "All long-running jobs are queued in the background and retried automatically on failure (except configuration errors). Text jobs and image/video jobs use separate queues so they don’t block each other. Closing the page doesn’t stop them, and they resume after a backend restart.")}</p>
      {list.length === 0 ? <p className="muted">{t("还没有任务。", "No tasks yet.")}</p> : (
        <table className="table">
          <thead><tr><th>#</th><th>{t("类型", "Type")}</th><th>{t("对象", "Target")}</th><th>{t("状态", "Status")}</th><th>{t("尝试", "Attempts")}</th><th>{t("更新时间", "Updated")}</th><th></th></tr></thead>
          <tbody>
            {list.map((task) => (
              <Fragment key={task.id}>
                <tr>
                  <td>{task.id}</td>
                  <td>{task.kind_label}</td>
                  <td>{task.target_id}</td>
                  <td><TaskBadge t={task} /></td>
                  <td>{task.attempts}/{task.max_attempts}</td>
                  <td>{task.updated_at.replace("T", " ").slice(0, 19)}</td>
                  <td>
                    {task.error && <button className="link" onClick={() => setOpen(open === task.id ? null : task.id)}>{t("详情", "Details")}</button>}
                    {task.status === "failed" && <button className="link" onClick={() => api.retryTask(task.id).then(() => api.tasks().then(setList))}>{t("重试", "Retry")}</button>}
                    {task.status === "pending" && <button className="link danger" onClick={() => api.cancelTask(task.id).then(() => api.tasks().then(setList))}>{t("取消", "Cancel")}</button>}
                  </td>
                </tr>
                {open === task.id && (
                  <tr><td colSpan={7}><pre className="error-box">{task.error}</pre></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
