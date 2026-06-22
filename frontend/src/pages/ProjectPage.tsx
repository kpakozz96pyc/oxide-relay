import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  buildErrorMessage,
  Project,
  Language,
  Namespace,
  Environment,
  DeliveryManifest,
  ProjectMember,
  Translation,
} from "../api";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { readEnvironmentPermission, editEnvironmentPermission } from "../lib/permissions";
import { LoadingScreen } from "../components/LoadingScreen";
import { ErrorCard } from "../components/ErrorCard";
import { MetaRow } from "../components/MetaRow";

export function ProjectPage() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
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
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectSlug, setEditProjectSlug] = useState("");
  const [editProjectDescription, setEditProjectDescription] = useState("");
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

  const deliveryManifestQuery = useQuery({
    queryKey: ["project", projectSlug, "delivery-manifest", environment, language],
    queryFn: () =>
      apiGet<DeliveryManifest>(
        `/api/v1/projects/${projectSlug}/delivery-manifest/${encodeURIComponent(language)}?environment=${encodeURIComponent(environment)}`,
      ),
    enabled: Boolean(projectSlug && environment && language),
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

  const updateProjectMutation = useMutation({
    mutationFn: async () =>
      apiPut<Project>(`/api/v1/projects/${projectSlug}`, {
        name: editProjectName,
        slug: editProjectSlug,
        description: editProjectDescription || null,
      }),
    onSuccess: async (data: Project) => {
      setIsEditingProject(false);
      if (data.slug !== projectSlug) {
        queryClient.setQueryData(["project", data.slug], data);
        queryClient.removeQueries({ queryKey: ["project", projectSlug] });
        navigate(`/projects/${data.slug}`, { replace: true });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["project", projectSlug] });
      }
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => apiDelete(`/api/v1/projects/${projectSlug}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects", { replace: true });
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
  const canDeleteProject = project.is_owner || permissionSet.has("DeleteProjects");
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
  const localeBundleHref = deliveryManifestQuery.data?.locale_bundle_url ?? null;
  const namespaceJsonLinks =
    deliveryManifestQuery.data?.namespaces.map((item) => ({
      id: item.name,
      name: item.name,
      href: item.url,
    })) ?? [];

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
          <MetaRow label="Current language" value={language || "—"} />
          <div className="divider" />
          <div className="stack gap-md">
            <header className="panel-header">
              <h2>Delivery links</h2>
            </header>
            {localeBundleHref ? (
              <div className="link-card">
                <strong>Locale bundle</strong>
                <a className="project-link" href={localeBundleHref} rel="noreferrer" target="_blank">
                  {localeBundleHref}
                </a>
              </div>
            ) : (
              <p className="muted">Select environment and language to view delivery URLs.</p>
            )}
            {namespaceJsonLinks.length > 0 ? (
              <div className="link-list">
                {namespaceJsonLinks.map((item) => (
                  <div className="link-card" key={item.id}>
                    <strong>{item.name}.json</strong>
                    <a className="project-link" href={item.href} rel="noreferrer" target="_blank">
                      {item.href}
                    </a>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
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

          <div className="divider" />
          <div className="stack gap-md">
            <header className="panel-header">
              <h2>Project settings</h2>
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
                    <span>Name</span>
                    <input value={editProjectName} onChange={(e) => setEditProjectName(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Slug</span>
                    <input value={editProjectSlug} onChange={(e) => setEditProjectSlug(e.target.value)} />
                  </label>
                </div>
                <label className="field">
                  <span>Description</span>
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
                    Save changes
                  </button>
                  <button className="button ghost" onClick={() => setIsEditingProject(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack gap-sm">
                <p className="muted">Modify project details or permanently delete this project.</p>
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
                    Edit project
                  </button>
                  <button
                    className="button ghost danger"
                    disabled={deleteProjectMutation.isPending || !canDeleteProject}
                    onClick={() => {
                      if (window.confirm("Are you sure you want to delete this project? This action cannot be undone.")) {
                        deleteProjectMutation.mutate();
                      }
                    }}
                  >
                    Delete project
                  </button>
                </div>
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
