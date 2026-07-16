import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parse,
  parseMarkdownFragment,
  planFragmentInsertion,
  sourcePosition,
} from "../src/index.ts";

describe("Markdown edit fragments", () => {
  it("parses fragments through the public lossless document model", () => {
    const source = "## Added\nbody\n";
    const fragment = parseMarkdownFragment(source);
    assert.equal(fragment.ok, true);
    if (!fragment.ok) return;
    assert.equal(fragment.value.source, source);
    assert.equal(fragment.value.document.sections[0]?.title, "Added");
    assert.equal(Object.isFrozen(fragment.value), true);
  });

  it("adds minimum LF boundaries at the first, middle, and last positions", () => {
    const parsed = parse("# A\n# C\nlast");
    const fragment = parseMarkdownFragment("# B");
    assert.equal(parsed.ok, true);
    assert.equal(fragment.ok, true);
    if (!parsed.ok || !fragment.ok) return;

    const first = planFragmentInsertion(
      parsed.value,
      fragment.value,
      sourcePosition(0, 1, 1),
    );
    const middle = planFragmentInsertion(
      parsed.value,
      fragment.value,
      sourcePosition(4, 2, 1),
    );
    const last = planFragmentInsertion(
      parsed.value,
      fragment.value,
      sourcePosition(12, 3, 5),
    );
    assert.equal(first.ok, true);
    assert.equal(middle.ok, true);
    assert.equal(last.ok, true);
    if (!first.ok || !middle.ok || !last.ok) return;
    assert.equal(first.value.replacement, "# B\n");
    assert.equal(middle.value.replacement, "# B\n");
    assert.equal(last.value.replacement, "\n# B");
  });

  it("uses the dominant CRLF style without normalizing fragment newlines", () => {
    const parsed = parse("# A\r\n# C\r\n");
    const fragment = parseMarkdownFragment("first\nsecond");
    assert.equal(parsed.ok, true);
    assert.equal(fragment.ok, true);
    if (!parsed.ok || !fragment.ok) return;

    const planned = planFragmentInsertion(
      parsed.value,
      fragment.value,
      sourcePosition(5, 2, 1),
    );
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.equal(planned.value.replacement, "first\nsecond\r\n");
  });

  it("uses the first newline style to break mixed-newline ties", () => {
    const parsed = parse("# A\r\n# C\n");
    const fragment = parseMarkdownFragment("# B");
    assert.equal(parsed.ok, true);
    assert.equal(fragment.ok, true);
    if (!parsed.ok || !fragment.ok) return;

    const planned = planFragmentInsertion(
      parsed.value,
      fragment.value,
      sourcePosition(5, 2, 1),
    );
    assert.equal(planned.ok, true);
    if (planned.ok) assert.equal(planned.value.replacement, "# B\r\n");
  });

  it("keeps supplied boundaries and treats an empty fragment as a no-op", () => {
    const parsed = parse("# A\n# C\n");
    const bounded = parseMarkdownFragment("\n# B\n");
    const empty = parseMarkdownFragment("");
    assert.equal(parsed.ok, true);
    assert.equal(bounded.ok, true);
    assert.equal(empty.ok, true);
    if (!parsed.ok || !bounded.ok || !empty.ok) return;

    const at = sourcePosition(4, 2, 1);
    const supplied = planFragmentInsertion(parsed.value, bounded.value, at);
    const noOp = planFragmentInsertion(parsed.value, empty.value, at);
    assert.equal(supplied.ok, true);
    assert.equal(noOp.ok, true);
    if (!supplied.ok || !noOp.ok) return;
    assert.equal(supplied.value.replacement, "\n# B\n");
    assert.equal(noOp.value.replacement, "");
  });

  it("rejects mid-line and split-CRLF insertion positions", () => {
    const parsed = parse("# A\r\n");
    const fragment = parseMarkdownFragment("# B");
    assert.equal(parsed.ok, true);
    assert.equal(fragment.ok, true);
    if (!parsed.ok || !fragment.ok) return;

    for (const at of [sourcePosition(2, 1, 3), sourcePosition(4, 1, 4)]) {
      const planned = planFragmentInsertion(parsed.value, fragment.value, at);
      assert.equal(planned.ok, false);
      if (!planned.ok) {
        assert.equal(planned.diagnostics[0].code, "edit.fragment-boundary");
      }
    }
  });
});
