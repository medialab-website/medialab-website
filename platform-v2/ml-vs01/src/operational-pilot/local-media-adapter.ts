import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { createLocalFileAdapter } from "../disposable-delivery/local-file-adapter.js";

export { createLocalFileAdapter };
export const MAX_CORRECTION_BYTES = 1_048_576;

function assertObjectIdentifier(identifier: string): void {
  if (!identifier || isAbsolute(identifier) || identifier.includes("..") || identifier.includes("\\") || basename(identifier) !== identifier) {
    throw new Error("unsafe local object identifier");
  }
}

export async function stageRawCorrection(input: Readable, stagingRoot: string, objectIdentifier: string,
  expectedMediaType: string, maximum = MAX_CORRECTION_BYTES): Promise<{ objectIdentifier: string; byteSize: number; checksumSha256: string; mediaType: string }> {
  assertObjectIdentifier(objectIdentifier);
  if (expectedMediaType !== "image/png") throw new Error("unsupported corrected media type");
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const root = await realpath(stagingRoot);
  const finalPath = resolve(root, objectIdentifier);
  if (relative(root, finalPath).startsWith(`..${sep}`)) throw new Error("staging path escaped controlled root");
  const partPath = `${finalPath}.part`;
  const handle = await open(partPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    for await (const piece of input) {
      const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      byteSize += bytes.length;
      if (byteSize > maximum) throw new Error("corrected media exceeds bounded limit");
      hash.update(bytes);
      await handle.write(bytes);
    }
    if (byteSize < 32) throw new Error("corrected media is empty or invalid");
    await handle.sync(); await handle.close();
    await rename(partPath, finalPath);
    const status = await lstat(finalPath);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error("staged media is not a regular file");
    return { objectIdentifier, byteSize, checksumSha256: hash.digest("hex"), mediaType: expectedMediaType };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(partPath).catch(() => undefined);
    throw error;
  }
}
