import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
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
      setIsCreateDialogOpen(false);
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
          {canEditProject ? (
            <button className="button primary" onClick={() => setIsCreateDialogOpen(true)} type="button">
              New language
            </button>
          ) : null}
        </header>
        <MutationErrors
          createError={null}
          deleteError={deleteLanguageMutation.error}
          queryError={languagesQuery.error}
        />
        <p className="muted">Create new languages through a dedicated modal to keep the resource workspace compact.</p>
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
                onClick={() => {
                  if (window.confirm(`Delete language "${item.code}" from this project?`)) {
                    deleteLanguageMutation.mutate(item.code);
                  }
                }}
                type="button"
              >
                Delete
              </button>
            ),
          }))}
        />
      </article>

      <CreateLanguageDialog
        canEditProject={canEditProject}
        code={newLanguageCode}
        error={createLanguageMutation.error}
        isPending={createLanguageMutation.isPending}
        name={newLanguageName}
        open={isCreateDialogOpen}
        onChangeCode={setNewLanguageCode}
        onChangeName={setNewLanguageName}
        onClose={() => {
          setIsCreateDialogOpen(false);
          createLanguageMutation.reset();
        }}
        onSubmit={() => createLanguageMutation.mutate()}
      />
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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
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
      setIsCreateDialogOpen(false);
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
          {canEditProject ? (
            <button className="button primary" onClick={() => setIsCreateDialogOpen(true)} type="button">
              New namespace
            </button>
          ) : null}
        </header>
        <MutationErrors
          createError={null}
          deleteError={deleteNamespaceMutation.error}
          queryError={namespacesQuery.error}
        />
        <p className="muted">Create new namespaces through a dedicated modal to keep the resource workspace compact.</p>
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
                onClick={() => {
                  if (window.confirm(`Delete namespace "${item.name}" from this project?`)) {
                    deleteNamespaceMutation.mutate(item.name);
                  }
                }}
                type="button"
              >
                Delete
              </button>
            ),
          }))}
        />
      </article>

      <CreateNamespaceDialog
        canEditProject={canEditProject}
        isPending={createNamespaceMutation.isPending}
        name={newNamespaceName}
        open={isCreateDialogOpen}
        error={createNamespaceMutation.error}
        onChangeName={setNewNamespaceName}
        onClose={() => {
          setIsCreateDialogOpen(false);
          createNamespaceMutation.reset();
        }}
        onSubmit={() => createNamespaceMutation.mutate()}
      />
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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [environmentPendingDelete, setEnvironmentPendingDelete] = useState<Pick<Environment, "name" | "slug"> | null>(null);
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
      setIsCreateDialogOpen(false);
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
          {canEditProject ? (
            <button className="button primary" onClick={() => setIsCreateDialogOpen(true)} type="button">
              New environment
            </button>
          ) : null}
        </header>
        <MutationErrors
          createError={null}
          deleteError={deleteEnvironmentMutation.error}
          queryError={environmentsQuery.error}
        />
        <p className="muted">Create new delivery targets through a modal to keep the resource workspace compact.</p>
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
                onClick={() => setEnvironmentPendingDelete({ name: item.name, slug: item.slug })}
                type="button"
              >
                Delete
              </button>
            ),
          }))}
        />
      </article>

      <CreateEnvironmentDialog
        canEditProject={canEditProject}
        error={createEnvironmentMutation.error}
        isPending={createEnvironmentMutation.isPending}
        name={newEnvironmentName}
        open={isCreateDialogOpen}
        slug={newEnvironmentSlug}
        onChangeName={setNewEnvironmentName}
        onChangeSlug={setNewEnvironmentSlug}
        onClose={() => {
          setIsCreateDialogOpen(false);
          createEnvironmentMutation.reset();
        }}
        onSubmit={() => createEnvironmentMutation.mutate()}
      />

      <DeleteEnvironmentDialog
        environment={environmentPendingDelete}
        isPending={deleteEnvironmentMutation.isPending}
        onClose={() => setEnvironmentPendingDelete(null)}
        onConfirm={() => {
          if (!environmentPendingDelete) {
            return;
          }
          deleteEnvironmentMutation.mutate(environmentPendingDelete.slug, {
            onSuccess: () => {
              setEnvironmentPendingDelete(null);
            },
          });
        }}
      />
    </div>
  );
}

