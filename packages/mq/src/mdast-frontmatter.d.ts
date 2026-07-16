import type { Literal } from "mdast";

declare module "mdast" {
  interface Toml extends Literal {
    readonly type: "toml";
  }

  interface JsonFrontmatter extends Literal {
    readonly type: "json";
  }

  interface FrontmatterContentMap {
    readonly toml: Toml;
    readonly json: JsonFrontmatter;
  }

  interface RootContentMap {
    readonly toml: Toml;
    readonly json: JsonFrontmatter;
  }
}
