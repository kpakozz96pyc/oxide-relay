# OxideRelay Frontend Localization Plan

## Goal

Localize the OxideRelay frontend by replacing hardcoded UI text with translation
keys, loading translations from the OxideRelay delivery API, falling back to the
key when no translation exists, and allowing runtime language switching from the UI.

## Requirements

1. Replace frontend UI text with translation keys.
2. If a translation is missing, display the key itself.
3. Load translations from the `oxide-relay` project delivery endpoint.
4. Support a configurable localization server base URL so a local frontend can
   consume translations from a remote OxideRelay instance.
5. Add a language switcher in the site header and reload translations on switch.

## Translation Source

Default relative path:

```text
/api/v1/projects/oxide-relay/locales/{language}?environment=production
```

Optional remote source via Vite runtime config:

```text
VITE_I18N_BASE_URL=http://kpakozz96pyc.xyz:8080
```

When `VITE_I18N_BASE_URL` is set, the frontend should load translations from:

```text
{VITE_I18N_BASE_URL}/api/v1/projects/oxide-relay/locales/{language}?environment=production
```

## Implementation Steps

### 1. Add frontend i18n infrastructure

- Create an `i18n` module for:
  - current language state
  - translation dictionary cache
  - translation loader
  - `t(key)` helper with key fallback
  - language persistence in `localStorage`

### 2. Add configurable translation source

- Introduce `VITE_I18N_BASE_URL`
- Centralize translation URL construction
- Use relative URLs when the variable is not set
- Use absolute remote URLs when the variable is set

### 3. Add runtime language switching

- Add a language switcher to the site header
- Persist the selected language
- Reload translations when the user switches languages

### 4. Replace hardcoded frontend text with keys

- Convert shared layout components
- Convert login page
- Convert projects, users, project workspace, and project panels
- Keep backend-provided error text unchanged where it comes from the server
- Use translation keys for frontend-generated fallback/error/loading text

### 5. Loading and failure behavior

- Do not crash if translation loading fails
- Show keys when translations are unavailable or missing
- Cache loaded dictionaries per language

### 6. Testing

- Verify default language loading
- Verify switching languages updates UI
- Verify `VITE_I18N_BASE_URL` path construction
- Verify missing translations fall back to keys
- Verify UI survives failed translation requests

## Notes

- The current codebase is the source of truth.
- Delivery endpoints are public, but using a remote translation source from a
  local frontend requires CORS to be allowed by that remote OxideRelay instance.
- Initial supported frontend languages can be defined statically in the frontend
  because the public delivery endpoint does not expose a public language catalog.
