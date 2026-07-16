#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  compileExpression,
  evaluate,
  isMarkdownNode,
  loadSchema,
  nodeMarkdown,
  parse,
  render,
  toJsonValue,
  validate,
  type Diagnostic,
  type Document,
  type QueryValue,
} from "@prelude/mq";

import { atomicWrite } from "./atomic-write.ts";

type ColorPolicy = "auto" | "always" | "never";
type DiagnosticFormat = "human" | "json";

interface CliOptions {
  rawOutput: boolean;
  json: boolean;
  quiet: boolean;
  nullInput: boolean;
  write: boolean;
  output: string | undefined;
  schema: string | undefined;
  failEmpty: boolean;
  help: boolean;
  color: ColorPolicy;
  diagnostics: DiagnosticFormat;
}

interface ParsedArguments {
  readonly options: CliOptions;
  readonly expression: string;
  readonly files: readonly string[];
}

interface EvaluatedInput {
  readonly path: string | undefined;
  readonly document: Document;
  readonly values: readonly QueryValue[];
}

interface LoadedInput {
  readonly path: string | undefined;
  readonly source?: string;
  readonly diagnostic?: Diagnostic;
}

interface ValidateArguments {
  readonly schema: string | undefined;
  readonly files: readonly string[];
  readonly help: boolean;
}

class CliUsageError extends Error {}

const optionsDefaults = (): CliOptions => ({
  rawOutput: false,
  json: false,
  quiet: false,
  nullInput: false,
  write: false,
  output: undefined,
  schema: undefined,
  failEmpty: false,
  help: false,
  color: "auto",
  diagnostics: "human",
});

const optionValue = (
  args: readonly string[],
  index: number,
  name: string,
  inline: string | undefined,
): { readonly value: string; readonly index: number } => {
  if (inline !== undefined) return { value: inline, index };
  const value = args[index + 1];
  if (value === undefined) {
    throw new CliUsageError(`Option ${name} requires a value.`);
  }
  return { value, index: index + 1 };
};

const parseArguments = (
  args: readonly string[],
  options: CliOptions,
): ParsedArguments => {
  const positional: string[] = [];
  let parseOptions = true;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (parseOptions && argument === "--") {
      parseOptions = false;
      continue;
    }
    if (!parseOptions || argument === "-" || !argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }

    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    if (
      inline !== undefined &&
      name !== "--color" &&
      name !== "--diagnostics" &&
      name !== "--output" &&
      name !== "--schema"
    ) {
      throw new CliUsageError(`Option ${name} does not accept a value.`);
    }
    if (name === "-r" || name === "--raw-output") {
      options.rawOutput = true;
    } else if (name === "-j" || name === "--json") {
      options.json = true;
    } else if (name === "-q" || name === "--quiet") {
      options.quiet = true;
    } else if (name === "-n" || name === "--null-input") {
      options.nullInput = true;
    } else if (name === "-w" || name === "--write") {
      options.write = true;
    } else if (name === "-o" || name === "--output") {
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      options.output = parsed.value;
    } else if (name === "--schema") {
      if (options.schema !== undefined) {
        throw new CliUsageError("--schema may be specified only once.");
      }
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      options.schema = parsed.value;
    } else if (name === "--fail-empty") {
      options.failEmpty = true;
    } else if (name === "-h" || name === "--help") {
      options.help = true;
    } else if (name === "--color") {
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      if (parsed.value !== "auto" && parsed.value !== "always" && parsed.value !== "never") {
        throw new CliUsageError(`Invalid --color value ${JSON.stringify(parsed.value)}.`);
      }
      options.color = parsed.value;
    } else if (name === "--diagnostics") {
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      if (parsed.value !== "human" && parsed.value !== "json") {
        throw new CliUsageError(
          `Invalid --diagnostics value ${JSON.stringify(parsed.value)}.`,
        );
      }
      options.diagnostics = parsed.value;
    } else {
      throw new CliUsageError(`Unknown option ${JSON.stringify(argument)}.`);
    }
  }

  if (options.json && options.rawOutput) {
    throw new CliUsageError("--json and --raw-output cannot be combined.");
  }

  const expression = positional[0] ?? ".";
  const files = positional.slice(1);
  if (options.nullInput && files.length > 0) {
    throw new CliUsageError("--null-input does not accept input files.");
  }
  if (options.write && options.output !== undefined) {
    throw new CliUsageError("--write and --output cannot be combined.");
  }
  if (options.write) {
    if (files.length === 0 || files.some((path) => path === "-")) {
      throw new CliUsageError("--write requires named input files.");
    }
    if (new Set(files).size !== files.length) {
      throw new CliUsageError("--write does not accept duplicate input paths.");
    }
  }
  if (options.output !== undefined && files.length > 1) {
    throw new CliUsageError("--output requires exactly one input.");
  }
  return { options, expression, files: Object.freeze(files) };
};

