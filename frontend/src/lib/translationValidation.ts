export const MAX_TRANSLATION_KEY_LENGTH = 500;
export const MAX_TRANSLATION_VALUE_LENGTH = 10_000;
export const MAX_TRANSLATION_IMPORT_ENTRIES = 5_000;

export function validateTranslationKey(key: string, namespace: string): string | null {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return "Every translation key must be a non-empty string.";
  }

  if (characterCount(normalizedKey) > MAX_TRANSLATION_KEY_LENGTH) {
    return "Translation key " + JSON.stringify(normalizedKey) + " must be at most " +
      MAX_TRANSLATION_KEY_LENGTH + " characters.";
  }

  if (/[:{}\u0000-\u001f\u007f-\u009f]/u.test(normalizedKey)) {
    return "Translation key " + JSON.stringify(normalizedKey) +
      " contains unsupported characters. Colons, braces, and control characters are not allowed.";
  }

  const normalizedNamespace = namespace.trim();
  if (normalizedNamespace && normalizedKey.startsWith(normalizedNamespace + ".")) {
    return "Translation key " + JSON.stringify(normalizedKey) + " must be local to namespace " +
      JSON.stringify(normalizedNamespace) + " and must not include the namespace prefix.";
  }

  return null;
}

export function validateTranslationValue(value: string, key?: string): string | null {
  const normalizedValue = value.trim();
  const field = key ? "The value for " + JSON.stringify(key) : "Translation value";
  if (!normalizedValue) {
    return field + " cannot be empty.";
  }

  if (characterCount(normalizedValue) > MAX_TRANSLATION_VALUE_LENGTH) {
    return field + " must be at most " + MAX_TRANSLATION_VALUE_LENGTH + " characters.";
  }

  return null;
}

function characterCount(value: string) {
  return Array.from(value).length;
}
