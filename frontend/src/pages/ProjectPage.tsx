import { useDeferredValue, useEffect, useRef, useState, type FocusEvent } from "react";
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
  TranslationGridResponse,
  TranslationGridRow,
} from "../api";
import { usePermissionSet } from "../hooks/usePermissionSet";
import { useTranslation } from "../i18n";
import { readEnvironmentPermission, editEnvironmentPermission } from "../lib/permissions";
import { LoadingScreen } from "../components/LoadingScreen";
import { ErrorCard } from "../components/ErrorCard";
import { MetaRow } from "../components/MetaRow";
import { ProjectSettingsPanel } from "./project/ProjectSettingsPanel";
import { ProjectMembersPanel } from "./project/ProjectMembersPanel";
import { ProjectResourcesPanel } from "./project/ProjectResourcesPanel";
import { ProjectDeliveryLinksPanel } from "./project/ProjectDeliveryLinksPanel";

type NewTermDraft = {
  id: string;
  key: string;
  description: string;
  values: Record<string, string>;
};

function createDraftId(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }

  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ProjectPage() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const translationGridRef = useRef<HTMLDivElement | null>(null);
  const [environment, setEnvironment] = useState("");
  const [language, setLanguage] = useState("");
  const [namespace, setNamespace] = useState("");
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
  const [translationSearch, setTranslationSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [selectedLanguageCodes, setSelectedLanguageCodes] = useState<string[]>([]);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  const [newTermDrafts, setNewTermDrafts] = useState<NewTermDraft[]>([
    { id: createDraftId(), key: "", description: "", values: {} },
  ]);
  const deferredTranslationSearch = useDeferredValue(translationSearch.trim());
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
    if (languagesQuery.data?.length && selectedLanguageCodes.length === 0) {
      setSelectedLanguageCodes([languagesQuery.data[0].code]);
    }
  }, [languagesQuery.data, selectedLanguageCodes.length]);

  useEffect(() => {
    if (language && !selectedLanguageCodes.includes(language)) {
      setSelectedLanguageCodes((current) => [...current, language]);
    }
  }, [language, selectedLanguageCodes]);

  useEffect(() => {
    if (!namespace && namespacesQuery.data?.[0]) {
      setNamespace(namespacesQuery.data[0].name);
    }
  }, [namespace, namespacesQuery.data]);

  useEffect(() => {
    setPage(1);
  }, [environment, namespace, deferredTranslationSearch, pageSize, selectedLanguageCodes.join(",")]);

  const translationsQuery = useQuery({
    queryKey: [
      "project",
      projectSlug,
      "translations-grid",
      environment,
      namespace,
      selectedLanguageCodes,
      deferredTranslationSearch,
      page,
      pageSize,
    ],
    queryFn: () =>
      apiGet<TranslationGridResponse>(
        `/api/v1/projects/${projectSlug}/translations/grid?${new URLSearchParams({
          environment,
          namespace,
          languages: selectedLanguageCodes.join(","),
          search: deferredTranslationSearch,
          page: String(page),
          page_size: String(pageSize),
        }).toString()}`,
      ),
    enabled:
      Boolean(projectSlug && environment && namespace && selectedLanguageCodes.length > 0) &&
      (Boolean(projectQuery.data?.is_owner) ||
        (permissionSet.has("ReadTranslations") &&
          permissionSet.has(readEnvironmentPermission(environment)))),
  });

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const row of translationsQuery.data?.items ?? []) {
      nextDrafts[`desc:${row.translation_key_id}`] = row.description ?? "";
      for (const languageCode of selectedLanguageCodes) {
        nextDrafts[`value:${row.translation_key_id}:${languageCode}`] =
          row.values[languageCode]?.value ?? "";
      }
    }
    setDraftValues(nextDrafts);
  }, [translationsQuery.data, selectedLanguageCodes]);

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
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] });
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({
      key,
      languageCode,
      value,
      description,
    }: {
      key: string;
      languageCode: string;
      value: string;
      description?: string;
    }) =>
      apiPost(`/api/v1/projects/${projectSlug}/translations`, {
        environment,
        language: languageCode,
        namespace,
        key,
        value,
        description,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] });
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      translationValueId,
      value,
      description,
    }: {
      translationValueId: string;
      value?: string;
      description?: string | null;
    }) => {
      return apiPut(`/api/v1/projects/${projectSlug}/translations/${translationValueId}`, {
        value,
        description,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] });
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (translationId: string) =>
      apiDelete(`/api/v1/projects/${projectSlug}/translations/${translationId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] });
      await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
    },
  });

  if (projectQuery.isLoading || languagesQuery.isLoading || namespacesQuery.isLoading || environmentsQuery.isLoading) {
    return <LoadingScreen label={t("project.loading")} compact />;
  }

  if (projectQuery.isError) {
    return <ErrorCard title={t("project.error.title")} message={buildErrorMessage(projectQuery.error)} />;
  }

  const project = projectQuery.data;
  if (!project) {
    return <ErrorCard title={t("project.error.title")} message={t("project.error.no_data")} />;
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
  const translationRows = translationsQuery.data?.items ?? [];
  const totalTranslationRows = translationsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTranslationRows / pageSize));

  const updateDraftValue = (draftKey: string, value: string) => {
    setDraftValues((current) => ({
      ...current,
      [draftKey]: value,
    }));
  };

  const focusNextGridInput = (currentTarget: HTMLElement) => {
    const focusable = Array.from(
      translationGridRef.current?.querySelectorAll<HTMLElement>("[data-grid-focus='true']") ?? [],
    );
    const currentIndex = focusable.indexOf(currentTarget);
    if (currentIndex >= 0) {
      const nextTarget = focusable[currentIndex + 1] ?? focusable[0];
      nextTarget?.focus();
    }
  };

  const commitDescription = async (row: TranslationGridRow) => {
    const draftKey = `desc:${row.translation_key_id}`;
    const nextDescription = (draftValues[draftKey] ?? "").trim();
    const currentDescription = row.description ?? "";
    if (nextDescription === currentDescription) {
      return;
    }
    await updateMutation.mutateAsync({
      translationValueId: row.representative_translation_id,
      description: nextDescription || null,
    });
  };

  const commitTranslationValue = async (row: TranslationGridRow, languageCode: string) => {
    const draftKey = `value:${row.translation_key_id}:${languageCode}`;
    const nextValue = (draftValues[draftKey] ?? "").trim();
    const existingCell = row.values[languageCode];
    const currentValue = existingCell?.value ?? "";

    if (!nextValue) {
      updateDraftValue(draftKey, currentValue);
      return;
    }

    if (nextValue === currentValue) {
      return;
    }

    if (existingCell?.id) {
      await updateMutation.mutateAsync({
        translationValueId: existingCell.id,
        value: nextValue,
      });
      return;
    }

    await apiPost(`/api/v1/projects/${projectSlug}/translations`, {
      environment,
      language: languageCode,
      namespace: row.namespace,
      key: row.key,
      value: nextValue,
      description: (draftValues[`desc:${row.translation_key_id}`] ?? row.description ?? "").trim() || undefined,
    });
    await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations-grid"] });
    await queryClient.invalidateQueries({ queryKey: ["project", projectSlug, "translations"] });
  };

  const toggleVisibleLanguage = (languageCode: string) => {
    setSelectedLanguageCodes((current) => {
      if (current.includes(languageCode)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((code) => code !== languageCode);
      }
      return [...current, languageCode];
    });
  };

  const updateNewTermDraft = (
    draftId: string,
    field: "key" | "description",
    value: string,
  ) => {
    setNewTermDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, [field]: value } : draft)),
    );
  };

  const updateNewTermValue = (draftId: string, languageCode: string, value: string) => {
    setNewTermDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              values: {
                ...draft.values,
                [languageCode]: value,
              },
            }
          : draft,
      ),
    );
  };

  const addNewTermDraftRow = () => {
    setNewTermDrafts((current) => [
      ...current,
      { id: createDraftId(), key: "", description: "", values: {} },
    ]);
  };

  const saveNewTermDraft = async (draftId: string) => {
    const draft = newTermDrafts.find((item) => item.id === draftId);
    if (!draft || draft.key.trim().length === 0) {
      return;
    }

    const description = draft.description.trim() || undefined;
    let savedAnyValue = false;

    for (const languageCode of selectedLanguageCodes) {
      const value = draft.values[languageCode]?.trim();
      if (!value) {
        continue;
      }
      await createMutation.mutateAsync({
        key: draft.key.trim(),
        languageCode,
        value,
        description,
      });
      savedAnyValue = true;
    }

    if (!savedAnyValue) {
      return;
    }

    setNewTermDrafts((current) => {
      const filtered = current.filter((item) => item.id !== draftId);
      return filtered.length > 0
        ? filtered
        : [{ id: createDraftId(), key: "", description: "", values: {} }];
    });
  };

  const savePendingNewTermDrafts = async () => {
    const pendingDrafts = newTermDrafts.filter((draft) => draft.key.trim().length > 0);
    if (pendingDrafts.length === 0) {
      setNewTermDrafts([{ id: createDraftId(), key: "", description: "", values: {} }]);
      return;
    }

    const remainingDrafts: NewTermDraft[] = [];

    for (const draft of pendingDrafts) {
      const description = draft.description.trim() || undefined;
      let savedAnyValue = false;
      for (const languageCode of selectedLanguageCodes) {
        const value = draft.values[languageCode]?.trim();
        if (!value) {
          continue;
        }
        await createMutation.mutateAsync({
          key: draft.key.trim(),
          languageCode,
          value,
          description,
        });
        savedAnyValue = true;
      }

      if (!savedAnyValue) {
        remainingDrafts.push(draft);
      }
    }

    setNewTermDrafts([
      ...remainingDrafts,
      { id: createDraftId(), key: "", description: "", values: {} },
    ]);
  };

  const handleTranslationGridBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    void savePendingNewTermDrafts();
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.is_owner ? t("project.badges.owner_workspace") : t("project.badges.member_workspace")}</p>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-description">{project.description ?? t("projects.empty_description")}</p>
        </div>
        <a className="button ghost" href="/projects">
          {t("project.back_to_projects")}
        </a>
      </header>

      <div className="toolbar">
        <label className="field small">
          <span>{t("project.filters.environment")}</span>
          <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            {environmentsQuery.data?.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>{t("project.filters.language")}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languagesQuery.data?.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>{t("project.filters.namespace")}</span>
          <select value={namespace} onChange={(event) => setNamespace(event.target.value)}>
            {namespacesQuery.data?.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={importMutation.isPending || !canImportTranslations}
          onClick={() => importMutation.mutate()}
        >
          {t("project.import.button")}
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

      <div className="workspace-grid">
        <article className="panel stack gap-md">
          <header className="panel-header">
            <h2>{t("project.translations.title")}</h2>
            <span className="badge">{totalTranslationRows}</span>
          </header>
          <div className="stack gap-md">
            <label className="field">
              <span>{t("project.import.label")}</span>
              <textarea
                className="textarea"
                value={importJson}
                onChange={(event) => setImportJson(event.target.value)}
                rows={7}
              />
            </label>
          </div>
          <div className="translation-toolbar">
            <label className="field search-field">
              <span>{t("project.search.label")}</span>
              <input
                value={translationSearch}
                onChange={(event) => setTranslationSearch(event.target.value)}
                placeholder={t("project.search.placeholder")}
              />
            </label>
            <div className="field language-filter">
              <span>{t("project.visible_languages.label")}</span>
              <div className="dropdown-shell">
                <button
                  className="button ghost"
                  onClick={() => setLanguageMenuOpen((current) => !current)}
                  type="button"
                >
                  {selectedLanguageCodes.join(", ") || t("project.visible_languages.placeholder")}
                </button>
                {languageMenuOpen ? (
                  <div className="dropdown-panel">
                    {languagesQuery.data?.map((item) => (
                      <label className="dropdown-option" key={item.id}>
                        <input
                          checked={selectedLanguageCodes.includes(item.code)}
                          onChange={() => toggleVisibleLanguage(item.code)}
                          type="checkbox"
                        />
                        <span>{item.code} · {item.name}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <label className="field compact-field">
              <span>{t("project.pagination.page_size")}</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          {!canReadCurrentEnvironment ? (
            <div className="banner error">
              {t("project.permissions.read_forbidden")}
            </div>
          ) : null}
          {translationsQuery.isLoading ? <p className="muted">{t("project.translations.loading")}</p> : null}
          {translationsQuery.isError ? (
            <div className="banner error">{buildErrorMessage(translationsQuery.error)}</div>
          ) : null}
          {translationsQuery.data ? (
            <>
            <div
              className="table-shell translation-grid-shell"
              onBlurCapture={handleTranslationGridBlurCapture}
              ref={translationGridRef}
            >
              <table>
                <thead>
                  <tr>
                    <th>{t("project.table.namespace")}</th>
                    <th>{t("project.table.key")}</th>
                    <th>{t("project.table.description")}</th>
                    {selectedLanguageCodes.map((languageCode) => (
                      <th key={languageCode}>{languageCode}</th>
                    ))}
                    <th>
                      <div className="table-actions-header">
                        <span>{t("project.table.actions")}</span>
                        {canCreateTranslation ? (
                          <button
                            className="button primary add-row-button"
                            onClick={addNewTermDraftRow}
                            type="button"
                          >
                            +
                          </button>
                        ) : null}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {canCreateTranslation
                    ? newTermDrafts.map((draft) => (
                        <tr className="new-term-row" key={draft.id}>
                          <td>
                            <span className="badge subtle">{namespace}</span>
                          </td>
                          <td>
                            <input
                              className={focusedCell === `new-key:${draft.id}` ? "grid-input is-focused" : "grid-input"}
                              data-grid-focus="true"
                              onChange={(event) => updateNewTermDraft(draft.id, "key", event.target.value)}
                              onFocus={() => setFocusedCell(`new-key:${draft.id}`)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  focusNextGridInput(event.currentTarget);
                                }
                              }}
                              placeholder={t("project.table.new_key_placeholder")}
                              value={draft.key}
                            />
                          </td>
                          <td>
                            <input
                              className={focusedCell === `new-desc:${draft.id}` ? "grid-input is-focused" : "grid-input"}
                              data-grid-focus="true"
                              onChange={(event) => updateNewTermDraft(draft.id, "description", event.target.value)}
                              onFocus={() => setFocusedCell(`new-desc:${draft.id}`)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  focusNextGridInput(event.currentTarget);
                                }
                              }}
                              placeholder={t("project.table.description_placeholder")}
                              value={draft.description}
                            />
                          </td>
                          {selectedLanguageCodes.map((languageCode) => (
                            <td key={languageCode}>
                              <input
                                className={
                                  focusedCell === `new-value:${draft.id}:${languageCode}`
                                    ? "grid-input is-focused"
                                    : "grid-input"
                                }
                                data-grid-focus="true"
                                onChange={(event) => updateNewTermValue(draft.id, languageCode, event.target.value)}
                                onFocus={() => setFocusedCell(`new-value:${draft.id}:${languageCode}`)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    focusNextGridInput(event.currentTarget);
                                  }
                                }}
                                placeholder={`${t("project.table.value_placeholder")} (${languageCode})`}
                                value={draft.values[languageCode] ?? ""}
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              className="button secondary"
                              disabled={createMutation.isPending || draft.key.trim().length === 0}
                              onClick={() => {
                                void saveNewTermDraft(draft.id);
                              }}
                              type="button"
                            >
                              {t("actions.save")}
                            </button>
                          </td>
                        </tr>
                      ))
                    : null}
                  {translationRows.map((translation) => (
                    <tr key={translation.translation_key_id}>
                      <td>{translation.namespace}</td>
                      <td>{translation.key}</td>
                      <td>
                        <input
                          className={focusedCell === `desc:${translation.translation_key_id}` ? "grid-input is-focused" : "grid-input"}
                          data-grid-focus="true"
                          onBlur={() => {
                            void commitDescription(translation);
                          }}
                          onChange={(event) => updateDraftValue(`desc:${translation.translation_key_id}`, event.target.value)}
                          onFocus={() => setFocusedCell(`desc:${translation.translation_key_id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitDescription(translation);
                              focusNextGridInput(event.currentTarget);
                            }
                          }}
                          placeholder={t("project.table.description_placeholder")}
                          value={draftValues[`desc:${translation.translation_key_id}`] ?? ""}
                        />
                      </td>
                      {selectedLanguageCodes.map((languageCode) => {
                        const draftKey = `value:${translation.translation_key_id}:${languageCode}`;
                        const hasValue = Boolean(translation.values[languageCode]?.id);
                        return (
                          <td key={languageCode}>
                            <input
                              className={focusedCell === draftKey ? "grid-input is-focused" : "grid-input"}
                              data-grid-focus="true"
                              onBlur={() => {
                                void commitTranslationValue(translation, languageCode);
                              }}
                              onChange={(event) => updateDraftValue(draftKey, event.target.value)}
                              onFocus={() => setFocusedCell(draftKey)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitTranslationValue(translation, languageCode);
                                  focusNextGridInput(event.currentTarget);
                                }
                              }}
                              placeholder={hasValue ? "" : `${t("project.table.add_value")} ${languageCode}`}
                              value={draftValues[draftKey] ?? ""}
                            />
                          </td>
                        );
                      })}
                      <td>
                        <div className="action-row">
                          <button
                            className="button ghost danger"
                            disabled={
                              deleteMutation.isPending ||
                              !canDeleteTranslation ||
                              !translation.values[language]?.id
                            }
                            onClick={() => {
                              const translationId = translation.values[language]?.id;
                              if (translationId) {
                                deleteMutation.mutate(translationId);
                              }
                            }}
                          >
                            {`${t("actions.delete")} ${language}`}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span className="muted">
                {`${t("project.pagination.page")} ${page} ${t("project.pagination.of")} ${totalPages} · ${totalTranslationRows} ${t("project.pagination.terms")}`}
              </span>
              <div className="action-row">
                <button
                  className="button ghost"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  {t("project.pagination.previous")}
                </button>
                <button
                  className="button ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  {t("project.pagination.next")}
                </button>
              </div>
            </div>
            </>
          ) : null}
        </article>

        <ProjectDeliveryLinksPanel
          projectSlug={project.slug}
          environment={environment}
          language={language}
          languagesCount={languagesQuery.data?.length ?? 0}
          namespacesCount={namespacesQuery.data?.length ?? 0}
          environmentsCount={environmentsQuery.data?.length ?? 0}
        />

        <article className="panel">
          <ProjectResourcesPanel projectSlug={project.slug} canEditProject={canEditProject} />
          
          <div className="divider" />
          <ProjectMembersPanel projectSlug={project.slug} canManageMembers={canManageMembers} canViewMembers={canViewMembers} />

          <div className="divider" />
          <ProjectSettingsPanel project={project} canEditProject={canEditProject} canDeleteProject={canDeleteProject} />
        </article>
      </div>
    </section>
  );
}
