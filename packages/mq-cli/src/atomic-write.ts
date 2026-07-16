import { randomUUID } from "node:crypto";
import { open, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
  readonly preserveMode?: boolean;
}

/** Writes a sibling temporary file and atomically renames it into place. */
export const atomicWrite = async (
  path: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<void> => {
  const mode = options.preserveMode
    ? (await stat(path)).mode & 0o7777
    : undefined;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.mq-${process.pid}-${randomUUID()}`,
  );
  let handle: FileHandle | undefined = await open(temporary, "wx", mode ?? 0o666);
  try {
    await handle.writeFile(text, "utf8");
    if (mode !== undefined) await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Preserve the primary write error.
      }
    }
    try {
      await unlink(temporary);
    } catch {
      // A missing or unremovable temporary file must not hide the primary error.
    }
    throw error;
  }
};
