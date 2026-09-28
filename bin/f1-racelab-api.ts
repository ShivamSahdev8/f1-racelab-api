#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
// The UI now computes estimates in the browser. Keep this CDK app empty so
// validation or an accidental deploy cannot recreate the retired API.
new cdk.App();
