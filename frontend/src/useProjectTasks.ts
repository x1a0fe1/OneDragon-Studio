import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isActive, Task } from "./api";

/**
 * 盯着一个项目的任务：有任务在跑就每 2 秒刷新一次，任何任务跑完就调用 onFinished（用来重新加载页面数据）。
 * latest(kind, id) 返回某个对象最近的一个该类任务，用来在卡片上显示状态。
 */
export function useProjectTasks(projectId: number | undefined, onFinished: () => void) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const timer = useRef<number>();
  const active = useRef(new Set<number>());
  const finishedCb = useRef(onFinished);
  finishedCb.current = onFinished;

  const poll = useCallback(async () => {
    if (!projectId) return;
    window.clearTimeout(timer.current);
    let ts: Task[];
    try {
      ts = await api.tasks(projectId, 500);
    } catch {
      timer.current = window.setTimeout(poll, 5000);
      return;
    }
    setTasks(ts);
    const nowActive = new Set(ts.filter(isActive).map((t) => t.id));
    const finished = [...active.current].some((id) => !nowActive.has(id));
    active.current = nowActive;
    if (finished) finishedCb.current();
    if (nowActive.size) timer.current = window.setTimeout(poll, 2000);
  }, [projectId]);

  useEffect(() => {
    poll();
    return () => window.clearTimeout(timer.current);
  }, [poll]);

  const byKey = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of tasks) {
      const k = `${t.kind}:${t.target_id}`;
      if (!m.has(k)) m.set(k, t); // 列表按 id 倒序，第一个就是最新的
    }
    return m;
  }, [tasks]);

  const latest = useCallback((kind: string, id: number) => byKey.get(`${kind}:${id}`), [byKey]);
  const activeCount = tasks.filter(isActive).length;

  return { tasks, latest, poll, activeCount };
}
