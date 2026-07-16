import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileExpression,
  compileSelector,
  evaluate,
  inlines,
  nodeMarkdown,
  parse,
  render,
  select,
} from "../src/index.ts";

const source = [
  "| Name | Status |",
  "| :--- | ---: |",
  "| Build | ~~blocked~~ |",
  "| Test | ready |",
  "",
  "- [x] done",
  "- [ ] pending",
  "",
  "Visit https://example.com and user@example.com.",
].join("\n");

describe("GFM semantic views", () => {
  it("recognizes tables, task items, strikethrough, and literal autolinks losslessly", () => {
    const result = parse(source);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(render(result.value), source);
    assert.deepEqual(result.value.diagnostics, []);
    const reconstructed = result.value.cst.children
      .map(({ range }) =>
        Buffer.from(source).subarray(
          range.start.byteOffset,
          range.end.byteOffset,
        ),
      )
      .reduce((left, right) => Buffer.concat([left, right]), Buffer.alloc(0));
    assert.equal(reconstructed.toString(), source);
    assert.deepEqual(result.value.preamble.map(({ type }) => type), [
      "table",
      "blank-line",
      "list",
      "blank-line",
      "paragraph",
    ]);
    assert.deepEqual(result.value.cst.children.map(({ kind }) => kind), [
      "table",
      "blank-line",
      "list",
      "blank-line",
      "paragraph",
    ]);

    const table = result.value.preamble[0];
    assert.equal(table?.type, "table");
    if (table?.type !== "table") return;
    assert.deepEqual(table.alignments, ["left", "right"]);
    assert.equal(table.children.length, 3);
    assert.equal(table.children[0]?.header, true);
    assert.equal(table.children[1]?.header, false);
    assert.deepEqual(
      table.children[0]?.children.map(({ alignment, header, text }) => ({
        alignment,
        header,
        text,
      })),
      [
        { alignment: "left", header: true, text: "Name" },
        { alignment: "right", header: true, text: "Status" },
      ],
    );

    const status = table.children[1]?.children[1];
    assert.equal(status?.type, "cell");
    if (status?.type === "cell") {
      const view = inlines(status);
      assert.deepEqual(view.map(({ type }) => type), ["strikethrough"]);
      const strike = view[0];
      assert.equal(strike?.type, "strikethrough");
      if (strike?.type === "strikethrough") {
        assert.equal(strike.children[0]?.type, "text");
        assert.equal(nodeMarkdown(result.value, strike), "~~blocked~~");
      }
    }

    const list = result.value.preamble[2];
    assert.equal(list?.type, "list");
    if (list?.type === "list") {
      assert.deepEqual(list.children.map(({ checked }) => checked), [true, false]);
    }

    const paragraph = result.value.preamble[4];
    assert.equal(paragraph?.type, "paragraph");
    if (paragraph?.type === "paragraph") {
      const links = inlines(paragraph).filter(({ type }) => type === "link");
      assert.deepEqual(
        links.map((link) => link.type === "link" && link.destination),
        ["https://example.com", "mailto:user@example.com"],
      );
    }
  });

  it("exposes GFM nodes and attributes to selectors and expressions", () => {
    const parsed = parse(source);
    const headers = compileSelector("table > row > cell[header=true]");
    const pending = compileSelector("item[checked=false]");
    const struck = compileSelector("cell strikethrough");
    const cells = compileExpression('select("cell") | text | array');
    const firstCell = compileExpression(
      'select("cell[header=true]") | first | json',
    );
    assert.equal(parsed.ok, true);
    assert.equal(headers.ok, true);
    assert.equal(pending.ok, true);
    assert.equal(struck.ok, true);
    assert.equal(cells.ok, true);
    assert.equal(firstCell.ok, true);
    if (
      !parsed.ok ||
      !headers.ok ||
      !pending.ok ||
      !struck.ok ||
      !cells.ok ||
      !firstCell.ok
    ) {
      return;
    }

    assert.deepEqual(
      select(parsed.value, headers.value).map(
        (node) => node.type === "cell" && node.text,
      ),
      ["Name", "Status"],
    );
    assert.equal(select(parsed.value, pending.value).length, 1);
    assert.equal(select(parsed.value, struck.value).length, 1);
    assert.deepEqual(evaluate(parsed.value, cells.value), [
      ["Name", "Status", "Build", "blocked", "Test", "ready"],
    ]);
    assert.deepEqual(evaluate(parsed.value, firstCell.value), [
      { alignment: "left", header: true, text: "Name", type: "cell" },
    ]);
  });
});
