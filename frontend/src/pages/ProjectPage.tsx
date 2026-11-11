import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, AssetKind, mediaUrl, ProjectDetail, Task } from "../api";
import EditableText from "../components/EditableText";
import ImportStory from "../components/ImportStory";
import LibraryPicker, { KIND_LABEL } from "../components/LibraryPicker";
import { busy, TaskStatus, UploadButton } from "../components/Media";
import VoicePicker from "../components/VoicePicker";
import { useProjectTasks } from "../useProjectTasks";

/** 三类资产的统一视图：角色的「描述」字段叫 appearance，其他叫 description。 */
interface AssetView {
  id: number;
  name: string;
  text: string;
  image_prompt: string;
  ref_image: string;
  voice?: string;
}

const KIND_INFO: Record<AssetKind, {
  task: string;
  textPlaceholder: string;
  promptPlaceholder: string;
  hint: string;
}> = {
  character: {
    task: "char_image",
    textPlaceholder: "外貌、服装、气质",
    promptPlaceholder: "留空 = 按「提示词」页的角色模板 + 外貌 + 画风生成三视图",
    hint: "拆分镜时会自动识别角色。外貌描述越具体，后面生图越稳定。参考图也可以上传自己画好的。",
  },
  scene: {
    task: "scene_image",
    textPlaceholder: "地点、时间、光线、陈设",
    promptPlaceholder: "留空 = 按「提示词」页的场景模板 + 描述 + 画风生成",
    hint: "",
  },
  prop: {
    task: "prop_image",
    textPlaceholder: "材质、颜色、形状、纹样",
    promptPlaceholder: "留空 = 按「提示词」页的道具模板 + 描述 + 画风生成",
    hint: "信物、武器、书信这类会反复出现的物件。镜头里勾上道具，生成首帧时会带上它的描述和参考图，前后画出来才一样。",
  },
};

