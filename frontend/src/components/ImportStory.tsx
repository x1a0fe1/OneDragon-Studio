import { useState } from "react";
import { api, ImportPreview, SplitMode } from "../api";
import Modal from "./Modal";

const MODES: { value: SplitMode; label: string; hint: string }[] = [
  { value: "chapter", label: "按章节标题", hint: "适合小说：识别「第X章」「第X回」「序章」「番外」等标题；EPUB 按书的目录拆。识别不到标题时自动改为按字数。" },
  { value: "ai", label: "AI 按剧情分集", hint: "适合没有章节的短篇故事：大模型按情节切开，每集一个小高潮。只决定在哪一段切，不改原文。一次最多 6 万字。" },
  { value: "length", label: "按字数", hint: "每集大约多少字，只在段落之间切开。" },
];

interface Row { title: string; text: string; chars: number; on: boolean }

/** 导入故事或小说：选文件或粘贴 → 选拆法 → 预览、改标题、勾选 → 追加成分集。 */
export default function ImportStory({ pid, onClose, onDone }: { pid: number; onClose: () => void; onDone: (n: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<SplitMode>("chapter");
  const [size, setSize] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  async function runPreview() {
    setBusy(true);
    setErr("");
    try {
      const p = await api.importPreview(pid, { file: file ?? undefined, text: file ? "" : text, mode, size });
      setPreview(p);
      setRows(p.chapters.map((c) => ({ ...c, on: true })));
      setOpen(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const chosen = rows.filter((r) => r.on);
    setBusy(true);
    setErr("");
    try {
      const created = await api.importCommit(pid, chosen.map((r) => ({ title: r.title, text: r.text })));
      onDone(created.length);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const patch = (i: number, b: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...b } : r)));
  /** 把第 i 集并到上一集 */
  const mergeUp = (i: number) => {
    setOpen(null);
    setRows((rs) => {
      const out = [...rs];
      // 被并入的那集如果有标题（比如「第三章 重逢」），保留成正文里的一行
      const text = [out[i - 1].text, out[i].title.trim(), out[i].text].filter(Boolean).join("\n");
      out[i - 1] = { ...out[i - 1], text, chars: text.length };
      out.splice(i, 1);
      return out;
    });
  };

  const chosen = rows.filter((r) => r.on);
  const avg = chosen.length ? chosen.reduce((a, r) => a + r.chars, 0) / chosen.length : 0;
  const hasSource = !!file || !!text.trim();

  return (
    <Modal wide title="导入故事或小说" onClose={onClose}
      footer={preview ? (
        <>
          <button onClick={() => setPreview(null)} disabled={busy}>← 重新选择</button>
          <span className="spacer" />
          {err && <span className="error small">{err}</span>}
          <button className="primary" disabled={busy || chosen.length === 0} onClick={commit}>
            {busy ? "导入中…" : `导入选中的 ${chosen.length} 集`}
          </button>
        </>
      ) : (
        <>
          <span className="spacer" />
          {err && <span className="error small">{err}</span>}
          <button className="primary" disabled={busy || !hasSource} onClick={runPreview}>
            {busy ? (mode === "ai" ? "AI 正在分集，可能要一两分钟…" : "拆分中…") : "预览拆分结果"}
          </button>
        </>
      )}>
      {!preview ? (
        <div className="import-form">
          <div className="import-source">
            <label className="file-drop">
              <input type="file" accept=".txt,.epub,.md,text/plain,application/epub+zip"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              {file ? <><b>{file.name}</b><span className="muted small">{Math.max(1, Math.round(file.size / 1024))} KB · 点击换一个</span></>
                : <><b>选择文件</b><span className="muted small">TXT / EPUB / Markdown，自动识别 UTF-8 和 GBK 编码</span></>}
            </label>
            {file && <button className="link" onClick={() => setFile(null)}>不用文件，改为粘贴</button>}
          </div>
          {!file && (
            <label>或者直接粘贴
              <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="把故事或小说正文贴进来，段落之间换行。" />
            </label>
          )}
          <div className="mode-list" role="radiogroup">
            {MODES.map((m) => (
              <label key={m.value} className={`mode ${mode === m.value ? "on" : ""}`}>
                <input type="radio" name="mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
                <b>{m.label}</b>
                <span className="muted small">{m.hint}</span>
              </label>
            ))}
          </div>
          <label className="inline wrap">
            <span className="nowrap">每集约</span>
            <input type="number" min={300} max={20000} step={100} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <span className="nowrap">字</span>
            <span className="muted small">（1 分钟左右的竖屏漫剧，剧本 800～1500 字比较合适）</span>
          </label>
        </div>
      ) : (
        <div className="import-preview">
          <p className="small">
            <b>{preview.source}</b> · {preview.note} · 共 {preview.total_chars.toLocaleString()} 字
            <button className="link" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: true })))}>全选</button>
            <button className="link" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: false })))}>全不选</button>
          </p>
          {avg > 3000 && <p className="muted small">每集平均 {avg.toFixed(0)} 字，比较长。拆分镜时 AI 会按目标时长精简；想一章拆成好几集，可以返回改用「按字数」。</p>}
          <ol className="chapter-list">
            {rows.map((r, i) => (
              <li key={i} className={r.on ? "" : "off"}>
                <div className="chapter-row">
                  <input type="checkbox" checked={r.on} onChange={(e) => patch(i, { on: e.target.checked })} aria-label="选中" />
                  <input className="chapter-title" value={r.title} placeholder="（导入后叫「第N集」）" onChange={(e) => patch(i, { title: e.target.value })} />
                  <span className="muted small nowrap">{r.chars.toLocaleString()} 字</span>
                  <button className="link" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "收起" : "看正文"}</button>
                  {i > 0 && <button className="link" title="把这一集接到上一集后面" onClick={() => mergeUp(i)}>并入上一集</button>}
                </div>
                {open === i ? <pre className="chapter-text">{r.text}</pre>
                  : <p className="muted small chapter-snippet">{r.text.slice(0, 80)}{r.text.length > 80 ? "…" : ""}</p>}
              </li>
            ))}
          </ol>
          <p className="muted small">导入后接在现有分集后面，每集的正文就是剧本，可以再去分集页修改。</p>
        </div>
      )}
    </Modal>
  );
}
