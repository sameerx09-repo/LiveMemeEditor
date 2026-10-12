export async function uploadInstagramClip(blob: Blob, headers: Record<string, string>): Promise<string> {
  const contentType = (blob.type || "video/mp4").split(";")[0];
  async function request(body: object) {
    const response = await fetch("/api/instagram/upload-direct", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Video upload failed");
    return data;
  }
  const { uploadUrl, uploadToken } = await request({ action: "prepare", size: blob.size, contentType });
  // Do not forward the app session token to storage.
  const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!uploaded.ok) throw new Error("Storage upload failed; check the bucket CORS configuration");
  const { mediaUrl } = await request({ action: "complete", uploadToken });
  if (typeof mediaUrl !== "string") throw new Error("Video upload could not be finalized");
  return mediaUrl;
}
