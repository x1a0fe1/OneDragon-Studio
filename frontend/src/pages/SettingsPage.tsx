import { Fragment, useEffect, useState } from "react";
import { api, Settings } from "../api";
import DonateButton from "../components/DonateButton";
import VoicePicker from "../components/VoicePicker";
import { LLMSettings } from "../components/LLMSettings";

const PLACEHOLDERS: Record<string, string> = {
  prompt: "正向提示词",
  negative: "反向提示词",
  seed: "随机种子（每次不同）",
  width: "宽（按项目画面比例和上面的长边自动算）",
  height: "高",
  image: "首帧图（图生视频用，自动上传到 ComfyUI）",
  ref_image_1: "参考图 1（自动上传；不够 3 张时重复前面的）",
  ref_image_2: "参考图 2",
  ref_image_3: "参考图 3",
  frames: "帧数（时长 × 帧率，取 4n+1）",
  fps: "帧率",
  duration: "时长（秒）",
  filename_prefix: "输出文件名前缀",
};

function checkWorkflow(text: string, required: string[]): { ok: boolean; msg: string } {
  if (!text.trim()) return { ok: true, msg: "" };
  let wf: any;
  try {
    wf = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, msg: "不是合法的 JSON：" + e.message };
  }
  if (wf && wf.nodes && wf.links) return { ok: false, msg: "这是普通保存格式，请在 ComfyUI 里用「导出 (API)」重新导出" };
  if (!wf || typeof wf !== "object" || !Object.values(wf).every((n: any) => n && n.class_type))
    return { ok: false, msg: "看不出是 API 格式的工作流" };
  const found = new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
  const unknown = [...found].filter((k) => !(k in PLACEHOLDERS));
  if (unknown.length) return { ok: false, msg: "不认识的占位符：" + unknown.join("、") };
  const missing = required.filter((k) => !found.has(k));
  const nodes = Object.keys(wf).length;
  if (missing.length) return { ok: false, msg: `${nodes} 个节点；还缺占位符：` + missing.map((k) => `{{${k}}}`).join("、") };
  return { ok: true, msg: `${nodes} 个节点；用到 ` + [...found].map((k) => `{{${k}}}`).join(" ") };
}

function WorkflowField(props: { title: string; hint: string; required: string[]; value: string; onChange: (v: string) => void }) {
  const check = checkWorkflow(props.value || "", props.required);
  return (
    <label className="block">
      <span className="label-row">
        <span>{props.title} <span className="muted">· {props.hint}</span></span>
        <span className="file-btn">
          导入 JSON
          <input type="file" accept=".json,application/json" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) f.text().then(props.onChange);
          }} />
        </span>
      </span>
      <textarea className="code" rows={props.value ? 6 : 2} value={props.value || ""} spellCheck={false}
        placeholder="粘贴 ComfyUI「导出 (API)」得到的 JSON" onChange={(e) => props.onChange(e.target.value)} />
      {check.msg && <span className={`wf-status ${check.ok ? "ok" : "error"}`}>{check.msg}</span>}
    </label>
  );
}


