import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Project } from "../api";
import { t } from "../i18n";

export default function Projects() {
  const [list, setList] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [style, setStyle] = useState("国风动漫，精致线条，电影感光影");
  const [err, setErr] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api.projects().then(setList).catch((e) => setErr(String(e.message || e)));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await api.createProject({ name: name.trim(), style });
      nav(`/projects/${p.id}`);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="page">
      <h1>{t("我的漫剧", "My Dramas")}</h1>
      <p className="muted">{t("每部剧是一个项目：里面有分集、角色、场景和道具。", "Each drama is a project with its own episodes, characters, scenes and props.")}</p>
      {err && <p className="error">{err}</p>}
      <form className="card form-row" onSubmit={create}>
        <label>
          {t("剧名", "Title")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("比如：满门被诬，我在军营毒翻了整个朝廷", "e.g. Framed and Disowned, I Poisoned the Whole Court from the Barracks")} />
        </label>
        <label>
          {t("画风", "Art style")}
          <input value={style} onChange={(e) => setStyle(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={!name.trim()}>
          {t("新建项目", "New project")}
        </button>
      </form>
      {list.length === 0 ? (
        <p className="muted">{t("还没有项目，先新建一个。", "No projects yet. Create one to get started.")}</p>
      ) : (
        <div className="grid">
          {list.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              <h3>{p.name}</h3>
              <p className="muted">{p.style}</p>
              <small className="muted">
                {p.aspect_ratio} · {t("创建于 {d}", "Created {d}", { d: p.created_at.slice(0, 10) })}
              </small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
