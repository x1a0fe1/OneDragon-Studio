import { useCallback, useEffect, useState } from "react";
import { api, AssetKind, LibraryItem, mediaUrl } from "../api";
import EditableText from "../components/EditableText";
import { kindLabel, kindLower } from "../components/LibraryPicker";
import { t } from "../i18n";
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
      <h1>{t("素材库", "Asset Library")}</h1>
      <p className="muted small">
        {t("这里的角色、场景、道具不属于任何一个项目。在项目里的卡片上点「存入素材库」就会复制一份过来；新项目里点「从素材库导入」就能直接用上，同一个角色在第二部剧里长相、音色都不变。",
          "Characters, scenes and props here don't belong to any one project. Click \"Save to Asset Library\" on a card in a project to copy it here; in a new project, click \"Import from Asset Library\" to reuse it, so the same character keeps their look and voice in your next drama.")}
      </p>
      <div className="toolbar">
        <div className="seg tabs" role="tablist">
          {KINDS.map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""}
              onClick={() => { setItems(null); setKind(k); }}>{kindLabel(k)}</button>
          ))}
        </div>
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索名字、描述、标签", "Search name, description, tags")} />
        <span className="spacer" />
        <button onClick={() => api.createLibraryItem({ kind, name: t("新{k}", "New {k}", { k: kindLower(kind) }) }).then(load)}>{t("+ 新建{k}", "+ New {k}", { k: kindLower(kind) })}</button>
      </div>
      {err && <p className="error">{err}</p>}
      {items === null ? <p className="muted">{t("加载中…", "Loading…")}</p> : items.length === 0 ? (
        <p className="muted">{q ? t("没有找到匹配的素材。", "No matching assets found.") : t("还没有{k}。到项目页的{k}卡片上点「存入素材库」，或者在这里新建。", "No {k}s yet. Click \"Save to Asset Library\" on a {k} card in a project, or create one here.", { k: kindLower(kind) })}</p>
      ) : (
        <div className="grid">
          {items.map((it) => (
            <div key={it.id} className="card asset">
              <div className="asset-img" style={{ aspectRatio: kind === "character" ? "16 / 9" : kind === "prop" ? "1 / 1" : "3 / 4" }}>
                {it.image
                  ? <a href={mediaUrl(it.image)} target="_blank" rel="noreferrer"><img src={mediaUrl(it.image)} alt={it.name} /></a>
                  : <span>{t("没有图片", "No image")}</span>}
              </div>
              <div className="asset-actions">
                <UploadButton label={it.image ? t("换一张图", "Replace image") : t("上传图片", "Upload image")}
                  onFile={(f) => api.uploadLibraryImage(it.id, f).then(load).catch((e) => setErr(e.message))} />
              </div>
              <EditableText className="title" value={it.name} onSave={(v) => patch(it.id, { name: v })} />
              <EditableText multiline rows={3} value={it.description} placeholder={kind === "character" ? t("外貌、服装、气质", "Appearance, outfit, vibe") : t("描述", "Description")}
                onSave={(v) => patch(it.id, { description: v })} />
              {kind === "character" && (
                <label>{t("配音音色", "Voice")}
                  <VoicePicker commitOnBlur value={it.voice} placeholder={t("默认按性别", "Auto by gender")} onChange={(v) => patch(it.id, { voice: v })} />
                </label>
              )}
              <label>{t("标签", "Tags")}<EditableText value={it.tags} placeholder={t("比如来源剧名、题材", "e.g. source drama, genre")} onSave={(v) => patch(it.id, { tags: v })} /></label>
              <details>
                <summary className="muted small">{t("生图提示词", "Image prompt")}</summary>
                <EditableText multiline rows={3} value={it.image_prompt} placeholder={t("留空 = 按模板生成", "Leave empty = generate from template")} onSave={(v) => patch(it.id, { image_prompt: v })} />
              </details>
              <div className="asset-foot">
                <span className="muted small">{t("更新于 {d}", "Updated {d}", { d: it.updated_at.slice(0, 10) })}</span>
                <button className="link danger" onClick={() => window.confirm(t("从素材库删除「{name}」？已经导入到项目里的不受影响。", "Delete \"{name}\" from the Asset Library? Copies already imported into projects are not affected.", { name: it.name })) && api.deleteLibraryItem(it.id).then(load)}>{t("删除", "Delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
