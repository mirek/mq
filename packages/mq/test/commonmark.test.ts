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
  '> Quote 😀 *emphasis* and [site](https://example.com "Example").',
  ">",
  "> - first `code`",
  "> - second ![logo](logo.png)",
  "",
  "3. ordered",
  "4. next",
  "",
  "---",
  "",
  "```js meta",
  "const x = 1;",
  "```",
  "",
  "    indented",
  "",
  "<div>html</div>",
  "",
  "Paragraph with **strong** and Caf&eacute;  ",
  "hard break.",
].join("\n");

describe("CommonMark semantic views", () => {
  it("recognizes required flow nodes without changing concrete source", () => {
    const result = parse(source);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const document = result.value;
    assert.equal(render(document), source);
    assert.deepEqual(document.diagnostics, []);
    const reconstructed = document.cst.children
      .map(({ range }) =>
        Buffer.from(source).subarray(
          range.start.byteOffset,
          range.end.byteOffset,
        ),
      )
      .reduce((left, right) => Buffer.concat([left, right]), Buffer.alloc(0));
    assert.equal(reconstructed.toString(), source);
    const blocks = document.preamble.filter(({ type }) => type !== "blank-line");
    assert.deepEqual(blocks.map(({ type }) => type), [
      "blockquote",
      "list",
      "thematic-break",
      "code",
      "code",
      "html",
      "paragraph",
    ]);
    assert.deepEqual(
      document.cst.children.map(({ kind }) => kind),
      [
        "blockquote",
        "blank-line",
        "list",
        "blank-line",
        "thematic-break",
        "blank-line",
        "fenced-code",
        "blank-line",
        "indented-code",
        "blank-line",
        "html",
        "blank-line",
        "paragraph",
      ],
    );

    const [quote, ordered, thematic, fenced, indented, html, paragraph] = blocks;
    assert.equal(quote?.type, "blockquote");
    if (quote?.type === "blockquote") {
      assert.deepEqual(quote.children.map(({ type }) => type), [
        "paragraph",
        "list",
      ]);
      const list = quote.children[1];
      assert.equal(list?.type, "list");
      if (list?.type === "list") {
        assert.equal(list.ordered, false);
        assert.equal(list.start, undefined);
        assert.equal(list.tight, true);
        assert.equal(list.children.length, 2);
        assert.equal(list.children[0]?.type, "item");
      }
    }
    assert.deepEqual(
      ordered?.type === "list"
        ? { ordered: ordered.ordered, start: ordered.start, tight: ordered.tight }
        : undefined,
      { ordered: true, start: 3, tight: true },
    );
    assert.equal(thematic?.type, "thematic-break");
    assert.deepEqual(
      fenced?.type === "code"
        ? {
            fenced: fenced.fenced,
            language: fenced.language,
            meta: fenced.meta,
            value: fenced.value,
          }
        : undefined,
      { fenced: true, language: "js", meta: "meta", value: "const x = 1;" },
    );
    assert.deepEqual(
      indented?.type === "code"
        ? { fenced: indented.fenced, value: indented.value }
        : undefined,
      { fenced: false, value: "indented" },
    );
    assert.deepEqual(
      html?.type === "html" ? html.value : undefined,
      "<div>html</div>",
    );
    assert.deepEqual(
      paragraph?.type === "paragraph" ? paragraph.text : undefined,
      "Paragraph with strong and Café\nhard break.",
    );
    assert.equal(Object.isFrozen(document.preamble), true);
    assert.equal(Object.isFrozen(quote), true);
  });

  it("materializes immutable inline nodes lazily with authoritative ranges", () => {
    const result = parse(source);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const quote = result.value.preamble.find(({ type }) => type === "blockquote");
    assert.equal(quote?.type, "blockquote");
    if (quote?.type !== "blockquote") return;
    const paragraph = quote.children[0];
    assert.equal(paragraph?.type, "paragraph");
    if (paragraph?.type !== "paragraph") return;

    const first = inlines(paragraph);
    const second = inlines(paragraph);
    assert.strictEqual(first, second);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(first.map(({ type }) => type), [
      "text",
      "emphasis",
      "text",
      "link",
      "text",
    ]);
    const emphasis = first[1];
    assert.equal(emphasis?.type, "emphasis");
    if (emphasis?.type === "emphasis") {
      assert.deepEqual(emphasis.children.map(({ type }) => type), ["text"]);
      assert.equal(emphasis.children[0]?.type === "text" && emphasis.children[0].value, "emphasis");
    }
    const link = first[3];
    assert.equal(link?.type, "link");
    if (link?.type === "link") {
      assert.equal(link.destination, "https://example.com");
      assert.equal(link.title, "Example");
      assert.equal(nodeMarkdown(result.value, link), '[site](https://example.com "Example")');
    }

    const bodyParagraph = result.value.preamble.find(
      (node) => node.type === "paragraph",
    );
    assert.equal(bodyParagraph?.type, "paragraph");
    if (bodyParagraph?.type === "paragraph") {
      assert.deepEqual(inlines(bodyParagraph).map(({ type }) => type), [
        "text",
        "strong",
        "text",
        "break",
        "text",
      ]);
    }
  });

  it("keeps nested headings in containers out of the section hierarchy", () => {
    const markdown = "> # Quoted\n> body\n# Top\nbody\n";
    const result = parse(markdown);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(result.value.sections.map(({ title }) => title), ["Top"]);
    const quote = result.value.preamble[0];
    assert.equal(quote?.type, "blockquote");
    if (quote?.type === "blockquote") {
      assert.deepEqual(quote.children.map(({ type }) => type), [
        "heading",
        "paragraph",
      ]);
    }
    assert.equal(render(result.value), markdown);
  });

  it("lets selectors and expressions traverse semantic block and inline children", () => {
    const parsed = parse(source);
    const selector = compileSelector("blockquote link");
    const expression = compileExpression('select("code") | text | array');
    const linkText = compileExpression('select("blockquote link") | text');
    assert.equal(parsed.ok, true);
    assert.equal(selector.ok, true);
    assert.equal(expression.ok, true);
    assert.equal(linkText.ok, true);
    if (!parsed.ok || !selector.ok || !expression.ok || !linkText.ok) return;

    const links = select(parsed.value, selector.value);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.type, "link");
    assert.deepEqual(evaluate(parsed.value, expression.value), [
      ["const x = 1;", "indented"],
    ]);
    assert.deepEqual(evaluate(parsed.value, linkText.value), ["site"]);

    const imageSelector = compileSelector('image[destination="logo.png"]');
    assert.equal(imageSelector.ok, true);
    if (!imageSelector.ok) return;
    const images = select(parsed.value, imageSelector.value);
    assert.equal(images.length, 1);
    assert.equal(images[0]?.type === "image" && images[0].alt, "logo");

    const listSelector = compileSelector(
      "list[ordered=true][start=3][tight=true]",
    );
    const codeSelector = compileSelector("code[language=js][fenced=true]");
    assert.equal(listSelector.ok, true);
    assert.equal(codeSelector.ok, true);
    if (!listSelector.ok || !codeSelector.ok) return;
    assert.equal(select(parsed.value, listSelector.value).length, 1);
    assert.equal(select(parsed.value, codeSelector.value).length, 1);

    const json = compileExpression('select("code[language=js]") | json');
    assert.equal(json.ok, true);
    if (!json.ok) return;
    assert.deepEqual(evaluate(parsed.value, json.value), [
      {
        fenced: true,
        language: "js",
        meta: "meta",
        type: "code",
        value: "const x = 1;",
      },
    ]);
  });
});
