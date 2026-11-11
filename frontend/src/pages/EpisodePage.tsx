import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Episode, mediaUrl, ProjectDetail, Shot, Task, waitTask } from "../api";
import DonateButton from "../components/DonateButton";
import EditableText from "../components/EditableText";
import OneClick from "../components/OneClick";
import { busy, TaskStatus, UploadButton } from "../components/Media";
import { useProjectTasks } from "../useProjectTasks";
import { t } from "../i18n";

// 景别、运镜的值会存进数据库、发给 AI，保持中文；只翻译显示的文字
const SHOT_TYPES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERAS = ["固定", "推", "拉", "摇", "移", "跟", "升", "降"];
const shotTypeLabel = (x: string) =>
  ({ 特写: t("特写", "Close-up"), 近景: t("近景", "Medium close-up"), 中景: t("中景", "Medium shot"), 全景: t("全景", "Full shot"), 远景: t("远景", "Wide shot") } as Record<string, string>)[x] ?? x;
const cameraLabel = (x: string) =>
  ({ 固定: t("固定", "Static"), 推: t("推", "Push in"), 拉: t("拉", "Pull out"), 摇: t("摇", "Pan"), 移: t("移", "Track"), 跟: t("跟", "Follow"), 升: t("升", "Crane up"), 降: t("降", "Crane down") } as Record<string, string>)[x] ?? x;

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
      setBatchMsg(ts.length
        ? t("已把 {n} 个{what}任务加入队列", "Queued {n} {what} tasks", { n: ts.length, what })
        : t("没有需要生成的{what}（已有的不会重复生成）", "No {what} to generate (existing ones are skipped)", { what }));
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
      if (ep && ep.shots.length > 0 && !window.confirm(t("重新拆分镜会替换掉当前所有镜头（角色、场景、道具会保留），继续？", "Redoing the storyboard replaces all current shots (characters, scenes and props are kept). Continue?"))) return;
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
  if (!ep || !project) return <div className="page muted">{t("加载中…", "Loading…")}</div>;

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
        <Link to="/projects">{t("项目", "Projects")}</Link> / <Link to={`/projects/${project.id}`}>{project.name}</Link> / {t("第{n}集", "Episode {n}", { n: ep.index })}
      </div>

      <div className="card">
        <div className="field-grid">
          <label>{t("集数", "Episode no.")}
            <input type="number" min={1} defaultValue={ep.index}
              onBlur={(e) => Number(e.target.value) !== ep.index && api.updateEpisode(eid, { index: Number(e.target.value) }).then(load)} />
          </label>
          <label>{t("本集标题", "Episode title")}<EditableText value={ep.title} onSave={(v) => api.updateEpisode(eid, { title: v }).then(setEp)} /></label>
        </div>
        <label className="block">
          <span className="label-row">
            {t("剧本", "Script")}
            <span>
              <label className="file-btn">{t("导入 TXT", "Import TXT")}<input type="file" accept=".txt,text/plain" onChange={(e) => importTxt(e.target.files?.[0])} /></label>
              <small className="muted"> {t("{n} 字", "{n} chars", { n: script.length })}</small>
            </span>
          </span>
          <textarea className="script" rows={14} value={script} onChange={(e) => setScript(e.target.value)} onBlur={saveScript}
            placeholder={t("把这一集的剧本贴进来：场景、人物动作、台词都写上，AI 会按剧情拆成镜头。", "Paste this episode’s script here — scenes, character actions and dialogue. AI will break it into shots.")} />
        </label>
        <div className="actions">
          <label className="inline">{t("目标时长", "Target length")}
            <input type="number" min={15} max={600} step={15} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /> {t("秒", "s")}
          </label>
          <button className="primary" onClick={runStoryboard} disabled={!!running || !script.trim()}>
            {running ? t("拆分镜中…", "Storyboarding…") : ep.shots.length ? t("重新 AI 拆分镜", "Redo AI Storyboard") : t("AI 拆分镜", "AI Storyboard")}
          </button>
          {task && <TaskBadge t={task} />}
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      <OneClick eid={eid} hasShots={ep.shots.length > 0} hasScript={!!script.trim()} seconds={seconds}
        task={latest("pipeline", eid)} beforeStart={saveScript} onStarted={poll} />

      <section>
        <div className="section-head">
          <h2>{t("分镜表", "Storyboard")} <small className="muted">{t("{n} 个镜头 · 合计 {sec} 秒 · 首帧 {img}/{n} · 视频 {vid}/{n} · 配音 {aud}/{dia}", "{n} shots · {sec}s total · First frames {img}/{n} · Videos {vid}/{n} · Voice-over {aud}/{dia}", { n: ep.shots.length, sec: total.toFixed(0), img: withImage, vid: withVideo, aud: withAudio, dia: withDialogue })}</small></h2>
          <button onClick={() => api.addShot(eid).then(load)}>{t("+ 追加镜头", "+ Add shot")}</button>
        </div>
        {ep.shots.length > 0 && (
          <div className="actions batch">
            <button className="primary" onClick={() => batch(() => api.genShotImages(eid), t("首帧", "first-frame"))}>{t("批量生成首帧", "Batch Generate First Frames")}</button>
            <button className="primary" disabled={withImage === 0} onClick={() => batch(() => api.genShotVideos(eid), t("视频", "video"))}>{t("批量生成视频", "Batch Generate Videos")}</button>
            <button className="primary" disabled={withDialogue === 0} onClick={() => batch(() => api.genShotAudios(eid), t("配音", "voice-over"))}>{t("批量配音", "Batch Voice-over")}</button>
            <button className="primary" disabled={withImage < ep.shots.length || busy(composeTask)} onClick={() => run(async () => {
              await api.compose(eid);
              document.getElementById("final")?.scrollIntoView({ behavior: "smooth" });
            })} title={withImage < ep.shots.length ? t("每个镜头都要有首帧或视频", "Every shot needs a first frame or video") : ""}>{t("合成成片", "Compose Final Video")}</button>
            {activeCount > 0 && (
              <>
                <span className="badge running">{t("队列中还有 {n} 个任务", "{n} tasks in queue", { n: activeCount })}</span>
                <button className="link danger" onClick={() => run(() => api.cancelPending(ep.project_id))}>{t("取消排队中的", "Cancel queued")}</button>
              </>
            )}
            {batchMsg && <span className="muted small">{batchMsg}</span>}
            <span className="muted small">{t("只生成还没有的；单个镜头可以点「重新生成」。合成时会自动补齐缺的配音，台词改过的也会重配。", "Only missing items are generated; use “Regenerate” on a single shot. Composing fills in missing voice-overs and redoes any whose dialogue changed.")}</span>
          </div>
        )}
        {ep.shots.length === 0 ? <p className="muted">{t("还没有镜头。填好剧本后点「AI 拆分镜」。", "No shots yet. Fill in the script, then click “AI Storyboard”.")}</p> : (
          <div className="shots">
            {ep.shots.map((s) => (
              <div className="card shot" key={s.id}>
                <div className="shot-head">
                  <b>#{s.index}</b>
                  <select value={s.scene_name} onChange={(e) => patchShot(s, { scene_name: e.target.value })}>
                    <option value="">{t("（场景）", "(Scene)")}</option>
                    {project.scenes.map((x) => <option key={x.id}>{x.name}</option>)}
                    {s.scene_name && !project.scenes.some((x) => x.name === s.scene_name) && <option>{s.scene_name}</option>}
                  </select>
                  <select value={s.shot_type} onChange={(e) => patchShot(s, { shot_type: e.target.value })}>
                    <option value="">{t("（景别）", "(Shot size)")}</option>
                    {SHOT_TYPES.map((x) => <option key={x} value={x}>{shotTypeLabel(x)}</option>)}
                  </select>
                  <select value={s.camera} onChange={(e) => patchShot(s, { camera: e.target.value })}>
                    <option value="">{t("（运镜）", "(Camera)")}</option>
                    {CAMERAS.map((x) => <option key={x} value={x}>{cameraLabel(x)}</option>)}
                  </select>
                  <label className="inline">
                    <input type="number" min={1} max={15} step={0.5} defaultValue={s.duration}
                      onBlur={(e) => Number(e.target.value) !== s.duration && patchShot(s, { duration: Number(e.target.value) })} /> {t("秒", "s")}
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
                        <label key={`p${x.id}`} className={`chip prop ${on ? "on" : ""}`} title={t("道具", "Prop")}>
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
                  <button className="link" onClick={() => api.addShot(eid, s.index).then(load)}>{t("在后面插入", "Insert after")}</button>
                  <button className="link danger" onClick={() => window.confirm(t("删除镜头 #{n}？", "Delete shot #{n}?", { n: s.index })) && api.deleteShot(s.id).then(load)}>{t("删除", "Delete")}</button>
                </div>
                <div className="shot-main">
                <ShotMedia shot={s} aspect={project.aspect_ratio}
                  imageTask={latest("shot_image", s.id)} videoTask={latest("shot_video", s.id)} audioTask={latest("shot_audio", s.id)}
                  onImage={() => run(() => api.genShotImage(s.id))}
                  onAudio={() => run(() => api.genShotAudio(s.id))}
                  onVideo={() => run(() => api.genShotVideo(s.id))}
                  onUpload={(f) => run(() => api.uploadShotImage(s.id, f).then(load))} />
                <div className="shot-body">
                  <label>{t("画面", "Visual")}<EditableText multiline value={s.visual} onSave={(v) => patchShot(s, { visual: v })} /></label>
                  <label>
                    {t("台词", "Dialogue")}
                    <div className="dialogue">
                      <EditableText className="speaker" value={s.speaker} placeholder={t("说话人", "Speaker")} onSave={(v) => patchShot(s, { speaker: v })} />
                      <EditableText multiline value={s.dialogue} placeholder={t("无台词", "No dialogue")} onSave={(v) => patchShot(s, { dialogue: v })} />
                    </div>
                  </label>
                  <label>{t("首帧提示词", "First-frame prompt")}<EditableText multiline rows={3} value={s.image_prompt} onSave={(v) => patchShot(s, { image_prompt: v })} /></label>
                  <label>{t("视频提示词（动作+运镜）", "Video prompt (action + camera)")}<EditableText multiline rows={3} value={s.video_prompt} onSave={(v) => patchShot(s, { video_prompt: v })} /></label>
                </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="final">
        <div className="section-head">
          <h2>{t("成片", "Final video")}</h2>
          <TaskStatus t={composeTask} />
        </div>
        <div className="card final">
          {ep.final_path ? (
            <>
              <video key={ep.final_path} src={mediaUrl(ep.final_path)} controls playsInline preload="metadata"
                poster={ep.shots[0]?.image_path ? mediaUrl(ep.shots[0].image_path) : undefined}
                style={{ aspectRatio: project.aspect_ratio.replace(":", " / ") }} />
              <div className="final-info">
                <p><b>{t("第{n}集", "Episode {n}", { n: ep.index })} {ep.title}</b></p>
                <p className="muted">{t("时长 {sec} 秒 · {n} 个镜头", "{sec}s · {n} shots", { sec: ep.final_duration.toFixed(1), n: ep.shots.length })}</p>
                <p className="actions">
                  <a className="button primary" href={api.downloadUrl(eid, "mp4")}>{t("下载 MP4", "Download MP4")}</a>
                  {ep.srt_path && <a className="button" href={api.downloadUrl(eid, "srt")}>{t("下载字幕 SRT", "Download SRT subtitles")}</a>}
                </p>
                <p className="muted small">{t("改了画面、台词或配音之后，再点一次「合成成片」就会更新。", "After changing visuals, dialogue or voice-over, click “Compose Final Video” again to update.")}</p>
                <p className="final-thanks small">
                  <span className="muted">{t("又做完一集！觉得省了时间的话，", "Another episode done! If this saved you time, ")}</span>
                  <DonateButton variant="link" label={t("请作者喝杯奶茶", "Buy the author a milk tea")} />
                </p>
              </div>
            </>
          ) : (
            <p className="muted">
              {busy(composeTask) ? t("正在合成…", "Composing…") : t("还没有成片。每个镜头都有首帧（或视频）后，点上面的「合成成片」。没有视频的镜头会用首帧静帧。", "No final video yet. Once every shot has a first frame (or video), click “Compose Final Video” above. Shots without video use the first frame as a still.")}
            </p>
          )}
        </div>
      </section>

      <p>
        <button className="link danger" onClick={async () => {
          if (!window.confirm(t("删除第{n}集？剧本和分镜都会删除，不能恢复。", "Delete Episode {n}? Its script and storyboard will be permanently deleted.", { n: ep.index }))) return;
          await api.deleteEpisode(eid);
          nav(`/projects/${project.id}`);
        }}>{t("删除这一集", "Delete this episode")}</button>
      </p>
    </div>
  );
}

export function TaskBadge({ t: task }: { t: Task }) {
  const label = { pending: t("排队中", "Queued"), running: t("执行中", "Running"), done: t("完成", "Done"), failed: t("失败", "Failed") }[task.status];
  return (
    <span className={`badge ${task.status}`} title={task.error || task.message}>
      {label}{task.message ? t("：{m}", ": {m}", { m: task.message }) : ""}
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
          <a href={mediaUrl(shot.image_path)} target="_blank" rel="noreferrer"><img src={mediaUrl(shot.image_path)} alt={t("镜头 {n}", "Shot {n}", { n: shot.index })} /></a>
        ) : (
          <span>{imgBusy ? t("首帧生成中…", "Generating first frame…") : t("还没有首帧", "No first frame yet")}</span>
        )}
      </div>
      {shot.image_path && shot.video_path && (
        <div className="seg">
          <button className={view === "image" ? "on" : ""} onClick={() => setView("image")}>{t("首帧", "First frame")}</button>
          <button className={view === "video" ? "on" : ""} onClick={() => setView("video")}>{t("视频", "Video")}</button>
        </div>
      )}
      <div className="media-actions">
        <button className="small-btn" disabled={imgBusy} onClick={props.onImage}>
          {imgBusy ? t("首帧生成中…", "Generating first frame…") : shot.image_path ? t("重新生成首帧", "Regenerate first frame") : t("生成首帧", "Generate first frame")}
        </button>
        <UploadButton label={t("上传首帧", "Upload first frame")} onFile={props.onUpload} />
        <button className="small-btn" disabled={vidBusy || !shot.image_path} title={shot.image_path ? "" : t("先生成首帧", "Generate a first frame first")} onClick={props.onVideo}>
          {vidBusy ? t("视频生成中…", "Generating video…") : shot.video_path ? t("重新生成视频", "Regenerate video") : t("生成视频", "Generate video")}
        </button>
      </div>
      {shot.audio_path && <audio key={shot.audio_path} src={mediaUrl(shot.audio_path)} controls preload="none" />}
      {(shot.dialogue.trim() || shot.audio_path) && (
        <button className="small-btn" disabled={busy(props.audioTask)} onClick={props.onAudio}>
          {busy(props.audioTask) ? t("配音中…", "Voicing…") : shot.audio_path ? t("重新配音（{sec} 秒）", "Redo voice-over ({sec}s)", { sec: shot.audio_duration.toFixed(1) }) : t("生成配音", "Generate voice-over")}
        </button>
      )}
      <TaskStatus t={props.imageTask} />
      <TaskStatus t={props.videoTask} />
      <TaskStatus t={props.audioTask} />
    </div>
  );
}
