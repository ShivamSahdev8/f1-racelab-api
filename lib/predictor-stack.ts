import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
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
      },
      bundling: {
        minify: true,
        sourceMap: false,
        externalModules: ["@aws-sdk/*"], // AWS SDK already in Lambda runtime
      },
    });

    // Grant Bedrock access
    predictorFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      }),
    );

    // Grant Marketplace permissions (required for Anthropic models)
    predictorFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "aws-marketplace:ViewSubscriptions",
          "aws-marketplace:Subscribe",
          "aws-marketplace:Unsubscribe",
          "bedrock:InvokeModel",
          "bedrock:GetFoundationModel",
          "bedrock:ListFoundationModels",
          "bedrock:GetInferenceProfile",
          "bedrock:ListInferenceProfiles",
        ],
        resources: ["*"],
      }),
    );

    // Connect to API Gateway
    const predictResource = props.api.root.addResource("predict");
    predictResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(predictorFn),
    );
  }
}
