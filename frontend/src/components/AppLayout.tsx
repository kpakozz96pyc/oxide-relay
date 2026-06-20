import { useNavigate, useLocation } from "react-router-dom";
import { FolderOpen, Users, FileCode, LogOut } from "lucide-react";
import { usePermissionSet } from "../hooks/usePermissionSet";

export function AppLayout(props: {
  user: { display_name: string; email: string };
  onLogout: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const permissionSet = usePermissionSet();
  const canOpenUsersWorkspace =
    permissionSet.has("ManageUsers") || permissionSet.has("ManagePermissions");

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <div className="brand-block">
            <p className="eyebrow">OxideRelay</p>
            <h1>Admin Console</h1>
            <p className="sidebar-copy" style={{ marginTop: "var(--space-2)", fontSize: "var(--text-sm)" }}>
              Session-backed workspace for managing translations.
            </p>
          </div>

          <nav className="nav-links">
            <a
              href="/projects"
              className={isActive("/projects") ? "active" : ""}
            >
              <FolderOpen size={16} />
              Projects
            </a>
            {canOpenUsersWorkspace ? (
              <a
                href="/users"
                className={isActive("/users") ? "active" : ""}
              >
                <Users size={16} />
                Users
              </a>
            ) : null}
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              <FileCode size={16} />
              OpenAPI
            </a>
          </nav>
        </div>

        <div className="user-card">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <strong style={{ fontSize: "var(--text-sm)" }}>{props.user.display_name}</strong>
            <span>{props.user.email}</span>
          </div>
          <button
            className="button ghost"
            style={{ width: "100%", gap: "var(--space-2)" }}
            onClick={async () => {
              await props.onLogout();
              navigate("/login", { replace: true });
            }}
            type="button"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="content-shell">{props.children}</main>
    </div>
  );
}
