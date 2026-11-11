import { Fragment, useEffect, useState } from "react";
import { api, Settings } from "../api";
import DonateButton from "../components/DonateButton";
import VoicePicker from "../components/VoicePicker";
import { LLMSettings } from "../components/LLMSettings";
import { t } from "../i18n";

/** 占位符说明：做成函数，界面文字在渲染时按当前语言取。 */
const PLACEHOLDERS = (): Record<string, string> => ({
  prompt: t("正向提示词", "Positive prompt"),
  negative: t("反向提示词", "Negative prompt"),
  seed: t("随机种子（每次不同）", "Random seed (different each time)"),
  width: t("宽（按项目画面比例和上面的长边自动算）", "Width (auto from the project aspect ratio and the long side above)"),
  height: t("高", "Height"),
  image: t("首帧图（图生视频用，自动上传到 ComfyUI）", "First frame (for image-to-video, auto-uploaded to ComfyUI)"),
  ref_image_1: t("参考图 1（自动上传；不够 3 张时重复前面的）", "Reference image 1 (auto-uploaded; repeats earlier ones if fewer than 3)"),
  ref_image_2: t("参考图 2", "Reference image 2"),
  ref_image_3: t("参考图 3", "Reference image 3"),
  frames: t("帧数（时长 × 帧率，取 4n+1）", "Frame count (duration × fps, rounded to 4n+1)"),
  fps: t("帧率", "Frame rate"),
  duration: t("时长（秒）", "Duration (seconds)"),
  filename_prefix: t("输出文件名前缀", "Output filename prefix"),
});

function checkWorkflow(text: string, required: string[]): { ok: boolean; msg: string } {
  if (!text.trim()) return { ok: true, msg: "" };
  let wf: any;
  try {
    wf = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, msg: t("不是合法的 JSON：", "Invalid JSON: ") + e.message };
  }
  if (wf && wf.nodes && wf.links) return { ok: false, msg: t("这是普通保存格式，请在 ComfyUI 里用「导出 (API)」重新导出", "This is the regular save format; re-export it in ComfyUI with Export (API)") };
  if (!wf || typeof wf !== "object" || !Object.values(wf).every((n: any) => n && n.class_type))
    return { ok: false, msg: t("看不出是 API 格式的工作流", "This does not look like an API-format workflow") };
  const found = new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
  const known = PLACEHOLDERS();
  const sep = t("、", ", ");
  const unknown = [...found].filter((k) => !(k in known));
  if (unknown.length) return { ok: false, msg: t("不认识的占位符：", "Unknown placeholders: ") + unknown.join(sep) };
  const missing = required.filter((k) => !found.has(k));
  const nodes = Object.keys(wf).length;
  if (missing.length) return { ok: false, msg: t("{n} 个节点；还缺占位符：", "{n} nodes; missing placeholders: ", { n: nodes }) + missing.map((k) => `{{${k}}}`).join(sep) };
  return { ok: true, msg: t("{n} 个节点；用到 ", "{n} nodes; uses ", { n: nodes }) + [...found].map((k) => `{{${k}}}`).join(" ") };
}

function WorkflowField(props: { title: string; hint: string; required: string[]; value: string; onChange: (v: string) => void }) {
  const check = checkWorkflow(props.value || "", props.required);
  return (
    <label className="block">
      <span className="label-row">
        <span>{props.title} <span className="muted">· {props.hint}</span></span>
        <span className="file-btn">
          {t("导入 JSON", "Import JSON")}
          <input type="file" accept=".json,application/json" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) f.text().then(props.onChange);
          }} />
        </span>
      </span>
      <textarea className="code" rows={props.value ? 6 : 2} value={props.value || ""} spellCheck={false}
        placeholder={t("粘贴 ComfyUI「导出 (API)」得到的 JSON", "Paste the JSON from ComfyUI Export (API)")} onChange={(e) => props.onChange(e.target.value)} />
      {check.msg && <span className={`wf-status ${check.ok ? "ok" : "error"}`}>{check.msg}</span>}
    </label>
  );
}


