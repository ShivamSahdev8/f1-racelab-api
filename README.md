# F1 RaceLab API (retired)

The F1 RaceLab UI now calculates illustrative race estimates in the browser from Jolpica championship data. It does not call this API or Amazon Bedrock. The CDK entry point defines no stacks, and the GitHub Actions workflow only validates the repository. A future push to main cannot recreate the retired prediction infrastructure.

The previous backend used API Gateway and Lambda to call Bedrock. A DynamoDB table stored guest trial IDs, daily member and IP counters, cached predictions, and short-lived locks. Those records let the server enforce usage limits across Lambda instances. DynamoDB's pay-per-request mode could incur charges, so it is no longer needed for browser-only estimates.

The deployed PredictorStack and SharedStack must be removed separately in AWS. The DynamoDB table had a RETAIN removal policy, so it must also be deleted after the stack is gone. Removing the source code alone does not remove AWS resources.

For historical code checks:

- npm ci
- npm run build
- npm test -- --runInBand

The existing CloudFront, S3, and Cognito services for the UI remain in use and may incur AWS charges. Keeping the current site does not guarantee a zero-dollar AWS bill.
