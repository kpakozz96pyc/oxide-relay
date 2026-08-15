export type PluralCategory = "one" | "few" | "many" | "other";

// Slavic languages (ru, srb) use CLDR's one/few/many split; every other supported
// language collapses to the simpler one/other split English uses.
export function pluralCategory(language: string, count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count));

  if (language === "ru" || language === "srb") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) {
      return "one";
    }
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
      return "few";
    }
    return "many";
  }

  return n === 1 ? "one" : "other";
}
