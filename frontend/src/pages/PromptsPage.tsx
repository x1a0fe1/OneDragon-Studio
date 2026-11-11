import { useEffect, useState } from "react";
import { api, PromptTpl } from "../api";

/** 提示词模板：留空 = 用内置默认；改过的会标出来，可以一键恢复。 */
export default function PromptsPage() {
  const [list, setList] = useState<PromptTpl[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => api.prompts().then((ps) => {
    setList(ps);
    setDraft(Object.fromEntries(ps.map((p) => [p.key, p.value || p.default])));
  }).catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
  }, []);

  if (!list) return <div className="page muted">{msg || "加载中…"}</div>;

  const dirty = list.some((p) => draft[p.key] !== (p.value || p.default));

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      // 和默认一样的存成空串，以后内置模板升级时能自动跟上
      const prompts = Object.fromEntries(list!.map((p) => {
        const v = draft[p.key] ?? "";
        return [p.key, v.trim() === p.default.trim() ? "" : v];
      }));
      await api.saveSettings({ prompts });
      await load();
      setMsg("已保存，下一次生成就会用新的提示词");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <h1>提示词</h1>
      <p className="muted small">
        AI 拆分镜、分集和生成参考图时用的模板。用 <code>{"{变量名}"}</code> 插入变量，只认下面列出的变量，其他花括号会原样保留。
        改坏了可以点「恢复默认」。
      </p>
      {list.map((p) => {
        const value = draft[p.key] ?? "";
        const changed = value.trim() !== p.default.trim();
        const missing = Object.keys(p.vars).filter((v) => !value.includes(`{${v}}`));
        return (
          <div className="card prompt-card" key={p.key}>
            <div className="section-head">
              <h2>{p.label} {changed && <span className="badge pending">已修改</span>}</h2>
              {changed && <button className="link" onClick={() => setDraft({ ...draft, [p.key]: p.default })}>恢复默认</button>}
            </div>
            <p className="muted small">{p.desc}</p>
            <p className="vars small">
              可用变量：{Object.entries(p.vars).map(([k, label]) => (
                <span key={k} className={missing.includes(k) ? "var unused" : "var"} title={missing.includes(k) ? "模板里没有用到" : ""}>
                  <code>{`{${k}}`}</code> {label}
                </span>
              ))}
            </p>
            <textarea className="code" spellCheck={false} rows={Math.min(24, Math.max(3, value.split("\n").length + 1))}
              value={value} onChange={(e) => setDraft({ ...draft, [p.key]: e.target.value })} />
          </div>
        );
      })}
      <div className="actions sticky">
        <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? "保存中…" : "保存"}</button>
        {dirty && <button onClick={() => setDraft(Object.fromEntries(list.map((p) => [p.key, p.value || p.default])))}>放弃修改</button>}
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </div>
  );
}
