#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import {
  compileExpression,
  evaluate,
  isMarkdownNode,
  nodeMarkdown,
  parse,
  toJsonValue,
  type Diagnostic,
  type Document,
  type QueryValue,
} from "@prelude/mq";

type ColorPolicy = "auto" | "always" | "never";
type DiagnosticFormat = "human" | "json";

interface CliOptions {
  rawOutput: boolean;
  json: boolean;
  quiet: boolean;
  nullInput: boolean;
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
  readonly document: Document;
  readonly values: readonly QueryValue[];
}

interface LoadedInput {
  readonly path: string | undefined;
  readonly source?: string;
  readonly diagnostic?: Diagnostic;
}

class CliUsageError extends Error {}

const optionsDefaults = (): CliOptions => ({
  rawOutput: false,
  json: false,
  quiet: false,
  nullInput: false,
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
      name !== "--diagnostics"
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
  "      --fail-empty           Exit 1 when an input emits no values",
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
  return `${location}: ${renderedLabel}: ${diagnostic.message}\n`;
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

const main = async (args: readonly string[]): Promise<number> => {
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

  const diagnostics: Diagnostic[] = [];
  const evaluated: EvaluatedInput[] = [];
  let status = 0;
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
    evaluated.push({ document: parsed.value, values });
  }

  const multipleInputs = inputs.length > 1;
  const ambiguousMarkdown =
    multipleInputs &&
    !options.json &&
    !options.quiet &&
    evaluated.some(({ values }) => values.some(isMarkdownNode));
  if (ambiguousMarkdown) {
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
