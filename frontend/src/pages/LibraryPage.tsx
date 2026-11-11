import { useCallback, useEffect, useState } from "react";
import { api, AssetKind, LibraryItem, mediaUrl } from "../api";
import EditableText from "../components/EditableText";
import { KIND_LABEL } from "../components/LibraryPicker";
import { UploadButton } from "../components/Media";
import VoicePicker from "../components/VoicePicker";

const KINDS: AssetKind[] = ["character", "scene", "prop"];

/** 跨项目素材库：存好的角色、场景、道具，可以在任何项目里「从素材库导入」。 */
export default function LibraryPage() {
  const [kind, setKind] = useState<AssetKind>("character");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => api.library(kind, q).then(setItems).catch((e) => setErr(e.message)), [kind, q]);
  useEffect(() => {
    const h = setTimeout(load, 200);
    return () => clearTimeout(h);
  }, [load]);

  const patch = (id: number, b: Partial<LibraryItem>) =>
    api.updateLibraryItem(id, b).then((it) => setItems((xs) => xs && xs.map((x) => (x.id === id ? it : x))));

  return (
    <div className="page wide">
      <h1>素材库</h1>
      <p className="muted small">
        这里的角色、场景、道具不属于任何一个项目。在项目里的卡片上点「存入素材库」就会复制一份过来；
        新项目里点「从素材库导入」就能直接用上，同一个角色在第二部剧里长相、音色都不变。
      </p>
      <div className="toolbar">
        <div className="seg tabs" role="tablist">
          {KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""}
              onClick={() => { setItems(null); setKind(k); }}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名字、描述、标签" />
        <span className="spacer" />
        <button onClick={() => api.createLibraryItem({ kind, name: `新${KIND_LABEL[kind]}` }).then(load)}>+ 新建{KIND_LABEL[kind]}</button>
      </div>
      {err && <p className="error">{err}</p>}
      {items === null ? <p className="muted">加载中…</p> : items.length === 0 ? (
        <p className="muted">{q ? "没有找到匹配的素材。" : `还没有${KIND_LABEL[kind]}。到项目页的${KIND_LABEL[kind]}卡片上点「存入素材库」，或者在这里新建。`}</p>
      ) : (
        <div className="grid">
          {items.map((it) => (
            <div key={it.id} className="card asset">
              <div className="asset-img" style={{ aspectRatio: kind === "character" ? "16 / 9" : kind === "prop" ? "1 / 1" : "3 / 4" }}>
                {it.image
                  ? <a href={mediaUrl(it.image)} target="_blank" rel="noreferrer"><img src={mediaUrl(it.image)} alt={it.name} /></a>
                  : <span>没有图片</span>}
              </div>
              <div className="asset-actions">
                <UploadButton label={it.image ? "换一张图" : "上传图片"}
                  onFile={(f) => api.uploadLibraryImage(it.id, f).then(load).catch((e) => setErr(e.message))} />
              </div>
              <EditableText className="title" value={it.name} onSave={(v) => patch(it.id, { name: v })} />
              <EditableText multiline rows={3} value={it.description} placeholder={kind === "character" ? "外貌、服装、气质" : "描述"}
                onSave={(v) => patch(it.id, { description: v })} />
              {kind === "character" && (
                <label>配音音色
                  <VoicePicker commitOnBlur value={it.voice} placeholder="默认按性别" onChange={(v) => patch(it.id, { voice: v })} />
                </label>
              )}
              <label>标签<EditableText value={it.tags} placeholder="比如来源剧名、题材" onSave={(v) => patch(it.id, { tags: v })} /></label>
              <details>
                <summary className="muted small">生图提示词</summary>
                <EditableText multiline rows={3} value={it.image_prompt} placeholder="留空 = 按模板生成" onSave={(v) => patch(it.id, { image_prompt: v })} />
              </details>
              <div className="asset-foot">
                <span className="muted small">更新于 {it.updated_at.slice(0, 10)}</span>
                <button className="link danger" onClick={() => window.confirm(`从素材库删除「${it.name}」？已经导入到项目里的不受影响。`) && api.deleteLibraryItem(it.id).then(load)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
