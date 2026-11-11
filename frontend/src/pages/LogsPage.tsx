import { Fragment, useCallback, useEffect, useState } from "react";
import { api, LLMLog, LLMLogBrief } from "../api";
import { t } from "../i18n";

/** AI 日志：每次调用大模型发了什么、回了什么。拆分镜结果不对时先来这里看。 */
export default function LogsPage() {
  const [list, setList] = useState<LLMLogBrief[] | null>(null);
  const [onlyErr, setOnlyErr] = useState(false);
  const [open, setOpen] = useState<LLMLog | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => api.llmLogs(onlyErr ? "error" : undefined).then(setList).catch((e) => setErr(e.message)), [onlyErr]);
  useEffect(() => {
    load();
  }, [load]);

  async function toggle(id: number) {
    if (open?.id === id) return setOpen(null);
    setOpen(await api.llmLog(id));
  }

  return (
    <div className="page wide">
      <h1>{t("AI 日志", "AI Logs")}</h1>
      <p className="muted small">{t("记录每一次调用大模型的请求和返回（不记录 API Key），只保留最近 500 条。拆出来的分镜不对、分集失败时，点开看看大模型到底回了什么。", "Records every LLM request and response (API keys are never logged); only the latest 500 are kept. If a storyboard looks wrong or episode splitting fails, open an entry to see what the model actually returned.")}</p>
      <div className="toolbar">
        <label className="inline"><input type="checkbox" checked={onlyErr} onChange={(e) => setOnlyErr(e.target.checked)} /> {t("只看失败的", "Failed only")}</label>
        <button onClick={load}>{t("刷新", "Refresh")}</button>
        <span className="spacer" />
        {!!list?.length && (
          <button className="link danger" onClick={() => window.confirm(t("清空全部 AI 日志？", "Clear all AI logs?")) && api.clearLLMLogs().then(() => { setOpen(null); load(); })}>{t("清空日志", "Clear logs")}</button>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      {list === null ? <p className="muted">{t("加载中…", "Loading…")}</p> : list.length === 0 ? <p className="muted">{t("还没有记录。拆分镜、AI 分集、测试大模型连接时都会记在这里。", "No records yet. AI Storyboard, AI episode splitting and LLM connection tests are all logged here.")}</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("时间", "Time")}</th><th>{t("用途", "Purpose")}</th><th>{t("对象", "Target")}</th><th>{t("模型", "Model")}</th><th>{t("耗时", "Duration")}</th><th>{t("tokens（入/出）", "Tokens (in/out)")}</th><th>{t("状态", "Status")}</th><th></th></tr></thead>
            <tbody>
              {list.map((l) => (
                <Fragment key={l.id}>
                  <tr className={open?.id === l.id ? "open" : ""}>
                    <td className="nowrap">{l.created_at.replace("T", " ").slice(5, 19)}</td>
                    <td className="nowrap">{l.purpose}</td>
                    <td>{l.target || (l.project_id ? t("项目 {id}", "Project {id}", { id: l.project_id }) : "")}</td>
                    <td className="nowrap">{l.model}</td>
                    <td className="nowrap">{t("{s} 秒", "{s}s", { s: (l.duration_ms / 1000).toFixed(1) })}</td>
                    <td className="nowrap">{l.prompt_tokens || l.completion_tokens ? `${l.prompt_tokens} / ${l.completion_tokens}` : "—"}</td>
                    <td>{l.status === "ok" ? <span className="badge done">{t("成功", "OK")}</span> : <span className="badge failed" title={l.error}>{t("失败", "Failed")}</span>}</td>
                    <td><button className="link" onClick={() => toggle(l.id)}>{open?.id === l.id ? t("收起", "Hide") : t("详情", "Details")}</button></td>
                  </tr>
                  {open?.id === l.id && (
                    <tr className="log-detail">
                      <td colSpan={8}>
                        <p className="muted small">{t("接口：", "Endpoint: ")}{open.base_url}</p>
                        {open.messages.map((m, i) => (
                          <div key={i} className="log-msg">
                            <b className="small">{m.role === "system" ? t("系统提示词", "System prompt") : m.role === "user" ? t("发送内容", "Request") : m.role}</b>
                            <pre>{m.content}</pre>
                          </div>
                        ))}
                        <div className="log-msg">
                          <b className="small">{open.status === "ok" ? t("大模型返回", "Response") : t("错误", "Error")}</b>
                          <pre className={open.status === "ok" ? "" : "error"}>{open.status === "ok" ? pretty(open.response) : open.error}</pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 返回是 JSON 就格式化一下，方便看 */
function pretty(text: string): string {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text;
  }
}
