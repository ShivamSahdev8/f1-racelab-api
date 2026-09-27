import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { SharedStack } from '../lib/shared-stack';
import { PredictorStack } from '../lib/predictor-stack';

test('deploys persistent quota storage and configures bounded inference access', () => {
  const app = new cdk.App();
  const shared = new SharedStack(app, 'Shared');
  const stack = new PredictorStack(app, 'Predictor', { api: shared.api });
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    BillingMode: 'PAY_PER_REQUEST',
    TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }]
  });
  template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Timeout: 30,
    Environment: { Variables: Match.objectLike({ MEMBER_DAILY_LIMIT: '5', GLOBAL_DAILY_LIMIT: '100', GUEST_IP_DAILY_LIMIT: '3', COGNITO_USER_POOL_ID: 'us-east-2_RbqsjgmwB', COGNITO_CLIENT_ID: '6ahposh9tdsm97rv721i7i41v', PREDICTION_TABLE: Match.anyValue() }) }
  });
  Template.fromStack(shared).hasResourceProperties('AWS::ApiGateway::Stage', {
    MethodSettings: Match.arrayWith([Match.objectLike({ ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 })])
  });
});
