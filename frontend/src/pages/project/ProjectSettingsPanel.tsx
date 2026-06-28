import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiPut, apiDelete, buildErrorMessage, Project } from "../../api";
import { useTranslation } from "../../i18n";

export function ProjectSettingsPanel({
  project,
  canEditProject,
  canDeleteProject,
}: {
  project: Project;
  canEditProject: boolean;
  canDeleteProject: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectSlug, setEditProjectSlug] = useState("");
  const [editProjectDescription, setEditProjectDescription] = useState("");

  const updateProjectMutation = useMutation({
    mutationFn: async () =>
      apiPut(`/api/v1/projects/${project.slug}`, {
        name: editProjectName,
        slug: editProjectSlug,
        description: editProjectDescription || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setIsEditingProject(false);

      if (editProjectSlug !== project.slug) {
        navigate(`/projects/${editProjectSlug}`, { replace: true });
      }
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => apiDelete(`/api/v1/projects/${project.slug}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects", { replace: true });
    },
  });

  return (
    <div className="stack gap-md">
      <header className="panel-header">
        <h2>{t("project.settings.title")}</h2>
      </header>
      {updateProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(updateProjectMutation.error)}</div>
      ) : null}
      {deleteProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteProjectMutation.error)}</div>
      ) : null}

      {isEditingProject ? (
        <div className="stack gap-md">
          <div className="form-grid">
            <label className="field">
              <span>{t("project.fields.name")}</span>
              <input value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} />
            </label>
            <label className="field">
              <span>{t("project.fields.slug")}</span>
              <input value={editProjectSlug} onChange={(e) => setEditProjectSlug(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>{t("project.fields.description")}</span>
            <textarea
              className="textarea"
              rows={3}
              value={editProjectDescription}
              onChange={(e) => setEditProjectDescription(e.target.value)}
            />
          </label>
          <div className="action-row">
            <button
              className="button primary"
              disabled={updateProjectMutation.isPending}
              onClick={() => updateProjectMutation.mutate()}
            >
              {t("project.settings.save")}
            </button>
            <button className="button ghost" onClick={() => setIsEditingProject(false)}>
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack gap-sm">
          <p className="muted">{t("project.settings.description")}</p>
          <div className="action-row">
            <button
              className="button secondary"
              disabled={!canEditProject}
              onClick={() => {
                setEditProjectName(project.name);
                setEditProjectSlug(project.slug);
                setEditProjectDescription(project.description ?? "");
                setIsEditingProject(true);
              }}
            >
              {t("project.settings.edit")}
            </button>
            <button
              className="button ghost danger"
              disabled={deleteProjectMutation.isPending || !canDeleteProject}
              onClick={() => {
                if (window.confirm(t("project.settings.delete_confirm"))) {
                  deleteProjectMutation.mutate();
                }
              }}
            >
              {t("project.settings.delete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
