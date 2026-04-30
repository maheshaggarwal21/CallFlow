import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import os from "os";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (client) return client;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  return client;
}

export async function getAudioPresignedUrl(key: string): Promise<string | null> {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) return null;

  const s3 = getClient();
  if (!s3) return null;

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
  const bucket = process.env.R2_BUCKET;
  if (!bucket) return false;

  const s3 = getClient();
  if (!s3) return false;

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
  const bucket = process.env.R2_BUCKET;
  if (!bucket) return null;

  const s3 = getClient();
  if (!s3) return null;

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
