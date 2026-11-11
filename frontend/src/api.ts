export interface Project {
  id: number;
  name: string;
  description: string;
  style: string;
  aspect_ratio: string;
  created_at: string;
}
export interface EpisodeBrief { id: number; project_id: number; index: number; title: string; shot_count: number }
export interface Character { id: number; project_id: number; name: string; appearance: string; image_prompt: string; ref_image: string; voice: string }
export interface Scene { id: number; project_id: number; name: string; description: string; image_prompt: string; ref_image: string }
export interface Prop { id: number; project_id: number; name: string; description: string; image_prompt: string; ref_image: string }
export interface ProjectDetail extends Project { episodes: EpisodeBrief[]; characters: Character[]; scenes: Scene[]; props: Prop[] }
export type AssetKind = "character" | "scene" | "prop";
export interface LibraryItem {
  id: number;
  kind: AssetKind;
  name: string;
  description: string;
  image_prompt: string;
  image: string;
  voice: string;
  tags: string;
  created_at: string;
  updated_at: string;
}
export interface ChapterPreview { title: string; text: string; chars: number }
export interface ImportPreview { source: string; total_chars: number; note: string; chapters: ChapterPreview[] }
export type SplitMode = "chapter" | "length" | "ai";
export interface PromptTpl { key: string; label: string; desc: string; vars: Record<string, string>; default: string; value: string; customized: boolean }
export interface LLMLogBrief {
  id: number;
  created_at: string;
  purpose: string;
  project_id: number;
  target: string;
  model: string;
  status: "ok" | "error";
  error: string;
  duration_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}
export interface LLMLog extends LLMLogBrief { base_url: string; messages: { role: string; content: string }[]; response: string }
export interface Shot {
  id: number;
  episode_id: number;
  index: number;
  scene_name: string;
  character_names: string[];
  prop_names: string[];
  shot_type: string;
  camera: string;
  visual: string;
  dialogue: string;
  speaker: string;
  duration: number;
  image_prompt: string;
  video_prompt: string;
  image_path: string;
  video_path: string;
  audio_path: string;
  audio_duration: number;
}
export interface Episode {
  id: number;
  project_id: number;
  index: number;
  title: string;
  script: string;
  final_path: string;
  srt_path: string;
  final_duration: number;
  shots: Shot[];
}
export interface Task {
  id: number;
  kind: string;
  kind_label: string;
  target_id: number;
  project_id: number;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  max_attempts: number;
  error: string;
  message: string;
  created_at: string;
  updated_at: string;
}
export type Settings = Record<string, any>;
export interface StatusItem { key: string; name: string; state: "ok" | "warn" | "error"; detail: string }
export interface SystemStatus { items: StatusItem[]; counts: { projects: number; episodes: number; active_tasks: number } }

async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new Error(msg);
  }
  return r.json();
}

function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then((r) => handle<T>(r));
}

function upload<T>(url: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  return fetch(url, { method: "POST", body: fd }).then((r) => handle<T>(r));
}

export const mediaUrl = (rel: string) => `/media/${rel}`;
export const isActive = (t: Task) => t.status === "pending" || t.status === "running";

