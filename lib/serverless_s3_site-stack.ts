import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { Construct } from 'constructs';
import { OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';

export class ServerlessS3SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // https://github.com/aws/aws-sdk-php/issues/1718
    // Bucket to store static website content
    // Note this bucket does not exposing static site hosting/public access, as will use cloudfront for exposing as S3
    // static site hosting does not support HTTPS
    const websiteBucket = new s3.Bucket(this, 'websiteBucket', {
      // NOTE THIS WEBSITE BUCKET CANNOT BE ENCRYPTED WITH CUSTOMER KMS KEY, AS ORIGIN IDENTITY SEEM CANNOT BE ENCRYPTED
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      publicReadAccess: false,
      enforceSSL: true,                      // Enforce the ssl page
      removalPolicy: RemovalPolicy.DESTROY,   // When the stack is destroyed, the content is also destroyed
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // Bucket to store authorized content
    const contentBucket = new s3.Bucket(this, 'contentBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      publicReadAccess: false,
      enforceSSL: true,                      // Enforce the ssl page
      removalPolicy: RemovalPolicy.DESTROY,   // When the stack is destroyed, the content is also destroyed
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // QS queue that will receive S3 event messages
    const contentBucketNotificationQueue = new sqs.Queue(this, 'ContentBucketS3NotificationQueue', {

    });
    // configure event notification
    contentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.SqsDestination(contentBucketNotificationQueue),
    );
    contentBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3Notifications.SqsDestination(contentBucketNotificationQueue),
    );


    // const product table
    const websiteTable = new dynamodb.Table(this, 'websiteTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      removalPolicy: RemovalPolicy.DESTROY   // When the stack is destroyed, the table is also destroyed
    });

    // create a global secondary index to allow faster search
    websiteTable.addGlobalSecondaryIndex({
      indexName: 'gsi',
      partitionKey: {
        name: 'gsi_pk',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'gsi_sk',
        type: dynamodb.AttributeType.STRING
      }
    })


    // Add per minute capacity (per second) 
    // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
    websiteTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });

    websiteTable.autoScaleReadCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });


    // Crate origin access identity (need for kms encrpyted bucket)
    // https://stackoverflow.com/questions/60905976/cloudfront-give-access-denied-response-created-through-aws-cdk-python-for-s3-buc
    const originAccessIdentity = new OriginAccessIdentity(this, "originAccessIdentity", {
      comment: "created_for_encryption_s3_site"
    });
    websiteBucket.grantRead(originAccessIdentity);

    // --------------------------------------------------------------------------------------
    // Cloudfront frontend for site distription and serving https as S3 Hosting does not serving HTTPS
    // --------------------------------------------------------------------------------------
    // https://github.com/aws-samples/aws-cdk-examples/issues/1084
    const websiteDistribution = new cloudfront.Distribution(this, 'websiteDistribution', {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html"
    });

    const webisteOrigin = 'https://' + websiteDistribution.distributionDomainName;
    // Enable below only for local test
    // const webisteOrigin = 'http://localhost:8080';

    // Add CORS to allow the cloudfront website to access the content bucket
    // Currently enable GET/POST/PUT/DELETE to retrieve and update content
    contentBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
      allowedOrigins: [webisteOrigin],
    });

    // https://docs.aws.amazon.com/cdk/api/v1/docs/aws-cognito-readme.html

    // --------------------------------------------------------------------------------------
    // AWS Cognito pool for OAuth2 auth
    // --------------------------------------------------------------------------------------
    const websiteUserPool = new cognito.UserPool(this, 'website-userpool', {
      userPoolName: 'website-userpool',
      selfSignUpEnabled: true,
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      removalPolicy: RemovalPolicy.DESTROY,  // When the stack is destroyed, the pool and its info are also destroyed
      userVerification: {
        emailSubject: 'Verify your email for our website!',
        emailBody: 'Thanks for signing up to our website! Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: 'Thanks for signing up to our website! Your verification code is {####}',
      },
      // https://docs.aws.amazon.com/cdk/api/v1/docs/aws-cognito-readme.html
      signInAliases: {            // Allow email as sign up alias please note it can only be configured at initial setup
        email: true
      },
      autoVerify: { email: true },  // Auto verify email
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    // Setup a client for website client
    const websiteAppClient = websiteUserPool.addClient('website-app-client', {
      accessTokenValidity: Duration.minutes(60), // Token lifetime
      generateSecret: false,
      preventUserExistenceErrors: true,    // Prevent user existence error to further secure (so will not notify that username exist or not)
      oAuth: {
        flows: {
          implicitCodeGrant: true, // Use implict grant in this case, as the website does not have a backend
        },
        scopes: [cognito.OAuthScope.OPENID],
        callbackUrls: [webisteOrigin],  // For callback and logout, go back to the website
        logoutUrls: [webisteOrigin],
      }
    });

    // domain for cognito hosted endpoint
    // currently use out of box domain from cognito
    const websiteCognitDomain = websiteUserPool.addDomain('websiteCognitDomain', {
      cognitoDomain: {
        domainPrefix: 'website-app',
      }
    });

    // Cognito auth to be used for later api gateway
    const websiteUserPoolAuth = new apigateway.CognitoUserPoolsAuthorizer(this, 'cognitoAuthorizer', {
      cognitoUserPools: [websiteUserPool]
    });

    // Setup login Url
    const signInUrl = websiteCognitDomain.signInUrl(websiteAppClient, {
      redirectUri: webisteOrigin, // must be a URL configured under 'callbackUrls' with the client
    });

    // Use a lmbda layer to store all shared library and while keep the distinct code small
    const lambdaLayer = new lambda.LayerVersion(this, 'LibraryLayer', {
      removalPolicy: RemovalPolicy.DESTROY,
      code: lambda.Code.fromAsset(path.join(__dirname, '/../lambda_layers')),
      compatibleArchitectures: [lambda.Architecture.ARM_64],
    });

    // IAM role for User Endpoint lambda
    const userEndpointsLambdaIAMRole = new iam.Role(this, 'userEndpointsLambdaIAMRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Add basic lambda role
    userEndpointsLambdaIAMRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));

    // Add permissions to allow lambda to list and modify (to update account status etc)
    const cognitoPolicy = new iam.Policy(this, 'cognito-modification', {
      statements: [
        new iam.PolicyStatement({
          actions: ['cognito-idp:AdminUpdateUserAttributes', 'cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
          resources: [websiteUserPool.userPoolArn]
        })
      ]
    });

    userEndpointsLambdaIAMRole.attachInlinePolicy(cognitoPolicy);

    // DynamoDB table for user write
    websiteTable.grantReadWriteData(userEndpointsLambdaIAMRole);

    // S3 bucket grant the permission
    contentBucket.grantReadWrite(userEndpointsLambdaIAMRole);


    // IAM role for User Endpoint lambda
    const sqsConsumerLambdaIAMRole = new iam.Role(this, 'sqsConsumerLambdaIAMRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Add basic lambda role
    sqsConsumerLambdaIAMRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));

    // Give permission to consume from s3 notification SQS queue
    sqsConsumerLambdaIAMRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl',
        ],
        resources: [contentBucketNotificationQueue.queueArn],
      }),
    );

    // DynamoDB table for user write
    websiteTable.grantReadWriteData(sqsConsumerLambdaIAMRole);

    // S3 bucket grant read permission for checking s3 prefix info
    contentBucket.grantRead(sqsConsumerLambdaIAMRole);

    // --------------------------------------------------------------------------------------
    // Create a Lambda function that will consume messages from the queue
    // --------------------------------------------------------------------------------------
    const sqsConsumerLambda = new lambda.Function(this, 'contentS3SSQSConsumerLambda', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      role: sqsConsumerLambdaIAMRole,
      handler: 'ContentS3SQSHandler.handler',
      timeout: Duration.seconds(5),                       // Maximum 5s timeout
      code: lambda.Code.fromAsset(path.join(__dirname, '/../lambda_fns')),
      layers: [lambdaLayer],
      environment: {
        WEBSITE_TABLE: websiteTable.tableName,
        S3_BUCKET_ARN: contentBucket.bucketArn,
      }
    });

    // --------------------------------------------------------------------------------------
    // Add an SQS event source mapping to the Lambda.
    // This tells Lambda to poll the SQS queue for messages.
    // --------------------------------------------------------------------------------------
    sqsConsumerLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(contentBucketNotificationQueue, {
        batchSize: 10,          // adjust as needed
        maxBatchingWindow: Duration.seconds(10),
      })
    );

    // Reference https://docs.aws.amazon.com/cdk/v2/guide/serverless_example.html
    // --------------------------------------------------------------------------------------
    // Lambda endpoint to handle API request from AWS Gateway public endpoint
    // --------------------------------------------------------------------------------------
    const userEndpointsLambda = new lambda.Function(this, 'userEndpointsLambda', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      role: userEndpointsLambdaIAMRole,
      architecture: lambda.Architecture.ARM_64,    // Use ARM_64 to save cost, but may need to tweak base on future lambda function content
      handler: 'UserAPI.handler',                    // The users.js is the entry point, so set it as handler
      timeout: Duration.seconds(2),                       // Maximum 2s timeout
      code: lambda.Code.fromAsset(path.join(__dirname, '/../lambda_fns')),
      layers: [lambdaLayer],
      environment: {
        WEBSITE_TABLE: websiteTable.tableName,
        S3_BUCKET_ARN: contentBucket.bucketArn,
        COGNITO_POOL_ID: websiteUserPool.userPoolId,
        CORS_ALLOW_ORIGIN: webisteOrigin
      }
    });

    // --------------------------------------------------------------------------------------
    // Gateway service for exposing endpoints
    // --------------------------------------------------------------------------------------
    const serviceAPI = new apigateway.RestApi(this, "service-api", {
      restApiName: "Website Service",
      description: "This service serves website API",
      // Set up CORS
      // Reference from https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors-console.html
      defaultCorsPreflightOptions: {
        allowOrigins: [webisteOrigin],
        allowMethods: ['GET', 'OPTIONS', 'PUT', 'POST', 'DELETE'],
        allowCredentials: true,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      }
    });

    const usersIntegration = new apigateway.LambdaIntegration(userEndpointsLambda, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' }
    });


    // Add users resource for retriving all users
    const usersResource = serviceAPI.root.addResource('users');
    usersResource.addMethod("GET", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // Add user resource for specific user
    const userIDResource = serviceAPI.root.addResource('user').addResource('{userId}');

    // Integrate with users API
    // Utilize the cognito pool authorizer
    // https://docs.aws.amazon.com/cdk/api/v1/docs/aws-apigateway-readme.html#authorizers
    userIDResource.addMethod("GET", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });
    userIDResource.addMethod("PUT", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // Add user resource for specific user
    const userAssetsResource = userIDResource.addResource("assets");
    userAssetsResource.addMethod("GET", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    const userAssetResource = userIDResource.addResource("asset");

    // Create new asset
    const userAssetResourcePreSignedPost = userAssetResource.addResource("presignedPost");
    userAssetResourcePreSignedPost.addMethod("POST", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });


    // Get/Delete asset
    const userAssetIdResourceGet = userAssetResource.addResource('{assetId}');
    userAssetIdResourceGet.addMethod("GET", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });
    userAssetIdResourceGet.addMethod("DELETE", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // post to asset
    const userAssetIdResourcePreSignedPost = userAssetIdResourceGet.addResource("presignedPost");;
    userAssetIdResourcePreSignedPost.addMethod("POST", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });


    // Print output
    new CfnOutput(this, 'WebsiteCognitoUserPoolId', { value: websiteUserPool.userPoolId });
    new CfnOutput(this, 'WebsiteUrl', { value: webisteOrigin });
    new CfnOutput(this, 'WebsiteSignInUrl', { value: signInUrl });
    new CfnOutput(this, 'WebsiteBucketName', { value: websiteBucket.bucketName });
  }
}
