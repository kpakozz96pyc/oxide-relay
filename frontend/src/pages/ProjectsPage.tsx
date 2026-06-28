import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, buildErrorMessage, Project } from "../api";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";
import { LoadingScreen } from "../components/LoadingScreen";
import { ErrorCard } from "../components/ErrorCard";

export function ProjectsPage() {
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectSlug, setNewProjectSlug] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const queryClient = useQueryClient();
  const permissionSet = usePermissionSet();
  const { t } = useTranslation();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<Project[]>("/api/v1/projects"),
  });

  const createProjectMutation = useMutation({
    mutationFn: async () =>
      apiPost("/api/v1/projects", {
        name: newProjectName,
        slug: newProjectSlug,
        description: newProjectDescription || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNewProjectName("");
      setNewProjectSlug("");
      setNewProjectDescription("");
    },
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
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("projects.eyebrow")}</p>
          <h1 className="page-title">{t("projects.title")}</h1>
        </div>
        <span className="badge">{`${projects.length} ${t("projects.visible_suffix")}`}</span>
      </header>

      {createProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createProjectMutation.error)}</div>
      ) : null}

      <article className="panel stack gap-md">
        <header className="panel-header">
          <h2>{t("projects.create.title")}</h2>
        </header>
        <div className="form-grid">
          <label className="field">
            <span>{t("projects.fields.name")}</span>
            <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
          </label>
          <label className="field">
            <span>{t("projects.fields.slug")}</span>
            <input value={newProjectSlug} onChange={(event) => setNewProjectSlug(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{t("projects.fields.description")}</span>
          <input
            value={newProjectDescription}
            onChange={(event) => setNewProjectDescription(event.target.value)}
          />
        </label>
        <button
          className="button primary"
          disabled={createProjectMutation.isPending || !canCreateProjects}
          onClick={() => createProjectMutation.mutate()}
        >
          {t("projects.create.submit")}
        </button>
      </article>

      <div className="project-grid">
        {projects.map((project) => (
          <Link className="project-card" key={project.id} to={`/projects/${project.slug}`}>
            <div className="stack gap-sm">
              <span className="badge subtle" style={{ alignSelf: "flex-start" }}>
                {project.is_owner ? t("projects.badges.owner") : t("projects.badges.member")}
              </span>
              <h2>{project.name}</h2>
              <p>{project.description ?? t("projects.empty_description")}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
