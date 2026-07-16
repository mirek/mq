import assert from "node:assert/strict";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  atomicWrite,
  type AtomicWriteFileSystem,
  type AtomicWriteHandle,
} from "../src/atomic-write.ts";

type FailureStage =
  | "open"
  | "write"
  | "permission"
  | "flush"
  | "close"
  | "rename";

const realFileSystem: AtomicWriteFileSystem = {
  open: async (path, flags, mode) => open(path, flags, mode),
  rename,
  stat,
  unlink,
};

const failingFileSystem = (
  stage: FailureStage,
  failure: Error,
): AtomicWriteFileSystem => {
  let closeFailed = false;
  return {
    ...realFileSystem,
    open: async (path, flags, mode): Promise<AtomicWriteHandle> => {
      if (stage === "open") throw failure;
      const handle = await realFileSystem.open(path, flags, mode);
      return {
        writeFile: async (text, encoding) => {
          if (stage === "write") throw failure;
          await handle.writeFile(text, encoding);
        },
        chmod: async (permissions) => {
          if (stage === "permission") throw failure;
          await handle.chmod(permissions);
        },
        sync: async () => {
          if (stage === "flush") throw failure;
          await handle.sync();
        },
        close: async () => {
          if (stage === "close" && !closeFailed) {
            closeFailed = true;
            throw failure;
          }
          await handle.close();
        },
      };
    },
    rename: async (source, destination) => {
      if (stage === "rename") throw failure;
      await realFileSystem.rename(source, destination);
    },
  };
};

describe("atomic write failure safety", () => {
  for (const stage of [
    "open",
    "write",
    "permission",
    "flush",
    "close",
    "rename",
  ] as const) {
    it(`preserves the original and removes temporary files after ${stage} failure`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "mq-atomic-write-"));
      const path = join(directory, "document.md");
      const original = Buffer.from("# Original\r\n\0\xff", "latin1");
      const failure = new Error(`${stage} failed`);
      try {
        await writeFile(path, original);

        await assert.rejects(
          atomicWrite(path, "# Replacement\n", {
            preserveMode: true,
            fileSystem: failingFileSystem(stage, failure),
          }),
          (error) => error === failure,
        );

        assert.deepEqual(await readFile(path), original);
        assert.deepEqual(await readdir(directory), ["document.md"]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  it("does not hide a primary failure when temporary cleanup also fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mq-atomic-write-"));
    const path = join(directory, "document.md");
    const original = Buffer.from("original bytes");
    const primary = new Error("write failed");
    const cleanup = new Error("cleanup failed");
    try {
      await writeFile(path, original);
      const fileSystem = failingFileSystem("write", primary);

      await assert.rejects(
        atomicWrite(path, "replacement", {
          fileSystem: {
            ...fileSystem,
            unlink: async () => {
              throw cleanup;
            },
          },
        }),
        (error) => error === primary,
      );

      assert.deepEqual(await readFile(path), original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