export default function ProjectPage() {
  const pid = Number(useParams().pid);
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const [picker, setPicker] = useState<AssetKind | null>(null);
  const nav = useNavigate();

  const load = useCallback(() => api.project(pid).then(setP).catch((e) => setErr(e.message)), [pid]);
  useEffect(() => {
    load();
  }, [load]);
  const { latest, poll } = useProjectTasks(pid, load);

  /** 发起操作后刷新任务状态；出错显示在页面上 */
  const run = (f: () => Promise<unknown>) => {
    setMsg("");
    return f().then(poll).catch((e) => setMsg(e.message));
  };

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!p) return <div className="page muted">加载中…</div>;

  async function newEpisode() {
    const e = await api.createEpisode(pid, {});
    nav(`/episodes/${e.id}`);
  }

  async function removeProject() {
    if (!window.confirm(`删除项目「${p!.name}」？分集、分镜、角色、场景、道具都会一起删除，不能恢复。（已存入素材库的不受影响）`)) return;
    await api.deleteProject(pid);
    nav("/projects");
  }

  const views: Record<AssetKind, AssetView[]> = {
    character: p.characters.map((c) => ({ ...c, text: c.appearance })),
    scene: p.scenes.map((s) => ({ ...s, text: s.description })),
    prop: p.props.map((x) => ({ ...x, text: x.description })),
  };

  const ops: Record<AssetKind, {
    create: () => Promise<unknown>;
    patch: (id: number, field: "name" | "text" | "image_prompt" | "voice", v: string) => Promise<unknown>;
    gen: (id: number) => Promise<unknown>;
    upload: (id: number, f: File) => Promise<unknown>;
    remove: (id: number) => Promise<unknown>;
  }> = {
    character: {
      create: () => api.createCharacter(pid, { name: "新角色" }),
      patch: (id, f, v) => api.updateCharacter(id, { [f === "text" ? "appearance" : f]: v }),
      gen: api.genCharacterImage,
      upload: api.uploadCharacterImage,
      remove: api.deleteCharacter,
    },
    scene: {
      create: () => api.createScene(pid, { name: "新场景" }),
      patch: (id, f, v) => api.updateScene(id, { [f === "text" ? "description" : f]: v }),
      gen: api.genSceneImage,
      upload: api.uploadSceneImage,
      remove: api.deleteScene,
    },
    prop: {
      create: () => api.createProp(pid, { name: "新道具" }),
      patch: (id, f, v) => api.updateProp(id, { [f === "text" ? "description" : f]: v }),
      gen: api.genPropImage,
      upload: api.uploadPropImage,
      remove: api.deleteProp,
    },
  };

  return (
    <div className="page">
      <div className="crumbs"><Link to="/projects">项目</Link> / {p.name}</div>
      <div className="card">
        <div className="field-grid">
          <label>剧名<EditableText value={p.name} onSave={(v) => api.updateProject(pid, { name: v }).then(load)} /></label>
          <label>画面比例
            <select value={p.aspect_ratio} onChange={(e) => api.updateProject(pid, { aspect_ratio: e.target.value }).then(load)}>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label className="span2">画风（会加进每一张图的提示词）<EditableText value={p.style} onSave={(v) => api.updateProject(pid, { style: v }).then(load)} /></label>
          <label className="span2">简介<EditableText multiline value={p.description} onSave={(v) => api.updateProject(pid, { description: v }).then(load)} /></label>
        </div>
      </div>

      {msg && <p className="notice">{msg} <button className="link" onClick={() => setMsg("")}>知道了</button></p>}

      <section>
        <div className="section-head">
          <h2>分集 <small className="muted">{p.episodes.length} 集</small></h2>
          <span className="actions tight">
            <button onClick={() => setImporting(true)}>导入故事或小说</button>
            <button className="primary" onClick={newEpisode}>+ 新建一集</button>
          </span>
        </div>
        {p.episodes.length === 0 ? (
          <p className="muted">还没有分集。可以「导入故事或小说」自动拆成多集，也可以新建一集把剧本贴进去。</p>
        ) : (
          <table className="table">
            <thead><tr><th>集</th><th>标题</th><th>镜头数</th><th></th></tr></thead>
            <tbody>
              {p.episodes.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">第{e.index}集</td>
                  <td><Link to={`/episodes/${e.id}`}>{e.title || "（未命名）"}</Link></td>
                  <td>{e.shot_count}</td>
                  <td><Link to={`/episodes/${e.id}`}>打开</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="actions">
        <button onClick={() => run(async () => {
          const ts = await api.genAssetImages(pid);
          setMsg(ts.length ? `已把 ${ts.length} 张参考图加入生成队列` : "角色、场景、道具都已经有参考图了");
        })}>一键生成缺少的参考图</button>
        <span className="muted small">角色、场景、道具里还没有参考图的都会生成；已有的不动。</span>
      </div>

      {(["character", "scene", "prop"] as AssetKind[]).map((kind) => (
        <section key={kind}>
          <div className="section-head">
            <h2>{KIND_LABEL[kind]} <small className="muted">{views[kind].length} 个</small></h2>
            <span className="actions tight">
              <button onClick={() => setPicker(kind)}>从素材库导入</button>
              <button onClick={() => run(() => ops[kind].create().then(load))}>+ 添加{KIND_LABEL[kind]}</button>
            </span>
          </div>
          {KIND_INFO[kind].hint && <p className="muted small">{KIND_INFO[kind].hint}</p>}
          {views[kind].length === 0 ? <p className="muted small">还没有{KIND_LABEL[kind]}，拆分镜时会自动识别，也可以手动添加或从素材库导入。</p> : (
            <div className="grid">
              {views[kind].map((a) => (
                <AssetCard key={a.id} asset={a} kind={kind}
                  aspect={kind === "character" ? "16:9" : kind === "prop" ? "1:1" : p.aspect_ratio}
                  task={latest(KIND_INFO[kind].task, a.id)}
                  onField={(f, v) => ops[kind].patch(a.id, f, v).then(load)}
                  onGenerate={() => run(() => ops[kind].gen(a.id))}
                  onUpload={(f) => run(() => ops[kind].upload(a.id, f).then(load))}
                  onSave={() => run(async () => setMsg((await api.saveToLibrary(kind, a.id)).message))}
                  onDelete={() => window.confirm(`删除${KIND_LABEL[kind]}「${a.name}」？`) && run(() => ops[kind].remove(a.id).then(load))} />
              ))}
            </div>
          )}
        </section>
      ))}

      <p><button className="link danger" onClick={removeProject}>删除整个项目</button></p>

      {importing && (
        <ImportStory pid={pid} onClose={() => setImporting(false)}
          onDone={(n) => { setImporting(false); setMsg(`已导入 ${n} 集`); load(); }} />
      )}
      {picker && (
        <LibraryPicker pid={pid} kind={picker} onClose={() => setPicker(null)}
          onDone={(m) => { setPicker(null); setMsg(m); load(); }} />
      )}
    </div>
  );
}

function AssetCard({ asset, kind, aspect, task, onField, onGenerate, onUpload, onSave, onDelete }: {
  asset: AssetView;
  kind: AssetKind;
  aspect: string;
  task?: Task;
  onField: (f: "name" | "text" | "image_prompt" | "voice", v: string) => Promise<unknown>;
  onGenerate: () => void;
  onUpload: (f: File) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const working = busy(task);
  const info = KIND_INFO[kind];
  return (
    <div className="card asset">
      <div className="asset-img" style={{ aspectRatio: aspect.replace(":", " / ") }}>
        {asset.ref_image
          ? <a href={mediaUrl(asset.ref_image)} target="_blank" rel="noreferrer"><img src={mediaUrl(asset.ref_image)} alt={asset.name} /></a>
          : <span>{working ? "生成中…" : "还没有参考图"}</span>}
      </div>
      <div className="asset-actions">
        <button className="small-btn" disabled={working} onClick={onGenerate}>
          {working ? "生成中…" : asset.ref_image ? "重新生成" : "生成参考图"}
        </button>
        <UploadButton onFile={onUpload} />
        <TaskStatus t={task} />
      </div>
      <EditableText className="title" value={asset.name} onSave={(v) => onField("name", v)} />
      <EditableText multiline rows={3} value={asset.text} placeholder={info.textPlaceholder} onSave={(v) => onField("text", v)} />
      {kind === "character" && (
        <label>配音音色
          <VoicePicker commitOnBlur value={asset.voice ?? ""} placeholder="默认按性别" onChange={(v) => onField("voice", v)} />
        </label>
      )}
      <details>
        <summary className="muted small">生图提示词</summary>
        <EditableText multiline rows={3} value={asset.image_prompt} placeholder={info.promptPlaceholder} onSave={(v) => onField("image_prompt", v)} />
      </details>
      <div className="asset-foot">
        <button className="link" onClick={onSave} title="复制一份到素材库，别的项目也能用；库里有同名的会更新">存入素材库</button>
        <button className="link danger" onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}
