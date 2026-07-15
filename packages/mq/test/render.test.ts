import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parse, render } from "../src/index.ts";

describe("render", () => {
  it("returns every recoverable parsed source byte-for-byte", () => {
    const sources = [
      "",
      "\uFEFF   ### Café ###  \r\n\r\nBody\n",
      "Setext  \r\n=======\r\n",
      "# ATX without final newline",
      "one\r\ntwo\nthree\rfour",
      "```md\n# preserved as opaque\n```\n",
      "  # indented heading spelling  ###  \n",
    ];

    for (const source of sources) {
      const parsed = parse(source);

      assert.equal(parsed.ok, true);
      if (!parsed.ok) continue;

      assert.equal(render(parsed.value), source);
    }
  });
});
