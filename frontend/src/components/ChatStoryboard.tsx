import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Modal from "./Modal";
import { t } from "../i18n";

/**
 * 用聊天 AI 拆分镜：复制提示词到 Claude / ChatGPT / DeepSeek 等聊天网页，
 * 再把它返回的 JSON 粘贴回来导入。不需要 API Key，可以在聊天里反复修改满意了再导入。
 */
export default function ChatStoryboard({ eid, seconds, hasShots, beforeOpen, onClose, onImported }: {
  eid: number;
  seconds: number;
  hasShots: boolean;
  beforeOpen: () => Promise<unknown>;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState("");
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [importing, setImporting] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    beforeOpen()
      .then(() => api.storyboardPrompt(eid, seconds))
      .then((r) => setPrompt(r.text))
      .catch((e) => setLoadErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid, seconds]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // 非 localhost 的 http 页面不能用剪贴板接口：选中文字让用户自己按 Ctrl+C
      promptRef.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function doImport() {
    setErr("");
    if (hasShots && !window.confirm(t("导入会替换掉当前所有镜头（角色、场景、道具会保留），继续？", "Importing replaces all current shots (characters, scenes and props are kept). Continue?"))) return;
    setImporting(true);
    try {
      const r = await api.storyboardImport(eid, pasted);
      onImported(r.message);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal wide title={t("用聊天 AI 拆分镜", "Storyboard with a chat AI")} onClose={onClose}
      footer={<>
        <button onClick={onClose}>{t("取消", "Cancel")}</button>
        <button className="primary" onClick={doImport} disabled={importing || !pasted.trim()}>
          {importing ? t("导入中…", "Importing…") : t("导入分镜", "Import storyboard")}
        </button>
      </>}>
      <p className="muted small">
        {t("不需要 API Key：把提示词复制到 Claude、ChatGPT、DeepSeek 等聊天网页，满意后把它返回的 JSON 粘贴回来。可以先在聊天里让它反复修改（比如「第 5 镜改成特写」）。",
          "No API key needed: copy the prompt into a chat site such as Claude, ChatGPT or DeepSeek, then paste the JSON it returns back here. You can refine it in the chat first (e.g. \"make shot 5 a close-up\").")}
      </p>

      <div className="chat-sb-step">
        <div className="label-row">
          <b>{t("① 复制提示词", "① Copy the prompt")}</b>
          <button onClick={copy} disabled={!prompt}>{copied ? t("已复制 ✓", "Copied ✓") : t("复制提示词", "Copy prompt")}</button>
        </div>
        {loadErr
          ? <p className="error small">{loadErr}</p>
          : <textarea ref={promptRef} className="mono" rows={6} readOnly value={prompt || t("加载中…", "Loading…")} />}
        <p className="muted small">{t("提示词里已经带上本集剧本、目标时长和项目里已有的角色、场景、道具。", "The prompt already includes this episode's script, target length, and the project's existing characters, scenes and props.")}</p>
      </div>

      <div className="chat-sb-step">
        <b>{t("② 粘贴 AI 返回的 JSON", "② Paste the JSON the AI returned")}</b>
        <textarea className="mono" rows={10} value={pasted} onChange={(e) => { setPasted(e.target.value); setErr(""); }}
          placeholder={t("把整段 JSON 粘贴到这里（带不带 ```json 都可以）", "Paste the whole JSON here (with or without ```json fences)")} />
        {err && <p className="error small">{err}</p>}
      </div>
    </Modal>
  );
}