const cliDiagnostic = (
  code: string,
  message: string,
  path?: string,
): Diagnostic =>
  Object.freeze({
    code,
    severity: "error",
    message,
    ...(path === undefined ? {} : { path }),
  });

const help = [
  "Usage: mq [options] [expression] [file ...]",
  "",
  "Query Markdown documents as ordered value streams.",
  "",
  "Arguments:",
  "  expression                 Query expression (default: .)",
  "  file ...                   Input files; omit for stdin, - also means stdin",
  "",
  "Options:",
  "  -r, --raw-output           Write strings without JSON quoting",
  "  -j, --json                 Encode every result as canonical JSON",
  "  -q, --quiet                Suppress results",
  "  -n, --null-input           Evaluate one empty document without reading input",
  "  -w, --write                Atomically replace each named input file",
  "  -o, --output <path>        Atomically write one document result",
  "      --schema <path>        Validate documents before output or writes",
  "      --fail-empty           Exit 1 when an input emits no values",
  "      --color <policy>       auto, always, or never (default: auto)",
  "      --diagnostics <format> human or json (default: human)",
  "  -h, --help                 Show this help",
  "",
].join("\n");

const validateHelp = [
  "Usage: mq validate --schema <schema.json> [file ...]",
  "",
  "Validate Markdown documents against one mq schema.",
  "",
  "Arguments:",
  "  file ...                   Input files; omit for stdin, - also means stdin",
  "",
  "Options:",
  "      --schema <path>        JSON mq schema (required)",
  "      --color <policy>       auto, always, or never (default: auto)",
  "      --diagnostics <format> human or json (default: human)",
  "  -h, --help                 Show this help",
  "",
].join("\n");

const usesColor = (policy: ColorPolicy): boolean =>
  policy === "always" || (policy === "auto" && process.stderr.isTTY === true);

const formatHumanDiagnostic = (
  diagnostic: Diagnostic,
  color: ColorPolicy,
): string => {
  let location = diagnostic.path ?? diagnostic.source ?? "mq";
  if (diagnostic.range !== undefined) {
    location += `:${diagnostic.range.start.line}:${diagnostic.range.start.column}`;
  }
  const label = `${diagnostic.severity}[${diagnostic.code}]`;
  const renderedLabel = usesColor(color)
    ? `\u001b[${diagnostic.severity === "error" ? "31" : "33"}m${label}\u001b[0m`
    : label;
  let output = `${location}: ${renderedLabel}: ${diagnostic.message}\n`;
  for (const note of diagnostic.notes ?? []) {
    let noteLocation = note.path ?? diagnostic.path ?? diagnostic.source ?? "mq";
    if (note.range !== undefined) {
      noteLocation += `:${note.range.start.line}:${note.range.start.column}`;
    }
    output += `${noteLocation}: note: ${note.message}\n`;
  }
  return output;
};

const writeDiagnostics = (
  diagnostics: readonly Diagnostic[],
  options: CliOptions,
): void => {
  for (const diagnostic of diagnostics) {
    process.stderr.write(
      options.diagnostics === "json"
        ? `${JSON.stringify(diagnostic)}\n`
        : formatHumanDiagnostic(diagnostic, options.color),
    );
  }
};

const readStdin = async (): Promise<string> => {
  process.stdin.setEncoding("utf8");
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  return source;
};

const formatValue = (
  document: Document,
  value: QueryValue,
  options: CliOptions,
): string => {
  if (!options.json && isMarkdownNode(value)) {
    return nodeMarkdown(document, value);
  }
  if (!options.json && options.rawOutput && typeof value === "string") {
    return `${value}\n`;
  }
  return `${JSON.stringify(toJsonValue(document, value))}\n`;
};