export const api = {
  projects: () => req<Project[]>("GET", "/api/projects"),
  createProject: (b: Partial<Project>) => req<Project>("POST", "/api/projects", b),
  project: (id: number) => req<ProjectDetail>("GET", `/api/projects/${id}`),
  updateProject: (id: number, b: Partial<Project>) => req<Project>("PATCH", `/api/projects/${id}`, b),
  deleteProject: (id: number) => req("DELETE", `/api/projects/${id}`),

  createEpisode: (pid: number, b: { title?: string; script?: string }) => req<Episode>("POST", `/api/projects/${pid}/episodes`, b),
  episode: (id: number) => req<Episode>("GET", `/api/episodes/${id}`),
  updateEpisode: (id: number, b: Partial<Episode>) => req<Episode>("PATCH", `/api/episodes/${id}`, b),
  deleteEpisode: (id: number) => req("DELETE", `/api/episodes/${id}`),
  storyboard: (id: number, seconds: number) => req<Task>("POST", `/api/episodes/${id}/storyboard?target_seconds=${seconds}`),

  createCharacter: (pid: number, b: Partial<Character>) => req<Character>("POST", `/api/projects/${pid}/characters`, b),
  updateCharacter: (id: number, b: Partial<Character>) => req<Character>("PATCH", `/api/characters/${id}`, b),
  deleteCharacter: (id: number) => req("DELETE", `/api/characters/${id}`),
  createScene: (pid: number, b: Partial<Scene>) => req<Scene>("POST", `/api/projects/${pid}/scenes`, b),
  updateScene: (id: number, b: Partial<Scene>) => req<Scene>("PATCH", `/api/scenes/${id}`, b),
  deleteScene: (id: number) => req("DELETE", `/api/scenes/${id}`),

  createProp: (pid: number, b: Partial<Prop>) => req<Prop>("POST", `/api/projects/${pid}/props`, b),
  updateProp: (id: number, b: Partial<Prop>) => req<Prop>("PATCH", `/api/props/${id}`, b),
  deleteProp: (id: number) => req("DELETE", `/api/props/${id}`),
  genPropImage: (id: number) => req<Task>("POST", `/api/props/${id}/image`),
  uploadPropImage: (id: number, f: File) => upload<Prop>(`/api/props/${id}/upload`, f),

  importPreview: (pid: number, b: { file?: File; text?: string; mode: SplitMode; size: number }) => {
    const fd = new FormData();
    if (b.file) fd.append("file", b.file);
    fd.append("text", b.text ?? "");
    fd.append("mode", b.mode);
    fd.append("size", String(b.size));
    return fetch(`/api/projects/${pid}/import/preview`, { method: "POST", body: fd }).then((r) => handle<ImportPreview>(r));
  },
  importCommit: (pid: number, chapters: { title: string; text: string }[]) =>
    req<EpisodeBrief[]>("POST", `/api/projects/${pid}/import/commit`, { chapters }),

  library: (kind?: AssetKind, q = "") =>
    req<LibraryItem[]>("GET", `/api/library?${kind ? `kind=${kind}&` : ""}q=${encodeURIComponent(q)}`),
  createLibraryItem: (b: Partial<LibraryItem>) => req<LibraryItem>("POST", "/api/library", b),
  updateLibraryItem: (id: number, b: Partial<LibraryItem>) => req<LibraryItem>("PATCH", `/api/library/${id}`, b),
  deleteLibraryItem: (id: number) => req("DELETE", `/api/library/${id}`),
  uploadLibraryImage: (id: number, f: File) => upload<LibraryItem>(`/api/library/${id}/upload`, f),
  saveToLibrary: (kind: AssetKind, id: number) =>
    req<{ item: LibraryItem; updated: boolean; message: string }>("POST", "/api/library/save", { kind, id }),
  importFromLibrary: (pid: number, ids: number[]) =>
    req<{ created: string[]; skipped: string[]; message: string }>("POST", `/api/projects/${pid}/library-import`, { ids }),

  prompts: () => req<PromptTpl[]>("GET", "/api/prompts"),
  llmLogs: (status?: string) => req<LLMLogBrief[]>("GET", `/api/llm-logs${status ? `?status=${status}` : ""}`),
  llmLog: (id: number) => req<LLMLog>("GET", `/api/llm-logs/${id}`),
  clearLLMLogs: () => req<{ deleted: number }>("DELETE", "/api/llm-logs"),

  updateShot: (id: number, b: Partial<Shot>) => req<Shot>("PATCH", `/api/shots/${id}`, b),
  addShot: (eid: number, afterIndex?: number) =>
    req<Shot>("POST", `/api/episodes/${eid}/shots${afterIndex !== undefined ? `?after_index=${afterIndex}` : ""}`),
  deleteShot: (id: number) => req("DELETE", `/api/shots/${id}`),

  genCharacterImage: (id: number) => req<Task>("POST", `/api/characters/${id}/image`),
  genSceneImage: (id: number) => req<Task>("POST", `/api/scenes/${id}/image`),
  genShotImage: (id: number) => req<Task>("POST", `/api/shots/${id}/image`),
  genShotVideo: (id: number) => req<Task>("POST", `/api/shots/${id}/video`),
  genAssetImages: (pid: number, onlyMissing = true) => req<Task[]>("POST", `/api/projects/${pid}/asset-images?only_missing=${onlyMissing}`),
  genShotImages: (eid: number, onlyMissing = true) => req<Task[]>("POST", `/api/episodes/${eid}/shot-images?only_missing=${onlyMissing}`),
  genShotVideos: (eid: number, onlyMissing = true) => req<Task[]>("POST", `/api/episodes/${eid}/shot-videos?only_missing=${onlyMissing}`),
  uploadCharacterImage: (id: number, f: File) => upload<Character>(`/api/characters/${id}/upload`, f),
  uploadSceneImage: (id: number, f: File) => upload<Scene>(`/api/scenes/${id}/upload`, f),
  uploadShotImage: (id: number, f: File) => upload<Shot>(`/api/shots/${id}/upload`, f),

  genShotAudio: (id: number) => req<Task>("POST", `/api/shots/${id}/audio`),
  genShotAudios: (eid: number, onlyMissing = true) => req<Task[]>("POST", `/api/episodes/${eid}/shot-audios?only_missing=${onlyMissing}`),
  voices: () => req<Record<string, string>>("GET", "/api/tts/voices"),
  previewVoice: (voice: string, text?: string) => req<{ url: string }>("POST", "/api/tts/preview", { voice, ...(text ? { text } : {}) }),
  compose: (eid: number) => req<Task>("POST", `/api/episodes/${eid}/compose`),
  downloadUrl: (eid: number, kind: "mp4" | "srt" = "mp4") => `/api/episodes/${eid}/download?kind=${kind}`,

  status: () => req<SystemStatus>("GET", "/api/status"),
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (b: Settings) => req<Settings>("PUT", "/api/settings", b),
  testLLM: () => req<{ ok: boolean; reply: string }>("POST", "/api/settings/test-llm"),
  llmModels: () => req<{ models: string[] }>("POST", "/api/settings/llm-models"),
  testCloud: (provider: "aliyun" | "volcengine") => req<{ ok: boolean; message: string }>("POST", `/api/settings/test-cloud/${provider}`),
  pipeline: (eid: number, b: { target_seconds: number; redo_storyboard: boolean; with_video: boolean }) =>
    req<Task>("POST", `/api/episodes/${eid}/pipeline`, b),
  stopPipeline: (taskId: number) => req<Task>("POST", `/api/tasks/${taskId}/stop`),
  testComfyUI: () => req<{ ok: boolean; version: string; device: string; vram_gb: number }>("POST", "/api/settings/test-comfyui"),

  tasks: (projectId?: number, limit = 100) =>
    req<Task[]>("GET", `/api/tasks?limit=${limit}${projectId ? `&project_id=${projectId}` : ""}`),
  task: (id: number) => req<Task>("GET", `/api/tasks/${id}`),
  retryTask: (id: number) => req<Task>("POST", `/api/tasks/${id}/retry`),
  cancelTask: (id: number) => req<Task>("POST", `/api/tasks/${id}/cancel`),
  cancelPending: (projectId?: number) =>
    req<{ cancelled: number }>("POST", `/api/tasks/cancel-pending${projectId ? `?project_id=${projectId}` : ""}`),
};

/** 轮询任务直到结束 */
export async function waitTask(id: number, onTick?: (t: Task) => void): Promise<Task> {
  for (;;) {
    const t = await api.task(id);
    onTick?.(t);
    if (t.status === "done" || t.status === "failed") return t;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
