import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Episode, mediaUrl, ProjectDetail, Shot, Task, waitTask } from "../api";
import DonateButton from "../components/DonateButton";
import EditableText from "../components/EditableText";
import OneClick from "../components/OneClick";
import { busy, TaskStatus, UploadButton } from "../components/Media";
import { useProjectTasks } from "../useProjectTasks";

const SHOT_TYPES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERAS = ["固定", "推", "拉", "摇", "移", "跟", "升", "降"];

export default function EpisodePage() {
  const eid = Number(useParams().eid);
  const nav = useNavigate();
  const [ep, setEp] = useState<Episode | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [script, setScript] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [task, setTask] = useState<Task | null>(null);
  const [err, setErr] = useState("");
  const [batchMsg, setBatchMsg] = useState("");

  const load = useCallback(async () => {
    const e = await api.episode(eid);
    setEp(e);
    setScript(e.script);
    setProject(await api.project(e.project_id));
    return e;
  }, [eid]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    // 页面打开时如果这集有在跑的拆分镜任务，接着显示进度
    api.tasks().then((ts) => {
      const running = ts.find((t) => t.kind === "storyboard" && t.target_id === eid && (t.status === "pending" || t.status === "running"));
      if (running) follow(running);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid]);

  const { latest, poll, activeCount } = useProjectTasks(ep?.project_id, () => load().catch(() => undefined));

  /** 发起生成后立刻刷新任务状态 */
  async function run(f: () => Promise<unknown>) {
    setBatchMsg("");
    try {
      await f();
      poll();
    } catch (e: any) {
      setBatchMsg(e.message);
    }
  }

  async function batch(f: () => Promise<Task[]>, what: string) {
    await run(async () => {
      const ts = await f();
      setBatchMsg(ts.length ? `已把 ${ts.length} 个${what}任务加入队列` : `没有需要生成的${what}（已有的不会重复生成）`);
    });
  }

  async function follow(t: Task) {
    setTask(t);
    const final = await waitTask(t.id, setTask);
    if (final.status === "done") await load();
  }

  async function saveScript() {
    if (!ep || script === ep.script) return;
    setEp(await api.updateEpisode(eid, { script }));
  }

  async function runStoryboard() {
    setErr("");
    try {
      await saveScript();
      if (ep && ep.shots.length > 0 && !window.confirm("重新拆分镜会替换掉当前所有镜头（角色、场景、道具会保留），继续？")) return;
      follow(await api.storyboard(eid, seconds));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  function importTxt(f: File | undefined) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setScript(String(reader.result || ""));
    reader.readAsText(f, "utf-8");
  }

  async function patchShot(s: Shot, b: Partial<Shot>) {
    const updated = await api.updateShot(s.id, b);
    setEp((cur) => cur && { ...cur, shots: cur.shots.map((x) => (x.id === s.id ? updated : x)) });
  }

  if (err && !ep) return <div className="page"><p className="error">{err}</p></div>;
  if (!ep || !project) return <div className="page muted">加载中…</div>;

  const running = task && (task.status === "pending" || task.status === "running");
  const total = ep.shots.reduce((a, s) => a + s.duration, 0);
  const withImage = ep.shots.filter((s) => s.image_path).length;
  const withVideo = ep.shots.filter((s) => s.video_path).length;
  const withDialogue = ep.shots.filter((s) => s.dialogue.trim()).length;
  const withAudio = ep.shots.filter((s) => s.audio_path).length;
  const composeTask = latest("compose", eid);

  return (
    <div className="page wide">
      <div className="crumbs">
        <Link to="/projects">项目</Link> / <Link to={`/projects/${project.id}`}>{project.name}</Link> / 第{ep.index}集
      </div>

      <div className="card">
        <div className="field-grid">
          <label>集数
            <input type="number" min={1} defaultValue={ep.index}
              onBlur={(e) => Number(e.target.value) !== ep.index && api.updateEpisode(eid, { index: Number(e.target.value) }).then(load)} />
          </label>
          <label>本集标题<EditableText value={ep.title} onSave={(v) => api.updateEpisode(eid, { title: v }).then(setEp)} /></label>
        </div>
        <label className="block">
          <span className="label-row">
            剧本
            <span>
              <label className="file-btn">导入 TXT<input type="file" accept=".txt,text/plain" onChange={(e) => importTxt(e.target.files?.[0])} /></label>
              <small className="muted"> {script.length} 字</small>
            </span>
          </span>
          <textarea className="script" rows={14} value={script} onChange={(e) => setScript(e.target.value)} onBlur={saveScript}
            placeholder="把这一集的剧本贴进来：场景、人物动作、台词都写上，AI 会按剧情拆成镜头。" />
        </label>
        <div className="actions">
          <label className="inline">目标时长
            <input type="number" min={15} max={600} step={15} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /> 秒
          </label>
          <button className="primary" onClick={runStoryboard} disabled={!!running || !script.trim()}>
            {running ? "拆分镜中…" : ep.shots.length ? "重新 AI 拆分镜" : "AI 拆分镜"}
          </button>
          {task && <TaskBadge t={task} />}
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      <OneClick eid={eid} hasShots={ep.shots.length > 0} hasScript={!!script.trim()} seconds={seconds}
        task={latest("pipeline", eid)} beforeStart={saveScript} onStarted={poll} />

      <section>
        <div className="section-head">
          <h2>分镜表 <small className="muted">{ep.shots.length} 个镜头 · 合计 {total.toFixed(0)} 秒 · 首帧 {withImage}/{ep.shots.length} · 视频 {withVideo}/{ep.shots.length} · 配音 {withAudio}/{withDialogue}</small></h2>
          <button onClick={() => api.addShot(eid).then(load)}>+ 追加镜头</button>
        </div>
        {ep.shots.length > 0 && (
          <div className="actions batch">
            <button className="primary" onClick={() => batch(() => api.genShotImages(eid), "首帧")}>批量生成首帧</button>
            <button className="primary" disabled={withImage === 0} onClick={() => batch(() => api.genShotVideos(eid), "视频")}>批量生成视频</button>
            <button className="primary" disabled={withDialogue === 0} onClick={() => batch(() => api.genShotAudios(eid), "配音")}>批量配音</button>
            <button className="primary" disabled={withImage < ep.shots.length || busy(composeTask)} onClick={() => run(async () => {
              await api.compose(eid);
              document.getElementById("final")?.scrollIntoView({ behavior: "smooth" });
            })} title={withImage < ep.shots.length ? "每个镜头都要有首帧或视频" : ""}>合成成片</button>
            {activeCount > 0 && (
              <>
                <span className="badge running">队列中还有 {activeCount} 个任务</span>
                <button className="link danger" onClick={() => run(() => api.cancelPending(ep.project_id))}>取消排队中的</button>
              </>
            )}
            {batchMsg && <span className="muted small">{batchMsg}</span>}
            <span className="muted small">只生成还没有的；单个镜头可以点「重新生成」。合成时会自动补齐缺的配音，台词改过的也会重配。</span>
          </div>
        )}
        {ep.shots.length === 0 ? <p className="muted">还没有镜头。填好剧本后点「AI 拆分镜」。</p> : (
          <div className="shots">
            {ep.shots.map((s) => (
              <div className="card shot" key={s.id}>
                <div className="shot-head">
                  <b>#{s.index}</b>
                  <select value={s.scene_name} onChange={(e) => patchShot(s, { scene_name: e.target.value })}>
                    <option value="">（场景）</option>
                    {project.scenes.map((x) => <option key={x.id}>{x.name}</option>)}
                    {s.scene_name && !project.scenes.some((x) => x.name === s.scene_name) && <option>{s.scene_name}</option>}
                  </select>
                  <select value={s.shot_type} onChange={(e) => patchShot(s, { shot_type: e.target.value })}>
                    <option value="">（景别）</option>
                    {SHOT_TYPES.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <select value={s.camera} onChange={(e) => patchShot(s, { camera: e.target.value })}>
                    <option value="">（运镜）</option>
                    {CAMERAS.map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <label className="inline">
                    <input type="number" min={1} max={15} step={0.5} defaultValue={s.duration}
                      onBlur={(e) => Number(e.target.value) !== s.duration && patchShot(s, { duration: Number(e.target.value) })} /> 秒
                  </label>
                  <span className="chars">
                    {project.characters.map((c) => (
                      <label key={c.id} className={`chip ${s.character_names.includes(c.name) ? "on" : ""}`}>
                        <input type="checkbox" checked={s.character_names.includes(c.name)}
                          onChange={(e) => patchShot(s, {
                            character_names: e.target.checked ? [...s.character_names, c.name] : s.character_names.filter((n) => n !== c.name),
                          })} />
                        {c.name}
                      </label>
                    ))}
                    {project.props.map((x) => {
                      const on = (s.prop_names ?? []).includes(x.name);
                      return (
                        <label key={`p${x.id}`} className={`chip prop ${on ? "on" : ""}`} title="道具">
                          <input type="checkbox" checked={on}
                            onChange={(e) => patchShot(s, {
                              prop_names: e.target.checked ? [...(s.prop_names ?? []), x.name] : (s.prop_names ?? []).filter((n) => n !== x.name),
                            })} />
                          ◆ {x.name}
                        </label>
                      );
                    })}
                  </span>
                  <span className="spacer" />
                  <button className="link" onClick={() => api.addShot(eid, s.index).then(load)}>在后面插入</button>
                  <button className="link danger" onClick={() => window.confirm(`删除镜头 #${s.index}？`) && api.deleteShot(s.id).then(load)}>删除</button>
                </div>
                <div className="shot-main">
                <ShotMedia shot={s} aspect={project.aspect_ratio}
                  imageTask={latest("shot_image", s.id)} videoTask={latest("shot_video", s.id)} audioTask={latest("shot_audio", s.id)}
                  onImage={() => run(() => api.genShotImage(s.id))}
                  onAudio={() => run(() => api.genShotAudio(s.id))}
                  onVideo={() => run(() => api.genShotVideo(s.id))}
                  onUpload={(f) => run(() => api.uploadShotImage(s.id, f).then(load))} />
                <div className="shot-body">
                  <label>画面<EditableText multiline value={s.visual} onSave={(v) => patchShot(s, { visual: v })} /></label>
                  <label>
                    台词
                    <div className="dialogue">
                      <EditableText className="speaker" value={s.speaker} placeholder="说话人" onSave={(v) => patchShot(s, { speaker: v })} />
                      <EditableText multiline value={s.dialogue} placeholder="无台词" onSave={(v) => patchShot(s, { dialogue: v })} />
                    </div>
                  </label>
                  <label>首帧提示词<EditableText multiline rows={3} value={s.image_prompt} onSave={(v) => patchShot(s, { image_prompt: v })} /></label>
                  <label>视频提示词（动作+运镜）<EditableText multiline rows={3} value={s.video_prompt} onSave={(v) => patchShot(s, { video_prompt: v })} /></label>
                </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="final">
        <div className="section-head">
          <h2>成片</h2>
          <TaskStatus t={composeTask} />
        </div>
        <div className="card final">
          {ep.final_path ? (
            <>
              <video key={ep.final_path} src={mediaUrl(ep.final_path)} controls playsInline preload="metadata"
                poster={ep.shots[0]?.image_path ? mediaUrl(ep.shots[0].image_path) : undefined}
                style={{ aspectRatio: project.aspect_ratio.replace(":", " / ") }} />
              <div className="final-info">
                <p><b>第{ep.index}集 {ep.title}</b></p>
                <p className="muted">时长 {ep.final_duration.toFixed(1)} 秒 · {ep.shots.length} 个镜头</p>
                <p className="actions">
                  <a className="button primary" href={api.downloadUrl(eid, "mp4")}>下载 MP4</a>
                  {ep.srt_path && <a className="button" href={api.downloadUrl(eid, "srt")}>下载字幕 SRT</a>}
                </p>
                <p className="muted small">改了画面、台词或配音之后，再点一次「合成成片」就会更新。</p>
                <p className="final-thanks small">
                  <span className="muted">又做完一集！觉得省了时间的话，</span>
                  <DonateButton variant="link" label="请作者喝杯奶茶" />
                </p>
              </div>
            </>
          ) : (
            <p className="muted">
              {busy(composeTask) ? "正在合成…" : "还没有成片。每个镜头都有首帧（或视频）后，点上面的「合成成片」。没有视频的镜头会用首帧静帧。"}
            </p>
          )}
        </div>
      </section>

      <p>
        <button className="link danger" onClick={async () => {
          if (!window.confirm(`删除第${ep.index}集？剧本和分镜都会删除，不能恢复。`)) return;
          await api.deleteEpisode(eid);
          nav(`/projects/${project.id}`);
        }}>删除这一集</button>
      </p>
    </div>
  );
}

export function TaskBadge({ t }: { t: Task }) {
  const label = { pending: "排队中", running: "执行中", done: "完成", failed: "失败" }[t.status];
  return (
    <span className={`badge ${t.status}`} title={t.error || t.message}>
      {label}{t.message ? `：${t.message}` : ""}
    </span>
  );
}

function ShotMedia(props: {
  shot: Shot;
  aspect: string;
  imageTask?: Task;
  videoTask?: Task;
  audioTask?: Task;
  onImage: () => void;
  onVideo: () => void;
  onAudio: () => void;
  onUpload: (f: File) => void;
}) {
  const { shot } = props;
  const [view, setView] = useState<"image" | "video">(shot.video_path ? "video" : "image");
  // 视频刚生成出来时自动切到视频
  useEffect(() => {
    if (shot.video_path) setView("video");
  }, [shot.video_path]);
  const imgBusy = busy(props.imageTask);
  const vidBusy = busy(props.videoTask);
  const showVideo = view === "video" && shot.video_path;

  return (
    <div className="shot-media">
      <div className="frame" style={{ aspectRatio: props.aspect.replace(":", " / ") }}>
        {showVideo ? (
          <video key={shot.video_path} src={mediaUrl(shot.video_path)} poster={shot.image_path ? mediaUrl(shot.image_path) : undefined}
            controls loop muted playsInline preload="metadata" />
        ) : shot.image_path ? (
          <a href={mediaUrl(shot.image_path)} target="_blank" rel="noreferrer"><img src={mediaUrl(shot.image_path)} alt={`镜头 ${shot.index}`} /></a>
        ) : (
          <span>{imgBusy ? "首帧生成中…" : "还没有首帧"}</span>
        )}
      </div>
      {shot.image_path && shot.video_path && (
        <div className="seg">
          <button className={view === "image" ? "on" : ""} onClick={() => setView("image")}>首帧</button>
          <button className={view === "video" ? "on" : ""} onClick={() => setView("video")}>视频</button>
        </div>
      )}
      <div className="media-actions">
        <button className="small-btn" disabled={imgBusy} onClick={props.onImage}>
          {imgBusy ? "首帧生成中…" : shot.image_path ? "重新生成首帧" : "生成首帧"}
        </button>
        <UploadButton label="上传首帧" onFile={props.onUpload} />
        <button className="small-btn" disabled={vidBusy || !shot.image_path} title={shot.image_path ? "" : "先生成首帧"} onClick={props.onVideo}>
          {vidBusy ? "视频生成中…" : shot.video_path ? "重新生成视频" : "生成视频"}
        </button>
      </div>
      {shot.audio_path && <audio key={shot.audio_path} src={mediaUrl(shot.audio_path)} controls preload="none" />}
      {(shot.dialogue.trim() || shot.audio_path) && (
        <button className="small-btn" disabled={busy(props.audioTask)} onClick={props.onAudio}>
          {busy(props.audioTask) ? "配音中…" : shot.audio_path ? `重新配音（${shot.audio_duration.toFixed(1)} 秒）` : "生成配音"}
        </button>
      )}
      <TaskStatus t={props.imageTask} />
      <TaskStatus t={props.videoTask} />
      <TaskStatus t={props.audioTask} />
    </div>
  );
}
