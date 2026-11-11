import { useEffect, useState } from "react";
import { api, AssetKind, LibraryItem, mediaUrl } from "../api";
import Modal from "./Modal";

export const KIND_LABEL: Record<AssetKind, string> = { character: "角色", scene: "场景", prop: "道具" };

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

  return (
    <Modal wide title={`从素材库导入${KIND_LABEL[kind]}`} onClose={onClose}
      footer={<>
        {err && <span className="error small">{err}</span>}
        <span className="spacer" />
        <button className="primary" disabled={!picked.length || busy} onClick={run}>
          {busy ? "导入中…" : `导入 ${picked.length} 个`}
        </button>
      </>}>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`搜索${KIND_LABEL[kind]}名、描述、标签`} />
      {items === null ? <p className="muted">加载中…</p> : items.length === 0 ? (
        <p className="muted">{q ? "没有找到匹配的素材。" : `素材库里还没有${KIND_LABEL[kind]}。在项目的${KIND_LABEL[kind]}卡片上点「存入素材库」就会出现在这里。`}</p>
      ) : (
        <div className="pick-grid">
          {items.map((it) => (
            <label key={it.id} className={`pick ${picked.includes(it.id) ? "on" : ""}`}>
              <input type="checkbox" checked={picked.includes(it.id)} onChange={() => toggle(it.id)} />
              <div className="pick-img">{it.image ? <img src={mediaUrl(it.image)} alt="" /> : <span>无图</span>}</div>
              <b>{it.name}</b>
              <span className="muted small clamp2">{it.description || "（无描述）"}</span>
              {it.tags && <span className="tag">{it.tags}</span>}
            </label>
          ))}
        </div>
      )}
      <p className="muted small">项目里已有同名{KIND_LABEL[kind]}的会跳过，不会覆盖。图片会复制一份到项目里。</p>
    </Modal>
  );
}
