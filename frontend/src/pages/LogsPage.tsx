import { Fragment, useCallback, useEffect, useState } from "react";
import { api, LLMLog, LLMLogBrief } from "../api";

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
      <h1>AI 日志</h1>
      <p className="muted small">记录每一次调用大模型的请求和返回（不记录 API Key），只保留最近 500 条。拆出来的分镜不对、分集失败时，点开看看大模型到底回了什么。</p>
      <div className="toolbar">
        <label className="inline"><input type="checkbox" checked={onlyErr} onChange={(e) => setOnlyErr(e.target.checked)} /> 只看失败的</label>
        <button onClick={load}>刷新</button>
        <span className="spacer" />
        {!!list?.length && (
          <button className="link danger" onClick={() => window.confirm("清空全部 AI 日志？") && api.clearLLMLogs().then(() => { setOpen(null); load(); })}>清空日志</button>
        )}
      </div>
      {err && <p className="error">{err}</p>}
      {list === null ? <p className="muted">加载中…</p> : list.length === 0 ? <p className="muted">还没有记录。拆分镜、AI 分集、测试大模型连接时都会记在这里。</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>时间</th><th>用途</th><th>对象</th><th>模型</th><th>耗时</th><th>tokens（入/出）</th><th>状态</th><th></th></tr></thead>
            <tbody>
              {list.map((l) => (
                <Fragment key={l.id}>
                  <tr className={open?.id === l.id ? "open" : ""}>
                    <td className="nowrap">{l.created_at.replace("T", " ").slice(5, 19)}</td>
                    <td className="nowrap">{l.purpose}</td>
                    <td>{l.target || (l.project_id ? `项目 ${l.project_id}` : "")}</td>
                    <td className="nowrap">{l.model}</td>
                    <td className="nowrap">{(l.duration_ms / 1000).toFixed(1)} 秒</td>
                    <td className="nowrap">{l.prompt_tokens || l.completion_tokens ? `${l.prompt_tokens} / ${l.completion_tokens}` : "—"}</td>
                    <td>{l.status === "ok" ? <span className="badge done">成功</span> : <span className="badge failed" title={l.error}>失败</span>}</td>
                    <td><button className="link" onClick={() => toggle(l.id)}>{open?.id === l.id ? "收起" : "详情"}</button></td>
                  </tr>
                  {open?.id === l.id && (
                    <tr className="log-detail">
                      <td colSpan={8}>
                        <p className="muted small">接口：{open.base_url}</p>
                        {open.messages.map((m, i) => (
                          <div key={i} className="log-msg">
                            <b className="small">{m.role === "system" ? "系统提示词" : m.role === "user" ? "发送内容" : m.role}</b>
                            <pre>{m.content}</pre>
                          </div>
                        ))}
                        <div className="log-msg">
                          <b className="small">{open.status === "ok" ? "大模型返回" : "错误"}</b>
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
