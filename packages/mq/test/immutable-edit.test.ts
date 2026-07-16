import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyEdits,
  appendEdit,
  compileSelector,
  parse,
  parseMarkdownFragment,
  render,
  replaceEdit,
  setTitleEdit,
  toJsonValue,
} from "../src/index.ts";

const source = "# Guide\nintro\n## Setup\nold\n";

describe("immutable edited document snapshots", () => {
  it("applies, reparses, and maps a new snapshot without mutating the input", () => {
    const parsed = parse(source, { path: "guide.md" });
    const setup = compileSelector("section[title=Setup]");
    const body = compileSelector("section[title=Setup] > paragraph");
    const replacement = parseMarkdownFragment("new");
    const appendix = parseMarkdownFragment("tail");
    assert.equal(parsed.ok, true);
    assert.equal(setup.ok, true);
    assert.equal(body.ok, true);
    assert.equal(replacement.ok, true);
    assert.equal(appendix.ok, true);
    if (
      !parsed.ok ||
      !setup.ok ||
      !body.ok ||
      !replacement.ok ||
      !appendix.ok
    ) {
      return;
    }

    const edited = applyEdits(parsed.value, [
      setTitleEdit(setup.value, "Installation"),
      replaceEdit(body.value, replacement.value),
      appendEdit(setup.value, appendix.value),
    ]);
    assert.equal(edited.ok, true);
    if (!edited.ok) return;

    assert.equal(render(parsed.value), source);
    assert.equal(
      render(edited.value),
      "# Guide\nintro\n## Installation\nnew\ntail",
    );
    assert.notStrictEqual(edited.value, parsed.value);
    assert.equal(edited.value.path, "guide.md");
    assert.equal(Object.isFrozen(edited.value), true);
    assert.ok(edited.value.sourceMap);
    assert.equal(Object.isFrozen(edited.value.sourceMap?.segments), true);

    const reparsed = parse(render(edited.value), { path: "guide.md" });
    assert.equal(reparsed.ok, true);
    if (reparsed.ok) {
      assert.deepEqual(
        toJsonValue(edited.value, edited.value),
        toJsonValue(reparsed.value, reparsed.value),
      );
    }
  });

  it("returns the original identity for an empty patch plan", () => {
    const parsed = parse(source);
    const missing = compileSelector("section[title=Missing]");
    assert.equal(parsed.ok, true);
    assert.equal(missing.ok, true);
    if (!parsed.ok || !missing.ok) return;

    const edited = applyEdits(parsed.value, [
      setTitleEdit(missing.value, "Never"),
    ]);
    assert.equal(edited.ok, true);
    if (edited.ok) assert.strictEqual(edited.value, parsed.value);
  });

  it("returns planning failures without producing a snapshot", () => {
    const parsed = parse(source);
    const section = compileSelector("section[title=Setup]");
    const paragraph = compileSelector("section[title=Setup] > paragraph");
    const one = parseMarkdownFragment("one");
    const two = parseMarkdownFragment("two");
    assert.equal(parsed.ok, true);
    assert.equal(section.ok, true);
    assert.equal(paragraph.ok, true);
    assert.equal(one.ok, true);
    assert.equal(two.ok, true);
    if (
      !parsed.ok ||
      !section.ok ||
      !paragraph.ok ||
      !one.ok ||
      !two.ok
    ) {
      return;
    }

    const edited = applyEdits(parsed.value, [
      replaceEdit(section.value, one.value),
      replaceEdit(paragraph.value, two.value),
    ]);
    assert.equal(edited.ok, false);
    if (!edited.ok) {
      assert.equal(edited.diagnostics[0].code, "edit.patch-overlap");
    }
    assert.equal(render(parsed.value), source);
  });
});
