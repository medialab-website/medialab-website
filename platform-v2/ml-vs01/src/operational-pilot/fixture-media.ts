import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

export const FIXTURE_NAMESPACE = "M16A_OPERATIONAL_PILOT";
export const FIXTURE_SCENARIO_ID = "M16A_GOLDEN_PATH_QUICK_EDIT_V1";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

export function deterministicPng(seed: number, width = 48, height = 32): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3); row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 3;
      row[offset] = (seed * 31 + x * 5 + y * 3) & 255;
      row[offset + 1] = (seed * 17 + x * 2 + y * 7) & 255;
      row[offset + 2] = (seed * 11 + x * 9 + y) & 255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface FixtureDescriptor {
  objectIdentifier: string;
  observedFilename: string;
  byteSize: number;
  checksumSha256: string;
  mediaType: "image/png";
  kind: "ORIGINAL" | "EDITOR_RETURN" | "QUICK_EDIT_CORRECTION";
}

export async function createSyntheticMedia(root: string): Promise<FixtureDescriptor[]> {
  await mkdir(root, { recursive: true });
  const definitions = [
    ...Array.from({ length: 6 }, (_, index) => ({ name: `original-${index + 1}.png`, seed: index + 1, kind: "ORIGINAL" as const })),
    ...Array.from({ length: 5 }, (_, index) => ({ name: `returned-${index + 1}.png`, seed: index + 21, kind: "EDITOR_RETURN" as const })),
    { name: "corrected-5.png", seed: 99, kind: "QUICK_EDIT_CORRECTION" as const },
  ];
  const manifest: FixtureDescriptor[] = [];
  for (const item of definitions) {
    const bytes = deterministicPng(item.seed);
    await writeFile(join(root, item.name), bytes, { flag: "w", mode: 0o600 });
    manifest.push({ objectIdentifier: item.name, observedFilename: item.name, byteSize: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png", kind: item.kind });
  }
  return manifest;
}
