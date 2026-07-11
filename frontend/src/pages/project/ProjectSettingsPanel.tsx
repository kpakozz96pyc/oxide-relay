import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Environment, Language, Namespace, Project, apiPut, buildErrorMessage } from "../../api";
import { MetaRow } from "../../components/MetaRow";
import { ProjectDeliveryLinksPanel } from "./ProjectDeliveryLinksPanel";

export function ProjectSettingsPanel({
  project,
  canEditProject,
  languages,
  namespaces,
  environments,
}: {
  project: Project;
  canEditProject: boolean;
  languages: Language[];
  namespaces: Namespace[];
  environments: Environment[];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);
  const [description, setDescription] = useState(project.description ?? "");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(project.name);
    setSlug(project.slug);
    setDescription(project.description ?? "");
  }, [project.description, project.id, project.name, project.slug, project.updated_at]);

  useEffect(() => {
    const state = location.state as { projectSettingsSaved?: boolean } | null;
    if (state?.projectSettingsSaved) {
      setSuccessMessage("Project settings saved.");
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate]);

  const normalizedDescription = description.trim();
  const normalizedProjectDescription = project.description ?? "";
  const isDirty =
    name.trim() !== project.name ||
    slug.trim() !== project.slug ||
    normalizedDescription !== normalizedProjectDescription;

  const updateProjectMutation = useMutation({
    mutationFn: async () =>
      apiPut<Project>(`/api/v1/projects/${project.slug}`, {
        name,
        slug,
        description: normalizedDescription || null,
      }),
    onSuccess: async (updatedProject) => {
      setSuccessMessage("Project settings saved.");
      await queryClient.invalidateQueries({ queryKey: ["project"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });

      if (updatedProject.slug !== project.slug) {
        navigate(`/projects/${updatedProject.slug}?tab=general`, {
          replace: true,
          state: { projectSettingsSaved: true },
        });
      }
    },
  });

  const formattedCreatedAt = useMemo(() => formatTimestamp(project.created_at), [project.created_at]);
  const formattedUpdatedAt = useMemo(() => formatTimestamp(project.updated_at), [project.updated_at]);

  const resetForm = () => {
    setName(project.name);
    setSlug(project.slug);
    setDescription(project.description ?? "");
    setSuccessMessage(null);
  };

  return (
    <div className="project-settings-layout">
      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Project Settings</h2>
            <p className="panel-copy">
              Update the project identity fields used throughout the delivery and management flows.
            </p>
          </div>
        </header>

        {updateProjectMutation.isError ? (
          <div className="banner error">{buildErrorMessage(updateProjectMutation.error)}</div>
        ) : null}
        {successMessage ? <div className="banner success">{successMessage}</div> : null}

        <div className="stack gap-md">
          <label className="field">
            <span>Project name</span>
            <input
              disabled={!canEditProject || updateProjectMutation.isPending}
              onChange={(event) => {
                setName(event.target.value);
                setSuccessMessage(null);
              }}
              value={name}
            />
          </label>

          <label className="field">
            <span>Slug</span>
            <input
              disabled={!canEditProject || updateProjectMutation.isPending}
              onChange={(event) => {
                setSlug(event.target.value);
                setSuccessMessage(null);
              }}
              value={slug}
            />
            <p className="field-hint warning">
              Changing the slug may break existing delivery URLs.
            </p>
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              className="textarea"
              disabled={!canEditProject || updateProjectMutation.isPending}
              onChange={(event) => {
                setDescription(event.target.value);
                setSuccessMessage(null);
              }}
              rows={5}
              value={description}
            />
          </label>
        </div>

        <div className="action-row">
          <button
            className="button primary"
            disabled={!canEditProject || !isDirty || updateProjectMutation.isPending}
            onClick={() => updateProjectMutation.mutate()}
            type="button"
          >
            {updateProjectMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          {isDirty ? (
            <button
              className="button ghost"
              disabled={updateProjectMutation.isPending}
              onClick={resetForm}
              type="button"
            >
              Revert
            </button>
          ) : null}
        </div>
      </article>

      <aside className="project-settings-sidebar">
        <article className="panel stack gap-md">
          <header className="panel-header">
            <div className="stack gap-sm">
              <h2>Project Details</h2>
              <p className="panel-copy">Read-only metadata from the current project model.</p>
            </div>
          </header>
          <MetaRow label="Created" value={formattedCreatedAt} />
          <MetaRow label="Updated" value={formattedUpdatedAt} />
          <MetaRow label="Owner" value={project.owner_user_id} />
          <MetaRow label="Slug" value={project.slug} />
          <MetaRow label="Project ID" value={project.id} />
        </article>

        <article className="panel stack gap-md">
          <header className="panel-header">
            <div className="stack gap-sm">
              <h2>Statistics</h2>
              <p className="panel-copy">Only data exposed by the current frontend and backend contracts is shown here.</p>
            </div>
          </header>
          <MetaRow label="Languages" value={String(languages.length)} />
          <MetaRow label="Namespaces" value={String(namespaces.length)} />
          <MetaRow label="Environments" value={String(environments.length)} />
          <MetaRow label="Translation keys" value="Unavailable" />
          <MetaRow label="Translation values" value="Unavailable" />
          <p className="muted">
            Translation key, translation value, and missing value totals are not available from the current project APIs.
          </p>
        </article>

        {languages.length > 0 && environments.length > 0 ? (
          <article className="panel stack gap-md">
            <ProjectDeliveryLinksPanel
              environments={environments}
              languages={languages}
              namespaces={namespaces}
              projectSlug={project.slug}
            />
          </article>
        ) : null}
      </aside>
    </div>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
