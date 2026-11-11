import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, Project } from "../api";

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
      <h1>我的漫剧</h1>
      <p className="muted">每部剧是一个项目：里面有分集、角色、场景和道具。</p>
      {err && <p className="error">{err}</p>}
      <form className="card form-row" onSubmit={create}>
        <label>
          剧名
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：满门被诬，我在军营毒翻了整个朝廷" />
        </label>
        <label>
          画风
          <input value={style} onChange={(e) => setStyle(e.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={!name.trim()}>
          新建项目
        </button>
      </form>
      {list.length === 0 ? (
        <p className="muted">还没有项目，先新建一个。</p>
      ) : (
        <div className="grid">
          {list.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card project-card">
              <h3>{p.name}</h3>
              <p className="muted">{p.style}</p>
              <small className="muted">
                {p.aspect_ratio} · 创建于 {p.created_at.slice(0, 10)}
              </small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
