export const resourceLimits = Object.freeze({
  markdown: Object.freeze({
    maxBytes: 16 * 1024 * 1024,
    maxNodes: 100_000,
    maxNestingDepth: 128,
    maxDiagnostics: 100,
  }),
  selector: Object.freeze({
    maxBytes: 65_536,
    maxListLength: 64,
    maxSteps: 256,
    maxTests: 256,
    maxNesting: 16,
    maxRegexPatternLength: 256,
  }),
  expression: Object.freeze({
    maxBytes: 65_536,
    maxStages: 256,
  }),
  schema: Object.freeze({
    maxBytes: 1024 * 1024,
    maxDepth: 64,
    maxValues: 100_000,
    maxRules: 256,
    maxDiagnostics: 100,
  }),
  validation: Object.freeze({
    maxDiagnostics: 1_000,
  }),
});
