import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { createWriteStream, existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import os from "os";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Local dev uploads directory — used when R2 is not configured
export const DEV_UPLOADS_DIR = path.join(__dirname, "../../dev-uploads");

function isR2Configured(): boolean {
  const ep = process.env.R2_ENDPOINT || "";
  const key = process.env.R2_ACCESS_KEY_ID || "";
  return ep.length > 0 && !ep.includes("placeholder") && key !== "your-access-key" && key.length > 0;
}

function ensureDevDir() {
  if (!existsSync(DEV_UPLOADS_DIR)) mkdirSync(DEV_UPLOADS_DIR, { recursive: true });
}

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!isR2Configured()) return null;
  if (client) return client;

  const endpoint = process.env.R2_ENDPOINT!;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;

  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return client;
}

export async function getAudioPresignedUrl(key: string): Promise<string | null> {
  const s3 = getClient();

  if (!s3) {
    // Dev fallback — serve from local dev-uploads directory
    const localPath = path.join(DEV_UPLOADS_DIR, path.basename(key));
    if (existsSync(localPath)) {
      const port = process.env.PORT || 4000;
      return `http://localhost:${port}/dev-audio/${encodeURIComponent(path.basename(key))}`;
    }
    return null;
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) return null;

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return await getSignedUrl(s3, command, { expiresIn: 900 });
  } catch {
    return null;
  }
}

export async function uploadAudioObject(
  key: string,
  body: Buffer,
  contentType?: string
): Promise<boolean> {
  const s3 = getClient();

  if (!s3) {
    // Dev fallback — save to local dev-uploads directory
    try {
      ensureDevDir();
      const { writeFileSync } = await import("fs");
      writeFileSync(path.join(DEV_UPLOADS_DIR, path.basename(key)), body);
      return true;
    } catch {
      return false;
    }
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) return false;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    });
    await s3.send(command);
    return true;
  } catch {
    return false;
  }
}

export async function downloadAudioToFile(key: string): Promise<string | null> {
  const s3 = getClient();

  if (!s3) {
    // Dev fallback — copy from dev-uploads to a tmp path for AI processing
    const localPath = path.join(DEV_UPLOADS_DIR, path.basename(key));
    if (!existsSync(localPath)) return null;
    const tmpPath = path.join(os.tmpdir(), `callflow-${randomUUID()}.wav`);
    copyFileSync(localPath, tmpPath);
    return tmpPath;
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) return null;

  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);
    const body = response.Body;
    if (!body || typeof body === "string") return null;

    const tmpPath = path.join(os.tmpdir(), `callflow-${randomUUID()}.wav`);
    await pipeline(body as NodeJS.ReadableStream, createWriteStream(tmpPath));
    return tmpPath;
  } catch {
    return null;
  }
}
