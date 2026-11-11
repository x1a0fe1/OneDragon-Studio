import { Fragment, useEffect, useState } from "react";
import { api, Task } from "../api";
import { TaskBadge } from "./EpisodePage";

export default function TasksPage() {
  const [list, setList] = useState<Task[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => api.tasks().then((t) => alive && setList(t)).catch(() => {});
    tick();
    const h = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  return (
    <div className="page wide">
      <h1>任务队列</h1>
      <p className="muted small">所有耗时操作都在后台排队执行，失败会自动重试（配置类错误不重试）；文本和生图生视频分两条队列，互不耽误；关掉网页不影响，后端重启后会接着跑。</p>
      {list.length === 0 ? <p className="muted">还没有任务。</p> : (
        <table className="table">
          <thead><tr><th>#</th><th>类型</th><th>对象</th><th>状态</th><th>尝试</th><th>更新时间</th><th></th></tr></thead>
          <tbody>
            {list.map((t) => (
              <Fragment key={t.id}>
                <tr>
                  <td>{t.id}</td>
                  <td>{t.kind_label}</td>
                  <td>{t.target_id}</td>
                  <td><TaskBadge t={t} /></td>
                  <td>{t.attempts}/{t.max_attempts}</td>
                  <td>{t.updated_at.replace("T", " ").slice(0, 19)}</td>
                  <td>
                    {t.error && <button className="link" onClick={() => setOpen(open === t.id ? null : t.id)}>详情</button>}
                    {t.status === "failed" && <button className="link" onClick={() => api.retryTask(t.id).then(() => api.tasks().then(setList))}>重试</button>}
                    {t.status === "pending" && <button className="link danger" onClick={() => api.cancelTask(t.id).then(() => api.tasks().then(setList))}>取消</button>}
                  </td>
                </tr>
                {open === t.id && (
                  <tr><td colSpan={7}><pre className="error-box">{t.error}</pre></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
