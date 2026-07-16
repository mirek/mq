import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import type { JsonObject, JsonValue } from "./schema.ts";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateSchema: true,
});
const validators = new WeakMap<JsonObject, ValidateFunction>();

const validatorFor = (schema: JsonObject): ValidateFunction => {
  const cached = validators.get(schema);
  if (cached !== undefined) return cached;
  const validator = ajv.compile(schema);
  if ("$async" in validator && validator.$async === true) {
    throw new TypeError("Asynchronous JSON Schemas are not supported.");
  }
  validators.set(schema, validator);
  return validator;
};

export const jsonSchemaCompileError = (schema: JsonObject): string | undefined => {
  try {
    validatorFor(schema);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON Schema.";
  }
};

export const validateJsonSchema = (
  schema: JsonObject,
  value: JsonValue,
): readonly ErrorObject[] => {
  const validator = validatorFor(schema);
  return validator(value) ? [] : Object.freeze([...(validator.errors ?? [])]);
};
