/** Returns true if the buffer starts with the WebM EBML magic bytes. */
export function isValidWebM(body: Buffer): boolean {
  return (
    body.length >= 4 &&
    body[0] === 0x1a &&
    body[1] === 0x45 &&
    body[2] === 0xdf &&
    body[3] === 0xa3
  );
}