export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [savedVendor, setSavedVendor] = useState("");

  useEffect(() => {
    api.settings().then((v) => { setS(v); setSavedVendor(v.llm?.vendor ?? ""); }).catch((e) => setMsg(e.message));
  }, []);
  if (!s) return <div className="page muted">{msg || "加载中…"}</div>;

  const set = (section: string, field: string, v: unknown) => setS({ ...s, [section]: { ...s[section], [field]: v } });

  async function save() {
    setMsg("");
    try {
      const saved = await api.saveSettings(s!);
      setS(saved);
      setSavedVendor(saved.llm.vendor);
      setMsg("已保存");
    } catch (e: any) {
      setMsg("保存失败：" + e.message);
    }
  }

  async function testComfy() {
    setTesting(true);
    setMsg("");
    try {
      await api.saveSettings(s!);
      setSavedVendor(s!.llm.vendor);
      const r = await api.testComfyUI();
      setMsg(`ComfyUI 连接成功：${r.version ? "v" + r.version + "，" : ""}${r.device || "未知设备"}${r.vram_gb ? `，显存 ${r.vram_gb} GB` : ""}`);
    } catch (e: any) {
      setMsg("ComfyUI 连接失败：" + e.message);
    } finally {
      setTesting(false);
    }
  }

  async function testCloud(provider: "aliyun" | "volcengine") {
    setTesting(true);
    setMsg("");
    try {
      await api.saveSettings(s!);
      setSavedVendor(s!.llm.vendor);
      setMsg((await api.testCloud(provider)).message);
    } catch (e: any) {
      setMsg("连接失败：" + e.message);
    } finally {
      setTesting(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg("");
    try {
      await api.saveSettings(s!);
      setSavedVendor(s!.llm.vendor);
      const r = await api.testLLM();
      setMsg(`连接成功，模型回复：${r.reply}`);
    } catch (e: any) {
      setMsg("连接失败：" + e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="page">
      <h1>系统设置</h1>
      <p className="muted">文本大模型、生图生视频（ComfyUI）、配音和合成成片的设置。</p>

      <LLMSettings s={s} setS={setS} onTest={test} testing={testing} savedVendor={savedVendor} />

      <div className="card">
        <h2>生图 / 生视频</h2>
        <p className="muted small">
          没有显卡时：先用「演示」把流程走通，再选阿里云百炼或火山方舟出真画面（不用 GPU，填 API Key 即可，按张 / 按秒付费，价格以平台为准）。
          租到 GPU、装好 ComfyUI 后也可以切过去。生图和生视频可以选不同的平台，已有的项目不用改。
        </p>
        <div className="field-grid">
          <label>生图供应商
            <select value={s.image_provider} onChange={(e) => setS({ ...s, image_provider: e.target.value })}>
              <option value="mock">演示（占位图，不调用模型）</option>
              <option value="aliyun">阿里云百炼（通义万相，按张计费）</option>
              <option value="volcengine">火山方舟（豆包 Seedream，按张计费）</option>
              <option value="comfyui">ComfyUI（自己的 GPU）</option>
            </select>
          </label>
          <label>生视频供应商
            <select value={s.video_provider} onChange={(e) => setS({ ...s, video_provider: e.target.value })}>
              <option value="mock">演示（首帧缓慢推近，不调用模型）</option>
              <option value="aliyun">阿里云百炼（通义万相，按秒计费）</option>
              <option value="volcengine">火山方舟（豆包 Seedance，按秒计费）</option>
              <option value="comfyui">ComfyUI（自己的 GPU）</option>
            </select>
          </label>
        </div>
      </div>

      {(["aliyun", "volcengine"] as const).filter((k) => s.image_provider === k || s.video_provider === k).map((k) => (
        <CloudCard key={k} provider={k} s={s} set={set} onTest={() => testCloud(k)} testing={testing} />
      ))}

      <div className="card">
        <h2>ComfyUI</h2>
        <div className="field-grid">
          <label className="span2">地址<input value={s.comfyui.base_url} onChange={(e) => set("comfyui", "base_url", e.target.value)} placeholder="http://127.0.0.1:8188 或租用 GPU 服务器的地址" /></label>
          <label>图片长边（像素）<input type="number" step={64} value={s.comfyui.image_long_side} onChange={(e) => set("comfyui", "image_long_side", Number(e.target.value))} /></label>
          <label>视频长边（像素）<input type="number" step={16} value={s.comfyui.video_long_side} onChange={(e) => set("comfyui", "video_long_side", Number(e.target.value))} /></label>
          <label>视频帧率<input type="number" min={8} max={60} value={s.comfyui.fps} onChange={(e) => set("comfyui", "fps", Number(e.target.value))} /></label>
          <label>单个任务超时（秒）<input type="number" min={60} step={60} value={s.comfyui.timeout_sec} onChange={(e) => set("comfyui", "timeout_sec", Number(e.target.value))} /></label>
          <label className="span2">反向提示词（云端平台也会用）<input value={s.comfyui.negative_prompt} onChange={(e) => set("comfyui", "negative_prompt", e.target.value)} /></label>
        </div>
        <div className="actions">
          <button onClick={testComfy} disabled={testing}>{testing ? "测试中…" : "保存并测试连接"}</button>
        </div>

        <WorkflowField title="文生图工作流" required={["prompt"]} hint="角色/场景参考图，以及没有参考图时的镜头首帧"
          value={s.comfyui.image_workflow} onChange={(v) => set("comfyui", "image_workflow", v)} />
        <WorkflowField title="参考图生图工作流（可选）" required={["prompt", "ref_image_1"]} hint="镜头首帧带上出镜角色和场景的参考图，人物更稳定；不填就用文生图"
          value={s.comfyui.ref_image_workflow} onChange={(v) => set("comfyui", "ref_image_workflow", v)} />
        <WorkflowField title="图生视频工作流" required={["image", "prompt"]} hint="用镜头首帧 + 视频提示词生成这一镜的视频"
          value={s.comfyui.video_workflow} onChange={(v) => set("comfyui", "video_workflow", v)} />

        <details>
          <summary className="muted small">怎么准备工作流？</summary>
          <ol className="small">
            <li>在 ComfyUI 里搭好一个能出图（或出视频）的工作流，先手动跑通。</li>
            <li>菜单里选「导出 (API)」/ Export (API)，得到一个 JSON 文件。</li>
            <li>用记事本打开，把每次要变的输入值改成下面的占位符，比如正向提示词节点的 <code>"text": "..."</code> 改成 <code>"text": "{"{{prompt}}"}"</code>，空 Latent 的宽高改成 <code>"{"{{width}}"}"</code>、<code>"{"{{height}}"}"</code>。</li>
            <li>粘贴到上面对应的框里，保存。</li>
          </ol>
          <div className="ph-list">
            {Object.entries(PLACEHOLDERS).map(([k, v]) => (<Fragment key={k}><code>{`{{${k}}}`}</code><span>{v}</span></Fragment>))}
          </div>
        </details>
      </div>

      <div className="card">
        <h2>配音</h2>
        <div className="field-grid">
          <label>配音供应商
            <select value={s.tts.provider} onChange={(e) => set("tts", "provider", e.target.value)}>
              <option value="edge">Edge 在线朗读（免费、免 Key）</option>
              <option value="openai">OpenAI 兼容接口（/audio/speech）</option>
              <option value="mock">演示（静音占位，不联网）</option>
            </select>
          </label>
          <label>语速<input type="number" min={0.5} max={2} step={0.05} value={s.tts.speed} onChange={(e) => set("tts", "speed", Number(e.target.value))} /></label>
          <label>女性角色默认音色<VoicePicker value={s.tts.female_voice} onChange={(v) => set("tts", "female_voice", v)} /></label>
          <label>男性角色默认音色<VoicePicker value={s.tts.male_voice} onChange={(v) => set("tts", "male_voice", v)} /></label>
          <label>旁白音色<VoicePicker value={s.tts.narrator_voice} onChange={(v) => set("tts", "narrator_voice", v)} /></label>
        </div>
        {s.tts.provider === "edge" && (
          <p className="muted small">Edge 朗读是微软浏览器「大声朗读」用的在线服务，不是官方开放接口，偶尔可能连不上；连不上会自动重试。试听前先点下面的「保存设置」。</p>
        )}
        {s.tts.provider === "openai" && (
          <div className="field-grid">
            <label className="span2">接口地址<input value={s.tts.base_url} placeholder="https://api.openai.com/v1 或自己部署的 CosyVoice 等兼容服务" onChange={(e) => set("tts", "base_url", e.target.value)} /></label>
            <label>模型名<input value={s.tts.model} placeholder="tts-1" onChange={(e) => set("tts", "model", e.target.value)} /></label>
            <label>API Key<input type="password" autoComplete="off" value={s.tts.api_key} placeholder="没有可不填" onChange={(e) => set("tts", "api_key", e.target.value)} /></label>
          </div>
        )}
        <p className="muted small">角色在项目页可以单独指定音色；没指定的按外貌描述里的性别用上面的默认音色，旁白用旁白音色。</p>
      </div>

      <div className="card">
        <h2>合成成片</h2>
        <div className="field-grid">
          <label>成片长边（像素）
            <select value={s.compose.long_side} onChange={(e) => set("compose", "long_side", Number(e.target.value))}>
              <option value={1280}>1280（720p）</option>
              <option value={1920}>1920（1080p）</option>
            </select>
          </label>
          <label>帧率<input type="number" min={15} max={60} value={s.compose.fps} onChange={(e) => set("compose", "fps", Number(e.target.value))} /></label>
          <label className="inline"><input type="checkbox" checked={!!s.compose.subtitles} onChange={(e) => set("compose", "subtitles", e.target.checked)} />把台词字幕烧进画面</label>
          <label>字幕字号（占画面短边的比例）<input type="number" min={0.02} max={0.1} step={0.005} value={s.compose.subtitle_size} onChange={(e) => set("compose", "subtitle_size", Number(e.target.value))} /></label>
          <label>AI 标识文字<input value={s.compose.ai_label} placeholder="留空不加" onChange={(e) => set("compose", "ai_label", e.target.value)} /></label>
          <label>AI 标识位置
            <select value={s.compose.ai_label_position} onChange={(e) => set("compose", "ai_label_position", e.target.value)}>
              <option value="top-right">右上</option>
              <option value="top-left">左上</option>
              <option value="bottom-right">右下</option>
              <option value="bottom-left">左下</option>
            </select>
          </label>
          <label>每句台词后停留（秒）<input type="number" min={0} max={3} step={0.1} value={s.compose.tail_padding} onChange={(e) => set("compose", "tail_padding", Number(e.target.value))} /></label>
        </div>
        <p className="muted small">按国内平台规定，AI 生成的视频需要显著标识，建议保留 AI 标识。</p>
      </div>

      <div className="card about">
        <h2>关于</h2>
        <p>OneDragon Studio（AI漫剧一条龙）· MIT 开源许可 · 数据只存在本机 <code>backend/data/</code></p>
        <p className="muted small">没有会员、没有广告。觉得好用的话，欢迎请作者喝杯奶茶，也欢迎提建议。</p>
        <DonateButton />
      </div>

      <div className="actions sticky">
        <button className="primary" onClick={save}>保存设置</button>
        {msg && <span className={msg.includes("失败") ? "error" : "ok"}>{msg}</span>}
      </div>
    </div>
  );
}


const CLOUD_INFO = {
  aliyun: {
    title: "阿里云百炼（通义万相）",
    keyUrl: "https://bailian.console.aliyun.com/",
    keyHint: "百炼控制台 → API Key。注意：Key 和地址要在同一个地域（默认北京）",
    resolutions: ["480P", "720P", "1080P"],
    fields: [
      { key: "image_model", label: "文生图模型", hint: "没有参考图时用" },
      { key: "ref_image_model", label: "参考图生图模型", hint: "镜头首帧带上角色 / 道具 / 场景参考图（1～4 张）" },
      { key: "video_model", label: "图生视频模型", hint: "首帧 → 视频" },
    ],
  },
  volcengine: {
    title: "火山方舟（豆包 Seedream / Seedance）",
    keyUrl: "https://console.volcengine.com/ark",
    keyHint: "方舟控制台 → API Key 管理；模型要先在「开通管理」里开通",
    resolutions: ["480p", "720p", "1080p"],
    fields: [
      { key: "image_model", label: "生图模型", hint: "文生图和参考图生图共用" },
      { key: "video_model", label: "图生视频模型", hint: "首帧 → 视频，模型名也可以填接入点 ID" },
    ],
  },
} as const;

function CloudCard({ provider, s, set, onTest, testing }: {
  provider: "aliyun" | "volcengine";
  s: Settings;
  set: (section: string, field: string, v: unknown) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const info = CLOUD_INFO[provider];
  const c = s[provider];
  return (
    <div className="card">
      <h2>{info.title}</h2>
      <p className="muted small">
        {info.keyHint}。<a href={info.keyUrl} target="_blank" rel="noreferrer">打开控制台</a>
        <br />模型名会随平台更新，填控制台模型列表里的名字即可；视频只生成画面，配音和字幕由这里自己做。
      </p>
      <div className="field-grid">
        <label className="span2">API Key
          <input type="password" autoComplete="off" value={c.api_key} placeholder="在这里填你自己的 Key；只存在本机数据库"
            onChange={(e) => set(provider, "api_key", e.target.value)} />
        </label>
        <label className="span2">接口地址<input value={c.base_url} onChange={(e) => set(provider, "base_url", e.target.value)} /></label>
        {info.fields.map((f) => (
          <label key={f.key}>{f.label} <span className="muted">· {f.hint}</span>
            <input value={c[f.key]} onChange={(e) => set(provider, f.key, e.target.value)} />
          </label>
        ))}
        <label>视频分辨率
          <select value={c.video_resolution} onChange={(e) => set(provider, "video_resolution", e.target.value)}>
            {info.resolutions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>视频时长范围（秒）
          <span className="inline-pair">
            <input type="number" min={1} value={c.video_min_seconds} onChange={(e) => set(provider, "video_min_seconds", Number(e.target.value))} />
            <span>～</span>
            <input type="number" min={1} value={c.video_max_seconds} onChange={(e) => set(provider, "video_max_seconds", Number(e.target.value))} />
          </span>
        </label>
        <label className="inline span2">
          <input type="checkbox" checked={!!c.use_refs} onChange={(e) => set(provider, "use_refs", e.target.checked)} />
          生成镜头首帧时带上角色 / 道具 / 场景参考图（人物更稳定，推荐打开）
        </label>
      </div>
      <p className="muted small">镜头比模型最短时长还短时，会按最短时长生成，合成时再裁到镜头长度。</p>
      <div className="actions">
        <button onClick={onTest} disabled={testing}>{testing ? "测试中…" : "保存并测试 API Key"}</button>
        <span className="muted small">只验证 Key，不生成内容，不花钱</span>
      </div>
    </div>
  );
}
