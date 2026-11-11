import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import Projects from "./pages/Projects";
import ProjectPage from "./pages/ProjectPage";
import EpisodePage from "./pages/EpisodePage";
import SettingsPage from "./pages/SettingsPage";
import TasksPage from "./pages/TasksPage";
import LibraryPage from "./pages/LibraryPage";
import PromptsPage from "./pages/PromptsPage";
import LogsPage from "./pages/LogsPage";
import WelcomePage from "./pages/WelcomePage";
import DonateButton from "./components/DonateButton";
import Icon from "./components/Icon";

const NAV: { group: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  { group: "", items: [{ to: "/", label: "欢迎", icon: "home", end: true }] },
  {
    group: "制作",
    items: [
      { to: "/projects", label: "我的漫剧", icon: "film" },
      { to: "/library", label: "素材库", icon: "box" },
      { to: "/tasks", label: "任务队列", icon: "list" },
    ],
  },
  {
    group: "配置",
    items: [
      { to: "/prompts", label: "提示词", icon: "prompt" },
      { to: "/logs", label: "AI 日志", icon: "log" },
      { to: "/settings", label: "系统设置", icon: "gear" },
    ],
  },
];

function readCollapsed() {
  try {
    return localStorage.getItem("sidebar-collapsed") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      /* 隐私模式等情况下存不了，无所谓 */
    }
  }, [collapsed]);
  // 手机上点了菜单项就收起抽屉
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <NavLink to="/" className="brand" title="OneDragon Studio">
            <img src="/favicon.svg" alt="" />
            <span className="brand-text">
              <b>OneDragon Studio</b>
              <small>AI漫剧一条龙</small>
            </span>
          </NavLink>
          <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开" : "收起"}>
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={14} />
          </button>
        </div>
        <nav className="side-nav" aria-label="主导航">
          {NAV.map((g) => (
            <div key={g.group || "top"} className="nav-group">
              {g.group && <div className="nav-group-title">{g.group}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} title={collapsed ? it.label : undefined}
                  className={({ isActive }) => {
                    // 项目详情、分集页也算在「我的漫剧」下面
                    const inProjects = it.to === "/projects" && /^\/(projects|episodes)\//.test(location.pathname);
                    return `nav-item ${isActive || inProjects ? "active" : ""}`;
                  }}>
                  <Icon name={it.icon} />
                  <span className="nav-label">{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <DonateButton />
        </div>
      </aside>

      <header className="mobile-bar">
        <button className="icon-btn" onClick={() => setMobileOpen(!mobileOpen)} aria-label="菜单"><Icon name="menu" /></button>
        <NavLink to="/" className="brand"><img src="/favicon.svg" alt="" /><b>OneDragon Studio</b></NavLink>
      </header>
      {mobileOpen && <div className="sidebar-mask" onClick={() => setMobileOpen(false)} />}

      <main className="content">
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:pid" element={<ProjectPage />} />
          <Route path="/episodes/:eid" element={<EpisodePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
