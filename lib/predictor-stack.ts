import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Construct } from "constructs";

interface PredictorStackProps extends cdk.StackProps {
  api: apigateway.RestApi;
}

export class PredictorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PredictorStackProps) {
    super(scope, id, props);

    const predictions = new dynamodb.Table(this, "PredictionAccess", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // NodejsFunction automatically compiles TypeScript!
    const predictorFn = new NodejsFunction(this, "PredictorFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../lambda/predictor/index.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        BEDROCK_REGION: "us-east-2",
        PREDICTION_TABLE: predictions.tableName,
        COGNITO_USER_POOL_ID: "us-east-2_RbqsjgmwB",
        COGNITO_CLIENT_ID: "6ahposh9tdsm97rv721i7i41v",
        MEMBER_DAILY_LIMIT: "5",
        GUEST_IP_DAILY_LIMIT: "3",
        GLOBAL_DAILY_LIMIT: "0",
      },
      bundling: {
        minify: true,
        sourceMap: false,
        externalModules: [], // Bundle pinned SDK versions, including the DynamoDB document client.
      },
    });

    predictions.grantReadWriteData(predictorFn);

    // Connect to API Gateway
    const predictResource = props.api.root.addResource("predict");
    predictResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(predictorFn),
    );
  }
}