function CreateNamespaceDialog({
  open,
  name,
  isPending,
  error,
  canEditProject,
  onChangeName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  name: string;
  isPending: boolean;
  error: unknown;
  canEditProject: boolean;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      onChangeName("");
    }
  }, [open, onChangeName]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-namespace-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="create-namespace-title">New namespace</h2>
            <p className="panel-copy">Create a namespace without leaving the current project resources workspace.</p>
          </div>
          <button aria-label="Close create namespace dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {error ? <div className="banner error">{buildErrorMessage(error)}</div> : null}

        <label className="field">
          <span>Namespace name</span>
          <input onChange={(event) => onChangeName(event.target.value)} placeholder="common" value={name} />
        </label>

        <div className="action-row">
          <button
            className="button primary"
            disabled={isPending || !canEditProject || !name.trim()}
            onClick={onSubmit}
            type="button"
          >
            {isPending ? "Creating..." : "Create namespace"}
          </button>
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateLanguageDialog({
  open,
  code,
  name,
  isPending,
  error,
  canEditProject,
  onChangeCode,
  onChangeName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  code: string;
  name: string;
  isPending: boolean;
  error: unknown;
  canEditProject: boolean;
  onChangeCode: (value: string) => void;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      onChangeCode("");
      onChangeName("");
    }
  }, [open, onChangeCode, onChangeName]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-language-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="create-language-title">New language</h2>
            <p className="panel-copy">Create a language without leaving the current project resources workspace.</p>
          </div>
          <button aria-label="Close create language dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {error ? <div className="banner error">{buildErrorMessage(error)}</div> : null}

        <div className="form-grid">
          <label className="field">
            <span>Language code</span>
            <input onChange={(event) => onChangeCode(event.target.value)} placeholder="en" value={code} />
          </label>
          <label className="field">
            <span>Language name</span>
            <input onChange={(event) => onChangeName(event.target.value)} placeholder="English" value={name} />
          </label>
        </div>

        <div className="action-row">
          <button
            className="button primary"
            disabled={isPending || !canEditProject || !code.trim() || !name.trim()}
            onClick={onSubmit}
            type="button"
          >
            {isPending ? "Creating..." : "Create language"}
          </button>
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateEnvironmentDialog({
  open,
  name,
  slug,
  isPending,
  error,
  canEditProject,
  onChangeName,
  onChangeSlug,
  onClose,
  onSubmit,
}: {
  open: boolean;
  name: string;
  slug: string;
  isPending: boolean;
  error: unknown;
  canEditProject: boolean;
  onChangeName: (value: string) => void;
  onChangeSlug: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) {
      onChangeName("");
      onChangeSlug("");
    }
  }, [open, onChangeName, onChangeSlug]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="create-environment-title">
      <div className="modal-card panel stack gap-md">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="create-environment-title">New environment</h2>
            <p className="panel-copy">Create a delivery environment without leaving the current project resources workspace.</p>
          </div>
          <button aria-label="Close create environment dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        {error ? <div className="banner error">{buildErrorMessage(error)}</div> : null}

        <div className="form-grid">
          <label className="field">
            <span>Environment name</span>
            <input onChange={(event) => onChangeName(event.target.value)} placeholder="Production" value={name} />
          </label>
          <label className="field">
            <span>Environment slug</span>
            <input onChange={(event) => onChangeSlug(event.target.value)} placeholder="production" value={slug} />
          </label>
        </div>

        <div className="action-row">
          <button
            className="button primary"
            disabled={isPending || !canEditProject || !name.trim() || !slug.trim()}
            onClick={onSubmit}
            type="button"
          >
            {isPending ? "Creating..." : "Create environment"}
          </button>
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteEnvironmentDialog({
  environment,
  isPending,
  onClose,
  onConfirm,
}: {
  environment: { name: string; slug: string } | null;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!environment) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-environment-title">
      <div className="modal-card panel stack gap-md danger-panel">
        <header className="panel-header">
          <div className="stack gap-sm">
            <h2 id="delete-environment-title">Delete environment</h2>
            <p className="panel-copy">
              This removes the environment <strong>{environment.name}</strong> and its translation values from the current project.
            </p>
          </div>
          <button aria-label="Close delete environment dialog" className="button ghost" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="banner warning">
          Environment deletion cannot be undone. Related translation values for this environment are removed by the database cascade.
        </div>

        <div className="action-row">
          <button className="button ghost danger" disabled={isPending} onClick={onConfirm} type="button">
            {isPending ? "Deleting..." : "Delete environment"}
          </button>
          <button className="button ghost" disabled={isPending} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
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
