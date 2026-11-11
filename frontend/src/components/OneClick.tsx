import { useState } from "react";
import { api, Task } from "../api";
import Icon from "./Icon";
import { t } from "../i18n";

const STEPS = () => [t("拆分镜", "Storyboard"), t("参考图", "Reference images"), t("首帧", "First frames"), t("视频", "Videos"), t("配音", "Voice-over"), t("合成", "Compose")];

/** 一键成片：剧本 → 拆分镜 → 参考图 → 首帧 → 视频 → 配音 → 合成，缺什么补什么。 */
export default function OneClick({ eid, hasShots, hasScript, seconds, task, beforeStart, onStarted }: {
  eid: number;
  hasShots: boolean;
  hasScript: boolean;
  seconds: number;
  task?: Task;
  beforeStart: () => Promise<unknown>;
  onStarted: () => void;
}) {
  const [redo, setRedo] = useState(false);
  const [withVideo, setWithVideo] = useState(true);
  const [err, setErr] = useState("");
  const active = !!task && (task.status === "pending" || task.status === "running");
  // 进行中的消息是「第 3/6 步 …」/「Step 3/6 …」，失败的消息是「第 3 步 … 失败」/「Step 3 … failed」
  const step = Number(/(?:第 |Step )(\d)(?:\/\d)?/.exec(task?.message || "")?.[1] || 0);
  const failed = task?.status === "failed" && task.message !== "已取消" && task.message !== "Cancelled";
  const done = task?.status === "done";

  async function start() {
    setErr("");
    try {
      await beforeStart();
      if (redo && hasShots && !window.confirm(t("重新拆分镜会替换掉当前所有镜头和它们的画面，继续？", "Redoing the storyboard replaces all current shots and their images. Continue?"))) return;
      await api.pipeline(eid, { target_seconds: seconds, redo_storyboard: redo, with_video: withVideo });
      onStarted();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className={`card oneclick ${active ? "active" : ""}`}>
      <div className="oneclick-head">
        <div>
          <h2><Icon name="wand" size={18} /> {t("一键成片", "One-Click Episode")}</h2>
          <p className="muted small">{t("从剧本自动跑到成片，已经有的不会重做。中途哪一步失败会停下来说明原因，修好后再点一次接着跑。", "Runs automatically from script to final video, skipping anything already done. If a step fails it stops and explains why; fix it and click again to resume.")}</p>
        </div>
        {active ? (
          <button className="danger-btn" onClick={() => task && api.stopPipeline(task.id).then(onStarted)}>{t("停止", "Stop")}</button>
        ) : (
          <button className="primary big-btn" onClick={start} disabled={!hasScript && !hasShots}>
            <Icon name="sparkle" size={16} /> {done || failed ? t("再跑一次", "Run again") : t("一键成片", "One-Click Episode")}
          </button>
        )}
      </div>

      {!active && (
        <div className="oneclick-opts">
          <label className="inline"><input type="checkbox" checked={withVideo} onChange={(e) => setWithVideo(e.target.checked)} />
            {t("生成视频（关掉就用首帧静图合成，最省钱）", "Generate videos (turn off to compose from first-frame stills — cheapest)")}</label>
          {hasShots && (
            <label className="inline"><input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} />
              {t("重新拆分镜（会替换现有镜头）", "Redo storyboard (replaces existing shots)")}</label>
          )}
          <span className="muted small">{t("目标时长 {n} 秒（在上面改）", "Target length {n}s (change it above)", { n: seconds })}</span>
        </div>
      )}

      {task && (active || failed || done) && (
        <>
          <ol className="pipe-steps">
            {STEPS().map((label, i) => {
              const n = i + 1;
              const state = done ? "done" : n < step ? "done" : n === step ? (failed ? "failed" : "current") : "todo";
              return (
                <li key={label} className={state}>
                  <span className="dot">{state === "done" ? <Icon name="check" size={12} /> : state === "failed" ? <Icon name="x" size={12} /> : n}</span>
                  {label}
                </li>
              );
            })}
          </ol>
          <p className={`small ${failed ? "error" : done ? "ok" : "muted"}`}>
            {task.status === "pending" ? t("排队中…", "Queued…") : task.message}
          </p>
        </>
      )}
      {err && <p className="error small">{err}</p>}
    </div>
  );
}
