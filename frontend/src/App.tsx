import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, startTransition } from "react";

import {
  ApiError,
  CurrentPermissionsResponse,
  Environment,
  Language,
  Namespace,
  Permission,
  ProjectMember,
  Project,
  Translation,
  User,
  apiGet,
  apiDelete,
  apiPost,
  apiPut,
  buildErrorMessage,
} from "./api";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/projects/:projectSlug" element={<ProjectPage />} />
      </Route>
    </Routes>
  );
}

function RequireAuth() {
  const location = useLocation();
  const session = useSession();

  if (session.isLoading) {
    return <LoadingScreen label="Restoring session" />;
  }

  if (!session.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <AppLayout user={session.user} onLogout={session.logout}><Outlet /></AppLayout>;
}

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin-password");
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | undefined)?.from ?? "/projects";

  const loginMutation = useMutation({
    mutationFn: async () =>
      apiPost("/api/v1/auth/login", {
        email,
        password,
      }),
    onSuccess: async () => {
      await session.refresh();
      startTransition(() => navigate(from, { replace: true }));
    },
    onError: (loginError: ApiError) => {
      setError(buildErrorMessage(loginError));
    },
  });

  useEffect(() => {
    if (!session.isLoading && session.user) {
      navigate("/projects", { replace: true });
    }
  }, [navigate, session.isLoading, session.user]);

  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="eyebrow">OxideRelay Admin</p>
        <h1 className="panel-title">Sign in to manage translations.</h1>
        <p className="panel-copy">
          The frontend is now wired to the real backend session API. Sign in with an existing
          admin or project user account.
        </p>

        <form
          className="stack gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            loginMutation.mutate();
          }}
        >
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <div className="banner error">{error}</div> : null}
          <button className="button primary" disabled={loginMutation.isPending} type="submit">
            {loginMutation.isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </section>
    </main>
  );
}

