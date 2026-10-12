import { isValidWebM } from "@/lib/webm-utils";

const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

describe("WebM magic bytes validation", () => {
  test("accepts valid WebM header", () => {
    expect(isValidWebM(Buffer.concat([WEBM_MAGIC, Buffer.alloc(100)]))).toBe(true);
  });

  test("accepts exactly 4 bytes", () => {
    expect(isValidWebM(WEBM_MAGIC)).toBe(true);
  });

  test("rejects empty buffer", () => {
    expect(isValidWebM(Buffer.alloc(0))).toBe(false);
  });

  test("rejects buffer with only 3 bytes", () => {
    expect(isValidWebM(Buffer.from([0x1a, 0x45, 0xdf]))).toBe(false);
  });

  test("rejects MP4 ftyp box", () => {
    const buf = Buffer.alloc(8);
    buf.write("ftyp", 4, "ascii");
    expect(isValidWebM(buf)).toBe(false);
  });

  test("rejects RIFF/AVI header", () => {
    expect(isValidWebM(Buffer.from([0x52, 0x49, 0x46, 0x46]))).toBe(false);
  });

  test("rejects first-byte mismatch", () => {
    expect(isValidWebM(Buffer.from([0x1b, 0x45, 0xdf, 0xa3]))).toBe(false);
  });

  test("rejects last-byte mismatch", () => {
    expect(isValidWebM(Buffer.from([0x1a, 0x45, 0xdf, 0xa4]))).toBe(false);
  });
});
