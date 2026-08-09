import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Permission,
  ProjectCatalogItem,
  UserProjectAccess,
  UserSummary,
  apiGet,
  buildErrorMessage,
} from "../api";
import { ErrorCard } from "../components/ErrorCard";
import { LoadingScreen } from "../components/LoadingScreen";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";
import { CreateUserDialog } from "./users/CreateUserDialog";
import { SelectedUserPanel } from "./users/SelectedUserPanel";
import { UsersTable } from "./users/UsersTable";

const NO_PROJECT_ACCESS_FILTER = "__no-project-access__";

type StatusFilter = "all" | "active" | "inactive";

export function UsersPage() {
  const { t } = useTranslation();
  const permissionSet = usePermissionSet();
  const canManageUsers = permissionSet.has("ManageUsers");
  const canManagePermissions = permissionSet.has("ManagePermissions");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [permissionFilter, setPermissionFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);
  const filtersActive = Boolean(
    search.trim() || statusFilter !== "all" || permissionFilter !== "all" || projectFilter !== "all",
  );
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setPermissionFilter("all");
    setProjectFilter("all");
  };

  const usersSummaryQuery = useQuery({
    queryKey: [
      "users-summary",
      {
        search,
        status: statusFilter,
        permission: permissionFilter,
        project: projectFilter === NO_PROJECT_ACCESS_FILTER ? "all" : projectFilter,
      },
    ],
    queryFn: () =>
      apiGet<UserSummary[]>(
        buildUsersSummaryPath({
          search,
          status: statusFilter,
          permission: permissionFilter,
          project: projectFilter === NO_PROJECT_ACCESS_FILTER ? "all" : projectFilter,
        }),
      ),
    placeholderData: keepPreviousData,
    enabled: canManageUsers || canManagePermissions,
  });

  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiGet<Permission[]>("/api/v1/permissions"),
    enabled: canManagePermissions,
  });

  const projectCatalogQuery = useQuery({
    queryKey: ["projects-catalog"],
    queryFn: () => apiGet<ProjectCatalogItem[]>("/api/v1/projects/catalog"),
    enabled: canManageUsers,
  });

  const users = useMemo(() => {
    const baseUsers = usersSummaryQuery.data ?? [];
    if (projectFilter === NO_PROJECT_ACCESS_FILTER) {
      return baseUsers.filter((user) => user.project_access_count === 0);
    }
    return baseUsers;
  }, [projectFilter, usersSummaryQuery.data]);

  useEffect(() => {
    if (!users.length) {
      setSelectedUserId("");
      return;
    }
    if (!selectedUserId || !users.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(users[0].id);
    }
  }, [selectedUserId, users]);

  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;

  const userPermissionsQuery = useQuery({
    queryKey: ["user-permissions", selectedUserId],
    queryFn: () => apiGet<Permission[]>(`/api/v1/users/${selectedUserId}/permissions`),
    enabled: Boolean(selectedUserId) && canManagePermissions,
  });

  const userProjectAccessQuery = useQuery({
    queryKey: ["user-project-access", selectedUserId],
    queryFn: () => apiGet<UserProjectAccess[]>(`/api/v1/users/${selectedUserId}/project-access`),
    enabled: Boolean(selectedUserId) && canManageUsers,
  });

  if (!canManageUsers && !canManagePermissions) {
    return <ErrorCard title={t("users.error.title")} message={t("users.error.forbidden")} />;
  }

  if (usersSummaryQuery.isLoading) {
    return <LoadingScreen label="Loading users workspace..." compact />;
  }

  if (usersSummaryQuery.isError) {
    return <ErrorCard title={t("users.error.title")} message={buildErrorMessage(usersSummaryQuery.error)} />;
  }

  const permissionsCatalog = permissionsQuery.data ?? [];
  const projectCatalog = projectCatalogQuery.data ?? [];

  return (
    <section className="page workspace-page project-settings-page users-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("users.eyebrow")}</p>
          <h1 className="page-title">Users and permissions</h1>
        </div>
      </header>

      <div className="toolbar users-toolbar">
        <label className="field search-field">
          <span>Search users</span>
          <input
            placeholder="Search by email or display name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        {canManageUsers ? (
          <label className="field compact-field">
            <span>Project</span>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="all">All projects</option>
              <option value={NO_PROJECT_ACCESS_FILTER}>No project access</option>
              {projectCatalog.map((project) => (
                <option key={project.id} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="field compact-field">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>

        {canManagePermissions ? (
          <label className="field compact-field">
            <span>Permission</span>
            <select value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value)}>
              <option value="all">Any permission</option>
              {permissionsCatalog.map((permission) => (
                <option key={permission.id} value={permission.code}>
                  {permission.code}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="users-toolbar-actions">
          {filtersActive ? (
            <button className="button ghost" onClick={clearFilters} type="button">
              Clear filters
            </button>
          ) : null}
          {canManageUsers ? (
            <button className="button primary" onClick={() => setIsCreateDialogOpen(true)} type="button">
              New user
            </button>
          ) : null}
        </div>
      </div>

      <div className="users-filter-summary" aria-live="polite">
        <span>{usersSummaryQuery.isFetching ? "Updating results..." : `${users.length} matching users`}</span>
        {filtersActive ? <span>Filters are combined using AND.</span> : <span>Showing all users.</span>}
      </div>

      {pageSuccess ? <div className="banner success">{pageSuccess}</div> : null}
      {permissionsQuery.isError ? <div className="banner error">{buildErrorMessage(permissionsQuery.error)}</div> : null}
      {projectCatalogQuery.isError ? <div className="banner error">{buildErrorMessage(projectCatalogQuery.error)}</div> : null}
      {userPermissionsQuery.isError ? <div className="banner error">{buildErrorMessage(userPermissionsQuery.error)}</div> : null}
      {userProjectAccessQuery.isError ? <div className="banner error">{buildErrorMessage(userProjectAccessQuery.error)}</div> : null}

      <div className="users-master-grid">
        <article className="panel stack gap-md">
          <header className="panel-header">
            <div className="stack gap-sm">
              <h2>Users</h2>
              <p className="panel-copy">Compact directory with search, filters, direct permission summary, and project access count.</p>
            </div>
            <span className="badge">{users.length}</span>
          </header>

          <UsersTable
            filtersActive={filtersActive}
            projectFilter={canManageUsers ? projectFilter : null}
            selectedUserId={selectedUserId}
            users={users}
            onClearFilters={clearFilters}
            onSelect={setSelectedUserId}
          />
        </article>

        <SelectedUserPanel
          canManagePermissions={canManagePermissions}
          canManageUsers={canManageUsers}
          permissionsCatalog={permissionsCatalog}
          permissionsLoading={permissionsQuery.isLoading || userPermissionsQuery.isLoading}
          projectAccess={userProjectAccessQuery.data ?? []}
          projectAccessLoading={projectCatalogQuery.isLoading || userProjectAccessQuery.isLoading}
          projectCatalog={projectCatalog}
          selectedUser={selectedUser}
          userPermissions={userPermissionsQuery.data ?? []}
          onDeleted={() => {
            setPageSuccess("User deleted.");
            setSelectedUserId("");
          }}
        />
      </div>

      <CreateUserDialog
        canManageUsers={canManageUsers}
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreated={(user) => {
          setPageSuccess("User created.");
          setSelectedUserId(user.id);
        }}
      />
    </section>
  );
}

function buildUsersSummaryPath({
  search,
  status,
  permission,
  project,
}: {
  search: string;
  status: StatusFilter;
  permission: string;
  project: string;
}) {
  const params = new URLSearchParams();
  if (search.trim()) {
    params.set("search", search.trim());
  }
  if (status !== "all") {
    params.set("status", status);
  }
  if (permission !== "all") {
    params.set("permission", permission);
  }
  if (project !== "all") {
    params.set("project", project);
  }
  const query = params.toString();
  return query ? `/api/v1/users/summary?${query}` : "/api/v1/users/summary";
}
