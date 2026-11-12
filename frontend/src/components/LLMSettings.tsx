import { useState } from "react";
import { api, Settings } from "../api";
import { t } from "../i18n";
import ReferralLink from "./ReferralLink";
import ModelCombo from "./ModelCombo";

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

/** 厂商预设：只决定接口地址、协议和默认模型；模型名随时可以改，也可以从接口拉取最新列表。
 *  做成函数：界面文字要在渲染时按当前语言取。 */
export const VENDORS = (): Vendor[] => [
  { key: "deepseek", name: "DeepSeek", hint: t("国内直连，便宜好用", "Direct in China, cheap and capable"), color: "#4d6bfe", protocol: "openai",
    base_url: "https://api.deepseek.com", model: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"],
    keyUrl: "https://platform.deepseek.com/api_keys" },
  { key: "openai", name: "OpenAI", hint: t("GPT 系列", "GPT models"), color: "#10a37f", protocol: "openai",
    base_url: "https://api.openai.com/v1", model: "", models: [],
    keyUrl: "https://platform.openai.com/api-keys", overseas: true },
  { key: "gemini", name: "Google Gemini", hint: t("OpenAI 兼容接口", "OpenAI-compatible API"), color: "#4285f4", protocol: "openai",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.8-flash", models: ["gemini-3.8-flash"],
    keyUrl: "https://aistudio.google.com/apikey", overseas: true },
  { key: "anthropic", name: "Anthropic Claude", hint: t("官方 SDK", "Official SDK"), color: "#d97757", protocol: "anthropic",
    base_url: "https://api.anthropic.com", model: "claude-opus-5-5", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys", overseas: true },
  { key: "azure", name: "Azure OpenAI", hint: t("模型名填部署名", "Use the deployment name as model"), color: "#0078d4", protocol: "azure",
    base_url: t("https://你的资源名.openai.azure.com/openai/v1", "https://your-resource.openai.azure.com/openai/v1"), model: "", models: [],
    keyUrl: "https://portal.azure.com/", overseas: true },
  { key: "openrouter", name: "OpenRouter", hint: t("一个 Key 用遍海外模型", "One key for many overseas models"), color: "#6467f2", protocol: "openai",
    base_url: "https://openrouter.ai/api/v1", model: "", models: [],
    keyUrl: "https://openrouter.ai/keys", overseas: true },
  { key: "aliyun", name: t("阿里云百炼", "Alibaba Cloud Model Studio"), hint: t("通义千问", "Qwen"), color: "#ff6a00", protocol: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", models: ["qwen-plus", "qwen-max", "qwen-turbo"],
    keyUrl: "https://bailian.console.aliyun.com/" },
  { key: "volcengine", name: t("火山方舟", "Volcano Engine Ark"), hint: t("豆包，模型名可填接入点", "Doubao; model can be an endpoint ID"), color: "#3370ff", protocol: "openai",
    base_url: "https://ark.cn-beijing.volces.com/api/v3", model: "", models: [],
    keyUrl: "https://console.volcengine.com/ark" },
  { key: "siliconflow", name: t("硅基流动", "SiliconFlow"), hint: t("一个 Key 用 DeepSeek、Qwen 等开源模型", "One key for DeepSeek, Qwen and other open models"), color: "#7c3aed", protocol: "openai",
    base_url: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3", models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"],
    keyUrl: "https://cloud.siliconflow.cn/account/ak" },
  { key: "ollama", name: "Ollama", hint: t("本机模型，不用 Key", "Local models, no key needed"), color: "#555555", protocol: "openai",
    base_url: "http://127.0.0.1:11434/v1", model: "qwen3:8b", models: ["qwen3:8b"], noKey: true },
  { key: "custom", name: t("自定义 API", "Custom API"), hint: t("任意 OpenAI 兼容接口 / 中转", "Any OpenAI-compatible API or relay"), color: "#7a746b", protocol: "openai",
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
  const vendors = VENDORS();
  const vendor = vendors.find((v) => v.key === llm.vendor) ?? vendors[vendors.length - 1];
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetchMsg, setFetchMsg] = useState("");
  const [fetchErr, setFetchErr] = useState(false);
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
    setFetchErr(false);
    try {
      await api.saveSettings(s);
      const { models } = await api.llmModels();
      setFetched(models);
      setFetchMsg(models.length
        ? t("获取到 {n} 个模型，在「模型」输入框里下拉选择", "Fetched {n} models; pick one from the Model dropdown", { n: models.length })
        : t("接口没有返回模型", "The API returned no models"));
    } catch (e: any) {
      setFetchErr(true);
      setFetchMsg(t("获取失败：", "Fetch failed: ") + e.message);
    } finally {
      setFetching(false);
    }
  }

  const suggestions = Array.from(new Set([...vendor.models, ...fetched]));
  return (
    <div className="card">
      <h2>{t("文本大模型", "Text LLM")} <small className="muted">{t("用于 AI 拆分镜、AI 分集", "Used for AI Storyboard and AI episode splitting")}</small></h2>
      <p className="muted small">{t("选择厂商", "Choose a vendor")}</p>
      <div className="vendor-grid">
        {vendors.map((v) => (
          <button key={v.key} type="button" className={`vendor ${v.key === vendor.key ? "on" : ""}`} onClick={() => pick(v)}>
            <span className="vendor-badge" style={{ background: v.color }}>{v.name.replace(/^(Google|Anthropic|Azure) /, "").slice(0, 1)}</span>
            <span className="vendor-text">
              <b>{v.name}</b>
              <small>{v.hint}{v.overseas ? t(" · 海外", " · Overseas") : ""}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="field-grid">
        <label className="span2">{t("接口地址", "Endpoint URL")}
          <input value={llm.base_url} placeholder={vendor.key === "custom" ? t("OpenAI 兼容接口，例如 https://xxx.com/v1", "OpenAI-compatible API, e.g. https://xxx.com/v1") : ""}
            onChange={(e) => set({ base_url: e.target.value })} />
        </label>
        <label>{t("模型", "Model")}{vendor.protocol === "azure" && <span className="muted">{t(" · 填 Azure 里的部署名", " · Use your Azure deployment name")}</span>}
          <ModelCombo value={llm.model} options={suggestions} onChange={(model) => set({ model })}
            placeholder={t("输入或下拉选择；点下面按钮获取最新列表", "Type or pick from the list; use Fetch Model List for the latest")} />
        </label>
        {vendor.protocol !== "anthropic" ? (
          <label>{t("温度", "Temperature")}<input type="number" step={0.1} min={0} max={2} value={llm.temperature ?? ""}
            onChange={(e) => set({ temperature: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        ) : <span />}
        {!vendor.noKey && (
          <label className="span2">API Key
            {vendor.keyUrl && <a className="small key-link" href={vendor.keyUrl} target="_blank" rel="noreferrer">{t("去 {name} 获取 Key", "Get a key from {name}", { name: vendor.name })}</a>}
            <ReferralLink vendor={vendor.key} name={vendor.name} />
            <input type="password" autoComplete="off" value={llm.api_key} placeholder={t("在这里填你自己的 Key；只存在本机数据库", "Enter your own key; stored only in the local database")}
              onChange={(e) => set({ api_key: e.target.value })} />
          </label>
        )}
        <label className="span2">{t("代理", "Proxy")} <span className="muted">{t("· 国内访问海外接口（OpenAI、Gemini、Claude 等）一般要填，例如 http://127.0.0.1:10809；留空不走代理", "· Usually needed in mainland China to reach overseas APIs (OpenAI, Gemini, Claude, etc.), e.g. http://127.0.0.1:10809; leave empty for no proxy")}</span>
          <input value={llm.proxy ?? ""} placeholder={vendor.overseas ? "http://127.0.0.1:10809" : t("国内接口一般不用填", "Usually not needed for domestic APIs")}
            onChange={(e) => set({ proxy: e.target.value })} />
        </label>
      </div>
      {vendor.protocol === "anthropic" && (
        <p className="muted small">{t("Claude 走官方 SDK。使用官方地址时会开启服务端兜底：请求被安全策略拒绝时，自动换 Anthropic 推荐的模型重跑一次。", "Claude uses the official SDK. With the official endpoint, server-side fallback is enabled: if a request is refused by the safety policy, it is retried once with the model Anthropic recommends.")}</p>
      )}
      <div className="actions">
        <button onClick={onTest} disabled={testing}>{testing ? t("测试中…", "Testing…") : t("保存并测试连接", "Save and Test Connection")}</button>
        <button onClick={fetchModels} disabled={fetching}>{fetching ? t("获取中…", "Fetching…") : t("获取模型列表", "Fetch Model List")}</button>
        {fetchMsg && <span className={`small ${fetchErr ? "error" : "muted"}`}>{fetchMsg}</span>}
      </div>
    </div>
  );
}
