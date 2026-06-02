#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SharedStack } from '../lib/shared-stack';
import { PredictorStack } from '../lib/predictor-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-2'
};

// Shared resources (API Gateway)
const sharedStack = new SharedStack(app, 'SharedStack', { env });

// Predictor Lambda + Bedrock
new PredictorStack(app, 'PredictorStack', {
  env,
  api: sharedStack.api
});