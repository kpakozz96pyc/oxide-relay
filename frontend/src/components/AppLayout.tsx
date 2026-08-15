import { useNavigate, useLocation, Link } from "react-router-dom";
import { FolderOpen, Users, FileCode, LogOut } from "lucide-react";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";

export function AppLayout(props: {
  user: { display_name: string; email: string };
  onLogout: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const permissionSet = usePermissionSet();
  const { language, setLanguage, supportedLanguages, t } = useTranslation();
  const canOpenUsersWorkspace =
    permissionSet.has("ManageUsers") || permissionSet.has("ManagePermissions");

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="shell-block">
          <div className="brand-block">
            <p className="eyebrow">{t("app.name")}</p>
            <h1>{t("layout.console.title")}</h1>
            <p className="sidebar-copy shell-copy">
              {t("layout.console.description")}
            </p>
          </div>

          <nav className="nav-links">
            <Link
              to="/projects"
              className={isActive("/projects") ? "active" : ""}
            >
              <FolderOpen size={16} />
              {t("nav.projects")}
            </Link>
            {canOpenUsersWorkspace ? (
              <Link
                to="/users"
                className={isActive("/users") ? "active" : ""}
              >
                <Users size={16} />
                {t("nav.users")}
              </Link>
            ) : null}
          </nav>
        </div>

        <div className="user-card">
          <label className="field locale-switcher app-user-card-language">
            <span>{t("layout.language.label")}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {supportedLanguages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="user-meta-stack">
            <strong>{props.user.display_name}</strong>
            <span>{props.user.email}</span>
          </div>
          <button
            className="button ghost full-width with-icon-gap"
            onClick={async () => {
              try {
                await props.onLogout();
              } catch (e) {
                console.error(t("errors.logout"), e);
              }
              navigate("/login", { replace: true });
            }}
            type="button"
          >
            <LogOut size={14} />
            {t("layout.logout")}
          </button>
          <div className="sidebar-secondary-links">
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              <FileCode size={14} />
              {t("nav.openapi")}
            </a>
          </div>
        </div>
      </aside>

      <main className="content-shell">
        <div className="shell-page-header">
          <div>
            <p className="eyebrow">{t("layout.header.eyebrow")}</p>
            <strong>{t("layout.header.title")}</strong>
          </div>
          <label className="field small locale-switcher">
            <span>{t("layout.language.label")}</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {supportedLanguages.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {props.children}
      </main>
    </div>
  );
}
