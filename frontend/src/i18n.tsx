import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import enMessages from "./locales/en.json";
import ruMessages from "./locales/ru.json";
import srbMessages from "./locales/srb.json";

type TranslationMessages = Record<string, string>;
type DeliveryMetadataResponse = {
  version?: string;
  languages?: Array<{ code: string; name: string }>;
  namespaces?: Array<{ name: string }>;
};

type I18nContextValue = {
  language: string;
  setLanguage: (language: string) => void;
  t: (key: string) => string;
  isLoading: boolean;
  error: string | null;
  supportedLanguages: Array<{ code: string; label: string }>;
};

const DEFAULT_LANGUAGE = "en";
const STORAGE_KEY = "oxiderelay.language";
const OXIDERELAY_PROJECT_SLUG = "oxide-relay";
const OXIDERELAY_ENVIRONMENT = "production";
const OXIDERELAY_NAMESPACE = "common";
const LOCAL_MESSAGES: Record<string, TranslationMessages> = {
  en: enMessages,
  ru: ruMessages,
  srb: srbMessages,
};
const DEFAULT_SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ru", label: "Russian" },
  { code: "srb", label: "Serbian" },
];

const I18nContext = createContext<I18nContextValue | null>(null);

function buildNamespaceUrl(language: string, version?: string): string {
  const path = `/static/${OXIDERELAY_PROJECT_SLUG}/${encodeURIComponent(OXIDERELAY_ENVIRONMENT)}/${encodeURIComponent(
    language,
  )}/${encodeURIComponent(OXIDERELAY_NAMESPACE)}.json${version ? `?v=${encodeURIComponent(version)}` : ""}`;
  const baseUrl = import.meta.env.VITE_I18N_BASE_URL?.trim();

  if (!baseUrl) {
    return path;
  }

  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function buildMetadataUrl(): string {
  const path = `/api/v1/projects/${OXIDERELAY_PROJECT_SLUG}/delivery-metadata?environment=${encodeURIComponent(
    OXIDERELAY_ENVIRONMENT,
  )}`;
  const baseUrl = import.meta.env.VITE_I18N_BASE_URL?.trim();

  if (!baseUrl) {
    return path;
  }

  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function readStoredLanguage(): string {
  if (typeof window === "undefined") {
    return DEFAULT_LANGUAGE;
  }

  const storedLanguage = window.localStorage.getItem(STORAGE_KEY)?.trim().toLowerCase();
  return storedLanguage || DEFAULT_LANGUAGE;
}

function getLocalMessages(language: string): TranslationMessages {
  return LOCAL_MESSAGES[language] ?? LOCAL_MESSAGES[DEFAULT_LANGUAGE] ?? {};
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState(readStoredLanguage);
  const [messages, setMessages] = useState<TranslationMessages>(() => getLocalMessages(readStoredLanguage()));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supportedLanguages, setSupportedLanguages] = useState(DEFAULT_SUPPORTED_LANGUAGES);
  const [metadataResolved, setMetadataResolved] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, TranslationMessages>>({});

  useEffect(() => {
    const controller = new AbortController();

    void fetch(buildMetadataUrl(), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`metadata request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as DeliveryMetadataResponse;
        const nextLanguages =
          payload.languages
            ?.filter((item) => item.code.trim().length > 0)
            .map((item) => ({
              code: item.code.trim().toLowerCase(),
              label: item.name?.trim() || item.code.trim().toUpperCase(),
            })) ?? [];

        if (nextLanguages.length > 0) {
          setSupportedLanguages(nextLanguages);
          setLanguageState((current) =>
            nextLanguages.some((item) => item.code === current) ? current : DEFAULT_LANGUAGE,
          );
        }
        setVersion(payload.version?.trim() || null);
        setMetadataResolved(true);
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setMetadataResolved(true);
      });

    return () => controller.abort();
  }, []);

  const setLanguage = useCallback((nextLanguage: string) => {
    const normalizedLanguage = nextLanguage.trim().toLowerCase();
    if (!normalizedLanguage) {
      return;
    }

    setLanguageState(normalizedLanguage);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, normalizedLanguage);
    }
  }, []);

  useEffect(() => {
    if (!metadataResolved) {
      return;
    }

    const cacheKey = `${language}:${version ?? "unversioned"}`;
    const cachedMessages = cacheRef.current[cacheKey];
    if (cachedMessages) {
      setMessages(cachedMessages);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const localMessages = getLocalMessages(language);
    setIsLoading(true);
    setError(null);
    setMessages(localMessages);

    void fetch(buildNamespaceUrl(language, version ?? undefined), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`translation request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as TranslationMessages;
        const nextMessages = { ...localMessages, ...(payload ?? {}) };
        cacheRef.current[cacheKey] = nextMessages;
        setMessages(nextMessages);
        setIsLoading(false);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setMessages(localMessages);
        setIsLoading(false);
        setError(loadError instanceof Error ? loadError.message : "translations.load_failed");
      });

    return () => controller.abort();
  }, [language, metadataResolved, version]);

  const t = useCallback(
    (key: string) => {
      return messages[key] ?? getLocalMessages(language)[key] ?? key;
    },
    [language, messages],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t,
      isLoading,
      error,
      supportedLanguages,
    }),
    [error, isLoading, language, setLanguage, supportedLanguages, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within I18nProvider");
  }
  return context;
}