export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedVendor, setSavedVendor] = useState("");

  useEffect(() => {
    api.settings().then((v) => { setS(v); setSavedVendor(v.llm?.vendor ?? ""); }).catch((e) => setMsg(e.message));
  }, []);
  if (!s) return <div className="page muted">{msg || t("加载中…", "Loading…")}</div>;

  const set = (section: string, field: string, v: unknown) => setS({ ...s, [section]: { ...s[section], [field]: v } });

  async function save() {
    setMsg("");
    setMsgErr(false);
    try {
      const saved = await api.saveSettings(s!);
      setS(saved);
      setSavedVendor(saved.llm.vendor);
      setMsg(t("已保存", "Saved"));
    } catch (e: any) {
      setMsgErr(true);
      setMsg(t("保存失败：", "Save failed: ") + e.message);
    }
  }

  async function testComfy() {
    setTesting(true);
    setMsg("");
    setMsgErr(false);
    try {
      await api.saveSettings(s!);
      setSavedVendor(s!.llm.vendor);
      const r = await api.testComfyUI();
      setMsg(t("ComfyUI 连接成功：", "ComfyUI connected: ") + (r.version ? "v" + r.version + t("，", ", ") : "") + (r.device || t("未知设备", "unknown device")) + (r.vram_gb ? t("，显存 {n} GB", ", VRAM {n} GB", { n: r.vram_gb }) : ""));
    } catch (e: any) {
      setMsgErr(true);
      setMsg(t("ComfyUI 连接失败：", "ComfyUI connection failed: ") + e.message);
    } finally {
      setTesting(false);
    }
  }

  async function testCloud(provider: "aliyun" | "volcengine") {
    setTesting(true);
    setMsg("");
    setMsgErr(false);
    try {
      await api.saveSettings(s!);
      setSavedVendor(s!.llm.vendor);
      setMsg((await api.testCloud(provider)).message);
    } catch (e: any) {
      setMsgErr(true);
      setMsg(t("连接失败：", "Connection failed: ") + e.message);
    } finally {
      setTesting(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg("");
    setMsgErr(false);
    try {
      await api.saveSettings(s!);
      setSavedVendor(s!.llm.vendor);
      const r = await api.testLLM();
      setMsg(t("连接成功，模型回复：", "Connected. Model replied: ") + r.reply);
    } catch (e: any) {
      setMsgErr(true);
      setMsg(t("连接失败：", "Connection failed: ") + e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="page">
      <h1>{t("系统设置", "Settings")}</h1>
      <p className="muted">{t("文本大模型、生图生视频（ComfyUI）、配音和合成成片的设置。", "Settings for the text LLM, image and video generation (ComfyUI), voice-over, and final video composition.")}</p>

      <LLMSettings s={s} setS={setS} onTest={test} testing={testing} savedVendor={savedVendor} />

      <div className="card">
        <h2>{t("生图 / 生视频", "Image / Video Generation")}</h2>
        <p className="muted small">
          {t("没有显卡时：先用「演示」把流程走通，再选阿里云百炼或火山方舟出真画面（不用 GPU，填 API Key 即可，按张 / 按秒付费，价格以平台为准）。", "No GPU? Run through the flow with Demo first, then switch to Alibaba Cloud Model Studio or Volcano Engine Ark for real output (no GPU needed, just an API key; billed per image / per second at the platform's prices).")}
          {t("租到 GPU、装好 ComfyUI 后也可以切过去。生图和生视频可以选不同的平台，已有的项目不用改。", " Once you have a GPU with ComfyUI installed, you can switch to it. Image and video generation can use different platforms, and existing projects need no changes.")}
        </p>
        <div className="field-grid">
          <label>{t("生图供应商", "Image generation provider")}
            <select value={s.image_provider} onChange={(e) => setS({ ...s, image_provider: e.target.value })}>
              <option value="mock">{t("演示（占位图，不调用模型）", "Demo (placeholder images, no model calls)")}</option>
              <option value="aliyun">{t("阿里云百炼（通义万相，按张计费）", "Alibaba Cloud Model Studio (Wan, billed per image)")}</option>
              <option value="volcengine">{t("火山方舟（豆包 Seedream，按张计费）", "Volcano Engine Ark (Doubao Seedream, billed per image)")}</option>
              <option value="comfyui">{t("ComfyUI（自己的 GPU）", "ComfyUI (your own GPU)")}</option>
            </select>
          </label>
          <label>{t("生视频供应商", "Video generation provider")}
            <select value={s.video_provider} onChange={(e) => setS({ ...s, video_provider: e.target.value })}>
              <option value="mock">{t("演示（首帧缓慢推近，不调用模型）", "Demo (slow zoom on the first frame, no model calls)")}</option>
              <option value="aliyun">{t("阿里云百炼（通义万相，按秒计费）", "Alibaba Cloud Model Studio (Wan, billed per second)")}</option>
              <option value="volcengine">{t("火山方舟（豆包 Seedance，按秒计费）", "Volcano Engine Ark (Doubao Seedance, billed per second)")}</option>
              <option value="comfyui">{t("ComfyUI（自己的 GPU）", "ComfyUI (your own GPU)")}</option>
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
          <label className="span2">{t("地址", "Address")}<input value={s.comfyui.base_url} onChange={(e) => set("comfyui", "base_url", e.target.value)} placeholder={t("http://127.0.0.1:8188 或租用 GPU 服务器的地址", "http://127.0.0.1:8188 or the address of a rented GPU server")} /></label>
          <label>{t("图片长边（像素）", "Image long side (px)")}<input type="number" step={64} value={s.comfyui.image_long_side} onChange={(e) => set("comfyui", "image_long_side", Number(e.target.value))} /></label>
          <label>{t("视频长边（像素）", "Video long side (px)")}<input type="number" step={16} value={s.comfyui.video_long_side} onChange={(e) => set("comfyui", "video_long_side", Number(e.target.value))} /></label>
          <label>{t("视频帧率", "Video frame rate")}<input type="number" min={8} max={60} value={s.comfyui.fps} onChange={(e) => set("comfyui", "fps", Number(e.target.value))} /></label>
          <label>{t("单个任务超时（秒）", "Per-task timeout (seconds)")}<input type="number" min={60} step={60} value={s.comfyui.timeout_sec} onChange={(e) => set("comfyui", "timeout_sec", Number(e.target.value))} /></label>
          <label className="span2">{t("反向提示词（云端平台也会用）", "Negative prompt (also used by cloud platforms)")}<input value={s.comfyui.negative_prompt} onChange={(e) => set("comfyui", "negative_prompt", e.target.value)} /></label>
        </div>
        <div className="actions">
          <button onClick={testComfy} disabled={testing}>{testing ? t("测试中…", "Testing…") : t("保存并测试连接", "Save and Test Connection")}</button>
        </div>

        <WorkflowField title={t("文生图工作流", "Text-to-image workflow")} required={["prompt"]} hint={t("角色/场景参考图，以及没有参考图时的镜头首帧", "Character/scene reference images, and shot first frames when there is no reference image")}
          value={s.comfyui.image_workflow} onChange={(v) => set("comfyui", "image_workflow", v)} />
        <WorkflowField title={t("参考图生图工作流（可选）", "Reference-image workflow (optional)")} required={["prompt", "ref_image_1"]} hint={t("镜头首帧带上出镜角色和场景的参考图，人物更稳定；不填就用文生图", "Shot first frames use reference images of the characters and scene for more consistent characters; falls back to text-to-image if empty")}
          value={s.comfyui.ref_image_workflow} onChange={(v) => set("comfyui", "ref_image_workflow", v)} />
        <WorkflowField title={t("图生视频工作流", "Image-to-video workflow")} required={["image", "prompt"]} hint={t("用镜头首帧 + 视频提示词生成这一镜的视频", "Generates the shot video from its first frame + video prompt")}
          value={s.comfyui.video_workflow} onChange={(v) => set("comfyui", "video_workflow", v)} />

        <details>
          <summary className="muted small">{t("怎么准备工作流？", "How do I prepare a workflow?")}</summary>
          <ol className="small">
            <li>{t("在 ComfyUI 里搭好一个能出图（或出视频）的工作流，先手动跑通。", "Build a workflow in ComfyUI that produces an image (or video), and run it manually first.")}</li>
            <li>{t("菜单里选「导出 (API)」/ Export (API)，得到一个 JSON 文件。", "Choose Export (API) from the menu to get a JSON file.")}</li>
            <li>{t("用记事本打开，把每次要变的输入值改成下面的占位符，比如正向提示词节点的 ", "Open it in a text editor and replace the inputs that change each run with the placeholders below, e.g. change the positive prompt node's ")}<code>"text": "..."</code>{t(" 改成 ", " to ")}<code>"text": "{"{{prompt}}"}"</code>{t("，空 Latent 的宽高改成 ", ", and the Empty Latent width/height to ")}<code>"{"{{width}}"}"</code>{t("、", " / ")}<code>"{"{{height}}"}"</code>{t("。", ".")}</li>
            <li>{t("粘贴到上面对应的框里，保存。", "Paste it into the matching box above and save.")}</li>
          </ol>
          <div className="ph-list">
            {Object.entries(PLACEHOLDERS()).map(([k, v]) => (<Fragment key={k}><code>{`{{${k}}}`}</code><span>{v}</span></Fragment>))}
          </div>
        </details>
      </div>

      <div className="card">
        <h2>{t("配音", "Voice-over")}</h2>
        <div className="field-grid">
          <label>{t("配音供应商", "Voice-over provider")}
            <select value={s.tts.provider} onChange={(e) => set("tts", "provider", e.target.value)}>
              <option value="edge">{t("Edge 在线朗读（免费、免 Key）", "Edge online TTS (free, no key)")}</option>
              <option value="openai">{t("OpenAI 兼容接口（/audio/speech）", "OpenAI-compatible API (/audio/speech)")}</option>
              <option value="mock">{t("演示（静音占位，不联网）", "Demo (silent placeholder, offline)")}</option>
            </select>
          </label>
          <label>{t("语速", "Speed")}<input type="number" min={0.5} max={2} step={0.05} value={s.tts.speed} onChange={(e) => set("tts", "speed", Number(e.target.value))} /></label>
          <label>{t("女性角色默认音色", "Default voice for female characters")}<VoicePicker value={s.tts.female_voice} onChange={(v) => set("tts", "female_voice", v)} /></label>
          <label>{t("男性角色默认音色", "Default voice for male characters")}<VoicePicker value={s.tts.male_voice} onChange={(v) => set("tts", "male_voice", v)} /></label>
          <label>{t("旁白音色", "Narrator voice")}<VoicePicker value={s.tts.narrator_voice} onChange={(v) => set("tts", "narrator_voice", v)} /></label>
        </div>
        {s.tts.provider === "edge" && (
          <p className="muted small">{t("Edge 朗读是微软浏览器「大声朗读」用的在线服务，不是官方开放接口，偶尔可能连不上；连不上会自动重试。试听前先点下面的「保存设置」。", "Edge TTS is the online service behind Microsoft Edge's Read Aloud. It is not an official public API and may occasionally fail to connect; it retries automatically. Click Save Settings below before previewing.")}</p>
        )}
        {s.tts.provider === "openai" && (
          <div className="field-grid">
            <label className="span2">{t("接口地址", "Endpoint URL")}<input value={s.tts.base_url} placeholder={t("https://api.openai.com/v1 或自己部署的 CosyVoice 等兼容服务", "https://api.openai.com/v1 or a self-hosted compatible service such as CosyVoice")} onChange={(e) => set("tts", "base_url", e.target.value)} /></label>
            <label>{t("模型名", "Model name")}<input value={s.tts.model} placeholder="tts-1" onChange={(e) => set("tts", "model", e.target.value)} /></label>
            <label>API Key<input type="password" autoComplete="off" value={s.tts.api_key} placeholder={t("没有可不填", "Optional")} onChange={(e) => set("tts", "api_key", e.target.value)} /></label>
          </div>
        )}
        <p className="muted small">{t("角色在项目页可以单独指定音色；没指定的按外貌描述里的性别用上面的默认音色，旁白用旁白音色。", "Characters can have their own voice set on the project page; otherwise the default voice above is used based on the gender in their appearance description. Narration uses the narrator voice.")}</p>
      </div>

      <div className="card">
        <h2>{t("合成成片", "Compose Final Video")}</h2>
        <div className="field-grid">
          <label>{t("成片长边（像素）", "Final video long side (px)")}
            <select value={s.compose.long_side} onChange={(e) => set("compose", "long_side", Number(e.target.value))}>
              <option value={1280}>{t("1280（720p）", "1280 (720p)")}</option>
              <option value={1920}>{t("1920（1080p）", "1920 (1080p)")}</option>
            </select>
          </label>
          <label>{t("帧率", "Frame rate")}<input type="number" min={15} max={60} value={s.compose.fps} onChange={(e) => set("compose", "fps", Number(e.target.value))} /></label>
          <label className="inline"><input type="checkbox" checked={!!s.compose.subtitles} onChange={(e) => set("compose", "subtitles", e.target.checked)} />{t("把台词字幕烧进画面", "Burn dialogue subtitles into the video")}</label>
          <label>{t("字幕字号（占画面短边的比例）", "Subtitle size (fraction of the short side)")}<input type="number" min={0.02} max={0.1} step={0.005} value={s.compose.subtitle_size} onChange={(e) => set("compose", "subtitle_size", Number(e.target.value))} /></label>
          <label>{t("AI 标识文字", "AI label text")}<input value={s.compose.ai_label} placeholder={t("留空不加", "Leave empty for none")} onChange={(e) => set("compose", "ai_label", e.target.value)} /></label>
          <label>{t("AI 标识位置", "AI label position")}
            <select value={s.compose.ai_label_position} onChange={(e) => set("compose", "ai_label_position", e.target.value)}>
              <option value="top-right">{t("右上", "Top right")}</option>
              <option value="top-left">{t("左上", "Top left")}</option>
              <option value="bottom-right">{t("右下", "Bottom right")}</option>
              <option value="bottom-left">{t("左下", "Bottom left")}</option>
            </select>
          </label>
          <label>{t("每句台词后停留（秒）", "Pause after each line (seconds)")}<input type="number" min={0} max={3} step={0.1} value={s.compose.tail_padding} onChange={(e) => set("compose", "tail_padding", Number(e.target.value))} /></label>
        </div>
        <p className="muted small">{t("按国内平台规定，AI 生成的视频需要显著标识，建议保留 AI 标识。", "Chinese platform rules require AI-generated videos to be clearly labeled; keeping the AI label is recommended.")}</p>
      </div>

      <div className="card about">
        <h2>{t("关于", "About")} <small className="muted">v{__APP_VERSION__}</small></h2>
        <p>{t("OneDragon Studio（AI漫剧一条龙）· MIT 开源许可 · 数据只存在本机 ", "OneDragon Studio · MIT License · Data is stored only on this machine in ")}<code>backend/data/</code></p>
        <p className="muted small">{t("没有会员、没有广告。觉得好用的话，欢迎请作者喝杯奶茶，也欢迎提建议。", "No subscriptions, no ads. If you find it useful, feel free to buy the author a milk tea, and suggestions are always welcome.")}</p>
        <DonateButton />
      </div>

      <div className="actions sticky">
        <button className="primary" onClick={save}>{t("保存设置", "Save Settings")}</button>
        {msg && <span className={msgErr ? "error" : "ok"}>{msg}</span>}
      </div>
    </div>
  );
}


/** 云端平台信息：做成函数，界面文字在渲染时按当前语言取。 */
const CLOUD_INFO = () => ({
  aliyun: {
    title: t("阿里云百炼（通义万相）", "Alibaba Cloud Model Studio (Wan)"),
    keyUrl: "https://bailian.console.aliyun.com/",
    keyHint: t("百炼控制台 → API Key。注意：Key 和地址要在同一个地域（默认北京）", "Model Studio console → API Key. Note: the key and endpoint must be in the same region (Beijing by default)"),
    resolutions: ["480P", "720P", "1080P"],
    fields: [
      { key: "image_model", label: t("文生图模型", "Text-to-image model"), hint: t("没有参考图时用", "Used when there is no reference image") },
      { key: "ref_image_model", label: t("参考图生图模型", "Reference-image model"), hint: t("镜头首帧带上角色 / 道具 / 场景参考图（1～4 张）", "Shot first frames with character / prop / scene reference images (1–4)") },
      { key: "video_model", label: t("图生视频模型", "Image-to-video model"), hint: t("首帧 → 视频", "First frame → video") },
    ],
  },
  volcengine: {
    title: t("火山方舟（豆包 Seedream / Seedance）", "Volcano Engine Ark (Doubao Seedream / Seedance)"),
    keyUrl: "https://console.volcengine.com/ark",
    keyHint: t("方舟控制台 → API Key 管理；模型要先在「开通管理」里开通", "Ark console → API Key management; activate models first under Activation Management"),
    resolutions: ["480p", "720p", "1080p"],
    fields: [
      { key: "image_model", label: t("生图模型", "Image generation model"), hint: t("文生图和参考图生图共用", "Shared by text-to-image and reference-image generation") },
      { key: "video_model", label: t("图生视频模型", "Image-to-video model"), hint: t("首帧 → 视频，模型名也可以填接入点 ID", "First frame → video; the model can also be an endpoint ID") },
    ],
  },
} as const);

function CloudCard({ provider, s, set, onTest, testing }: {
  provider: "aliyun" | "volcengine";
  s: Settings;
  set: (section: string, field: string, v: unknown) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const info = CLOUD_INFO()[provider];
  const c = s[provider];
  return (
    <div className="card">
      <h2>{info.title}</h2>
      <p className="muted small">
        {info.keyHint}{t("。", ". ")}<a href={info.keyUrl} target="_blank" rel="noreferrer">{t("打开控制台", "Open console")}</a>
        <br />{t("模型名会随平台更新，填控制台模型列表里的名字即可；视频只生成画面，配音和字幕由这里自己做。", "Model names change as the platform updates; use a name from the console's model list. The platform only generates visuals; voice-over and subtitles are done here.")}
      </p>
      <div className="field-grid">
        <label className="span2">API Key
          <input type="password" autoComplete="off" value={c.api_key} placeholder={t("在这里填你自己的 Key；只存在本机数据库", "Enter your own key; stored only in the local database")}
            onChange={(e) => set(provider, "api_key", e.target.value)} />
        </label>
        <label className="span2">{t("接口地址", "Endpoint URL")}<input value={c.base_url} onChange={(e) => set(provider, "base_url", e.target.value)} /></label>
        {info.fields.map((f) => (
          <label key={f.key}>{f.label} <span className="muted">· {f.hint}</span>
            <input value={c[f.key]} onChange={(e) => set(provider, f.key, e.target.value)} />
          </label>
        ))}
        <label>{t("视频分辨率", "Video resolution")}
          <select value={c.video_resolution} onChange={(e) => set(provider, "video_resolution", e.target.value)}>
            {info.resolutions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>{t("视频时长范围（秒）", "Video duration range (seconds)")}
          <span className="inline-pair">
            <input type="number" min={1} value={c.video_min_seconds} onChange={(e) => set(provider, "video_min_seconds", Number(e.target.value))} />
            <span>{t("～", "–")}</span>
            <input type="number" min={1} value={c.video_max_seconds} onChange={(e) => set(provider, "video_max_seconds", Number(e.target.value))} />
          </span>
        </label>
        <label className="inline span2">
          <input type="checkbox" checked={!!c.use_refs} onChange={(e) => set(provider, "use_refs", e.target.checked)} />
          {t("生成镜头首帧时带上角色 / 道具 / 场景参考图（人物更稳定，推荐打开）", "Use character / prop / scene reference images for shot first frames (more consistent characters; recommended)")}
        </label>
      </div>
      <p className="muted small">{t("镜头比模型最短时长还短时，会按最短时长生成，合成时再裁到镜头长度。", "If a shot is shorter than the model's minimum duration, the minimum is generated and trimmed to the shot length when composing.")}</p>
      <div className="actions">
        <button onClick={onTest} disabled={testing}>{testing ? t("测试中…", "Testing…") : t("保存并测试 API Key", "Save and Test API Key")}</button>
        <span className="muted small">{t("只验证 Key，不生成内容，不花钱", "Only verifies the key; generates nothing and costs nothing")}</span>
      </div>
    </div>
  );
}
