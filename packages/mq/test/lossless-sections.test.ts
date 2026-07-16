import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parse,
  render,
  type Block,
  type Document,
  type MarkdownNode,
  type Section,
} from "../src/index.ts";

const isBlock = (node: MarkdownNode): node is Block =>
  node.type !== "document" &&
  node.type !== "section" &&
  node.type !== "heading" &&
  node.type !== "text";

const flattenSections = (
  sections: readonly Section[],
): readonly Section[] =>
  sections.flatMap((section) => [
    section,
    ...flattenSections(section.sections),
  ]);

const assertSectionOwnership = (document: Document): void => {
  assert.equal(document.range.start.byteOffset, 0);
  assert.equal(document.range.end.byteOffset, document.source.byteLength);
  assert.deepEqual(
    document.children.filter(({ type }) => type !== "section"),
    document.preamble,
  );
  assert.deepEqual(
    document.children.filter(({ type }) => type === "section"),
    document.sections,
  );

  const allSections = flattenSections(document.sections);
  const orderedSections = allSections.toSorted(
    (left, right) =>
      left.range.start.byteOffset - right.range.start.byteOffset,
  );
  const ownedBlocks = new Set<Block>();
  const ownedHeadings = new Set<MarkdownNode>();

  const visit = (section: Section, parent?: Section): void => {
    assert.strictEqual(section.children[0], section.heading);
    assert.equal(section.range.start.byteOffset, section.heading.range.start.byteOffset);
    assert.deepEqual(section.children.filter(isBlock), section.body);
    assert.deepEqual(
      section.children.filter(({ type }) => type === "section"),
      section.sections,
    );
    assert.equal(ownedHeadings.has(section.heading), false);
    ownedHeadings.add(section.heading);

    if (parent !== undefined) {
      assert.equal(section.level > parent.level, true);
      assert.equal(
        section.range.start.byteOffset >= parent.range.start.byteOffset,
        true,
      );
      assert.equal(section.range.end.byteOffset <= parent.range.end.byteOffset, true);
    }

    let lastStart = section.range.start.byteOffset;
    for (const child of section.children) {
      assert.equal(child.range.start.byteOffset >= lastStart, true);
      assert.equal(child.range.end.byteOffset <= section.range.end.byteOffset, true);
      lastStart = child.range.start.byteOffset;
    }

    for (const block of section.body) {
      assert.equal(ownedBlocks.has(block), false);
      ownedBlocks.add(block);
    }
    for (const child of section.sections) visit(child, section);
  };

  for (const section of document.sections) visit(section);

  for (const [index, section] of orderedSections.entries()) {
    const closing = orderedSections
      .slice(index + 1)
      .find((candidate) => candidate.level <= section.level);
    assert.equal(
      section.range.end.byteOffset,
      closing?.range.start.byteOffset ?? document.source.byteLength,
    );
  }

  const concreteHeadingCount = document.cst.children.filter(
    ({ kind }) => kind === "atx-heading" || kind === "setext-heading",
  ).length;
  assert.equal(ownedHeadings.size, concreteHeadingCount);
};

const assertLosslessSections = (source: string): void => {
  const parsed = parse(source, { path: "generated.md" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(render(parsed.value), source);
  assert.equal(parsed.value.source.byteLength, Buffer.byteLength(source));
  assertSectionOwnership(parsed.value);
};

const readableFixtures = [
  "\uFEFF# Café 😀\r\nbody\n### 跳過\r## Repeated\r\n## Again",
  "preamble\rTitle\r=====\r> unsupported\r\r### Child",
  "```md\n# opaque heading\n```\n# Visible without final newline",
  "### Skipped\nbody\n### Repeated\nbody\n# Root\n",
];

const generatedFixtures = function* (): Generator<string> {
  let state = 0x6d715eed;
  const next = (limit: number): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % limit;
  };
  const lines = [
    "",
    "plain text",
    "Café 😀 東京",
    "# One",
    "## Two ##",
    "### Skipped",
    "###### Deep",
    "Heading",
    "=======",
    "Subheading",
    "---",
    "> opaque quote",
    "```md",
    "# fenced heading",
    "```",
    "<custom broken=>",
    "\0 valid UTF-8 control",
  ];
  const newlines = ["\n", "\r\n", "\r"];

  for (let fixture = 0; fixture < 256; fixture += 1) {
    const count = next(24);
    let source = next(5) === 0 ? "\uFEFF" : "";
    for (let line = 0; line < count; line += 1) {
      source += lines[next(lines.length)];
      if (line + 1 < count || next(2) === 0) {
        source += newlines[next(newlines.length)];
      }
    }
    yield source;
  }
};

describe("lossless section properties", () => {
  it("preserves readable edge-case fixtures and their ownership indexes", () => {
    for (const source of readableFixtures) assertLosslessSections(source);
  });

  it("preserves generated recoverable UTF-8 and section ownership", () => {
    for (const source of generatedFixtures()) assertLosslessSections(source);
  });
});
