import { useEffect, useState } from "react";
import { api, AssetKind, LibraryItem, mediaUrl } from "../api";
import { t } from "../i18n";
import Modal from "./Modal";

/** 素材类别名（渲染时调用，跟随当前语言） */
export const kindLabel = (k: AssetKind) =>
  ({ character: t("角色", "Character"), scene: t("场景", "Scene"), prop: t("道具", "Prop") })[k];

/** 小写形式，用于英文句中 */
export const kindLower = (k: AssetKind) =>
  ({ character: t("角色", "character"), scene: t("场景", "scene"), prop: t("道具", "prop") })[k];

/** 从素材库挑几个同类素材导入当前项目。 */
export default function LibraryPicker({ pid, kind, onClose, onDone }: {
  pid: number;
  kind: AssetKind;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => api.library(kind, q).then(setItems).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(h);
  }, [kind, q]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function run() {
    setBusy(true);
    try {
      const r = await api.importFromLibrary(pid, picked);
      onDone(r.message);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const lower = kindLower(kind);

  return (
    <Modal wide title={t("从素材库导入{k}", "Import {k} from Asset Library", { k: lower })} onClose={onClose}
      footer={<>
        {err && <span className="error small">{err}</span>}
        <span className="spacer" />
        <button className="primary" disabled={!picked.length || busy} onClick={run}>
          {busy ? t("导入中…", "Importing…") : t("导入 {n} 个", "Import {n}", { n: picked.length })}
        </button>
      </>}>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t("搜索{k}名、描述、标签", "Search {k} name, description, tags", { k: lower })} />
      {items === null ? <p className="muted">{t("加载中…", "Loading…")}</p> : items.length === 0 ? (
        <p className="muted">{q ? t("没有找到匹配的素材。", "No matching assets found.")
          : t("素材库里还没有{k}。在项目的{k}卡片上点「存入素材库」就会出现在这里。",
            "No {k}s in the Asset Library yet. Click \"Save to Asset Library\" on a {k} card in a project and it will show up here.",
            { k: lower })}</p>
      ) : (
        <div className="pick-grid">
          {items.map((it) => (
            <label key={it.id} className={`pick ${picked.includes(it.id) ? "on" : ""}`}>
              <input type="checkbox" checked={picked.includes(it.id)} onChange={() => toggle(it.id)} />
              <div className="pick-img">{it.image ? <img src={mediaUrl(it.image)} alt="" /> : <span>{t("无图", "No image")}</span>}</div>
              <b>{it.name}</b>
              <span className="muted small clamp2">{it.description || t("（无描述）", "(No description)")}</span>
              {it.tags && <span className="tag">{it.tags}</span>}
            </label>
          ))}
        </div>
      )}
      <p className="muted small">{t("项目里已有同名{k}的会跳过，不会覆盖。图片会复制一份到项目里。",
        "A {k} with the same name already in the project is skipped, not overwritten. Images are copied into the project.",
        { k: lower })}</p>
    </Modal>
  );
}
