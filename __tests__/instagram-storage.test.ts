import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client } from "@/lib/r2";
import { completeInstagramUpload, getInstagramStorageDownloadUrl, MAX_INSTAGRAM_UPLOAD_BYTES, prepareInstagramUpload, readInstagramUploadTicket } from "@/lib/instagram-storage";

jest.mock("@/lib/r2", () => ({ getR2Client: jest.fn(), R2_BUCKET: "fixture-bucket" }));
jest.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: jest.fn() }));
const originalSecret = process.env.INSTAGRAM_STATE_SECRET;
const send = jest.fn();
beforeEach(() => {
  jest.resetAllMocks();
  process.env.INSTAGRAM_STATE_SECRET = "fixture-signing-secret";
  jest.mocked(getR2Client).mockReturnValue({ send } as unknown as NonNullable<ReturnType<typeof getR2Client>>);
  jest.mocked(getSignedUrl).mockResolvedValue("https://storage.test/signed");
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.INSTAGRAM_STATE_SECRET;
  else process.env.INSTAGRAM_STATE_SECRET = originalSecret;
  jest.useRealTimers();
});

test("prepares an account-bound, size-bound presigned PUT without uploading bytes through the app", async () => {
  const result = await prepareInstagramUpload("alice", 1024, "video/mp4");
  const ticket = readInstagramUploadTicket(result.uploadToken, "alice");
  expect(ticket).toMatchObject({ userId: "alice", size: 1024, contentType: "video/mp4" });
  expect(ticket.key).toMatch(/^social\/instagram\/alice\/[a-f0-9]{32}\.mp4$/);
  expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.any(PutObjectCommand), expect.objectContaining({ expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) }));
  expect((jest.mocked(getSignedUrl).mock.calls[0][1] as PutObjectCommand).input.ContentLength).toBe(1024);
  expect(send).not.toHaveBeenCalled();
});
test.each([0, 11, -1, 12.5, MAX_INSTAGRAM_UPLOAD_BYTES + 1, NaN])("rejects invalid declared upload size %s", async size => {
  await expect(prepareInstagramUpload("alice", size, "video/mp4")).rejects.toThrow("Video must");
  expect(getSignedUrl).not.toHaveBeenCalled();
});
test("rejects unsupported upload content types", async () => {
  await expect(prepareInstagramUpload("alice", 1024, "text/html")).rejects.toThrow("MP4 or WebM");
});
test("rejects another account, tampered tickets and expired tickets before storage access", async () => {
  const { uploadToken } = await prepareInstagramUpload("alice", 1024, "video/mp4");
  await expect(completeInstagramUpload("bob", uploadToken)).rejects.toThrow("this account");
  await expect(completeInstagramUpload("alice", uploadToken + "x")).rejects.toThrow("Invalid upload ticket");
  jest.useFakeTimers().setSystemTime(Date.now() + 601000);
  await expect(completeInstagramUpload("alice", uploadToken)).rejects.toThrow("expired");
  expect(send).not.toHaveBeenCalled();
});
test("finalization checks metadata and reads only a bounded file header", async () => {
  const { uploadToken } = await prepareInstagramUpload("alice", 1024, "video/mp4");
  send.mockResolvedValueOnce({ ContentLength: 1024, ContentType: "video/mp4" })
    .mockResolvedValueOnce({ Body: { transformToByteArray: async () => Buffer.from('0000ftypisom') } });
  expect(await completeInstagramUpload("alice", uploadToken)).toHaveProperty("key");
  expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
  expect(send.mock.calls[1][0].input.Range).toBe("bytes=0-63");
});
test.each([{ ContentLength: 1025, ContentType: "video/mp4" }, { ContentLength: 1024, ContentType: "text/html" }])("rejects mismatched object metadata", async head => {
  const { uploadToken } = await prepareInstagramUpload("alice", 1024, "video/mp4");
  send.mockResolvedValueOnce(head);
  await expect(completeInstagramUpload("alice", uploadToken)).rejects.toThrow("does not match");
  expect(send).toHaveBeenCalledTimes(1);
});
test("rejects fake video bytes", async () => {
  const { uploadToken } = await prepareInstagramUpload("alice", 1024, "video/mp4");
  send.mockResolvedValueOnce({ ContentLength: 1024, ContentType: "video/mp4" })
    .mockResolvedValueOnce({ Body: { transformToByteArray: async () => Buffer.from('<html>not a video</html>') } });
  await expect(completeInstagramUpload("alice", uploadToken)).rejects.toThrow("Invalid video");
});
test("signs separate GET and HEAD delivery URLs with a bounded lifetime", async () => {
  await getInstagramStorageDownloadUrl("social/instagram/alice/fixture.mp4");
  await getInstagramStorageDownloadUrl("social/instagram/alice/fixture.mp4", true);
  expect(getSignedUrl).toHaveBeenNthCalledWith(1, expect.anything(), expect.any(GetObjectCommand), { expiresIn: 3600 });
  expect(getSignedUrl).toHaveBeenNthCalledWith(2, expect.anything(), expect.any(HeadObjectCommand), { expiresIn: 3600 });
});
