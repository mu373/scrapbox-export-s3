import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const s3 = new S3Client({});
const ssm = new SSMClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const S3_PREFIX = process.env.S3_PREFIX!;
const PROJECT_NAMES = process.env.PROJECT_NAMES!.split(",");
const SID_PARAMETER_NAME = process.env.SID_PARAMETER_NAME!;

/** Retrieve the Scrapbox session cookie (connect.sid) from SSM Parameter Store */
async function getSid(): Promise<string> {
  const result = await ssm.send(
    new GetParameterCommand({
      Name: SID_PARAMETER_NAME,
      WithDecryption: true,
    })
  );
  return result.Parameter!.Value!;
}

/**
 * Export all pages from a Scrapbox project using the page-data export API.
 * Requires a valid session cookie for private projects.
 */
async function exportProject(
  projectName: string,
  sid: string
): Promise<unknown> {
  const url = `https://scrapbox.io/api/page-data/export/${projectName}.json`;
  const res = await fetch(url, {
    headers: {
      Cookie: `connect.sid=${sid}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to export ${projectName}: ${res.status} ${res.statusText}`
    );
  }

  return res.json();
}

/**
 * Upload the exported JSON to S3.
 * Writes two keys per project:
 *   - {prefix}/{project}/latest.json  — always overwritten, for consumers
 *   - {prefix}/{project}/{date}.json  — daily snapshot for history
 */
async function uploadToS3(
  projectName: string,
  data: unknown,
  date: string
): Promise<void> {
  const json = JSON.stringify(data);

  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${S3_PREFIX}/${projectName}/latest.json`,
        Body: json,
        ContentType: "application/json",
      })
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${S3_PREFIX}/${projectName}/${date}.json`,
        Body: json,
        ContentType: "application/json",
      })
    ),
  ]);
}

/**
 * Lambda entry point. Triggered daily by EventBridge.
 * Exports each configured Scrapbox project in parallel and uploads to S3.
 */
export async function handler(): Promise<void> {
  const sid = await getSid();
  const date = new Date().toISOString().slice(0, 10);

  const failures: { project: string; error: unknown }[] = [];
  for (const projectName of PROJECT_NAMES) {
    try {
      console.log(`Exporting ${projectName}...`);
      const data = await exportProject(projectName, sid);
      await uploadToS3(projectName, data, date);
      console.log(`Exported ${projectName} to s3://${BUCKET_NAME}/${S3_PREFIX}/${projectName}/`);
    } catch (error) {
      console.error(`Failed to export ${projectName}:`, error);
      failures.push({ project: projectName, error });
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${PROJECT_NAMES.length} exports failed: ${failures.map((f) => f.project).join(", ")}`);
  }

  console.log(`All ${PROJECT_NAMES.length} projects exported successfully`);
}
