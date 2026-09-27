# 🧠 F1 RaceLab API

> Serverless backend powering the AI race predictions in **F1 RaceLab** — built with AWS CDK, Lambda, and Amazon Bedrock (Claude).

[![AWS CDK](https://img.shields.io/badge/AWS%20CDK-TypeScript-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com/cdk/)
[![Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?logo=awslambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![Bedrock](https://img.shields.io/badge/Amazon-Bedrock-232F3E?logo=amazonaws&logoColor=white)](https://aws.amazon.com/bedrock/)
[![API Gateway](https://img.shields.io/badge/Amazon-API%20Gateway-FF4F8B?logo=amazonapigateway&logoColor=white)](https://aws.amazon.com/api-gateway/)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)

**🎨 Frontend that consumes this API:** [f1-racelab-ui](https://github.com/ShivamSahdev8/f1-racelab-ui)

---

## Overview

This repository defines the cloud infrastructure and serverless logic behind F1 RaceLab's AI predictor. It is an **AWS CDK (TypeScript)** application that provisions an API Gateway, a Lambda function, and the IAM permissions needed to call **Amazon Bedrock**.

Given a race setup, the Lambda fetches current Formula 1 data, builds a prompt, and asks **Claude (Haiku 4.5)** on Bedrock to generate a structured prediction — returning win probability, expected finish, optimal setup, and analysis as clean JSON.

---

## Why a backend at all?

The Bedrock call **cannot** be made directly from the browser — it requires AWS credentials, which must never be exposed in client-side code. The Lambda acts as a secure middleman:

```
Browser  ──►  API Gateway  ──►  Lambda  ──►  Amazon Bedrock (Claude)
 (no AWS keys)              (holds IAM role)        (AI inference)
                                  │
                                  └──►  Ergast / Jolpica F1 data
```

Public F1 data is fetched server-side and combined with the user's inputs into a single prompt, so predictions are grounded in real standings and form rather than the model's assumptions alone.

---

## Architecture (multi-stack CDK)

The app uses a **multi-stack pattern** so resources can evolve and deploy independently:

```
bin/f1-racelab-api.ts        # CDK app entry point
│
├── SharedStack              # API Gateway (CORS enabled) — shared by all features
│      └── exposes `api`
│
└── PredictorStack           # consumes the shared API
       ├── NodejsFunction    # Lambda (TypeScript, bundled via esbuild)
       ├── IAM policy        # bedrock:InvokeModel + marketplace permissions
       └── POST /predict     # route wired to the Lambda
```

| Stack | Creates |
|-------|---------|
| `SharedStack` | API Gateway `F1 RaceLab API` with permissive CORS, exposes the `RestApi` to other stacks |
| `PredictorStack` | `NodejsFunction` Lambda, Bedrock + AWS Marketplace IAM permissions, `POST /predict` route |

---

## Prediction access and cost controls

`POST /predict` is public only for a limited anonymous trial. The Lambda enforces access before invoking Bedrock:

- **Guests:** one request attempt per UUIDv4 `guestId`, persisted indefinitely in DynamoDB; a separate hashed source-IP bucket allows at most 3 guest attempts per UTC day. The IP comes from API Gateway, never a caller-supplied forwarding header. A person can change browsers or IPs, so the global allowance is the final Bedrock safeguard.
- **Members:** send a Cognito **ID token** as `Authorization: Bearer <token>`. Signature, expiry, issuer, token use, and app-client audience are verified using `aws-jwt-verify`. A verified personal email is required. The previous shared demo account is rejected even if its token is valid. Invalid tokens never fall back to guest access.
- **Allowances:** 5 requests per member per UTC day and 100 new model invocations site-wide per UTC day. A DynamoDB transaction reserves all applicable counters together. Errors, uncertain responses, and timeouts retain reservations; there are no automatic Bedrock SDK retries. A quota-store failure fails closed.
- **Caching:** normalized setups and shared overviews are cached for 15 minutes and partitioned by UTC day, model, and prompt version. Cache hits still require a user allowance, but consume no model allowance. Conditional generation locks prevent simultaneous cache misses from invoking the model repeatedly. A busy request returns `429` without consuming its server allowance; the browser conservatively retains its attempted trial.
- **Overviews:** require member authentication and count toward the same member/global limits as personalized predictions.
- **Infrastructure:** a retained DynamoDB table holds allowances, expiring cache/lock records, and daily counters. API Gateway also targets 5 requests/second with a burst of 10; this throttle is best effort, while the transactional generation counter is the inference limit.

The defaults and existing Cognito pool/app IDs are in `lib/predictor-stack.ts`. Set `GLOBAL_DAILY_LIMIT` to `0` to stop new model generations. Cached results can still be served within member/guest allowances. Daily counters are keyed by UTC date rather than relying on eventual DynamoDB TTL deletion. This limits inference attempts, not all AWS charges; API Gateway, Lambda, and DynamoDB still incur usage costs. Keep AWS billing alerts enabled.

The frontend must use the updated guest ID and ID-token contract. Deploy this API together with `f1-racelab-ui`'s `feature/ui-updates` changes. Revoke/disable the previously published shared guest credentials in Cognito as operational cleanup; this endpoint already denies that account.

Errors return `{ "code": "...", "error": "..." }`: `INVALID_REQUEST` (400), `SIGN_IN_REQUIRED` (401), `GUEST_LIMIT_REACHED` (403), `DAILY_LIMIT_REACHED`, `GLOBAL_LIMIT_REACHED`, or `RATE_LIMITED` (429), and `UNAVAILABLE` (503). Clients must not automatically retry generation requests.

## API

### `POST /predict`

**Race overview** (member ID token required) — top contenders for the next Grand Prix:

```json
{ "type": "overview" }
```

**What-if prediction** — single driver + setup. Anonymous requests also include a stable UUIDv4 `guestId`; members provide the ID-token header instead:

```json
{
  "guestId": "06d939be-4eac-498a-8d7d-f3ec690b566d",
  "driver": "Charles Leclerc",
  "circuit": "Monaco",
  "tyres": "SOFT",
  "weather": "DRY",
  "downforce": "HIGH",
  "strategy": "1-STOP"
}
```

**Sample response:**

```json
{
  "winChance": 72,
  "podiumChance": 85,
  "expectedPosition": 2,
  "expectedPoints": 23,
  "insight": "Leclerc's Monaco pedigree and Ferrari's strength in slow corners make him a strong favourite...",
  "riskFactor": "LOW",
  "optimalSetup": {
    "tyres": "SOFT",
    "strategy": "1-STOP",
    "downforce": "HIGH",
    "winChance": 72,
    "explanation": "Soft tyres maximise grip on Monaco's low-speed corners."
  },
  "funFact": "Charles Leclerc has an exceptional podium record at his home Grand Prix."
}
```

---

## Tech Stack

- **IaC:** AWS CDK (TypeScript)
- **Compute:** AWS Lambda (`NodejsFunction`, bundled with esbuild)
- **API:** Amazon API Gateway (REST, CORS)
- **AI:** Amazon Bedrock — Claude **Haiku 4.5** (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) via an inference profile
- **Data:** Ergast / Jolpica F1 API
- **Region:** `us-east-2`
- **CI/CD:** GitHub Actions

---

## Getting Started

### Prerequisites

- Node.js 22
- AWS CLI configured with credentials (`aws configure`)
- AWS CDK CLI: `npm install -g aws-cdk`
- Amazon Bedrock model access enabled for Anthropic Claude in your account/region

### Install

```bash
git clone https://github.com/ShivamSahdev8/f1-racelab-api.git
cd f1-racelab-api
npm install
```

### Bootstrap (first time per account/region)

```bash
cdk bootstrap --region us-east-2
```

### Useful commands

```bash
cdk synth                       # preview the generated CloudFormation
cdk deploy --all                # deploy every stack
cdk deploy PredictorStack       # deploy only the predictor
cdk diff                        # show what would change
cdk destroy --all               # tear everything down
```

### Test locally without incurring model charges

```bash
npm run build
npm test -- --runInBand
npx cdk synth
```

Tests mock inference and storage; they do not call the live prediction API.

### Manually test the deployed endpoint (consumes a trial)

```bash
curl -X POST <api-url>/predict \
  -H "Content-Type: application/json" \
  -d '{"guestId":"06d939be-4eac-498a-8d7d-f3ec690b566d","driver":"Charles Leclerc","circuit":"Monaco","tyres":"SOFT","weather":"DRY","downforce":"HIGH","strategy":"1-STOP"}'
```

---

## Deployment

Pushing to `main` triggers a **GitHub Actions** workflow that configures AWS credentials and runs:

```bash
npx cdk deploy --all --require-approval never
```

AWS credentials are stored as repository secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`).

---

## Project Structure

```
f1-racelab-api/
├── bin/
│   └── f1-racelab-api.ts        # CDK app entry point
├── lib/
│   ├── shared-stack.ts          # API Gateway
│   └── predictor-stack.ts       # Lambda + Bedrock + route
├── lambda/
│   └── predictor/
│       └── index.ts             # handler: fetch data → prompt → Bedrock → JSON
├── .github/workflows/           # CI/CD
└── cdk.json
```

---

## Implementation Notes

- The Lambda uses CDK's **`NodejsFunction`**, which compiles and bundles the TypeScript handler with esbuild automatically — no manual build step or committed JS.
- Runtime dependencies, including AWS SDK clients and JWT verification, are bundled from the lockfile so deployment does not depend on the runtime's SDK version.
- Bedrock requires an **inference-profile model ID** (the `us.` prefix) for on-demand throughput; legacy direct model IDs are not supported.
- The IAM role includes AWS Marketplace permissions (`aws-marketplace:ViewSubscriptions`, `Subscribe`) required for first-time and ongoing access to Anthropic models.

---

## Roadmap

- [ ] RAG over historical race data for sharper predictions
- [ ] Separate `FantasyStack` for fantasy scoring
- [ ] CloudWatch dashboard + alarms
- [ ] Move Cognito and hosting into CDK (`AuthStack`, `HostingStack`)

---

*Unofficial personal project for learning. Not affiliated with Formula 1. AI output is for entertainment and should not be used for betting.*
