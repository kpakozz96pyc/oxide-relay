import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Project, apiPost, buildErrorMessage } from "../../api";

export function CreateProjectDialog({
  open,
  canCreateProjects,
  onClose,
  onCreated,
}: {
  open: boolean;
  canCreateProjects: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setDescription("");
    }
  }, [open]);

  const createProjectMutation = useMutation({
    mutationFn: async () =>
      apiPost<Project>("/api/v1/projects", {
        name,
        slug,
        description: description.trim() || null,
      }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onCreated(project);
      onClose();
    },
  });

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="create-project-title">New project</h2>
            <p className="panel-copy">Create a project with its default language, namespace, and delivery environments.</p>
          </div>
          <button aria-label="Close create project dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {createProjectMutation.isError ? (
          <div className="banner error">{buildErrorMessage(createProjectMutation.error)}</div>
        ) : null}

        <div className="stack gap-md">
          <label className="field">
            <span>Project name</span>
            <input onChange={(event) => setName(event.target.value)} value={name} />
          </label>
          <label className="field">
            <span>Slug</span>
            <input onChange={(event) => setSlug(event.target.value)} placeholder="my-project" value={slug} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              className="textarea"
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              value={description}
            />
          </label>
        </div>

        <div className="action-row">
          <button
            className="button primary"
            disabled={createProjectMutation.isPending || !canCreateProjects || !name.trim() || !slug.trim()}
            onClick={() => createProjectMutation.mutate()}
            type="button"
          >
            {createProjectMutation.isPending ? "Creating..." : "Create project"}
          </button>
          <button className="button ghost" disabled={createProjectMutation.isPending} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
