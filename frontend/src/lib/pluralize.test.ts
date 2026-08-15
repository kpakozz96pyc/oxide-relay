import { describe, expect, it } from "vitest";
import { pluralCategory } from "./pluralize";

describe("pluralCategory", () => {
  it("uses English-style one/other for languages without a Slavic rule", () => {
    expect(pluralCategory("en", 0)).toBe("other");
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
    expect(pluralCategory("en", 11)).toBe("other");
  });

  it("applies Russian one/few/many rules", () => {
    expect(pluralCategory("ru", 1)).toBe("one");
    expect(pluralCategory("ru", 21)).toBe("one");
    expect(pluralCategory("ru", 2)).toBe("few");
    expect(pluralCategory("ru", 3)).toBe("few");
    expect(pluralCategory("ru", 4)).toBe("few");
    expect(pluralCategory("ru", 24)).toBe("few");
    expect(pluralCategory("ru", 0)).toBe("many");
    expect(pluralCategory("ru", 5)).toBe("many");
    expect(pluralCategory("ru", 11)).toBe("many");
    expect(pluralCategory("ru", 12)).toBe("many");
    expect(pluralCategory("ru", 14)).toBe("many");
    expect(pluralCategory("ru", 111)).toBe("many");
  });

  it("applies the same Slavic rules to Serbian", () => {
    expect(pluralCategory("srb", 1)).toBe("one");
    expect(pluralCategory("srb", 3)).toBe("few");
    expect(pluralCategory("srb", 11)).toBe("many");
  });
});
