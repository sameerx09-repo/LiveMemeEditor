import { S3Client } from "@aws-sdk/client-s3";

// R2 is S3-compatible. Endpoint format: https://<accountId>.r2.cloudflarestorage.com
export function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME || "clipmemeeditor-clips";

// Link validity only; object retention is configured separately in R2.
export const CLIP_TTL_SECONDS = 60 * 60 * 24;
