import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SystemStatus } from "../api";
import DonateButton from "../components/DonateButton";
import Icon from "../components/Icon";
import { t } from "../i18n";

/** 制作流程：每一步对应网页里的哪个位置（渲染时生成，跟随当前语言） */
const flowSteps = (): { label: string; icon: string; color: string; tip: string }[] => [
  { label: t("导入故事", "Import story"), icon: "book", color: "#2563eb", tip: t("项目页 → 导入故事或小说，自动拆成多集", "Project page → import a story or novel; it is split into episodes automatically") },
  { label: t("AI 拆分镜", "AI Storyboard"), icon: "sparkle", color: "#7c3aed", tip: t("分集页 → AI 拆分镜，同时识别角色、场景、道具", "Episode page → AI Storyboard; also detects characters, scenes and props") },
  { label: t("角色参考图", "Character refs"), icon: "user", color: "#db2777", tip: t("项目页 → 角色卡片，保证每个镜头里长得一样", "Project page → character cards keep characters consistent across shots") },
  { label: t("场景 / 道具", "Scenes / Props"), icon: "box", color: "#d97706", tip: t("项目页 → 场景、道具卡片，可存入素材库复用", "Project page → scene and prop cards; save them to the library for reuse") },
  { label: t("生成首帧", "First frames"), icon: "image", color: "#0d9488", tip: t("分集页 → 批量生成首帧，自动带上参考图", "Episode page → batch-generate first frames with reference images attached") },
  { label: t("图生视频", "Image-to-video"), icon: "video", color: "#dc2626", tip: t("分集页 → 批量生成视频，首帧动起来", "Episode page → batch-generate videos that animate the first frames") },
  { label: t("台词配音", "Voice-over"), icon: "mic", color: "#4f46e5", tip: t("分集页 → 批量配音，角色可以单独选音色", "Episode page → batch voice-over; pick a voice per character") },
  { label: t("字幕与标识", "Subtitles & label"), icon: "captions", color: "#0891b2", tip: t("合成时自动烧录字幕和「AI生成」标识", "Subtitles and an \"AI-generated\" label are burned in when composing") },
  { label: t("合成成片", "Compose"), icon: "check", color: "#16a34a", tip: t("分集页 → 合成成片，网页里预览、下载 MP4 / SRT", "Episode page → Compose; preview in the browser and download MP4 / SRT") },
];

const STATE_ICON = { ok: "check", warn: "alert", error: "x" } as const;

export default function WelcomePage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    api.status().then(setStatus).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const llmReady = status?.items.find((i) => i.key === "llm")?.state === "ok";
  const flow = flowSteps();

  return (
    <div className="page welcome">
      <div className="hero">
        <div className="hero-logo"><img src="/favicon.svg" alt="" /></div>
        <h1>{t("欢迎使用一条龙 OneDragon Studio", "Welcome to OneDragon Studio")}</h1>
        <p>{t("从一个故事到一集能发布的竖屏漫剧：拆分镜、出图、出视频、配音、字幕、合成，一条龙做完。", "From a story to a publish-ready vertical comic drama: storyboard, images, video, voice-over, subtitles and compositing, all in one place.")}</p>
        {status && (
          <div className="hero-stats">
            <span><b>{status.counts.projects}</b> {t("部剧", "dramas")}</span>
            <span><b>{status.counts.episodes}</b> {t("集", "episodes")}</span>
            <span><b>{status.counts.active_tasks}</b> {t("个任务进行中", "tasks running")}</span>
          </div>
        )}
      </div>

      <section className="card flow-card">
        <h2><Icon name="wand" size={18} className="accent" /> {t("制作流程", "Workflow")}</h2>
        <ol className="flow">
          {flow.map((f, i) => (
            <li key={f.icon} title={f.tip}>
              <span className="flow-icon" style={{ background: f.color }}><Icon name={f.icon} size={22} /></span>
              <span className="flow-label"><small>{i + 1}</small>{f.label}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">{t("鼠标停在每一步上，可以看到在哪里操作。", "Hover over a step to see where to do it.")}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{t("系统状态", "System status")}</h2>
          <button onClick={load} disabled={loading}><Icon name="refresh" size={14} /> {loading ? t("检查中…", "Checking…") : t("刷新", "Refresh")}</button>
        </div>
        {err && <p className="error">{err}</p>}
        {!status ? <p className="muted">{loading ? t("检查中…", "Checking…") : ""}</p> : (
          <div className="status-list">
            {status.items.map((it) => (
              <div key={it.key} className={`status-item st-${it.state}`}>
                <span className="status-icon"><Icon name={STATE_ICON[it.state]} size={16} /></span>
                <div>
                  <b>{it.name}</b>
                  <span className="muted small">{it.detail}</span>
                </div>
                <Link to="/settings">{t("设置", "Settings")}</Link>
              </div>
            ))}
          </div>
        )}
        {status && !llmReady && (
          <p className="tip"><b>{t("提示：", "Tip: ")}</b>{t("先到「系统设置」填好文本大模型的地址和 API Key，AI 拆分镜、AI 分集才能用。生图、生视频没有 GPU 时可以先用演示模式走通流程。", "Fill in the text LLM's URL and API key in Settings first; AI Storyboard and AI episode splitting need it. Without a GPU for image and video generation, you can try the whole workflow in demo mode.")}</p>
        )}
      </section>

      <div className="welcome-actions">
        <Link to="/projects" className="button primary big">{t("开始制作", "Start creating")} <Icon name="arrowRight" size={16} /></Link>
        <Link to="/settings" className="button big">{t("系统设置", "Settings")}</Link>
      </div>

      <div className="support-card">
        <div>
          <b>{t("OneDragon Studio 免费开源", "OneDragon Studio is free and open source")}</b>
          <span className="muted small">{t("没有会员、没有广告。如果它帮你省下了时间，欢迎请作者喝杯奶茶，支持继续更新。", "No subscriptions, no ads. If it saves you time, consider buying the author a milk tea to support future updates.")}</span>
        </div>
        <DonateButton />
      </div>
    </div>
  );
}
