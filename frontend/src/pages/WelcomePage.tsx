import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, SystemStatus } from "../api";
import DonateButton from "../components/DonateButton";
import Icon from "../components/Icon";

/** 制作流程：每一步对应网页里的哪个位置 */
const FLOW: { label: string; icon: string; color: string; tip: string }[] = [
  { label: "导入故事", icon: "book", color: "#2563eb", tip: "项目页 → 导入故事或小说，自动拆成多集" },
  { label: "AI 拆分镜", icon: "sparkle", color: "#7c3aed", tip: "分集页 → AI 拆分镜，同时识别角色、场景、道具" },
  { label: "角色参考图", icon: "user", color: "#db2777", tip: "项目页 → 角色卡片，保证每个镜头里长得一样" },
  { label: "场景 / 道具", icon: "box", color: "#d97706", tip: "项目页 → 场景、道具卡片，可存入素材库复用" },
  { label: "生成首帧", icon: "image", color: "#0d9488", tip: "分集页 → 批量生成首帧，自动带上参考图" },
  { label: "图生视频", icon: "video", color: "#dc2626", tip: "分集页 → 批量生成视频，首帧动起来" },
  { label: "台词配音", icon: "mic", color: "#4f46e5", tip: "分集页 → 批量配音，角色可以单独选音色" },
  { label: "字幕与标识", icon: "captions", color: "#0891b2", tip: "合成时自动烧录字幕和「AI生成」标识" },
  { label: "合成成片", icon: "check", color: "#16a34a", tip: "分集页 → 合成成片，网页里预览、下载 MP4 / SRT" },
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

  return (
    <div className="page welcome">
      <div className="hero">
        <div className="hero-logo"><img src="/favicon.svg" alt="" /></div>
        <h1>欢迎使用 OneDragon Studio</h1>
        <p>从一个故事到一集能发布的竖屏漫剧：拆分镜、出图、出视频、配音、字幕、合成，一条龙做完。</p>
        {status && (
          <div className="hero-stats">
            <span><b>{status.counts.projects}</b> 部剧</span>
            <span><b>{status.counts.episodes}</b> 集</span>
            <span><b>{status.counts.active_tasks}</b> 个任务进行中</span>
          </div>
        )}
      </div>

      <section className="card flow-card">
        <h2><Icon name="wand" size={18} className="accent" /> 制作流程</h2>
        <ol className="flow">
          {FLOW.map((f, i) => (
            <li key={f.label} title={f.tip}>
              <span className="flow-icon" style={{ background: f.color }}><Icon name={f.icon} size={22} /></span>
              <span className="flow-label"><small>{i + 1}</small>{f.label}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">鼠标停在每一步上，可以看到在哪里操作。</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>系统状态</h2>
          <button onClick={load} disabled={loading}><Icon name="refresh" size={14} /> {loading ? "检查中…" : "刷新"}</button>
        </div>
        {err && <p className="error">{err}</p>}
        {!status ? <p className="muted">{loading ? "检查中…" : ""}</p> : (
          <div className="status-list">
            {status.items.map((it) => (
              <div key={it.key} className={`status-item st-${it.state}`}>
                <span className="status-icon"><Icon name={STATE_ICON[it.state]} size={16} /></span>
                <div>
                  <b>{it.name}</b>
                  <span className="muted small">{it.detail}</span>
                </div>
                <Link to="/settings">设置</Link>
              </div>
            ))}
          </div>
        )}
        {status && !llmReady && (
          <p className="tip"><b>提示：</b>先到「系统设置」填好文本大模型的地址和 API Key，AI 拆分镜、AI 分集才能用。生图、生视频没有 GPU 时可以先用演示模式走通流程。</p>
        )}
      </section>

      <div className="welcome-actions">
        <Link to="/projects" className="button primary big">开始制作 <Icon name="arrowRight" size={16} /></Link>
        <Link to="/settings" className="button big">系统设置</Link>
      </div>

      <div className="support-card">
        <div>
          <b>OneDragon Studio 免费开源</b>
          <span className="muted small">没有会员、没有广告。如果它帮你省下了时间，欢迎请作者喝杯奶茶，支持继续更新。</span>
        </div>
        <DonateButton />
      </div>
    </div>
  );
}
