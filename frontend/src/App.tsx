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
import { setLang, t, useLang } from "./i18n";

/** 菜单在渲染时生成，切换语言后文字跟着变 */
function navGroups(): { group: string; items: { to: string; label: string; icon: string; end?: boolean }[] }[] {
  return [
    { group: "", items: [{ to: "/", label: t("欢迎", "Welcome"), icon: "home", end: true }] },
    {
      group: t("制作", "Create"),
      items: [
        { to: "/projects", label: t("我的漫剧", "My Dramas"), icon: "film" },
        { to: "/library", label: t("素材库", "Asset Library"), icon: "box" },
        { to: "/tasks", label: t("任务队列", "Task Queue"), icon: "list" },
      ],
    },
    {
      group: t("配置", "Configure"),
      items: [
        { to: "/prompts", label: t("提示词", "Prompts"), icon: "prompt" },
        { to: "/logs", label: t("AI 日志", "AI Logs"), icon: "log" },
        { to: "/settings", label: t("系统设置", "Settings"), icon: "gear" },
      ],
    },
  ];
}

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
  const lang = useLang();

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
    // key={lang}：切换语言时整个界面重新挂载，所有文字一次性换掉
    <div key={lang} className={`shell ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <NavLink to="/" className="brand" title="OneDragon Studio">
            <img src="/favicon.svg" alt="" />
            <span className="brand-text">
              <b>OneDragon Studio</b>
              <small>{t("AI漫剧一条龙", "AI comic-drama studio")}</small>
            </span>
          </NavLink>
          <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t("展开侧边栏", "Expand sidebar") : t("收起侧边栏", "Collapse sidebar")}
            title={collapsed ? t("展开", "Expand") : t("收起", "Collapse")}>
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={14} />
          </button>
        </div>
        <nav className="side-nav" aria-label={t("主导航", "Main navigation")}>
          {navGroups().map((g) => (
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
          <div className="lang-switch" role="group" aria-label="Language">
            <button className={lang === "zh" ? "on" : ""} onClick={() => setLang("zh")} title="中文">中</button>
            <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")} title="English">EN</button>
          </div>
          <DonateButton />
        </div>
      </aside>

      <header className="mobile-bar">
        <button className="icon-btn" onClick={() => setMobileOpen(!mobileOpen)} aria-label={t("菜单", "Menu")}><Icon name="menu" /></button>
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
