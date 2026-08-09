import { useDeferredValue, useEffect, useRef, useState, type FocusEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Environment,
  Language,
  Namespace,
  Project,
  TranslationGridResponse,
  TranslationGridRow,
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  buildErrorMessage,
} from "../../api";
import { usePermissionSet } from "../../hooks/usePermissionSet";
import { useTranslation } from "../../i18n";
import { editEnvironmentPermission } from "../../lib/permissions";

type NewTermDraft = {
  id: string;
  key: string;
  description: string;
  values: Record<string, string>;
};

type TranslationViewMode = "all" | "missing";

type CellStatus = "dirty" | "saving" | "saved" | "error";

type CellState = {
  status: CellStatus;
  message?: string;
};

export function ProjectTranslationsPanel({
  project,
  projectSlug,
  languages,
  namespaces,
  environments,
}: {
  project: Project;
  projectSlug: string;
  languages: Language[];
  namespaces: Namespace[];
  environments: Environment[];
}) {
  const { t } = useTranslation();
  const permissionSet = usePermissionSet();
  const queryClient = useQueryClient();
  const translationGridRef = useRef<HTMLDivElement | null>(null);
  const [environment, setEnvironment] = useState("");
  const [language, setLanguage] = useState("");
  const [namespace, setNamespace] = useState("");
  const [viewMode, setViewMode] = useState<TranslationViewMode>("all");
  const [translationSearch, setTranslationSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [selectedLanguageCodes, setSelectedLanguageCodes] = useState<string[]>([]);
  const [missingTargetLanguageCodes, setMissingTargetLanguageCodes] = useState<string[]>([]);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [cellStates, setCellStates] = useState<Record<string, CellState>>({});
  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  const draftValuesRef = useRef<Record<string, string>>({});
  const cellStatesRef = useRef<Record<string, CellState>>({});
  const cellTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingSaveValuesRef = useRef<Record<string, string>>({});
  const [newTermDrafts, setNewTermDrafts] = useState<NewTermDraft[]>([
    { id: createDraftId(), key: "", description: "", values: {} },
  ]);
  const deferredTranslationSearch = useDeferredValue(translationSearch.trim());
  const displayLanguageCodes =
    viewMode === "missing"
      ? [language, ...missingTargetLanguageCodes].filter((code, index, codes) => code && codes.indexOf(code) === index)
      : selectedLanguageCodes;

  useEffect(() => {
    if (!environment && environments[0]) {
      setEnvironment(environments[0].slug);
    }
  }, [environment, environments]);

  useEffect(() => {
    if (!language && languages[0]) {
      setLanguage(languages[0].code);
    }
  }, [language, languages]);

  useEffect(() => {
    if (languages.length && selectedLanguageCodes.length === 0) {
      setSelectedLanguageCodes([languages[0].code]);
    }
  }, [languages, selectedLanguageCodes.length]);

  useEffect(() => {
    if (viewMode === "all" && language && !selectedLanguageCodes.includes(language)) {
      setSelectedLanguageCodes((current) => [...current, language]);
    }
  }, [language, selectedLanguageCodes, viewMode]);

  useEffect(() => {
    const availableTargets = languages.map((item) => item.code).filter((code) => code !== language);
    setMissingTargetLanguageCodes((current) => {
      const next = current.filter((code) => availableTargets.includes(code));
      if (next.length > 0) {
        return next.length === current.length && next.every((code, index) => code === current[index]) ? current : next;
      }
      return availableTargets[0] ? [availableTargets[0]] : [];
    });
  }, [language, languages]);

  useEffect(() => {
    if (!namespace && namespaces[0]) {
      setNamespace(namespaces[0].name);
    }
  }, [namespace, namespaces]);

  useEffect(() => {
    setPage(1);
  }, [
    deferredTranslationSearch,
    environment,
    language,
    missingTargetLanguageCodes.join(","),
    namespace,
    pageSize,
    selectedLanguageCodes.join(","),
    viewMode,
  ]);

  const translationsQuery = useQuery({
    queryKey: [
      "project",
      projectSlug,
      "translations-grid",
      environment,
      namespace,
      displayLanguageCodes,
      viewMode,
      language,
      missingTargetLanguageCodes,
      deferredTranslationSearch,
      page,
      pageSize,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
          environment,
          namespace,
          languages: displayLanguageCodes.join(","),
          search: deferredTranslationSearch,
          page: String(page),
          page_size: String(pageSize),
      });
      if (viewMode === "missing") {
        params.set("base_language", language);
        params.set("missing_languages", missingTargetLanguageCodes.join(","));
      }
      return apiGet<TranslationGridResponse>(
        `/api/v1/projects/${projectSlug}/translations/grid?${params.toString()}`,
      );
    },
    enabled:
      Boolean(
        projectSlug &&
          environment &&
          namespace &&
          displayLanguageCodes.length > 0 &&
          (viewMode === "all" || (language && missingTargetLanguageCodes.length > 0)),
      ) &&
      (project.is_owner || permissionSet.has("ReadTranslations")),
  });

  useEffect(() => {
    draftValuesRef.current = draftValues;
  }, [draftValues]);

  useEffect(() => {
    cellStatesRef.current = cellStates;
  }, [cellStates]);

  useEffect(() => {
    const timers = cellTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    // Cells the user is actively editing (status "dirty") keep their in-progress
    // text even when a background refetch (triggered by saving a different cell)
    // brings in fresh server data, so an unsaved edit is never silently dropped.
    const nextDrafts: Record<string, string> = {};
    for (const row of translationsQuery.data?.items ?? []) {
      const descKey = `desc:${row.translation_key_id}`;
      const baselineDescription = row.description ?? "";
      nextDrafts[descKey] =
        cellStatesRef.current[descKey]?.status === "dirty"
          ? (draftValuesRef.current[descKey] ?? baselineDescription)
          : baselineDescription;

      for (const languageCode of displayLanguageCodes) {
        const valueKey = `value:${row.translation_key_id}:${languageCode}`;
        const baselineValue = row.values[languageCode]?.value ?? "";
        nextDrafts[valueKey] =
          cellStatesRef.current[valueKey]?.status === "dirty"
            ? (draftValuesRef.current[valueKey] ?? baselineValue)
            : baselineValue;
      }
    }
    setDraftValues(nextDrafts);
  }, [displayLanguageCodes.join(","), translationsQuery.data]);

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
    }) =>
      apiPut(`/api/v1/projects/${projectSlug}/translations/${translationValueId}`, {
        value,
        description,
      }),
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

  const canReadCurrentEnvironment = project.is_owner || permissionSet.has("ReadTranslations");
  const canEditCurrentEnvironment = project.is_owner || permissionSet.has(editEnvironmentPermission(environment));
  const canCreateTranslation = project.is_owner || (permissionSet.has("EditTranslations") && canEditCurrentEnvironment);
  const canDeleteTranslation = project.is_owner || (permissionSet.has("DeleteTranslations") && canEditCurrentEnvironment);
  const translationRows = translationsQuery.data?.items ?? [];
  const totalTranslationRows = translationsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTranslationRows / pageSize));

  const updateDraftValue = (draftKey: string, value: string) => {
    setDraftValues((current) => ({
      ...current,
      [draftKey]: value,
    }));
  };

  const clearCellTimer = (draftKey: string) => {
    const timer = cellTimersRef.current.get(draftKey);
    if (timer !== undefined) {
      clearTimeout(timer);
      cellTimersRef.current.delete(draftKey);
    }
  };

  const setCellState = (draftKey: string, state: CellState) => {
    clearCellTimer(draftKey);
    setCellStates((current) => ({ ...current, [draftKey]: state }));
  };

  const clearCellState = (draftKey: string) => {
    clearCellTimer(draftKey);
    setCellStates((current) => {
      if (!(draftKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
  };

  // Briefly show a "saved" indicator, then fade the cell back to its idle state.
  const flashCellSaved = (draftKey: string) => {
    setCellState(draftKey, { status: "saved" });
    const timer = setTimeout(() => {
      setCellStates((current) => {
        if (current[draftKey]?.status !== "saved") {
          return current;
        }
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
      cellTimersRef.current.delete(draftKey);
    }, 1600);
    cellTimersRef.current.set(draftKey, timer);
  };

  const handleTrackedDraftChange = (draftKey: string, value: string, baselineValue: string) => {
    updateDraftValue(draftKey, value);
    if (value.trim() === baselineValue.trim()) {
      clearCellState(draftKey);
      return;
    }
    setCellState(draftKey, { status: "dirty" });
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

    // Enter commits immediately and then moves focus, which fires a native
    // blur on the same field; guard against sending the same edit twice.
    if (pendingSaveValuesRef.current[draftKey] === nextDescription) {
      return;
    }
    pendingSaveValuesRef.current[draftKey] = nextDescription;
    setCellState(draftKey, { status: "saving" });

    try {
      await updateMutation.mutateAsync({
        translationValueId: row.representative_translation_id,
        description: nextDescription || null,
      });
      flashCellSaved(draftKey);
    } catch (error) {
      setCellState(draftKey, { status: "error", message: buildErrorMessage(error) });
    } finally {
      delete pendingSaveValuesRef.current[draftKey];
    }
  };

  const commitTranslationValue = async (row: TranslationGridRow, languageCode: string) => {
    const draftKey = `value:${row.translation_key_id}:${languageCode}`;
    const nextValue = (draftValues[draftKey] ?? "").trim();
    const existingCell = row.values[languageCode];
    const currentValue = existingCell?.value ?? "";

    if (!nextValue) {
      updateDraftValue(draftKey, currentValue);
      clearCellState(draftKey);
      return;
    }

    if (nextValue === currentValue) {
      return;
    }

    // Enter commits immediately and then moves focus, which fires a native
    // blur on the same field; guard against sending the same edit twice.
    if (pendingSaveValuesRef.current[draftKey] === nextValue) {
      return;
    }
    pendingSaveValuesRef.current[draftKey] = nextValue;
    setCellState(draftKey, { status: "saving" });

    try {
      if (existingCell?.id) {
        await updateMutation.mutateAsync({
          translationValueId: existingCell.id,
          value: nextValue,
        });
      } else {
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
      }
      flashCellSaved(draftKey);
    } catch (error) {
      setCellState(draftKey, { status: "error", message: buildErrorMessage(error) });
    } finally {
      delete pendingSaveValuesRef.current[draftKey];
    }
  };

  const cellStatusLabel = (status: CellStatus) => {
    switch (status) {
      case "dirty":
        return t("project.table.cell_status.dirty");
      case "saving":
        return t("project.table.cell_status.saving");
      case "saved":
        return t("project.table.cell_status.saved");
      case "error":
        return t("project.table.cell_status.error");
      default:
        return "";
    }
  };

  const cellStatusClassName = (status?: CellStatus) => (status ? ` is-${status}` : "");

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

  const toggleMissingTargetLanguage = (languageCode: string) => {
    setMissingTargetLanguageCodes((current) => {
      if (current.includes(languageCode)) {
        return current.length === 1 ? current : current.filter((code) => code !== languageCode);
      }
      return [...current, languageCode];
    });
  };

  const updateNewTermDraft = (draftId: string, field: "key" | "description", value: string) => {
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

    for (const languageCode of displayLanguageCodes) {
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
      for (const languageCode of displayLanguageCodes) {
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
    <article className="panel stack gap-md">
      <header className="panel-header">
        <div className="stack gap-sm">
          <h2>{t("project.translations.title")}</h2>
          <p className="panel-copy">{t("project.translations.description")}</p>
        </div>
        <span className="badge">{totalTranslationRows}</span>
      </header>

      <div className="toolbar">
        <label className="field small">
          <span>{t("project.filters.environment")}</span>
          <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
            {environments.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>{t("project.filters.namespace")}</span>
          <select value={namespace} onChange={(event) => setNamespace(event.target.value)}>
            {namespaces.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>
            {viewMode === "missing" ? t("project.missing.base_language") : t("project.filters.language")}
          </span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languages.map((item) => (
              <option key={item.id} value={item.code}>
                {item.code} · {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field small">
          <span>{t("project.filters.view")}</span>
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as TranslationViewMode)}>
            <option value="all">{t("project.views.all")}</option>
            <option value="missing">{t("project.views.missing")}</option>
          </select>
        </label>
      </div>

      <div className="translation-toolbar">
        <label className="field search-field">
          <span>{t("project.search.label")}</span>
          <input
            onChange={(event) => setTranslationSearch(event.target.value)}
            placeholder={t("project.search.placeholder")}
            value={translationSearch}
          />
        </label>
        <div className="field language-filter">
          <span>
            {viewMode === "missing"
              ? t("project.missing.target_languages")
              : t("project.visible_languages.label")}
          </span>
          <div className="dropdown-shell">
            <button
              className="button ghost language-menu-button"
              onClick={() => setLanguageMenuOpen((current) => !current)}
              type="button"
            >
              {(viewMode === "missing" ? missingTargetLanguageCodes : selectedLanguageCodes).join(", ") ||
                t("project.visible_languages.placeholder")}
            </button>
            {languageMenuOpen ? (
              <div className="dropdown-panel">
                {languages.map((item) => {
                  const isBaseLanguage = viewMode === "missing" && item.code === language;
                  const isChecked =
                    viewMode === "missing"
                      ? missingTargetLanguageCodes.includes(item.code)
                      : selectedLanguageCodes.includes(item.code);
                  return (
                    <label className="dropdown-option" key={item.id}>
                      <input
                        checked={isChecked}
                        disabled={isBaseLanguage}
                        onChange={() =>
                          viewMode === "missing"
                            ? toggleMissingTargetLanguage(item.code)
                            : toggleVisibleLanguage(item.code)
                        }
                        type="checkbox"
                      />
                      <span>
                        {item.code} · {item.name}
                      </span>
                    </label>
                  );
                })}
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

      {!canReadCurrentEnvironment ? <div className="banner error">{t("project.permissions.read_forbidden")}</div> : null}
      {viewMode === "missing" && missingTargetLanguageCodes.length === 0 ? (
        <div className="banner warning">{t("project.missing.no_target_languages")}</div>
      ) : null}
      {translationsQuery.isLoading ? <p className="muted">{t("project.translations.loading")}</p> : null}
      {translationsQuery.isError ? <div className="banner error">{buildErrorMessage(translationsQuery.error)}</div> : null}

      {translationsQuery.data ? (
        <>
          {createMutation.isError ? (
            <div className="banner error">{buildErrorMessage(createMutation.error)}</div>
          ) : null}
          {updateMutation.isError ? (
            <div className="banner error">{buildErrorMessage(updateMutation.error)}</div>
          ) : null}
          {deleteMutation.isError ? (
            <div className="banner error">{buildErrorMessage(deleteMutation.error)}</div>
          ) : null}
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
                  {displayLanguageCodes.map((languageCode) => (
                    <th key={languageCode}>
                      {languageCode}
                      {viewMode === "missing" && languageCode === language ? (
                        <span className="base-language-label">{t("project.missing.base_badge")}</span>
                      ) : null}
                    </th>
                  ))}
                  {viewMode === "all" ? <th>
                    <div className="table-actions-header">
                      <span>{t("project.table.actions")}</span>
                      {canCreateTranslation ? (
                        <button className="button primary add-row-button" onClick={addNewTermDraftRow} type="button">
                          +
                        </button>
                      ) : null}
                    </div>
                  </th> : null}
                </tr>
              </thead>
              <tbody>
                {canCreateTranslation && viewMode === "all"
                  ? newTermDrafts.map((draft, draftIndex) => (
                      <tr className="new-term-row" key={draft.id}>
                        <td>
                          <span className="badge subtle">{namespace}</span>
                        </td>
                        <td>
                          <input
                            className={focusedCell === `new-key:${draft.id}` ? "grid-input is-focused" : "grid-input"}
                            data-grid-focus="true"
                            data-new-term-key={draftIndex === 0 ? "true" : undefined}
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
                        {displayLanguageCodes.map((languageCode) => (
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
                {translationRows.map((translation) => {
                  const descKey = `desc:${translation.translation_key_id}`;
                  const descState = cellStates[descKey];
                  return (
                  <tr key={translation.translation_key_id}>
                    <td>{translation.namespace}</td>
                    <td>{translation.key}</td>
                    <td>
                      <div className="grid-cell">
                        <input
                          className={`${focusedCell === descKey ? "grid-input is-focused" : "grid-input"}${cellStatusClassName(descState?.status)}`}
                          data-grid-focus="true"
                          onBlur={() => {
                            void commitDescription(translation);
                          }}
                          onChange={(event) =>
                            handleTrackedDraftChange(descKey, event.target.value, translation.description ?? "")
                          }
                          onFocus={() => setFocusedCell(descKey)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitDescription(translation);
                              focusNextGridInput(event.currentTarget);
                            }
                          }}
                          placeholder={t("project.table.description_placeholder")}
                          title={descState?.status === "error" ? descState.message : undefined}
                          value={draftValues[descKey] ?? ""}
                        />
                        {descState ? (
                          <span
                            aria-hidden="true"
                            className={`cell-status-dot is-${descState.status}`}
                            title={cellStatusLabel(descState.status)}
                          />
                        ) : null}
                      </div>
                    </td>
                    {displayLanguageCodes.map((languageCode) => {
                      const draftKey = `value:${translation.translation_key_id}:${languageCode}`;
                      const hasValue = Boolean(translation.values[languageCode]?.id);
                      const cellState = cellStates[draftKey];
                      const emptyClassName = !hasValue ? (viewMode === "missing" ? " is-missing" : " is-empty-value") : "";
                      return (
                        <td
                          className={viewMode === "missing" && !hasValue ? "missing-translation-cell" : undefined}
                          key={languageCode}
                        >
                          <div className="grid-cell">
                            <input
                              className={`${focusedCell === draftKey ? "grid-input is-focused" : "grid-input"}${emptyClassName}${cellStatusClassName(cellState?.status)}`}
                              data-grid-focus="true"
                              onBlur={() => {
                                void commitTranslationValue(translation, languageCode);
                              }}
                              onChange={(event) =>
                                handleTrackedDraftChange(
                                  draftKey,
                                  event.target.value,
                                  translation.values[languageCode]?.value ?? "",
                                )
                              }
                              onFocus={() => setFocusedCell(draftKey)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitTranslationValue(translation, languageCode);
                                  focusNextGridInput(event.currentTarget);
                                }
                              }}
                              placeholder={hasValue ? "" : `${t("project.table.add_value")} ${languageCode}`}
                              title={cellState?.status === "error" ? cellState.message : undefined}
                              value={draftValues[draftKey] ?? ""}
                            />
                            {cellState ? (
                              <span
                                aria-hidden="true"
                                className={`cell-status-dot is-${cellState.status}`}
                                title={cellStatusLabel(cellState.status)}
                              />
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                    {viewMode === "all" ? <td>
                      <div className="action-row">
                        <button
                          className="button ghost danger"
                          disabled={deleteMutation.isPending || !canDeleteTranslation || !translation.values[language]?.id}
                          onClick={() => {
                            const translationId = translation.values[language]?.id;
                            if (translationId) {
                              deleteMutation.mutate(translationId);
                            }
                          }}
                          type="button"
                        >
                          {`${t("actions.delete")} ${language}`}
                        </button>
                      </div>
                    </td> : null}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {translationRows.length === 0 ? (
            <div className="translation-empty-state">
              <span>{viewMode === "missing" ? t("project.missing.empty") : t("project.translations.empty")}</span>
              {viewMode === "all" && canCreateTranslation ? (
                <button
                  className="button primary"
                  onClick={() => {
                    const input = translationGridRef.current?.querySelector<HTMLInputElement>(
                      '[data-new-term-key="true"]',
                    );
                    input?.focus();
                  }}
                  type="button"
                >
                  {t("project.translations.empty_action")}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="pagination-bar">
            <span className="muted">
              {`${t("project.pagination.page")} ${page} ${t("project.pagination.of")} ${totalPages} · ${totalTranslationRows} ${t("project.pagination.terms")}`}
            </span>
            <div className="action-row">
              <button
                className="button ghost"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                {t("project.pagination.previous")}
              </button>
              <button
                className="button ghost"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                type="button"
              >
                {t("project.pagination.next")}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </article>
  );
}

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