const parseValidateArguments = (
  args: readonly string[],
  options: CliOptions,
): ValidateArguments => {
  const files: string[] = [];
  let schema: string | undefined;
  let helpRequested = false;
  let parseOptions = true;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (parseOptions && argument === "--") {
      parseOptions = false;
      continue;
    }
    if (!parseOptions || argument === "-" || !argument.startsWith("-")) {
      files.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    if (name === "--schema") {
      if (schema !== undefined) {
        throw new CliUsageError("mq validate accepts --schema only once.");
      }
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      schema = parsed.value;
    } else if (name === "--color") {
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      if (parsed.value !== "auto" && parsed.value !== "always" && parsed.value !== "never") {
        throw new CliUsageError(`Invalid --color value ${JSON.stringify(parsed.value)}.`);
      }
      options.color = parsed.value;
    } else if (name === "--diagnostics") {
      const parsed = optionValue(args, index, name, inline);
      index = parsed.index;
      if (parsed.value !== "human" && parsed.value !== "json") {
        throw new CliUsageError(`Invalid --diagnostics value ${JSON.stringify(parsed.value)}.`);
      }
      options.diagnostics = parsed.value;
    } else if (name === "-h" || name === "--help") {
      if (inline !== undefined) throw new CliUsageError(`Option ${name} does not accept a value.`);
      helpRequested = true;
    } else {
      throw new CliUsageError(`Unknown validate option ${JSON.stringify(argument)}.`);
    }
  }
  if (!helpRequested && schema === undefined) {
    throw new CliUsageError("mq validate requires --schema <path>.");
  }
  return { schema, files: Object.freeze(files), help: helpRequested };
};

const validateMain = async (args: readonly string[]): Promise<number> => {
  const options = optionsDefaults();
  let parsed: ValidateArguments;
  try {
    parsed = parseValidateArguments(args, options);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    writeDiagnostics([cliDiagnostic("cli.usage", error.message)], options);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(validateHelp);
    return 0;
  }

  let schemaSource: string;
  try {
    schemaSource = await readFile(parsed.schema!, "utf8");
  } catch {
    writeDiagnostics(
      [cliDiagnostic("cli.io", "Cannot read schema file.", parsed.schema)],
      options,
    );
    return 3;
  }
  const loadedSchema = loadSchema(schemaSource, { path: parsed.schema! });
  if (!loadedSchema.ok) {
    writeDiagnostics(loadedSchema.diagnostics, options);
    return 2;
  }

  const inputs: readonly (string | undefined)[] =
    parsed.files.length === 0 ? [undefined] : parsed.files;
  const stdinPromise = inputs.some((path) => path === undefined || path === "-")
    ? readStdin()
    : undefined;
  let status = 0;
  const diagnostics: Diagnostic[] = [];
  const loadedInputs: readonly LoadedInput[] = await Promise.all(
    inputs.map(async (path): Promise<LoadedInput> => {
      if (path === undefined || path === "-") {
        return { path, source: await stdinPromise! };
      }
      try {
        return { path, source: await readFile(path, "utf8") };
      } catch {
        return {
          path,
          diagnostic: cliDiagnostic("cli.io", "Cannot read input file.", path),
        };
      }
    }),
  );
  for (const loaded of loadedInputs) {
    if (loaded.diagnostic !== undefined) {
      diagnostics.push(loaded.diagnostic);
      status = Math.max(status, 3);
      continue;
    }
    const parsedDocument = parse(
      loaded.source!,
      loaded.path === undefined ? {} : { path: loaded.path },
    );
    diagnostics.push(...parsedDocument.diagnostics);
    if (!parsedDocument.ok) {
      status = Math.max(status, 2);
      continue;
    }
    const result = validate(parsedDocument.value, loadedSchema.value);
    if (!result.ok) {
      diagnostics.push(...result.diagnostics);
      status = Math.max(status, 1);
    }
  }
  writeDiagnostics(diagnostics, options);
  return status;
};

