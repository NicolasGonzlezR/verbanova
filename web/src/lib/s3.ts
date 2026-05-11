import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("MinIO not configured (MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY)");
  }
  _client = new S3Client({
    region: process.env.MINIO_REGION || "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export function getBucket(): string {
  return process.env.MINIO_BUCKET || "voice-profiles";
}

export function isConfigured(): boolean {
  return !!(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY);
}

export async function ensureBucket(): Promise<void> {
  const client = getClient();
  const bucket = getBucket();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body, ContentType: contentType })
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  );
}
