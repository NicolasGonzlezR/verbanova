import { S3Client } from "@aws-sdk/client-s3";

const endpoint = process.env.MINIO_ENDPOINT || "";
const accessKeyId = process.env.MINIO_ACCESS_KEY || "";
const secretAccessKey = process.env.MINIO_SECRET_KEY || "";

if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error("MinIO config is missing (MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY)");
}

export const s3Client = new S3Client({
  region: process.env.MINIO_REGION || "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export const s3Bucket = process.env.MINIO_BUCKET || "voice-profiles";
