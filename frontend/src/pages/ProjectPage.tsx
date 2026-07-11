import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { buildErrorMessage, Environment, Language, Namespace, Project, apiGet } from "../api";
import { ErrorCard } from "../components/ErrorCard";
import { LoadingScreen } from "../components/LoadingScreen";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";
import { ProjectDangerZonePanel } from "./project/ProjectDangerZonePanel";
import { ProjectImportPanel } from "./project/ProjectImportPanel";
import { ProjectMembersPanel } from "./project/ProjectMembersPanel";
import { ProjectResourcesPanel } from "./project/ProjectResourcesPanel";
import { ProjectSettingsPanel } from "./project/ProjectSettingsPanel";
import { ProjectTranslationsPanel } from "./project/ProjectTranslationsPanel";

const PROJECT_TABS = [
  { id: "general", label: "General" },
  { id: "translations", label: "Translations" },
  { id: "import", label: "Import" },
  { id: "access", label: "Access" },
  { id: "environments", label: "Environments" },
  { id: "languages", label: "Languages" },
  { id: "namespaces", label: "Namespaces" },
  { id: "danger", label: "Danger Zone" },
] as const;

type ProjectTab = (typeof PROJECT_TABS)[number]["id"];

export function ProjectPage() {
  const { projectSlug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const permissionSet = usePermissionSet();
  const requestedTab = searchParams.get("tab");
  const activeTab = isProjectTab(requestedTab) ? requestedTab : "general";
  const activeTabLabel = getActiveTabLabel(activeTab);

  const projectQuery = useQuery({
    queryKey: ["project", projectSlug],
    queryFn: () => apiGet<Project>(`/api/v1/projects/${projectSlug}`),
    enabled: Boolean(projectSlug),
  });

  const languagesQuery = useQuery({
    queryKey: ["project", projectSlug, "languages"],
    queryFn: () => apiGet<Language[]>(`/api/v1/projects/${projectSlug}/languages`),
    enabled: Boolean(projectSlug),
  });

  const namespacesQuery = useQuery({
    queryKey: ["project", projectSlug, "namespaces"],
    queryFn: () => apiGet<Namespace[]>(`/api/v1/projects/${projectSlug}/namespaces`),
    enabled: Boolean(projectSlug),
  });

  const environmentsQuery = useQuery({
    queryKey: ["project", projectSlug, "environments"],
    queryFn: () => apiGet<Environment[]>(`/api/v1/projects/${projectSlug}/environments`),
    enabled: Boolean(projectSlug),
  });

  if (
    projectQuery.isLoading ||
    languagesQuery.isLoading ||
    namespacesQuery.isLoading ||
    environmentsQuery.isLoading
  ) {
    return <LoadingScreen label={t("project.loading")} compact />;
  }

  if (projectQuery.isError) {
    return <ErrorCard title={t("project.error.title")} message={buildErrorMessage(projectQuery.error)} />;
  }

  const project = projectQuery.data;
  if (!project) {
    return <ErrorCard title={t("project.error.title")} message={t("project.error.no_data")} />;
  }

  const languages = languagesQuery.data ?? [];
  const namespaces = namespacesQuery.data ?? [];
  const environments = environmentsQuery.data ?? [];
  const canEditProject = project.is_owner || permissionSet.has("EditProjects");
  const canDeleteProject = project.is_owner || permissionSet.has("DeleteProjects");
  const canManageMembers = project.is_owner || permissionSet.has("ManageProjectMembers");
  const canViewMembers = project.is_owner || permissionSet.has("ManageProjectMembers");

  return (
    <section className="page project-settings-page">
      <div className="project-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/projects">Projects</Link>
        <span>/</span>
        <Link to={`/projects/${project.slug}`}>{project.name}</Link>
        <span>/</span>
        <strong>{activeTabLabel}</strong>
      </div>

      <header className="project-hero">
        <div className="stack gap-sm">
          <p className="eyebrow">{project.is_owner ? "Owner workspace" : "Member workspace"}</p>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-description">{project.description ?? "No project description provided."}</p>
        </div>
      </header>

      <nav aria-label="Project settings sections" className="project-tabs">
        {PROJECT_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={`project-tab${isActive ? " is-active" : ""}`}
              key={tab.id}
              onClick={() => setSearchParams({ tab: tab.id })}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {activeTab === "general" ? (
        <ProjectSettingsPanel
          canEditProject={canEditProject}
          environments={environments}
          languages={languages}
          namespaces={namespaces}
          project={project}
        />
      ) : null}

      {activeTab === "translations" ? (
        <ProjectTranslationsPanel
          environments={environments}
          languages={languages}
          namespaces={namespaces}
          project={project}
          projectSlug={project.slug}
        />
      ) : null}

      {activeTab === "import" ? (
        <ProjectImportPanel
          environments={environments}
          languages={languages}
          namespaces={namespaces}
          project={project}
          projectSlug={project.slug}
        />
      ) : null}

      {activeTab === "access" ? (
        <ProjectMembersPanel
          canManageMembers={canManageMembers}
          canViewMembers={canViewMembers}
          projectOwnerId={project.owner_user_id}
          projectSlug={project.slug}
        />
      ) : null}

      {activeTab === "environments" ? (
        <ProjectResourcesPanel
          canEditProject={canEditProject}
          projectSlug={project.slug}
          resourceType="environments"
        />
      ) : null}

      {activeTab === "languages" ? (
        <ProjectResourcesPanel
          canEditProject={canEditProject}
          projectSlug={project.slug}
          resourceType="languages"
        />
      ) : null}

      {activeTab === "namespaces" ? (
        <ProjectResourcesPanel
          canEditProject={canEditProject}
          projectSlug={project.slug}
          resourceType="namespaces"
        />
      ) : null}

      {activeTab === "danger" ? (
        <ProjectDangerZonePanel canDeleteProject={canDeleteProject} project={project} />
      ) : null}
    </section>
  );
}

function isProjectTab(value: string | null): value is ProjectTab {
  return PROJECT_TABS.some((tab) => tab.id === value);
}

function getActiveTabLabel(activeTab: ProjectTab): string {
  if (activeTab === "general") {
    return "Project Settings";
  }

  return PROJECT_TABS.find((tab) => tab.id === activeTab)?.label ?? "Project";
}
