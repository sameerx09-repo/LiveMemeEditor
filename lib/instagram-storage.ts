import crypto from "crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, R2_BUCKET } from "./r2";
import { isValidWebM } from "./webm-utils";

export const MAX_INSTAGRAM_UPLOAD_BYTES = 500 * 1024 * 1024;
type UploadTicket = { userId: string; key: string; size: number; contentType: string; expires: number };

function secret() {
  const value = process.env.INSTAGRAM_STATE_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!value) throw new Error("Instagram signing secret is not configured");
  return value;
}
function signature(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}
function storage() {
  const client = getR2Client();
  if (!client) throw new Error("R2 not configured");
  return client;
}

export async function prepareInstagramUpload(userId: string, size: number, contentType: string) {
  if (!Number.isSafeInteger(size) || size < 12 || size > MAX_INSTAGRAM_UPLOAD_BYTES) throw new Error("Video must be between 12 bytes and 500 MB");
  if (contentType !== "video/mp4" && contentType !== "video/webm") throw new Error("Upload an MP4 or WebM video");
  const key = `social/instagram/${userId}/${crypto.randomBytes(16).toString("hex")}.${contentType === "video/mp4" ? "mp4" : "webm"}`;
  const ticket: UploadTicket = { userId, key, size, contentType, expires: Math.floor(Date.now() / 1000) + 600 };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  const uploadToken = `${payload}.${signature(payload)}`;
  const uploadUrl = await getSignedUrl(storage(), new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, ContentType: contentType, ContentLength: size,
  }), { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) });
  return { uploadUrl, uploadToken };
}

export function readInstagramUploadTicket(token: string, userId: string): UploadTicket {
  if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid upload ticket");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid upload ticket");
  const expected = Buffer.from(signature(parts[0]));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Invalid upload ticket");
  let ticket: UploadTicket;
  try { ticket = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { throw new Error("Invalid upload ticket"); }
  if (!ticket || ticket.userId !== userId || !Number.isFinite(ticket.expires) || ticket.expires <= Math.floor(Date.now() / 1000) ||
      typeof ticket.key !== "string" || !ticket.key.startsWith(`social/instagram/${userId}/`) ||
      !/\/[a-f0-9]{32}\.(mp4|webm)$/.test(ticket.key) || !Number.isSafeInteger(ticket.size) || ticket.size < 12 ||
      ticket.size > MAX_INSTAGRAM_UPLOAD_BYTES || !["video/mp4", "video/webm"].includes(ticket.contentType)) throw new Error("Upload ticket expired or invalid for this account");
  return ticket;
}

export async function completeInstagramUpload(userId: string, token: string) {
  const ticket = readInstagramUploadTicket(token, userId);
  const client = storage();
  const head = await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: ticket.key }));
  if (head.ContentLength !== ticket.size || head.ContentType !== ticket.contentType) throw new Error("Uploaded video size or type does not match");
  const sample = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: ticket.key, Range: "bytes=0-63" }));
  if (!sample.Body) throw new Error("Uploaded video is empty");
  const header = Buffer.from(await sample.Body.transformToByteArray());
  const valid = ticket.contentType === "video/webm" ? isValidWebM(header) : header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp";
  if (!valid) throw new Error("Invalid video file");
  return { key: ticket.key };
}

export function getInstagramStorageDownloadUrl(key: string, head = false) {
  const command = head ? new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }) : new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(storage(), command, { expiresIn: 3600 });
}
