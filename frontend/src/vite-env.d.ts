/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional engine origin (http(s) URL or root-relative path). Empty means same origin via the dev proxy. */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
