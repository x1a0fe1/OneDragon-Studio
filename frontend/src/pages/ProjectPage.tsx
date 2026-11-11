import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, AssetKind, mediaUrl, ProjectDetail, Task } from "../api";
import EditableText from "../components/EditableText";
import ImportStory from "../components/ImportStory";
import LibraryPicker, { kindLabel, kindLower } from "../components/LibraryPicker";
import { busy, TaskStatus, UploadButton } from "../components/Media";
import VoicePicker from "../components/VoicePicker";
import { t } from "../i18n";
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

const KIND_TASK: Record<AssetKind, string> = {
  character: "char_image",
  scene: "scene_image",
  prop: "prop_image",
};

/** 各类资产的提示文案（渲染时调用，跟随当前语言） */
const kindInfo = (k: AssetKind): { textPlaceholder: string; promptPlaceholder: string; hint: string } => ({
  character: {
    textPlaceholder: t("外貌、服装、气质", "Appearance, outfit, vibe"),
    promptPlaceholder: t("留空 = 按「提示词」页的角色模板 + 外貌 + 画风生成三视图",
      "Leave empty = generate a three-view sheet from the character template on the Prompts page + appearance + art style"),
    hint: t("拆分镜时会自动识别角色。外貌描述越具体，后面生图越稳定。参考图也可以上传自己画好的。",
      "Characters are detected automatically during AI Storyboard. The more specific the appearance, the more consistent the images. You can also upload your own reference image."),
  },
  scene: {
    textPlaceholder: t("地点、时间、光线、陈设", "Location, time, lighting, set dressing"),
    promptPlaceholder: t("留空 = 按「提示词」页的场景模板 + 描述 + 画风生成",
      "Leave empty = generate from the scene template on the Prompts page + description + art style"),
    hint: "",
  },
  prop: {
    textPlaceholder: t("材质、颜色、形状、纹样", "Material, color, shape, pattern"),
    promptPlaceholder: t("留空 = 按「提示词」页的道具模板 + 描述 + 画风生成",
      "Leave empty = generate from the prop template on the Prompts page + description + art style"),
    hint: t("信物、武器、书信这类会反复出现的物件。镜头里勾上道具，生成首帧时会带上它的描述和参考图，前后画出来才一样。",
      "Recurring objects like keepsakes, weapons or letters. Tick a prop in a shot and its description and reference image are used for the first frame, so it looks the same every time."),
  },
})[k];

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
  if (!p) return <div className="page muted">{t("加载中…", "Loading…")}</div>;

  async function newEpisode() {
    const e = await api.createEpisode(pid, {});
    nav(`/episodes/${e.id}`);
  }

  async function removeProject() {
    if (!window.confirm(t("删除项目「{name}」？分集、分镜、角色、场景、道具都会一起删除，不能恢复。（已存入素材库的不受影响）", "Delete project \"{name}\"? All its episodes, shots, characters, scenes and props will be deleted permanently. (Items saved to the Asset Library are not affected.)", { name: p!.name }))) return;
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
      create: () => api.createCharacter(pid, { name: t("新角色", "New character") }),
      patch: (id, f, v) => api.updateCharacter(id, { [f === "text" ? "appearance" : f]: v }),
      gen: api.genCharacterImage,
      upload: api.uploadCharacterImage,
      remove: api.deleteCharacter,
    },
    scene: {
      create: () => api.createScene(pid, { name: t("新场景", "New scene") }),
      patch: (id, f, v) => api.updateScene(id, { [f === "text" ? "description" : f]: v }),
      gen: api.genSceneImage,
      upload: api.uploadSceneImage,
      remove: api.deleteScene,
    },
    prop: {
      create: () => api.createProp(pid, { name: t("新道具", "New prop") }),
      patch: (id, f, v) => api.updateProp(id, { [f === "text" ? "description" : f]: v }),
      gen: api.genPropImage,
      upload: api.uploadPropImage,
      remove: api.deleteProp,
    },
  };

  return (
    <div className="page">
      <div className="crumbs"><Link to="/projects">{t("项目", "Projects")}</Link> / {p.name}</div>
      <div className="card">
        <div className="field-grid">
          <label>{t("剧名", "Title")}<EditableText value={p.name} onSave={(v) => api.updateProject(pid, { name: v }).then(load)} /></label>
          <label>{t("画面比例", "Aspect ratio")}
            <select value={p.aspect_ratio} onChange={(e) => api.updateProject(pid, { aspect_ratio: e.target.value }).then(load)}>
              <option value="9:16">{t("9:16 竖屏", "9:16 Portrait")}</option>
              <option value="16:9">{t("16:9 横屏", "16:9 Landscape")}</option>
              <option value="3:4">3:4</option>
            </select>
          </label>
          <label className="span2">{t("画风（会加进每一张图的提示词）", "Art style (added to every image prompt)")}<EditableText value={p.style} onSave={(v) => api.updateProject(pid, { style: v }).then(load)} /></label>
          <label className="span2">{t("简介", "Synopsis")}<EditableText multiline value={p.description} onSave={(v) => api.updateProject(pid, { description: v }).then(load)} /></label>
        </div>
      </div>

      {msg && <p className="notice">{msg} <button className="link" onClick={() => setMsg("")}>{t("知道了", "Got it")}</button></p>}

      <section>
        <div className="section-head">
          <h2>{t("分集", "Episodes")} <small className="muted">{t("{n} 集", "{n} episodes", { n: p.episodes.length })}</small></h2>
          <span className="actions tight">
            <button onClick={() => setImporting(true)}>{t("导入故事或小说", "Import Story or Novel")}</button>
            <button className="primary" onClick={newEpisode}>{t("+ 新建一集", "+ New episode")}</button>
          </span>
        </div>
        {p.episodes.length === 0 ? (
          <p className="muted">{t("还没有分集。可以「导入故事或小说」自动拆成多集，也可以新建一集把剧本贴进去。", "No episodes yet. Use \"Import Story or Novel\" to split a story into episodes automatically, or create a new episode and paste in a script.")}</p>
        ) : (
          <table className="table">
            <thead><tr><th>{t("集", "Episode")}</th><th>{t("标题", "Title")}</th><th>{t("镜头数", "Shots")}</th><th></th></tr></thead>
            <tbody>
              {p.episodes.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{t("第{n}集", "Episode {n}", { n: e.index })}</td>
                  <td><Link to={`/episodes/${e.id}`}>{e.title || t("（未命名）", "(Untitled)")}</Link></td>
                  <td>{e.shot_count}</td>
                  <td><Link to={`/episodes/${e.id}`}>{t("打开", "Open")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="actions">
        <button onClick={() => run(async () => {
          const ts = await api.genAssetImages(pid);
          setMsg(ts.length ? t("已把 {n} 张参考图加入生成队列", "Queued {n} reference images for generation", { n: ts.length }) : t("角色、场景、道具都已经有参考图了", "All characters, scenes and props already have reference images"));
        })}>{t("一键生成缺少的参考图", "Generate Missing Reference Images")}</button>
        <span className="muted small">{t("角色、场景、道具里还没有参考图的都会生成；已有的不动。", "Generates images for any character, scene or prop without one; existing images are kept.")}</span>
      </div>

      {(["character", "scene", "prop"] as AssetKind[]).map((kind) => (
        <section key={kind}>
          <div className="section-head">
            <h2>{kindLabel(kind)} <small className="muted">{t("{n} 个", "{n}", { n: views[kind].length })}</small></h2>
            <span className="actions tight">
              <button onClick={() => setPicker(kind)}>{t("从素材库导入", "Import from Asset Library")}</button>
              <button onClick={() => run(() => ops[kind].create().then(load))}>{t("+ 添加{k}", "+ Add {k}", { k: kindLower(kind) })}</button>
            </span>
          </div>
          {kindInfo(kind).hint && <p className="muted small">{kindInfo(kind).hint}</p>}
          {views[kind].length === 0 ? <p className="muted small">{t("还没有{k}，拆分镜时会自动识别，也可以手动添加或从素材库导入。", "No {k}s yet. They are detected automatically during AI Storyboard, or you can add them manually or import from the Asset Library.", { k: kindLower(kind) })}</p> : (
            <div className="grid">
              {views[kind].map((a) => (
                <AssetCard key={a.id} asset={a} kind={kind}
                  aspect={kind === "character" ? "16:9" : kind === "prop" ? "1:1" : p.aspect_ratio}
                  task={latest(KIND_TASK[kind], a.id)}
                  onField={(f, v) => ops[kind].patch(a.id, f, v).then(load)}
                  onGenerate={() => run(() => ops[kind].gen(a.id))}
                  onUpload={(f) => run(() => ops[kind].upload(a.id, f).then(load))}
                  onSave={() => run(async () => setMsg((await api.saveToLibrary(kind, a.id)).message))}
                  onDelete={() => window.confirm(t("删除{k}「{name}」？", "Delete {k} \"{name}\"?", { k: kindLower(kind), name: a.name })) && run(() => ops[kind].remove(a.id).then(load))} />
              ))}
            </div>
          )}
        </section>
      ))}

      <p><button className="link danger" onClick={removeProject}>{t("删除整个项目", "Delete project")}</button></p>

      {importing && (
        <ImportStory pid={pid} onClose={() => setImporting(false)}
          onDone={(n) => { setImporting(false); setMsg(t("已导入 {n} 集", "Imported {n} episodes", { n })); load(); }} />
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
  const info = kindInfo(kind);
  return (
    <div className="card asset">
      <div className="asset-img" style={{ aspectRatio: aspect.replace(":", " / ") }}>
        {asset.ref_image
          ? <a href={mediaUrl(asset.ref_image)} target="_blank" rel="noreferrer"><img src={mediaUrl(asset.ref_image)} alt={asset.name} /></a>
          : <span>{working ? t("生成中…", "Generating…") : t("还没有参考图", "No reference image yet")}</span>}
      </div>
      <div className="asset-actions">
        <button className="small-btn" disabled={working} onClick={onGenerate}>
          {working ? t("生成中…", "Generating…") : asset.ref_image ? t("重新生成", "Regenerate") : t("生成参考图", "Generate")}
        </button>
        <UploadButton onFile={onUpload} />
        <TaskStatus t={task} />
      </div>
      <EditableText className="title" value={asset.name} onSave={(v) => onField("name", v)} />
      <EditableText multiline rows={3} value={asset.text} placeholder={info.textPlaceholder} onSave={(v) => onField("text", v)} />
      {kind === "character" && (
        <label>{t("配音音色", "Voice")}
          <VoicePicker commitOnBlur value={asset.voice ?? ""} placeholder={t("默认按性别", "Auto by gender")} onChange={(v) => onField("voice", v)} />
        </label>
      )}
      <details>
        <summary className="muted small">{t("生图提示词", "Image prompt")}</summary>
        <EditableText multiline rows={3} value={asset.image_prompt} placeholder={info.promptPlaceholder} onSave={(v) => onField("image_prompt", v)} />
      </details>
      <div className="asset-foot">
        <button className="link" onClick={onSave} title={t("复制一份到素材库，别的项目也能用；库里有同名的会更新", "Copy to the Asset Library for use in other projects; an item with the same name there will be updated")}>{t("存入素材库", "Save to Asset Library")}</button>
        <button className="link danger" onClick={onDelete}>{t("删除", "Delete")}</button>
      </div>
    </div>
  );
}
