import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, buildErrorMessage, Project } from "../api";
import { LoadingScreen } from "../components/LoadingScreen";
import { ErrorCard } from "../components/ErrorCard";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";
import { CreateProjectDialog } from "./projects/CreateProjectDialog";
import { ProjectsTable } from "./projects/ProjectsTable";

export function ProjectsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);
  const permissionSet = usePermissionSet();
  const { t } = useTranslation();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<Project[]>("/api/v1/projects"),
  });

  if (projectsQuery.isLoading) {
    return <LoadingScreen label={t("projects.loading")} compact />;
  }

  if (projectsQuery.isError) {
    return <ErrorCard title={t("projects.error.title")} message={buildErrorMessage(projectsQuery.error)} />;
  }

  const projects = projectsQuery.data ?? [];
  const canCreateProjects = permissionSet.has("CreateProjects");

  return (
    <section className="page workspace-page projects-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("projects.eyebrow")}</p>
          <h1 className="page-title">{t("projects.title")}</h1>
        </div>
        <div className="action-row">
          <span className="badge">{`${projects.length} ${t("projects.visible_suffix")}`}</span>
          {canCreateProjects ? (
            <button className="button primary" onClick={() => setIsCreateDialogOpen(true)} type="button">
              {t("projects.new_button")}
            </button>
          ) : null}
        </div>
      </header>

      {pageSuccess ? <div className="banner success">{pageSuccess}</div> : null}

      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>{t("projects.panel.title")}</h2>
            <p className="panel-copy">{t("projects.panel.description")}</p>
          </div>
          <span className="badge">{projects.length}</span>
        </header>

        <ProjectsTable
          canCreateProjects={canCreateProjects}
          onCreateProject={() => setIsCreateDialogOpen(true)}
          projects={projects}
        />
      </article>

      <CreateProjectDialog
        canCreateProjects={canCreateProjects}
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreated={() => setPageSuccess(t("projects.create.success"))}
      />
    </section>
  );
}
