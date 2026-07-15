import type { Document } from "./model.ts";

/** Returns the document's retained Markdown source without normalization. */
export const render = (document: Document): string => document.source.text;
