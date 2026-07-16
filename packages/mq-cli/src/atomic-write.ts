import { randomUUID } from "node:crypto";
import { open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteHandle {
  writeFile(text: string, encoding: "utf8"): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AtomicWriteFileSystem {
  stat(path: string): Promise<{ readonly mode: number }>;
  open(path: string, flags: "wx", mode: number): Promise<AtomicWriteHandle>;
  rename(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface AtomicWriteOptions {
  readonly preserveMode?: boolean;
  /** Filesystem seam for deterministic failure verification. */
  readonly fileSystem?: AtomicWriteFileSystem;
}

const nodeFileSystem: AtomicWriteFileSystem = {
  stat: async (path) => stat(path),
  open: async (path, flags, mode) => open(path, flags, mode),
  rename,
  unlink,
};

/** Writes a sibling temporary file and atomically renames it into place. */
export const atomicWrite = async (
  path: string,
  text: string,
  options: AtomicWriteOptions = {},
): Promise<void> => {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const mode = options.preserveMode
    ? (await fileSystem.stat(path)).mode & 0o7777
    : undefined;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.mq-${process.pid}-${randomUUID()}`,
  );
  let handle: AtomicWriteHandle | undefined = await fileSystem.open(
    temporary,
    "wx",
    mode ?? 0o666,
  );
  try {
    await handle.writeFile(text, "utf8");
    if (mode !== undefined) await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fileSystem.rename(temporary, path);
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Preserve the primary write error.
      }
    }
    try {
      await fileSystem.unlink(temporary);
    } catch {
      // A missing or unremovable temporary file must not hide the primary error.
    }
    throw error;
  }
};
