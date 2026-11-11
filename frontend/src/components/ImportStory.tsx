import { useState } from "react";
import { api, ImportPreview, SplitMode } from "../api";
import { t } from "../i18n";
import Modal from "./Modal";

/** 拆分方式（渲染时调用，跟随当前语言） */
const modes = (): { value: SplitMode; label: string; hint: string }[] => [
  { value: "chapter", label: t("按章节标题", "By chapter headings"), hint: t("适合小说：识别「第X章」「第X回」「序章」「番外」等标题；EPUB 按书的目录拆。识别不到标题时自动改为按字数。", "Best for novels: detects headings like \"Chapter X\", \"Prologue\" or \"Extra\"; EPUB files split by the table of contents. Falls back to splitting by length if no headings are found.") },
  { value: "ai", label: t("AI 按剧情分集", "AI split by plot"), hint: t("适合没有章节的短篇故事：大模型按情节切开，每集一个小高潮。只决定在哪一段切，不改原文。一次最多 6 万字。", "Best for short stories without chapters: the AI splits by plot, with a small climax in each episode. It only picks where to cut and never changes the text. Up to 60,000 characters at a time.") },
  { value: "length", label: t("按字数", "By length"), hint: t("每集大约多少字，只在段落之间切开。", "Roughly a set number of characters per episode, cut only between paragraphs.") },
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
    <Modal wide title={t("导入故事或小说", "Import Story or Novel")} onClose={onClose}
      footer={preview ? (
        <>
          <button onClick={() => setPreview(null)} disabled={busy}>{t("← 重新选择", "← Back")}</button>
          <span className="spacer" />
          {err && <span className="error small">{err}</span>}
          <button className="primary" disabled={busy || chosen.length === 0} onClick={commit}>
            {busy ? t("导入中…", "Importing…") : t("导入选中的 {n} 集", "Import {n} selected episodes", { n: chosen.length })}
          </button>
        </>
      ) : (
        <>
          <span className="spacer" />
          {err && <span className="error small">{err}</span>}
          <button className="primary" disabled={busy || !hasSource} onClick={runPreview}>
            {busy ? (mode === "ai" ? t("AI 正在分集，可能要一两分钟…", "AI is splitting episodes, this may take a minute or two…") : t("拆分中…", "Splitting…")) : t("预览拆分结果", "Preview split")}
          </button>
        </>
      )}>
      {!preview ? (
        <div className="import-form">
          <div className="import-source">
            <label className="file-drop">
              <input type="file" accept=".txt,.epub,.md,text/plain,application/epub+zip"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              {file ? <><b>{file.name}</b><span className="muted small">{Math.max(1, Math.round(file.size / 1024))} KB · {t("点击换一个", "Click to change")}</span></>
                : <><b>{t("选择文件", "Choose file")}</b><span className="muted small">{t("TXT / EPUB / Markdown，自动识别 UTF-8 和 GBK 编码", "TXT / EPUB / Markdown, UTF-8 and GBK encodings detected automatically")}</span></>}
            </label>
            {file && <button className="link" onClick={() => setFile(null)}>{t("不用文件，改为粘贴", "Paste text instead")}</button>}
          </div>
          {!file && (
            <label>{t("或者直接粘贴", "Or paste it here")}
              <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("把故事或小说正文贴进来，段落之间换行。", "Paste the story or novel text here, one paragraph per line.")} />
            </label>
          )}
          <div className="mode-list" role="radiogroup">
            {modes().map((m) => (
              <label key={m.value} className={`mode ${mode === m.value ? "on" : ""}`}>
                <input type="radio" name="mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
                <b>{m.label}</b>
                <span className="muted small">{m.hint}</span>
              </label>
            ))}
          </div>
          <label className="inline wrap">
            <span className="nowrap">{t("每集约", "About")}</span>
            <input type="number" min={300} max={20000} step={100} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <span className="nowrap">{t("字", "characters per episode")}</span>
            <span className="muted small">{t("（1 分钟左右的竖屏漫剧，剧本 800～1500 字比较合适）", "(800–1500 characters suits a vertical drama of about 1 minute)")}</span>
          </label>
        </div>
      ) : (
        <div className="import-preview">
          <p className="small">
            <b>{preview.source}</b> · {preview.note} · {t("共 {n} 字", "{n} chars total", { n: preview.total_chars.toLocaleString() })}
            <button className="link" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: true })))}>{t("全选", "Select all")}</button>
            <button className="link" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, on: false })))}>{t("全不选", "Select none")}</button>
          </p>
          {avg > 3000 && <p className="muted small">{t("每集平均 {n} 字，比较长。拆分镜时 AI 会按目标时长精简；想一章拆成好几集，可以返回改用「按字数」。", "Episodes average {n} chars, which is long. AI Storyboard will condense to the target length; to split a chapter into several episodes, go back and use \"By length\".", { n: avg.toFixed(0) })}</p>}
          <ol className="chapter-list">
            {rows.map((r, i) => (
              <li key={i} className={r.on ? "" : "off"}>
                <div className="chapter-row">
                  <input type="checkbox" checked={r.on} onChange={(e) => patch(i, { on: e.target.checked })} aria-label={t("选中", "Select")} />
                  <input className="chapter-title" value={r.title} placeholder={t("（导入后叫「第N集」）", "(Will be named \"Episode N\")")} onChange={(e) => patch(i, { title: e.target.value })} />
                  <span className="muted small nowrap">{t("{n} 字", "{n} chars", { n: r.chars.toLocaleString() })}</span>
                  <button className="link" onClick={() => setOpen(open === i ? null : i)}>{open === i ? t("收起", "Collapse") : t("看正文", "View text")}</button>
                  {i > 0 && <button className="link" title={t("把这一集接到上一集后面", "Append this episode to the end of the previous one")} onClick={() => mergeUp(i)}>{t("并入上一集", "Merge into previous")}</button>}
                </div>
                {open === i ? <pre className="chapter-text">{r.text}</pre>
                  : <p className="muted small chapter-snippet">{r.text.slice(0, 80)}{r.text.length > 80 ? "…" : ""}</p>}
              </li>
            ))}
          </ol>
          <p className="muted small">{t("导入后接在现有分集后面，每集的正文就是剧本，可以再去分集页修改。", "Imported episodes are added after the existing ones. Each episode's text becomes its script, which you can edit on the episode page.")}</p>
        </div>
      )}
    </Modal>
  );
}