const main = async (args: readonly string[]): Promise<number> => {
  if (args[0] === "validate") return validateMain(args.slice(1));
  const options = optionsDefaults();
  let parsedArguments: ParsedArguments;
  try {
    parsedArguments = parseArguments(args, options);
  } catch (error) {
    if (!(error instanceof CliUsageError)) throw error;
    writeDiagnostics([cliDiagnostic("cli.usage", error.message)], options);
    return 2;
  }
  if (options.help) {
    process.stdout.write(help);
    return 0;
  }

  const compiled = compileExpression(parsedArguments.expression);
  if (!compiled.ok) {
    writeDiagnostics(compiled.diagnostics, options);
    return 2;
  }

  let schema: ReturnType<typeof loadSchema> | undefined;
  if (options.schema !== undefined) {
    let source: string;
    try {
      source = await readFile(options.schema, "utf8");
    } catch {
      writeDiagnostics(
        [cliDiagnostic("cli.io", "Cannot read schema file.", options.schema)],
        options,
      );
      return 3;
    }
    schema = loadSchema(source, { path: options.schema });
    if (!schema.ok) {
      writeDiagnostics(schema.diagnostics, options);
      return 2;
    }
  }

  const diagnostics: Diagnostic[] = [];
  const evaluated: EvaluatedInput[] = [];
  let status = 0;
  let schemaBlocked = false;
  const writes = options.write || options.output !== undefined;
  const inputs: readonly (string | undefined)[] = options.nullInput
    ? [undefined]
    : parsedArguments.files.length === 0
      ? [undefined]
      : parsedArguments.files;

  const stdinPromise =
    !options.nullInput && inputs.some((path) => path === undefined || path === "-")
      ? readStdin()
      : undefined;
  const loadedInputs: readonly LoadedInput[] = await Promise.all(
    inputs.map(async (path): Promise<LoadedInput> => {
      if (options.nullInput) return { path, source: "" };
      if (path === undefined || path === "-") {
        return { path, source: await stdinPromise! };
      }
      try {
        return { path, source: await readFile(path, "utf8") };
      } catch {
        return {
          path,
          diagnostic: cliDiagnostic("cli.io", "Cannot read input file.", path),
        };
      }
    }),
  );

  for (const loaded of loadedInputs) {
    if (loaded.diagnostic !== undefined) {
      diagnostics.push(loaded.diagnostic);
      status = Math.max(status, 3);
      continue;
    }
    const source = loaded.source!;

    const parsed = parse(
      source,
      loaded.path === undefined ? {} : { path: loaded.path },
    );
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.ok) {
      status = Math.max(status, 2);
      continue;
    }

    const values = evaluate(parsed.value, compiled.value);
    if (options.failEmpty && values.length === 0) status = Math.max(status, 1);
    evaluated.push({ path: loaded.path, document: parsed.value, values });
    const documentResult =
      values.length === 1 &&
      values[0] !== undefined &&
      isMarkdownNode(values[0]) &&
      values[0].type === "document";
    if (schema?.ok === true && (!writes || documentResult)) {
      const value = values[0];
      const candidate =
        documentResult && value !== undefined && isMarkdownNode(value)
          ? (value as Document)
          : parsed.value;
      const result = validate(candidate, schema.value);
      if (!result.ok) {
        diagnostics.push(...result.diagnostics);
        schemaBlocked = true;
        status = Math.max(status, 1);
      }
    }
  }

  if (writes && status < 2) {
    const invalid = evaluated.some(
      ({ values }) =>
        values.length !== 1 ||
        !isMarkdownNode(values[0]) ||
        values[0].type !== "document",
    );
    if (invalid || evaluated.length !== inputs.length) {
      diagnostics.push(
        cliDiagnostic(
          "cli.write-result",
          "Write output requires exactly one document result.",
        ),
      );
      status = Math.max(status, 2);
    }
  }

  if (writes && status === 0 && !schemaBlocked) {
    const failures = await Promise.all(
      evaluated.map(async (input): Promise<string | undefined> => {
        const value = input.values[0]!;
        if (!isMarkdownNode(value) || value.type !== "document") {
          return undefined;
        }
        const destination = options.output ?? input.path!;
        try {
          await atomicWrite(destination, render(value), {
            preserveMode: options.write,
          });
          return undefined;
        } catch {
          return destination;
        }
      }),
    );
    for (const destination of failures) {
      if (destination === undefined) continue;
      diagnostics.push(
        cliDiagnostic("cli.io", "Cannot write output file.", destination),
      );
      status = Math.max(status, 3);
    }
  }

  const multipleInputs = inputs.length > 1;
  const ambiguousMarkdown =
    multipleInputs &&
    !options.json &&
    !options.quiet &&
    evaluated.some(({ values }) => values.some(isMarkdownNode));
  if (writes || schemaBlocked) {
    // Explicit write modes never also emit query output.
  } else if (ambiguousMarkdown) {
    diagnostics.push(
      cliDiagnostic(
        "cli.multiple-markdown-inputs",
        "Markdown node output from multiple inputs requires --json.",
      ),
    );
    status = Math.max(status, 2);
  } else if (!options.quiet) {
    for (const { document, values } of evaluated) {
      for (const value of values) {
        process.stdout.write(formatValue(document, value, options));
      }
    }
  }

  writeDiagnostics(diagnostics, options);
  return status;
};

process.exitCode = await main(process.argv.slice(2));
