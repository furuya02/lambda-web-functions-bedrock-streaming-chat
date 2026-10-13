# lambda-web-functions-bedrock-streaming-chat

A sample chat app that streams Amazon Bedrock responses on AWS Lambda Web Functions

[日本語](README.ja.md)

## Overview

The chat page (GET /) and the API (POST /chat) live in a single Hono app running on Lambda Web Functions.
POST /chat streams the Bedrock ConverseStream response to the browser as it arrives.
No Lambda handler or adapter (Lambda Web Adapter) is used; the app is written as a plain Node.js HTTP server.

```
Browser ─ HTTPS (Basic auth) ─ Lambda Web Functions (Hono)
                                 ├ GET  /      chat page (renders Markdown)
                                 └ POST /chat  streams the ConverseStream response ─ Amazon Bedrock
```

## Features

- Streams Bedrock responses (no extra configuration needed for streaming)
- Renders Markdown answers in the browser (marked + DOMPurify)
- Aborts the Bedrock call when the client disconnects
- Basic authentication
- Endpoint traffic limits (100 requests per second, up to 2 execution environments)
- Deployed with CDK (L1: CfnWebFunction / CfnWebFunctionRevision / CfnWebFunctionEndpoint)

## Structure

| Directory | Contents |
|---|---|
| app/ | Hono app (app/src/index.ts), bundled into app/dist/index.js with esbuild |
| cdk/ | CDK (S3 bucket, execution role, Web Function, revision, endpoint) |

## Requirements

- Node.js 22+ / pnpm
- AWS credentials (Tokyo region ap-northeast-1, CDK bootstrapped)
- Access to `jp.anthropic.claude-haiku-4-5-20251001-v1:0` on Bedrock
- aws-cdk-lib 2.273.0 or later (includes the Web Functions L1 constructs)

## Deploy

```bash
git clone https://github.com/furuya02/lambda-web-functions-bedrock-streaming-chat.git
cd lambda-web-functions-bedrock-streaming-chat

# Build the app (bundled into a single file: app/dist/index.js)
pnpm -C app install
pnpm -C app build

# Deploy (specify the Basic auth password; the user name is "user")
pnpm -C cdk install
pnpm -C cdk cdk deploy -c basic_password=<password>
```

Note the `Url` output. The S3 bucket name suffix defaults to the account ID (override with `-c bucket_suffix=xxx`).

## Try it

### Browser

Open `Url`, sign in as `user` with your password, and ask a question. The answer appears gradually.

### curl

```bash
curl -N -u user:<password> -X POST <Url>chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":[{"text":"Name five spring flowers"}]}]}'
```

### Local

```bash
AWS_REGION=ap-northeast-1 pnpm -C app dev   # http://localhost:3000/ (user: user / password: pass)
```

## Notes

- The endpoint uses ApplicationManaged auth, so anyone who knows the URL can reach it. Basic auth is a minimal guard for testing. For production, consider CloudFront + OAC or another authentication method
- The Basic auth password is stored in plain text in the revision's environment variables and in the CloudFormation template (cdk.out)
- Delete the stack when you are done (Bedrock calls incur costs)

## Clean up

```bash
pnpm -C cdk cdk destroy -c basic_password=<password>
```

## License

MIT
