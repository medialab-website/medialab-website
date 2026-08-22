import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  OWNER_PREVIEW_MANIFEST_PATH,
  OWNER_PREVIEW_MEDIA_ROOT,
  OWNER_PREVIEW_ROOT,
  OWNER_PREVIEW_URL,
  syntheticPixelPng,
  syntheticRoomPng,
} from "../scripts/run-contextual-editor-review-owner-preview.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunks(bytes: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    result.set(type, bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  expect(offset).toBe(bytes.length);
  return result;
}

describe("P02-M22-A synthetic contextual review owner-preview harness", () => {
  it("pins the preview to one explicit loopback boundary and one narrow /tmp media root", () => {
    expect(OWNER_PREVIEW_ROOT).toBe("/tmp/mlvs01-p02m22a-owner-preview");
    expect(OWNER_PREVIEW_MEDIA_ROOT).toBe(`${OWNER_PREVIEW_ROOT}/ReviewMediaStore`);
    expect(OWNER_PREVIEW_MANIFEST_PATH).toBe(`${OWNER_PREVIEW_ROOT}/OWNER_PREVIEW.json`);
    expect(OWNER_PREVIEW_URL).toBe("http://127.0.0.1:4317/operations");
  });

  it("generates complete distinct 1x1 RGBA PNGs rather than placeholder image bytes", () => {
    const blue = syntheticPixelPng(28, 92, 154);
    const orange = syntheticPixelPng(226, 96, 48);
    expect(blue.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(orange).not.toEqual(blue);
    const blueChunks = chunks(blue);
    expect([...blueChunks.keys()]).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(blueChunks.get("IHDR")?.readUInt32BE(0)).toBe(1);
    expect(blueChunks.get("IHDR")?.readUInt32BE(4)).toBe(1);
    expect(blueChunks.get("IHDR")?.subarray(8, 10)).toEqual(Buffer.from([8, 6]));
    expect(inflateSync(blueChunks.get("IDAT")!)).toEqual(Buffer.from([0, 28, 92, 154, 255]));
    expect(blueChunks.get("IEND")).toEqual(Buffer.alloc(0));
  });

  it("rejects invalid synthetic pixel channels before producing media", () => {
    expect(() => syntheticPixelPng(-1, 0, 0)).toThrow(/integers from 0 through 255/);
    expect(() => syntheticPixelPng(0, 256, 0)).toThrow(/integers from 0 through 255/);
    expect(() => syntheticPixelPng(0, 0.5, 0)).toThrow(/integers from 0 through 255/);
  });

  it("generates distinct 960 by 640 synthetic room scenes without source-media bytes", () => {
    const first = syntheticRoomPng(19);
    const second = syntheticRoomPng(38);
    expect(first.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.readUInt32BE(16)).toBe(960);
    expect(first.readUInt32BE(20)).toBe(640);
    expect(first.equals(second)).toBe(false);
    expect(first.length).toBeGreaterThan(10_000);
    expect(() => syntheticRoomPng(-1)).toThrow(/integer from 0 through 255/);
    expect(() => syntheticRoomPng(256)).toThrow(/integer from 0 through 255/);
  });
});
