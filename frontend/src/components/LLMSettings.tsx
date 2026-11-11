import { useState } from "react";
import { api, Settings } from "../api";

type Protocol = "openai" | "anthropic" | "azure";

interface Vendor {
  key: string;
  name: string;
  hint: string;
  color: string;
  protocol: Protocol;
  base_url: string;
  model: string;
  models: string[];        // 常用模型（下拉提示）；最新的可以点「获取模型列表」
  keyUrl?: string;
  overseas?: boolean;      // 国内一般要走代理
  noKey?: boolean;
}

/** 厂商预设：只决定接口地址、协议和默认模型；模型名随时可以改，也可以从接口拉取最新列表。 */
export const VENDORS: Vendor[] = [
  { key: "deepseek", name: "DeepSeek", hint: "国内直连，便宜好用", color: "#4d6bfe", protocol: "openai",
    base_url: "https://api.deepseek.com", model: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"],
    keyUrl: "https://platform.deepseek.com/api_keys" },
  { key: "openai", name: "OpenAI", hint: "GPT 系列", color: "#10a37f", protocol: "openai",
    base_url: "https://api.openai.com/v1", model: "", models: [],
    keyUrl: "https://platform.openai.com/api-keys", overseas: true },
  { key: "gemini", name: "Google Gemini", hint: "OpenAI 兼容接口", color: "#4285f4", protocol: "openai",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", models: ["gemini-3.8-flash"],
    keyUrl: "https://aistudio.google.com/apikey", overseas: true },
  { key: "anthropic", name: "Anthropic Claude", hint: "官方 SDK", color: "#d97757", protocol: "anthropic",
    base_url: "https://api.anthropic.com", model: "claude-opus-5-5", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys", overseas: true },
  { key: "azure", name: "Azure OpenAI", hint: "模型名填部署名", color: "#0078d4", protocol: "azure",
    base_url: "https://你的资源名.openai.azure.com/openai/v1", model: "", models: [],
    keyUrl: "https://portal.azure.com/", overseas: true },
  { key: "openrouter", name: "OpenRouter", hint: "一个 Key 用遍海外模型", color: "#6467f2", protocol: "openai",
    base_url: "https://openrouter.ai/api/v1", model: "", models: [],
    keyUrl: "https://openrouter.ai/keys", overseas: true },
  { key: "aliyun", name: "阿里云百炼", hint: "通义千问", color: "#ff6a00", protocol: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    keyUrl: "https://bailian.console.aliyun.com/" },
  { key: "volcengine", name: "火山方舟", hint: "豆包，模型名可填接入点", color: "#3370ff", protocol: "openai",
    base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "", models: [],
    keyUrl: "https://console.volcengine.com/ark" },
  { key: "ollama", name: "Ollama", hint: "本机模型，不用 Key", color: "#555555", protocol: "openai",
    base_url: "http://127.0.0.1:11434/v1", model: "qwen3:8b", models: ["qwen3:8b"], noKey: true },
  { key: "custom", name: "自定义 API", hint: "任意 OpenAI 兼容接口 / 中转", color: "#7a746b", protocol: "openai",
    base_url: "", model: "", models: [] },
];

export function LLMSettings({ s, setS, onTest, testing, savedVendor }: {
  s: Settings;
  setS: (s: Settings) => void;
  onTest: () => void;
  testing: boolean;
  savedVendor: string; // 数据库里当前保存的厂商：切回它时 Key 保持不变
}) {
  const llm = s.llm;
  const vendor = VENDORS.find((v) => v.key === llm.vendor) ?? VENDORS[VENDORS.length - 1];
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetchMsg, setFetchMsg] = useState("");
  const [fetching, setFetching] = useState(false);
  const set = (b: Record<string, unknown>) => setS({ ...s, llm: { ...llm, ...b } });

  function pick(v: Vendor) {
    if (v.key === llm.vendor) return;
    setFetched([]);
    setFetchMsg("");
    set({
      vendor: v.key,
      provider: v.protocol,
      base_url: v.key === "custom" ? llm.base_url : v.base_url,
      model: v.key === "custom" ? llm.model : v.model,
      // 换了厂商，原来的 Key 就不能用了；切回已保存的厂商时保留原 Key（"********" 表示不改）
      api_key: v.key === savedVendor ? "********" : "",
    });
  }

  async function fetchModels() {
    setFetching(true);
    setFetchMsg("");
    try {
      await api.saveSettings(s);
      const { models } = await api.llmModels();
      setFetched(models);
      setFetchMsg(models.length ? `获取到 ${models.length} 个模型，在「模型」输入框里下拉选择` : "接口没有返回模型");
    } catch (e: any) {
      setFetchMsg("获取失败：" + e.message);
    } finally {
      setFetching(false);
    }
  }

  const suggestions = Array.from(new Set([...vendor.models, ...fetched]));
  return (
    <div className="card">
      <h2>文本大模型 <small className="muted">用于 AI 拆分镜、AI 分集</small></h2>
      <p className="muted small">选择厂商</p>
      <div className="vendor-grid">
        {VENDORS.map((v) => (
          <button key={v.key} type="button" className={`vendor ${v.key === vendor.key ? "on" : ""}`} onClick={() => pick(v)}>
            <span className="vendor-badge" style={{ background: v.color }}>{v.name.replace(/^(Google|Anthropic|Azure) /, "").slice(0, 1)}</span>
            <span className="vendor-text">
              <b>{v.name}</b>
              <small>{v.hint}{v.overseas ? " · 海外" : ""}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="field-grid">
        <label className="span2">接口地址
          <input value={llm.base_url} placeholder={vendor.key === "custom" ? "OpenAI 兼容接口，例如 https://xxx.com/v1" : ""}
            onChange={(e) => set({ base_url: e.target.value })} />
        </label>
        <label>模型{vendor.protocol === "azure" && <span className="muted"> · 填 Azure 里的部署名</span>}
          <input list="llm-models" value={llm.model} placeholder="输入或下拉选择；点右边按钮获取最新列表"
            onChange={(e) => set({ model: e.target.value })} />
          <datalist id="llm-models">{suggestions.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        {vendor.protocol !== "anthropic" ? (
          <label>温度<input type="number" step={0.1} min={0} max={2} value={llm.temperature ?? ""}
            onChange={(e) => set({ temperature: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        ) : <span />}
        {!vendor.noKey && (
          <label className="span2">API Key
            {vendor.keyUrl && <a className="small key-link" href={vendor.keyUrl} target="_blank" rel="noreferrer">去 {vendor.name} 获取 Key</a>}
            <input type="password" autoComplete="off" value={llm.api_key} placeholder="在这里填你自己的 Key；只存在本机数据库"
              onChange={(e) => set({ api_key: e.target.value })} />
          </label>
        )}
        <label className="span2">代理 <span className="muted">· 国内访问海外接口（OpenAI、Gemini、Claude 等）一般要填，例如 http://127.0.0.1:10809；留空不走代理</span>
          <input value={llm.proxy ?? ""} placeholder={vendor.overseas ? "http://127.0.0.1:10809" : "国内接口一般不用填"}
            onChange={(e) => set({ proxy: e.target.value })} />
        </label>
      </div>
      {vendor.protocol === "anthropic" && (
        <p className="muted small">Claude 走官方 SDK。使用官方地址时会开启服务端兜底：请求被安全策略拒绝时，自动换 Anthropic 推荐的模型重跑一次。</p>
      )}
      <div className="actions">
        <button onClick={onTest} disabled={testing}>{testing ? "测试中…" : "保存并测试连接"}</button>
        <button onClick={fetchModels} disabled={fetching}>{fetching ? "获取中…" : "获取模型列表"}</button>
        {fetchMsg && <span className={`small ${fetchMsg.startsWith("获取失败") ? "error" : "muted"}`}>{fetchMsg}</span>}
      </div>
    </div>
  );
}
