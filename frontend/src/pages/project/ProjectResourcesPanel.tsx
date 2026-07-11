import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Environment, Language, Namespace, apiDelete, apiGet, apiPost, buildErrorMessage } from "../../api";

type ResourceType = "languages" | "namespaces" | "environments";

export function ProjectResourcesPanel({
  projectSlug,
  canEditProject,
  resourceType,
}: {
  projectSlug: string;
  canEditProject: boolean;
  resourceType: ResourceType;
}) {
  switch (resourceType) {
    case "languages":
      return <LanguagesPanel canEditProject={canEditProject} projectSlug={projectSlug} />;
    case "namespaces":
      return <NamespacesPanel canEditProject={canEditProject} projectSlug={projectSlug} />;
    case "environments":
      return <EnvironmentsPanel canEditProject={canEditProject} projectSlug={projectSlug} />;
    default:
      return null;
  }
}

function LanguagesPanel({
  projectSlug,
  canEditProject,
}: {
  projectSlug: string;
  canEditProject: boolean;
}) {
  const queryClient = useQueryClient();
  const [newLanguageCode, setNewLanguageCode] = useState("");
  const [newLanguageName, setNewLanguageName] = useState("");

  const languagesQuery = useQuery({
    queryKey: ["project", projectSlug, "languages"],
    queryFn: () => apiGet<Language[]>(`/api/v1/projects/${projectSlug}/languages`),
    enabled: Boolean(projectSlug),
  });

  const createLanguageMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/languages`, {
        code: newLanguageCode,
        name: newLanguageName,
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

  return (
    <div className="project-resource-grid">
      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Languages</h2>
            <p className="panel-copy">Add locale codes that can receive translation values in this project.</p>
          </div>
        </header>
        <MutationErrors
          createError={createLanguageMutation.error}
          deleteError={deleteLanguageMutation.error}
          queryError={languagesQuery.error}
        />
        <div className="form-grid">
          <label className="field">
            <span>Language code</span>
            <input
              onChange={(event) => setNewLanguageCode(event.target.value)}
              placeholder="en"
              value={newLanguageCode}
            />
          </label>
          <label className="field">
            <span>Language name</span>
            <input
              onChange={(event) => setNewLanguageName(event.target.value)}
              placeholder="English"
              value={newLanguageName}
            />
          </label>
        </div>
        <div className="action-row">
          <button
            className="button secondary"
            disabled={
              createLanguageMutation.isPending ||
              !canEditProject ||
              !newLanguageCode.trim() ||
              !newLanguageName.trim()
            }
            onClick={() => createLanguageMutation.mutate()}
            type="button"
          >
            {createLanguageMutation.isPending ? "Adding..." : "Add language"}
          </button>
        </div>
      </article>

      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Current Languages</h2>
            <p className="panel-copy">Existing language records for this project.</p>
          </div>
          <span className="badge">{languagesQuery.data?.length ?? 0}</span>
        </header>
        {languagesQuery.isLoading ? <p className="muted">Loading languages...</p> : null}
        <ResourceList
          items={(languagesQuery.data ?? []).map((item) => ({
            id: item.id,
            title: item.code,
            subtitle: item.name,
            secondary: `Updated ${formatShortDate(item.updated_at)}`,
            action: (
              <button
                className="button ghost danger"
                disabled={deleteLanguageMutation.isPending || !canEditProject}
                onClick={() => deleteLanguageMutation.mutate(item.code)}
                type="button"
              >
                Delete
              </button>
            ),
          }))}
        />
      </article>
    </div>
  );
}

function NamespacesPanel({
  projectSlug,
  canEditProject,
}: {
  projectSlug: string;
  canEditProject: boolean;
}) {
  const queryClient = useQueryClient();
  const [newNamespaceName, setNewNamespaceName] = useState("");

  const namespacesQuery = useQuery({
    queryKey: ["project", projectSlug, "namespaces"],
    queryFn: () => apiGet<Namespace[]>(`/api/v1/projects/${projectSlug}/namespaces`),
    enabled: Boolean(projectSlug),
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

  return (
    <div className="project-resource-grid">
      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Namespaces</h2>
            <p className="panel-copy">Keep translation keys grouped by namespace without changing the backend contract.</p>
          </div>
        </header>
        <MutationErrors
          createError={createNamespaceMutation.error}
          deleteError={deleteNamespaceMutation.error}
          queryError={namespacesQuery.error}
        />
        <label className="field">
          <span>Namespace name</span>
          <input
            onChange={(event) => setNewNamespaceName(event.target.value)}
            placeholder="common"
            value={newNamespaceName}
          />
        </label>
        <div className="action-row">
          <button
            className="button secondary"
            disabled={createNamespaceMutation.isPending || !canEditProject || !newNamespaceName.trim()}
            onClick={() => createNamespaceMutation.mutate()}
            type="button"
          >
            {createNamespaceMutation.isPending ? "Adding..." : "Add namespace"}
          </button>
        </div>
      </article>

      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Current Namespaces</h2>
            <p className="panel-copy">Namespace records currently attached to this project.</p>
          </div>
          <span className="badge">{namespacesQuery.data?.length ?? 0}</span>
        </header>
        {namespacesQuery.isLoading ? <p className="muted">Loading namespaces...</p> : null}
        <ResourceList
          items={(namespacesQuery.data ?? []).map((item) => ({
            id: item.id,
            title: item.name,
            secondary: `Updated ${formatShortDate(item.updated_at)}`,
            action: (
              <button
                className="button ghost danger"
                disabled={deleteNamespaceMutation.isPending || !canEditProject}
                onClick={() => deleteNamespaceMutation.mutate(item.name)}
                type="button"
              >
                Delete
              </button>
            ),
          }))}
        />
      </article>
    </div>
  );
}

function EnvironmentsPanel({
  projectSlug,
  canEditProject,
}: {
  projectSlug: string;
  canEditProject: boolean;
}) {
  const queryClient = useQueryClient();
  const [newEnvironmentName, setNewEnvironmentName] = useState("");
  const [newEnvironmentSlug, setNewEnvironmentSlug] = useState("");

  const environmentsQuery = useQuery({
    queryKey: ["project", projectSlug, "environments"],
    queryFn: () => apiGet<Environment[]>(`/api/v1/projects/${projectSlug}/environments`),
    enabled: Boolean(projectSlug),
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
    <div className="project-resource-grid">
      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Environments</h2>
            <p className="panel-copy">Manage project delivery targets such as development, staging, and production.</p>
          </div>
        </header>
        <MutationErrors
          createError={createEnvironmentMutation.error}
          deleteError={deleteEnvironmentMutation.error}
          queryError={environmentsQuery.error}
        />
        <div className="form-grid">
          <label className="field">
            <span>Environment name</span>
            <input
              onChange={(event) => setNewEnvironmentName(event.target.value)}
              placeholder="Production"
              value={newEnvironmentName}
            />
          </label>
          <label className="field">
            <span>Environment slug</span>
            <input
              onChange={(event) => setNewEnvironmentSlug(event.target.value)}
              placeholder="production"
              value={newEnvironmentSlug}
            />
          </label>
        </div>
        <div className="action-row">
          <button
            className="button secondary"
            disabled={
              createEnvironmentMutation.isPending ||
              !canEditProject ||
              !newEnvironmentName.trim() ||
              !newEnvironmentSlug.trim()
            }
            onClick={() => createEnvironmentMutation.mutate()}
            type="button"
          >
            {createEnvironmentMutation.isPending ? "Adding..." : "Add environment"}
          </button>
        </div>
      </article>

      <article className="panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2>Current Environments</h2>
            <p className="panel-copy">Delivery environments available for this project.</p>
          </div>
          <span className="badge">{environmentsQuery.data?.length ?? 0}</span>
        </header>
        {environmentsQuery.isLoading ? <p className="muted">Loading environments...</p> : null}
        <ResourceList
          items={(environmentsQuery.data ?? []).map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: item.slug,
            secondary: `Updated ${formatShortDate(item.updated_at)}`,
            action: (
              <button
                className="button ghost danger"
                disabled={deleteEnvironmentMutation.isPending || !canEditProject}
                onClick={() => deleteEnvironmentMutation.mutate(item.slug)}
                type="button"
              >
                Delete
              </button>
            ),
          }))}
        />
      </article>
    </div>
  );
}

function MutationErrors({
  queryError,
  createError,
  deleteError,
}: {
  queryError: unknown;
  createError: unknown;
  deleteError: unknown;
}) {
  return (
    <>
      {queryError ? <div className="banner error">{buildErrorMessage(queryError)}</div> : null}
      {createError ? <div className="banner error">{buildErrorMessage(createError)}</div> : null}
      {deleteError ? <div className="banner error">{buildErrorMessage(deleteError)}</div> : null}
    </>
  );
}

function ResourceList({
  items,
}: {
  items: Array<{
    id: string;
    title: string;
    subtitle?: string;
    secondary: string;
    action: ReactNode;
  }>;
}) {
  if (items.length === 0) {
    return <p className="muted">Nothing to show yet.</p>;
  }

  return (
    <div className="project-resource-list">
      {items.map((item) => (
        <div className="resource-item-card" key={item.id}>
          <div className="stack gap-sm">
            <strong>{item.title}</strong>
            {item.subtitle ? <span className="muted">{item.subtitle}</span> : null}
            <span className="muted">{item.secondary}</span>
          </div>
          {item.action}
        </div>
      ))}
    </div>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}
