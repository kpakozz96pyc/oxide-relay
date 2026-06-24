import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete, buildErrorMessage, Environment, Language, Namespace } from "../../api";

export function ProjectResourcesPanel({
  projectSlug,
  canEditProject,
}: {
  projectSlug: string;
  canEditProject: boolean;
}) {
  const queryClient = useQueryClient();

  const [newLanguageCode, setNewLanguageCode] = useState("");
  const [newLanguageName, setNewLanguageName] = useState("");
  const [newNamespaceName, setNewNamespaceName] = useState("");
  const [newEnvironmentName, setNewEnvironmentName] = useState("");
  const [newEnvironmentSlug, setNewEnvironmentSlug] = useState("");

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

  const createLanguageMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/languages`, {
        code: newLanguageCode,
        name: newLanguageName || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "languages"] });
      setNewLanguageCode("");
      setNewLanguageName("");
    },
  });

  const deleteLanguageMutation = useMutation({
    mutationFn: async (code: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/languages/${code}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "languages"] });
    },
  });

  const createNamespaceMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/namespaces`, {
        name: newNamespaceName,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "namespaces"] });
      setNewNamespaceName("");
    },
  });

  const deleteNamespaceMutation = useMutation({
    mutationFn: async (name: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/namespaces/${name}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "namespaces"] });
    },
  });

  const createEnvironmentMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/environments`, {
        name: newEnvironmentName,
        slug: newEnvironmentSlug,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "environments"] });
      setNewEnvironmentName("");
      setNewEnvironmentSlug("");
    },
  });

  const deleteEnvironmentMutation = useMutation({
    mutationFn: async (slug: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/environments/${slug}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "environments"] });
    },
  });

  return (
    <>
      <div className="stack gap-md">
        <header className="panel-header">
          <h2>Languages</h2>
        </header>
        <div className="form-grid">
          <label className="field">
            <span>Code</span>
            <input value={newLanguageCode} onChange={(event) => setNewLanguageCode(event.target.value)} placeholder="en" />
          </label>
          <label className="field">
            <span>Name (optional)</span>
            <input value={newLanguageName} onChange={(event) => setNewLanguageName(event.target.value)} placeholder="English" />
          </label>
        </div>
        <button
          className="button secondary"
          disabled={createLanguageMutation.isPending || !canEditProject || !newLanguageCode.trim()}
          onClick={() => createLanguageMutation.mutate()}
        >
          Add language
        </button>
        {languagesQuery.data?.map((item) => (
          <div className="member-card" key={item.id}>
            <div className="stack gap-sm">
              <strong>{item.code}</strong>
              <span className="muted">{item.name}</span>
            </div>
            <button
              className="button ghost danger"
              disabled={deleteLanguageMutation.isPending || !canEditProject}
              onClick={() => deleteLanguageMutation.mutate(item.code)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="divider" />
      <div className="stack gap-md">
        <header className="panel-header">
          <h2>Namespaces</h2>
        </header>
        <label className="field">
          <span>Name</span>
          <input value={newNamespaceName} onChange={(event) => setNewNamespaceName(event.target.value)} placeholder="common" />
        </label>
        <button
          className="button secondary"
          disabled={createNamespaceMutation.isPending || !canEditProject || !newNamespaceName.trim()}
          onClick={() => createNamespaceMutation.mutate()}
        >
          Add namespace
        </button>
        {namespacesQuery.data?.map((item) => (
          <div className="member-card" key={item.id}>
            <div className="stack gap-sm">
              <strong>{item.name}</strong>
            </div>
            <button
              className="button ghost danger"
              disabled={deleteNamespaceMutation.isPending || !canEditProject}
              onClick={() => deleteNamespaceMutation.mutate(item.name)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="divider" />
      <div className="stack gap-md">
        <header className="panel-header">
          <h2>Environments</h2>
        </header>
        <div className="form-grid">
          <label className="field">
            <span>Name</span>
            <input value={newEnvironmentName} onChange={(event) => setNewEnvironmentName(event.target.value)} placeholder="Production" />
          </label>
          <label className="field">
            <span>Slug</span>
            <input value={newEnvironmentSlug} onChange={(event) => setNewEnvironmentSlug(event.target.value)} placeholder="production" />
          </label>
        </div>
        <button
          className="button secondary"
          disabled={createEnvironmentMutation.isPending || !canEditProject || !newEnvironmentName.trim() || !newEnvironmentSlug.trim()}
          onClick={() => createEnvironmentMutation.mutate()}
        >
          Add environment
        </button>
        {environmentsQuery.data?.map((item) => (
          <div className="member-card" key={item.id}>
            <div className="stack gap-sm">
              <strong>{item.name}</strong>
              <span className="muted">{item.slug}</span>
            </div>
            <button
              className="button ghost danger"
              disabled={deleteEnvironmentMutation.isPending || !canEditProject}
              onClick={() => deleteEnvironmentMutation.mutate(item.slug)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
