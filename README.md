# scrapbox-export-s3

Daily export of Scrapbox projects to S3 via AWS Lambda. Centralizes Scrapbox API access to avoid rate limits across multiple consumer projects.

## Architecture

```
EventBridge (daily cron) → Lambda → Scrapbox API → S3
```

Each project is exported to:
- `s3://{bucket}/{prefix}/{project}/latest.json` — always current, for consumers
- `s3://{bucket}/{prefix}/{project}/{date}.json` — daily snapshot for history

Consumer repos read from S3 via GitHub Actions OIDC (no long-lived AWS keys).

## Prerequisites

- AWS CLI configured
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- pnpm
- esbuild (`npm install -g esbuild`)

## Setup

### 1. Install dependencies

```bash
cd lambda && pnpm install
```

### 2. Store your Scrapbox SID

The Lambda reads the Scrapbox session cookie (`connect.sid`) from SSM Parameter Store.

To find your SID:
1. Open Scrapbox in your browser
2. Open DevTools → Application → Cookies → `https://scrapbox.io`
3. Copy the value of `connect.sid`

Store it in SSM:

```bash
aws ssm put-parameter \
  --name /scrapbox-export/sid \
  --type SecureString \
  --value "YOUR_CONNECT_SID_VALUE"
```

To update later:

```bash
aws ssm put-parameter \
  --name /scrapbox-export/sid \
  --type SecureString \
  --value "NEW_VALUE" \
  --overwrite
```

### 3. Configure deployment

```bash
cp samconfig.example.toml samconfig.toml
```

Edit `samconfig.toml` with your values:

| Parameter | Description | Example |
|---|---|---|
| `BucketName` | Existing S3 bucket | `my-bucket` |
| `S3Prefix` | Key prefix in the bucket | `scrapbox-exports/projects` |
| `ProjectNames` | Comma-separated Scrapbox project names | `project1,project2` |
| `SidParameterName` | SSM parameter name for SID | `/scrapbox-export/sid` |
| `GitHubOrgOrUser` | GitHub org/user for reader role OIDC | `your-username` |
| `ReaderRoleName` | IAM role name for consumers | `scrapbox-s3-reader` |
| `GitHubOidcProviderArn` | ARN of existing GitHub OIDC provider | `arn:aws:iam::123456789:oidc-provider/token.actions.githubusercontent.com` |

### 4. Deploy

```bash
sam build && sam deploy
```

## Consumer setup (GitHub Actions)

In your consumer repos, use the reader role to access the exported JSON:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-arn: arn:aws:iam::<ACCOUNT_ID>:role/scrapbox-s3-reader
      aws-region: ap-northeast-1

  - run: aws s3 cp s3://<BUCKET>/<PREFIX>/<PROJECT>/latest.json .
```

## Manual invocation

```bash
sam remote invoke ExportFunction --stack-name scrapbox-export-s3
```

## License
MIT