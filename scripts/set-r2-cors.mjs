import { execFileSync } from "node:child_process";
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";

const env = (name) => execFileSync("npx", ["convex", "env", "get", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const bucket = env("R2_BUCKET");
const endpoint = env("R2_ENDPOINT");
const accessKeyId = env("R2_ACCESS_KEY_ID");
const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
const appUrl = env("APP_URL").replace(/\/$/, "");

const client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
const CORSRules = [{
  AllowedOrigins: [...new Set([appUrl, "http://localhost:3000"])],
  AllowedMethods: ["GET", "PUT", "HEAD"],
  AllowedHeaders: ["*"],
  ExposeHeaders: ["ETag"],
  MaxAgeSeconds: 3600,
}];

await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules } }));
const result = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`R2 CORS configured for ${bucket}: ${result.CORSRules?.[0]?.AllowedOrigins?.join(", ")}`);
