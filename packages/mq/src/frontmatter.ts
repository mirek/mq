import { parse as parseToml, TomlDate } from "smol-toml";
import { parseDocument } from "yaml";

import type { Diagnostic } from "./diagnostic.ts";
import type { Frontmatter } from "./model.ts";
import { failure, success, type Result } from "./result.ts";
import { parseJsonValue, type JsonValue } from "./schema.ts";

export interface DecodeFrontmatterOptions {
  readonly path?: string;
}

const portable = (
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): JsonValue => {
  if (value instanceof TomlDate) return value.toISOString();
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Frontmatter numbers must be finite.");
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Frontmatter must decode to portable JSON data.");
  }
  if (ancestors.has(value)) throw new TypeError("Frontmatter aliases must not form cycles.");
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) return Object.freeze(value.map((item) => portable(item, next)));
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      enumerable: true,
      value: portable(child, next),
    });
  }
  return Object.freeze(result);
};

const decode = (frontmatter: Frontmatter): JsonValue => {
  if (frontmatter.format === "json") {
    const parsed = parseJsonValue(`{${frontmatter.value}}`);
    if (!parsed.ok) throw new SyntaxError(parsed.diagnostics[0].message);
    return parsed.value;
  }
  if (frontmatter.format === "toml") return portable(parseToml(frontmatter.value));

  const document = parseDocument(frontmatter.value, {
    schema: "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    resolveKnownTags: false,
  });
  const issue = document.errors[0] ?? document.warnings[0];
  if (issue !== undefined) throw new SyntaxError(issue.message);
  return portable(document.toJS({ maxAliasCount: 0 }));
};

/** Safely decodes one losslessly retained frontmatter node into portable JSON. */
export const decodeFrontmatter = (
  frontmatter: Frontmatter,
  options: DecodeFrontmatterOptions = {},
): Result<JsonValue> => {
  try {
    return success(portable(decode(frontmatter)));
  } catch (error) {
    const diagnostic: Diagnostic = Object.freeze({
      code: "schema.frontmatter-decode",
      severity: "error",
      message:
        error instanceof Error
          ? `Cannot decode ${frontmatter.format.toUpperCase()} frontmatter: ${error.message}`
          : `Cannot decode ${frontmatter.format.toUpperCase()} frontmatter.`,
      source: "schema",
      ...(options.path === undefined ? {} : { path: options.path }),
      range: frontmatter.range,
    });
    return failure(diagnostic);
  }
};
