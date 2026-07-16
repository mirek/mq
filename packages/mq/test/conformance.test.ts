import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import {
  compileSelector,
  parse,
  render,
  select,
  type Document,
} from "../src/index.ts";

interface CommonMarkExample {
  readonly markdown: string;
  readonly html: string;
  readonly section: string;
  readonly number: number;
}

const require = createRequire(import.meta.url);
const commonmark = require("commonmark-spec") as {
  readonly tests: readonly CommonMarkExample[];
};

const count = (source: string, pattern: RegExp): number =>
  source.match(pattern)?.length ?? 0;

const selectedCount = (document: Document, type: string): number => {
  const compiled = compileSelector(type);
  assert.equal(compiled.ok, true);
  return compiled.ok ? select(document, compiled.value).length : 0;
};

const semanticSections = new Map<
  string,
  readonly { readonly type: string; readonly html: RegExp }[]
>([
  ["Thematic breaks", [{ type: "thematic-break", html: /<hr \/>/gu }]],
  [
    "ATX headings",
    [{ type: "heading", html: /<h[1-6](?:>| )/gu }],
  ],
  [
    "Setext headings",
    [{ type: "heading", html: /<h[12](?:>| )/gu }],
  ],
  [
    "Indented code blocks",
    [{ type: "code", html: /<pre><code(?:>| )/gu }],
  ],
  [
    "Fenced code blocks",
    [{ type: "code", html: /<pre><code(?:>| )/gu }],
  ],
  ["Paragraphs", [{ type: "paragraph", html: /<p>/gu }]],
  ["Block quotes", [{ type: "blockquote", html: /<blockquote>/gu }]],
  [
    "Lists",
    [{ type: "list", html: /<(?:ul|ol)(?:>| )/gu }],
  ],
  ["Code spans", [{ type: "inline-code", html: /<code>/gu }]],
  [
    "Emphasis and strong emphasis",
    [
      { type: "emphasis", html: /<em>/gu },
      { type: "strong", html: /<strong>/gu },
    ],
  ],
  ["Links", [{ type: "link", html: /<a href=/gu }]],
  ["Images", [{ type: "image", html: /<img src=/gu }]],
  ["Autolinks", [{ type: "link", html: /<a href=/gu }]],
  ["Hard line breaks", [{ type: "break", html: /<br \/>/gu }]],
]);

const intentionalSemanticDeviations = new Set([
  // A closed leading `---` block is YAML frontmatter in mq.
  96,
  // GFM literal autolinks intentionally extend CommonMark plain text.
  602,
  608,
  611,
  612,
]);

describe("CommonMark 0.31.2 conformance corpus", () => {
  it("round-trips all 652 pinned examples", () => {
    assert.equal(commonmark.tests.length, 652);
    for (const example of commonmark.tests) {
      const parsed = parse(example.markdown);
      assert.equal(parsed.ok, true, `example ${example.number}`);
      if (!parsed.ok) continue;
      assert.equal(
        render(parsed.value),
        example.markdown,
        `example ${example.number}`,
      );
    }
  });

  it("matches supported semantic node counts in applicable sections", () => {
    for (const example of commonmark.tests) {
      if (intentionalSemanticDeviations.has(example.number)) continue;
      const expectations = semanticSections.get(example.section);
      if (expectations === undefined) continue;
      const parsed = parse(example.markdown);
      assert.equal(parsed.ok, true, `example ${example.number}`);
      if (!parsed.ok) continue;

      for (const expectation of expectations) {
        assert.equal(
          selectedCount(parsed.value, expectation.type),
          count(example.html, expectation.html),
          `example ${example.number} ${expectation.type}`,
        );
      }
    }
  });

  it("recovers positionless GFM-generated inlines as one opaque source range", () => {
    const example = commonmark.tests.find(({ number }) => number === 606);
    assert.ok(example);
    const parsed = parse(example.markdown);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(selectedCount(parsed.value, "link"), 0);
    assert.equal(selectedCount(parsed.value, "opaque"), 1);
    assert.equal(render(parsed.value), example.markdown);
  });
});

const gfmExamples = [
  {
    number: 1,
    section: "Tables",
    markdown: "| abc | def |\n| --- | --- |\n| ghi | jkl |\n| mno | pqr |\n",
    expected: { table: 1 },
  },
  {
    number: 8,
    section: "Table cell count mismatches",
    markdown:
      "| a | b | c |\n| --- | --- | ---\n| x\n| a | b\n| 1 | 2 | 3 | 4 | 5 |\n",
    expected: { table: 1 },
  },
  {
    number: 9,
    section: "Embedded pipes",
    markdown:
      "| a | b |\n| --- | --- |\n| Escaped pipes are \\|okay\\|. | Like \\| this. |\n| Within `\\|code\\| is okay` too. |\n",
    expected: { table: 1, "inline-code": 1 },
  },
  {
    number: 17,
    section: "Strikethroughs",
    markdown: "A proper ~strikethrough~.\n",
    expected: { strikethrough: 1 },
  },
  {
    number: 20,
    section: "Autolinks",
    markdown: "This shouldn't crash everything: (_A_@_.A\n",
    expected: {},
  },
  {
    number: 24,
    section: "Footnotes",
    markdown:
      "This is some text. It has a footnote[^a-footnote].\n\n[^a-footnote]: This footnote remains opaque.\n",
    expected: { opaque: 2 },
  },
  {
    number: 26,
    section: "Interop",
    markdown: "~~www.google.com~~\n\n~~http://google.com~~\n",
    expected: { strikethrough: 2, link: 2 },
  },
  {
    number: 28,
    section: "Task lists",
    markdown: "- [ ] foo\n- [x] bar\n",
    expected: { "item[checked]": 2 },
  },
] as const;

describe("GFM 0.29.0.gfm.13 pinned extension examples", () => {
  for (const example of gfmExamples) {
    it(`round-trips example ${example.number} (${example.section})`, () => {
      const parsed = parse(example.markdown);
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;
      assert.equal(render(parsed.value), example.markdown);
      for (const [selector, expected] of Object.entries(example.expected)) {
        assert.equal(selectedCount(parsed.value, selector), expected, selector);
      }
    });
  }
});
