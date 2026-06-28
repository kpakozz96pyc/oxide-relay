/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_I18N_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
