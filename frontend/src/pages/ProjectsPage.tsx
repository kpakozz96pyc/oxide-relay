import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiDelete, buildErrorMessage, Project } from "../api";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { LoadingScreen } from "../components/LoadingScreen";
import { ErrorCard } from "../components/ErrorCard";

export function ProjectsPage() {
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectSlug, setNewProjectSlug] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectSlug, setEditProjectSlug] = useState("");
  const [editProjectDescription, setEditProjectDescription] = useState("");
  const queryClient = useQueryClient();
  const permissionSet = usePermissionSet();

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

  const updateProjectMutation = useMutation({
    mutationFn: async () => {
      const project = projects.find((item) => item.id === editingProjectId);
      if (!project) {
        throw new Error("No project selected for editing.");
      }
      return apiPut(`/api/v1/projects/${project.slug}`, {
        name: editProjectName,
        slug: editProjectSlug,
        description: editProjectDescription || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setEditingProjectId(null);
      setEditProjectName("");
      setEditProjectSlug("");
      setEditProjectDescription("");
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectSlug: string) => apiDelete(`/api/v1/projects/${projectSlug}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (projectsQuery.isLoading) {
    return <LoadingScreen label="Loading projects" compact />;
  }

  if (projectsQuery.isError) {
    return <ErrorCard title="Projects are unavailable" message={buildErrorMessage(projectsQuery.error)} />;
  }

  const projects = projectsQuery.data ?? [];
  const canCreateProjects = permissionSet.has("CreateProjects");

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h1 className="page-title">Owned and assigned projects</h1>
        </div>
        <span className="badge">{projects.length} visible</span>
      </header>

      {createProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createProjectMutation.error)}</div>
      ) : null}
      {updateProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(updateProjectMutation.error)}</div>
      ) : null}
      {deleteProjectMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteProjectMutation.error)}</div>
      ) : null}

      <article className="panel stack gap-md">
        <header className="panel-header">
          <h2>Create project</h2>
        </header>
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
          </label>
          <label className="field">
            <span>Slug</span>
            <input value={newProjectSlug} onChange={(event) => setNewProjectSlug(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
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
          Create project
        </button>
      </article>

      <div className="project-grid">
        {projects.map((project) => (
          <div className="project-card" key={project.id}>
            <div className="stack gap-sm">
              <span className="badge subtle">{project.is_owner ? "Owner" : "Member"}</span>
              {editingProjectId === project.id ? (
                <>
                  <input value={editProjectName} onChange={(event) => setEditProjectName(event.target.value)} />
                  <input value={editProjectSlug} onChange={(event) => setEditProjectSlug(event.target.value)} />
                  <textarea
                    className="textarea"
                    rows={4}
                    value={editProjectDescription}
                    onChange={(event) => setEditProjectDescription(event.target.value)}
                  />
                </>
              ) : (
                <>
                  <h2>{project.name}</h2>
                  <p>{project.description ?? "No description yet."}</p>
                </>
              )}
            </div>
            <div className="action-row">
              {editingProjectId === project.id ? (
                <>
                  <button className="button secondary" disabled={updateProjectMutation.isPending} onClick={() => updateProjectMutation.mutate()}>
                    Save
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => {
                      setEditingProjectId(null);
                      setEditProjectName("");
                      setEditProjectSlug("");
                      setEditProjectDescription("");
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <a className="project-link" href={`/projects/${project.slug}`}>
                    Open project
                  </a>
                  <button
                    className="button secondary"
                    disabled={!project.is_owner && !permissionSet.has("EditProjects")}
                    onClick={() => {
                      setEditingProjectId(project.id);
                      setEditProjectName(project.name);
                      setEditProjectSlug(project.slug);
                      setEditProjectDescription(project.description ?? "");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="button ghost danger"
                    disabled={
                      deleteProjectMutation.isPending ||
                      (!project.is_owner && !permissionSet.has("DeleteProjects"))
                    }
                    onClick={() => deleteProjectMutation.mutate(project.slug)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
