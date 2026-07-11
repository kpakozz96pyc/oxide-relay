import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Project, apiDelete, buildErrorMessage } from "../../api";

export function ProjectDangerZonePanel({
  project,
  canDeleteProject,
}: {
  project: Project;
  canDeleteProject: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmationSlug, setConfirmationSlug] = useState("");

  const deleteProjectMutation = useMutation({
    mutationFn: async () => apiDelete(`/api/v1/projects/${project.slug}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects", { replace: true });
    },
  });

  return (
    <article className="panel stack gap-md danger-panel">
      <header className="panel-header">
        <div className="stack gap-sm">
          <h2>Danger Zone</h2>
          <p className="panel-copy">
            Deleting a project removes its languages, namespaces, environments, translation keys, translation values, and membership records.
          </p>
        </div>
      </header>

      {deleteProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteProjectMutation.error)}</div>
      ) : null}

      <div className="danger-box">
        <div className="stack gap-sm">
          <strong>Delete project</strong>
          <p className="muted">
            Type <code>{project.slug}</code> to confirm permanent deletion.
          </p>
        </div>

        <label className="field">
          <span>Project slug confirmation</span>
          <input
            onChange={(event) => setConfirmationSlug(event.target.value)}
            placeholder={project.slug}
            value={confirmationSlug}
          />
        </label>

        <div className="action-row">
          <button
            className="button ghost danger"
            disabled={
              deleteProjectMutation.isPending ||
              !canDeleteProject ||
              confirmationSlug.trim() !== project.slug
            }
            onClick={() => {
              if (window.confirm(`Delete project "${project.name}"? This action cannot be undone.`)) {
                deleteProjectMutation.mutate();
              }
            }}
            type="button"
          >
            {deleteProjectMutation.isPending ? "Deleting..." : "Delete project"}
          </button>
        </div>

        {!canDeleteProject ? (
          <div className="banner info">Only the owner or a user with project deletion permission can delete this project.</div>
        ) : null}
      </div>
    </article>
  );
}
