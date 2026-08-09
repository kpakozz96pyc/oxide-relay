import { describe, expect, it } from "vitest";

import { extractPlaceholders, findMissingPlaceholders } from "./placeholders";

describe("extractPlaceholders", () => {
  it("finds double-brace placeholders", () => {
    expect(extractPlaceholders("Hello {{name}}, you have {{count}} items")).toEqual([
      "count",
      "name",
    ]);
  });

  it("finds single-brace placeholders", () => {
    expect(extractPlaceholders("Hello {name}, you have {count} items")).toEqual([
      "count",
      "name",
    ]);
  });

  it("does not double-count double-brace placeholders as single-brace ones", () => {
    expect(extractPlaceholders("Hello {{name}}")).toEqual(["name"]);
  });

  it("supports dotted and underscored names", () => {
    expect(extractPlaceholders("{{user.first_name}} / {order_id}")).toEqual([
      "order_id",
      "user.first_name",
    ]);
  });

  it("deduplicates repeated placeholders", () => {
    expect(extractPlaceholders("{name} said hi to {name}")).toEqual(["name"]);
  });

  it("returns an empty list when there are no placeholders", () => {
    expect(extractPlaceholders("Plain text with no braces")).toEqual([]);
  });

  it("ignores braces with no supported placeholder characters inside", () => {
    expect(extractPlaceholders("Use the {} shorthand or a { free brace")).toEqual([]);
  });
});

describe("findMissingPlaceholders", () => {
  it("flags a language missing a placeholder present in another language", () => {
    expect(
      findMissingPlaceholders({
        en: "Hello {{name}}",
        ru: "Привет",
      }),
    ).toEqual({ ru: ["name"] });
  });

  it("returns no gaps when every populated language has the same placeholders", () => {
    expect(
      findMissingPlaceholders({
        en: "Hello {{name}}",
        ru: "Привет, {{name}}",
      }),
    ).toEqual({});
  });

  it("ignores languages with no value yet", () => {
    expect(
      findMissingPlaceholders({
        en: "Hello {{name}}",
        ru: "",
      }),
    ).toEqual({});
  });

  it("does nothing when fewer than two languages have a value", () => {
    expect(findMissingPlaceholders({ en: "Hello {{name}}" })).toEqual({});
  });

  it("flags multiple languages independently against the union of placeholders", () => {
    expect(
      findMissingPlaceholders({
        en: "{{greeting}}, {{name}}",
        ru: "{{greeting}}",
        srb: "{{name}}",
      }),
    ).toEqual({
      ru: ["name"],
      srb: ["greeting"],
    });
  });
});
