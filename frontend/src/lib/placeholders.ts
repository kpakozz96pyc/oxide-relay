const DOUBLE_BRACE_PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const SINGLE_BRACE_PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

export function extractPlaceholders(value: string): string[] {
  const names = new Set<string>();

  const withoutDoubleBraces = value.replace(DOUBLE_BRACE_PLACEHOLDER, (_match, name: string) => {
    names.add(name);
    return "";
  });

  for (const match of withoutDoubleBraces.matchAll(SINGLE_BRACE_PLACEHOLDER)) {
    names.add(match[1]);
  }

  return Array.from(names).sort();
}

// For each language that has a non-empty value, returns the placeholder names
// present in at least one other language's value but missing from this one.
// Languages are only compared once two or more of them have a value, and a
// language absent from the input (no value yet) is never reported.
export function findMissingPlaceholders(
  valuesByLanguage: Record<string, string>,
): Record<string, string[]> {
  const placeholdersByLanguage: Record<string, string[]> = {};
  for (const [languageCode, value] of Object.entries(valuesByLanguage)) {
    const trimmed = value.trim();
    if (trimmed) {
      placeholdersByLanguage[languageCode] = extractPlaceholders(trimmed);
    }
  }

  const languagesWithValues = Object.keys(placeholdersByLanguage);
  if (languagesWithValues.length < 2) {
    return {};
  }

  const union = new Set<string>();
  for (const names of Object.values(placeholdersByLanguage)) {
    for (const name of names) {
      union.add(name);
    }
  }

  const gaps: Record<string, string[]> = {};
  for (const languageCode of languagesWithValues) {
    const owned = new Set(placeholdersByLanguage[languageCode]);
    const missing = Array.from(union)
      .filter((name) => !owned.has(name))
      .sort();
    if (missing.length > 0) {
      gaps[languageCode] = missing;
    }
  }
  return gaps;
}