function ProjectsPage() {
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

function ProjectPage() {
  const { projectSlug = "" } = useParams();
  const [environment, setEnvironment] = useState("");
  const [language, setLanguage] = useState("");
  const [namespace, setNamespace] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingTranslationId, setEditingTranslationId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [importJson, setImportJson] = useState(
    JSON.stringify(
      {
        "button.confirm": "Confirm",
        "button.reject": "Reject",
      },
      null,
      2,
    ),
  );
  const [memberUserId, setMemberUserId] = useState("");
  const [newLanguageCode, setNewLanguageCode] = useState("");
  const [newLanguageName, setNewLanguageName] = useState("");
  const [newNamespaceName, setNewNamespaceName] = useState("");
  const [newEnvironmentName, setNewEnvironmentName] = useState("");
  const [newEnvironmentSlug, setNewEnvironmentSlug] = useState("");
  const queryClient = useQueryClient();
  const permissionSet = usePermissionSet();

  const projectQuery = useQuery({
    queryKey: ["project", projectSlug],
    queryFn: () => apiGet<Project>(`/api/v1/projects/${projectSlug}`),
  });

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

  const canViewMembers = Boolean(projectQuery.data?.is_owner) || permissionSet.has("ManageProjectMembers");
  const membersQuery = useQuery({
    queryKey: ["project", projectSlug, "members"],
    queryFn: () => apiGet<ProjectMember[]>(`/api/v1/projects/${projectSlug}/members`),
    enabled: Boolean(projectSlug) && canViewMembers,
  });

  useEffect(() => {
    if (!environment && environmentsQuery.data?.[0]) {
      setEnvironment(environmentsQuery.data[0].slug);
    }
  }, [environment, environmentsQuery.data]);

  useEffect(() => {
    if (!language && languagesQuery.data?.[0]) {
      setLanguage(languagesQuery.data[0].code);
    }
  }, [language, languagesQuery.data]);

  useEffect(() => {
    if (!namespace && namespacesQuery.data?.[0]) {
      setNamespace(namespacesQuery.data[0].name);
    }
  }, [namespace, namespacesQuery.data]);

  const translationsQuery = useQuery({
    queryKey: ["project", projectSlug, "translations", environment, language, namespace],
    queryFn: () =>
      apiGet<Translation[]>(
        `/api/v1/projects/${projectSlug}/translations?environment=${encodeURIComponent(environment)}&language=${encodeURIComponent(language)}&namespace=${encodeURIComponent(namespace)}`,
      ),
    enabled:
      Boolean(projectSlug && environment && language && namespace) &&
      (Boolean(projectQuery.data?.is_owner) ||
        (permissionSet.has("ReadTranslations") &&
          permissionSet.has(readEnvironmentPermission(environment)))),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const values = JSON.parse(importJson) as Record<string, string>;
      return apiPost(`/api/v1/projects/${projectSlug}/imports/json`, {
        environment,
        language,
        namespace,
        values,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/translations`, {
        environment,
        language,
        namespace,
        key: newKey,
        value: newValue,
        description: newDescription || undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
      setNewKey("");
      setNewValue("");
      setNewDescription("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingTranslationId) {
        throw new Error("No translation selected for editing.");
      }
      return apiPut(`/api/v1/projects/${projectSlug}/translations/${editingTranslationId}`, {
        value: editValue,
        description: editDescription || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
      setEditingTranslationId(null);
      setEditValue("");
      setEditDescription("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (translationId: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/translations/${translationId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async () =>
      apiPost(`/api/v1/projects/${projectSlug}/members`, {
        user_id: memberUserId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "members"] });
      setMemberUserId("");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => apiDelete(`/api/v1/projects/${projectSlug}/members/${userId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "members"] });
    },
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
    mutationFn: async (languageCode: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/languages/${languageCode}`),
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
    mutationFn: async (namespaceName: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/namespaces/${namespaceName}`),
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
    mutationFn: async (environmentSlug: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/environments/${environmentSlug}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "environments"] });
    },
  });

  if (projectQuery.isLoading || languagesQuery.isLoading || namespacesQuery.isLoading || environmentsQuery.isLoading) {
    return <LoadingScreen label="Loading project workspace" compact />;
  }

  if (projectQuery.isError) {
    return <ErrorCard title="Project is unavailable" message={buildErrorMessage(projectQuery.error)} />;
  }

  const project = projectQuery.data;
  if (!project) {
    return <ErrorCard title="Project is unavailable" message="Project data was not returned by the API." />;
  }

  const canEditProject = project.is_owner || permissionSet.has("EditProjects");
  const canManageMembers = project.is_owner || permissionSet.has("ManageProjectMembers");
  const canReadCurrentEnvironment = project.is_owner || permissionSet.has(readEnvironmentPermission(environment));
  const canEditCurrentEnvironment = project.is_owner || permissionSet.has(editEnvironmentPermission(environment));
  const canCreateTranslation =
    project.is_owner ||
    (permissionSet.has("EditTranslations") && canEditCurrentEnvironment);
  const canDeleteTranslation =
    project.is_owner ||
    (permissionSet.has("DeleteTranslations") && canEditCurrentEnvironment);
  const canImportTranslations =
    project.is_owner ||
    (permissionSet.has("ImportTranslations") && canEditCurrentEnvironment);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.is_owner ? "Owner Workspace" : "Member Workspace"}</p>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-description">{project.description ?? "No description yet."}</p>
        </div>
        <a className="button ghost" href="/projects">
          Back to projects
        </a>
      </header>

      <div className="toolbar">
        <label className="field small">
          <span>Environment</span>
          <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            {environmentsQuery.data?.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>Language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languagesQuery.data?.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>Namespace</span>
          <select value={namespace} onChange={(event) => setNamespace(event.target.value)}>
            {namespacesQuery.data?.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={createMutation.isPending || !canCreateTranslation}
          onClick={() => createMutation.mutate()}
        >
          Create translation
        </button>
        <button
          className="button secondary"
          disabled={importMutation.isPending || !canImportTranslations}
          onClick={() => importMutation.mutate()}
        >
          Import JSON
        </button>
      </div>

      {createMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createMutation.error)}</div>
      ) : null}
      {importMutation.isError ? (
        <div className="banner error">{buildErrorMessage(importMutation.error)}</div>
      ) : null}
      {updateMutation.isError ? (
        <div className="banner error">{buildErrorMessage(updateMutation.error)}</div>
      ) : null}
      {deleteMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteMutation.error)}</div>
      ) : null}
      {addMemberMutation.isError ? (
        <div className="banner error">{buildErrorMessage(addMemberMutation.error)}</div>
      ) : null}
      {removeMemberMutation.isError ? (
        <div className="banner error">{buildErrorMessage(removeMemberMutation.error)}</div>
      ) : null}
      {createLanguageMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createLanguageMutation.error)}</div>
      ) : null}
      {deleteLanguageMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteLanguageMutation.error)}</div>
      ) : null}
      {createNamespaceMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createNamespaceMutation.error)}</div>
      ) : null}
      {deleteNamespaceMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteNamespaceMutation.error)}</div>
      ) : null}
      {createEnvironmentMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createEnvironmentMutation.error)}</div>
      ) : null}
      {deleteEnvironmentMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteEnvironmentMutation.error)}</div>
      ) : null}

      <div className="workspace-grid">
        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>Translations</h2>
            <span className="badge">{translationsQuery.data?.length ?? 0}</span>
          </header>
          <div className="stack gap-md">
            <div className="form-grid">
              <label className="field">
                <span>Key</span>
                <input value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="button.save" />
              </label>
              <label className="field">
                <span>Value</span>
                <input value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="Save" />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <input
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Optional description"
              />
            </label>
            <label className="field">
              <span>Import JSON</span>
              <textarea
                className="textarea"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={7}
              />
            </label>
          </div>
          {!canReadCurrentEnvironment ? (
            <div className="banner error">
              You do not have permission to read translations for the selected environment.
            </div>
          ) : null}
          {translationsQuery.isLoading ? <p className="muted">Loading translations...</p> : null}
          {translationsQuery.isError ? (
            <div className="banner error">{buildErrorMessage(translationsQuery.error)}</div>
          ) : null}
          {translationsQuery.data ? (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                    <th>Description</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {translationsQuery.data.map((translation) => (
                    <tr key={translation.id}>
                      <td>{translation.key}</td>
                      <td>
                        {editingTranslationId === translation.id ? (
                          <input value={editValue} onChange={(event) => setEditValue(event.target.value)} />
                        ) : (
                          translation.value
                        )}
                      </td>
                      <td>
                        {editingTranslationId === translation.id ? (
                          <input
                            value={editDescription}
                            onChange={(event) => setEditDescription(event.target.value)}
                            placeholder="Optional description"
                          />
                        ) : (
                          translation.description ?? "—"
                        )}
                      </td>
                      <td>
                        <div className="action-row">
                          {editingTranslationId === translation.id ? (
                            <>
                              <button
                                className="button secondary"
                                disabled={updateMutation.isPending}
                                onClick={() => updateMutation.mutate()}
                              >
                                Save
                              </button>
                              <button
                                className="button ghost"
                                onClick={() => {
                                  setEditingTranslationId(null);
                                  setEditValue("");
                                  setEditDescription("");
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="button secondary"
                                disabled={!canCreateTranslation}
                                onClick={() => {
                                  setEditingTranslationId(translation.id);
                                  setEditValue(translation.value);
                                  setEditDescription(translation.description ?? "");
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="button ghost danger"
                                disabled={deleteMutation.isPending || !canDeleteTranslation}
                                onClick={() => deleteMutation.mutate(translation.id)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>Project controls</h2>
          </header>
          <MetaRow label="Languages" value={String(languagesQuery.data?.length ?? 0)} />
          <MetaRow label="Namespaces" value={String(namespacesQuery.data?.length ?? 0)} />
          <MetaRow label="Environments" value={String(environmentsQuery.data?.length ?? 0)} />
          <MetaRow label="Current environment" value={environment || "—"} />
          <div className="divider" />
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
                <span>Name</span>
                <input value={newLanguageName} onChange={(event) => setNewLanguageName(event.target.value)} placeholder="English" />
              </label>
            </div>
            <button
              className="button secondary"
              disabled={createLanguageMutation.isPending || !canEditProject}
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
              disabled={createNamespaceMutation.isPending || !canEditProject}
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
              disabled={createEnvironmentMutation.isPending || !canEditProject}
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
          <div className="divider" />
          <div className="stack gap-md">
            <header className="panel-header">
              <h2>Members</h2>
              <span className="badge">{membersQuery.data?.length ?? 0}</span>
            </header>
            <label className="field">
              <span>Add member by user ID</span>
              <input
                value={memberUserId}
                onChange={(event) => setMemberUserId(event.target.value)}
                placeholder="Paste user id"
              />
            </label>
            <button
              className="button secondary"
              disabled={addMemberMutation.isPending || !canManageMembers}
              onClick={() => addMemberMutation.mutate()}
            >
              Add member
            </button>
            {membersQuery.isLoading ? <p className="muted">Loading members...</p> : null}
            {membersQuery.isError ? (
              <div className="banner error">{buildErrorMessage(membersQuery.error)}</div>
            ) : null}
            {membersQuery.data?.map((member) => (
              <div className="member-card" key={member.id}>
                <div className="stack gap-sm">
                  <strong>{member.display_name}</strong>
                  <span className="muted">{member.email}</span>
                  <span className="badge subtle">{member.is_owner ? "Owner" : member.is_active ? "Active" : "Inactive"}</span>
                </div>
                {!member.is_owner ? (
                  <button
                    className="button ghost danger"
                    disabled={removeMemberMutation.isPending || !canManageMembers}
                    onClick={() => removeMemberMutation.mutate(member.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function UsersPage() {
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [permissionText, setPermissionText] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const queryClient = useQueryClient();
  const permissionSet = usePermissionSet();
  const canManageUsers = permissionSet.has("ManageUsers");
  const canManagePermissions = permissionSet.has("ManagePermissions");

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<User[]>("/api/v1/users"),
    enabled: canManageUsers,
  });

  const permissionsQuery = useQuery({
    queryKey: ["permissions"],
    queryFn: () => apiGet<Permission[]>("/api/v1/permissions"),
    enabled: canManagePermissions,
  });

  const userPermissionsQuery = useQuery({
    queryKey: ["user-permissions", selectedUserId],
    queryFn: () => apiGet<Permission[]>(`/api/v1/users/${selectedUserId}/permissions`),
    enabled: Boolean(selectedUserId) && canManagePermissions,
  });

  useEffect(() => {
    if (!selectedUserId && usersQuery.data?.[0]) {
      setSelectedUserId(usersQuery.data[0].id);
    }
  }, [selectedUserId, usersQuery.data]);

  useEffect(() => {
    const selectedUser = usersQuery.data?.find((user) => user.id === selectedUserId);
    if (selectedUser) {
      setEditEmail(selectedUser.email);
      setEditDisplayName(selectedUser.display_name);
      setEditPassword("");
      setEditIsActive(selectedUser.is_active);
    }
  }, [selectedUserId, usersQuery.data]);

  useEffect(() => {
    if (userPermissionsQuery.data) {
      setPermissionText(userPermissionsQuery.data.map((item) => item.code).join("\n"));
    }
  }, [userPermissionsQuery.data]);

  const createUserMutation = useMutation({
    mutationFn: async () =>
      apiPost("/api/v1/users", {
        email: newEmail,
        password: newPassword,
        display_name: newDisplayName,
        is_active: true,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setNewEmail("");
      setNewPassword("");
      setNewDisplayName("");
    },
  });

  const replacePermissionsMutation = useMutation({
    mutationFn: async () =>
      apiPut(`/api/v1/users/${selectedUserId}/permissions`, {
        permission_codes: permissionText
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["user-permissions", selectedUserId] });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async () =>
      apiPut(`/api/v1/users/${selectedUserId}`, {
        email: editEmail,
        display_name: editDisplayName,
        password: editPassword || undefined,
        is_active: editIsActive,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async () => apiDelete(`/api/v1/users/${selectedUserId}`),
    onSuccess: async () => {
      const previousUsers = usersQuery.data ?? [];
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      const nextUsers = previousUsers.filter((user) => user.id !== selectedUserId);
      setSelectedUserId(nextUsers[0]?.id ?? "");
    },
  });

  if (!canManageUsers && !canManagePermissions) {
    return (
      <ErrorCard
        title="Users are unavailable"
        message="You do not have permission to manage users or direct permissions."
      />
    );
  }

  if ((canManageUsers && usersQuery.isLoading) || (canManagePermissions && permissionsQuery.isLoading)) {
    return <LoadingScreen label="Loading users workspace" compact />;
  }

  if (canManageUsers && usersQuery.isError) {
    return <ErrorCard title="Users are unavailable" message={buildErrorMessage(usersQuery.error)} />;
  }

  if (canManagePermissions && permissionsQuery.isError) {
    return <ErrorCard title="Permissions are unavailable" message={buildErrorMessage(permissionsQuery.error)} />;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Users</p>
          <h1 className="page-title">Manage accounts and direct permissions</h1>
        </div>
      </header>

      {createUserMutation.isError ? (
        <div className="banner error">{buildErrorMessage(createUserMutation.error)}</div>
      ) : null}
      {replacePermissionsMutation.isError ? (
        <div className="banner error">{buildErrorMessage(replacePermissionsMutation.error)}</div>
      ) : null}
      {updateUserMutation.isError ? (
        <div className="banner error">{buildErrorMessage(updateUserMutation.error)}</div>
      ) : null}
      {deleteUserMutation.isError ? (
        <div className="banner error">{buildErrorMessage(deleteUserMutation.error)}</div>
      ) : null}

      <div className="workspace-grid">
        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>Create user</h2>
          </header>
          <div className="form-grid">
            <label className="field">
              <span>Email</span>
              <input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>Display name</span>
              <input value={newDisplayName} onChange={(event) => setNewDisplayName(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Password</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </label>
          <button
            className="button primary"
            disabled={createUserMutation.isPending || !canManageUsers}
            onClick={() => createUserMutation.mutate()}
          >
            Create user
          </button>

          <div className="divider" />

          <header className="panel-header">
            <h2>All users</h2>
            <span className="badge">{usersQuery.data?.length ?? 0}</span>
          </header>
          {usersQuery.data?.map((user) => (
            <button
              className={`member-card selectable${selectedUserId === user.id ? " selected" : ""}`}
              key={user.id}
              onClick={() => setSelectedUserId(user.id)}
              type="button"
            >
              <div className="stack gap-sm">
                <strong>{user.display_name}</strong>
                <span className="muted">{user.email}</span>
              </div>
              <span className="badge subtle">{user.is_active ? "Active" : "Inactive"}</span>
            </button>
          ))}
        </article>

        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>Direct permissions</h2>
          </header>
          <label className="field">
            <span>Selected user</span>
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              {usersQuery.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Permission codes</span>
            <textarea
              className="textarea"
              rows={12}
              value={permissionText}
              onChange={(event) => setPermissionText(event.target.value)}
              placeholder="One code per line"
            />
          </label>
          <button
            className="button secondary"
            disabled={!selectedUserId || replacePermissionsMutation.isPending || !canManagePermissions}
            onClick={() => replacePermissionsMutation.mutate()}
          >
            Replace permissions
          </button>
          <div className="divider" />
          <header className="panel-header">
            <h2>Update user</h2>
          </header>
          <div className="form-grid">
            <label className="field">
              <span>Email</span>
              <input value={editEmail} onChange={(event) => setEditEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>Display name</span>
              <input value={editDisplayName} onChange={(event) => setEditDisplayName(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={editPassword}
              onChange={(event) => setEditPassword(event.target.value)}
              placeholder="Leave blank to keep current password"
            />
          </label>
          <label className="checkbox-row">
            <input checked={editIsActive} onChange={(event) => setEditIsActive(event.target.checked)} type="checkbox" />
            <span>User is active</span>
          </label>
          <div className="action-row">
            <button
              className="button secondary"
              disabled={!selectedUserId || updateUserMutation.isPending || !canManageUsers}
              onClick={() => updateUserMutation.mutate()}
            >
              Save user
            </button>
            <button
              className="button ghost danger"
              disabled={!selectedUserId || deleteUserMutation.isPending || !canManageUsers}
              onClick={() => deleteUserMutation.mutate()}
            >
              Delete user
            </button>
          </div>
          <div className="divider" />
          <header className="panel-header">
            <h2>Seeded catalog</h2>
            <span className="badge">{permissionsQuery.data?.length ?? 0}</span>
          </header>
          <div className="permission-grid">
            {permissionsQuery.data?.map((permission) => (
              <div className="permission-card" key={permission.id}>
                <strong>{permission.code}</strong>
                <span className="muted">{permission.description ?? "No description"}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function AppLayout(props: { user: { display_name: string; email: string }; onLogout: () => Promise<void> | void; children: React.ReactNode }) {
  const navigate = useNavigate();
  const permissionSet = usePermissionSet();
  const canOpenUsersWorkspace =
    permissionSet.has("ManageUsers") || permissionSet.has("ManagePermissions");

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">OxideRelay</p>
          <h1>Admin Console</h1>
          <p className="sidebar-copy">Session-backed workspace for managing translations across projects.</p>
        </div>
        <nav className="nav-links">
          <a href="/projects">Projects</a>
          {canOpenUsersWorkspace ? <a href="/users">Users</a> : null}
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
        </nav>
        <div className="user-card">
          <strong>{props.user.display_name}</strong>
          <span>{props.user.email}</span>
          <button
            className="button ghost"
            onClick={async () => {
              await props.onLogout();
              navigate("/login", { replace: true });
            }}
            type="button"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="content-shell">{props.children}</main>
    </div>
  );
}

function LoadingScreen(props: { label: string; compact?: boolean }) {
  return (
    <div className={props.compact ? "loading compact" : "loading"}>
      <div className="spinner" />
      <p>{props.label}</p>
    </div>
  );
}

function ErrorCard(props: { title: string; message: string }) {
  return (
    <section className="page">
      <div className="panel">
        <h1 className="page-title">{props.title}</h1>
        <div className="banner error">{props.message}</div>
      </div>
    </section>
  );
}

function MetaRow(props: { label: string; value: string }) {
  return (
    <div className="meta-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function useSession() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => apiGet<{ user: { id: string; email: string; display_name: string } }>("/api/v1/me"),
    retry: false,
  });

  return {
    isLoading: sessionQuery.isLoading,
    user: sessionQuery.data?.user ?? null,
    async refresh() {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    async logout() {
      await apiPost("/api/v1/auth/logout", undefined);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  };
}

function usePermissionSet() {
  const permissionsQuery = useQuery({
    queryKey: ["current-permissions"],
    queryFn: () => apiGet<CurrentPermissionsResponse>("/api/v1/me/permissions"),
    retry: false,
  });

  const permissions = permissionsQuery.data?.permissions ?? [];
  return {
    permissions,
    has(permission: string) {
      return permissions.includes(permission);
    },
  };
}

function readEnvironmentPermission(environmentSlug: string) {
  switch (environmentSlug) {
    case "development":
      return "ReadDevelopment";
    case "staging":
      return "ReadStaging";
    case "production":
      return "ReadProduction";
    default:
      return "";
  }
}

function editEnvironmentPermission(environmentSlug: string) {
  switch (environmentSlug) {
    case "development":
      return "EditDevelopment";
    case "staging":
      return "EditStaging";
    case "production":
      return "EditProduction";
    default:
      return "";
  }
}
