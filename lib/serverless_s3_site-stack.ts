import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { Construct } from 'constructs';
import * as fs from 'fs';
import { OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ServerlessS3SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // KMS Key for encrpytion entire site
    // Enable automatic rotation
    const kmsKey = new kms.Key(this, 'siteEncrpytionKey', {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY,   // When the stack is destroyed, the key is also destroyed
      pendingWindow: Duration.days(7),      // Retain for 10 days after destroy command
    });

    // https://github.com/aws/aws-sdk-php/issues/1718
    // Bucket to store static website content
    const websiteBucket = new s3.Bucket(this, 'websiteBucket', {
      // NOTE THIS WEBSITE BUCKET CANNOT BE ENCRYPTED WITH CUSTOMER KMS KEY, AS ORIGIN IDENTITY SEEM CANNOT BE ENCRYPTED
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      enforceSSL: true,                      // Enforce the ssl page
      removalPolicy: RemovalPolicy.DESTROY,   // When the stack is destroyed, the content is also destroyed
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // Bucket to store authorized content
    const contentBucket = new s3.Bucket(this, 'contentBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      publicReadAccess: false,
      enforceSSL: true,                      // Enforce the ssl page
      removalPolicy: RemovalPolicy.DESTROY,   // When the stack is destroyed, the content is also destroyed
      autoDeleteObjects: true, // NOT recommended for production code
    });

    // const usertable
    const userTable = new dynamodb.Table(this, 'userTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      removalPolicy: RemovalPolicy.DESTROY   // When the stack is destroyed, the table is also destroyed
    });

    // Add per minute capacity (per second) 
    // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
    userTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });

    // Crate origin access identity (need for kms encrpyted bucket)
    // https://stackoverflow.com/questions/60905976/cloudfront-give-access-denied-response-created-through-aws-cdk-python-for-s3-buc
    const originAccessIdentity = new OriginAccessIdentity(this, "originAccessIdentity", {
      comment: "created_for_encryption_s3_site"
    });
    websiteBucket.grantRead(originAccessIdentity);

    // Cloudfront frontend for site distription and serving https
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront.CfnDistribution.S3OriginConfigProperty.html
    // https://docs.aws.amazon.com/cdk/api/v2//docs/aws-cdk-lib.aws_cloudfront.Distribution.html
    const websiteDistribution = new cloudfront.Distribution(this, 'websiteDistribution', {
      defaultBehavior: {
        origin: new cloudfrontOrigins.S3Origin(websiteBucket, {
          originAccessIdentity: originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html"
    });



    const webisteOrigin = 'https://' + websiteDistribution.distributionDomainName;
    //const webisteOrigin = 'http://localhost:8080';

    // Add CORS to allow the cloudfront website to access the content bucket
    // Currently enable GET/POST/PUT/DELETE to retrieve and update content
    contentBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
      allowedOrigins: [webisteOrigin],
    });

    // https://docs.aws.amazon.com/cdk/api/v1/docs/aws-cognito-readme.html

    // AWS Cognito for securing website endpoint
    const websiteUserPool = new cognito.UserPool(this, 'website-userpool', {
      userPoolName: 'website-userpool',
      selfSignUpEnabled: true,
      removalPolicy: RemovalPolicy.DESTROY,  // When the stack is destroyed, the pool and its info are also destroyed
      userVerification: {
        emailSubject: 'Verify your email for our webiste!',
        emailBody: 'Thanks for signing up to our webiste! Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: 'Thanks for signing up to our webiste! Your verification code is {####}',
      },
      // https://docs.aws.amazon.com/cdk/api/v1/docs/aws-cognito-readme.html
      signInAliases: {            // Allow emailand username to be used as sign in alias, please note it can only be configured at initial setup
        username: true,
        email: true
      },
      autoVerify: { email: true }  // Auto verify email
    });


    // Setup a client for website client
    const websiteAppClient = websiteUserPool.addClient('website-app-client', {
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
      },
    });

    // Setup login Url
    const signInUrl = websiteCognitDomain.signInUrl(websiteAppClient, {
      redirectUri: webisteOrigin, // must be a URL configured under 'callbackUrls' with the client
    });

    // IAM role for Lambda
    const userEndpointsLambdaIAMRole = new iam.Role(this, 'userEndpointsLambdaIAMRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Add basic lambda role
    userEndpointsLambdaIAMRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"));
    // grant dynamodb permission
    userTable.grantReadWriteData(userEndpointsLambdaIAMRole);
    // kms key permission (so can write to dynamoDB)
    kmsKey.grantEncryptDecrypt(userEndpointsLambdaIAMRole);
    // S3 bucket grant the permission
    contentBucket.grantReadWrite(userEndpointsLambdaIAMRole);


    // Reference https://docs.aws.amazon.com/cdk/v2/guide/serverless_example.html

    // Lambda endpoint
    const userEndpointsLambda = new lambda.Function(this, 'userEndpointsLambda', {
      runtime: lambda.Runtime.NODEJS_14_X,
      role: userEndpointsLambdaIAMRole,
      architecture: lambda.Architecture.ARM_64,    // Use ARM_64 to save cost, but may need to tweak base on future lambda function content
      handler: 'users.handler',                    // The users.js is the entry point, so set it as handler
      timeout: Duration.seconds(2),                       // Maximum 2s timeout
      code: lambda.Code.fromAsset(path.join(__dirname, '/../lambda_fns')),
      environment: {
        S3_BUCKET_ARN: contentBucket.bucketArn,
        KMS_KEY_ARN: kmsKey.keyArn,
        USER_TABLE: userTable.tableName,
        CORS_ALLOW_ORIGIN: webisteOrigin
      }
    });

    const websiteUserPoolAuth = new apigateway.CognitoUserPoolsAuthorizer(this, 'booksAuthorizer', {
      cognitoUserPools: [websiteUserPool]
    });

    const userAPI = new apigateway.RestApi(this, "users-api", {
      restApiName: "User Service",
      description: "This service serves users.",
      // Set up CORS
      // Reference from https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors-console.html
      defaultCorsPreflightOptions: {
        allowOrigins: [webisteOrigin],
        allowMethods: ['GET', 'OPTIONS', 'PUT'],
        allowCredentials: true,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      }
    });

    const usersIntegration = new apigateway.LambdaIntegration(userEndpointsLambda, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' }
    });

    const userResource = userAPI.root.addResource('user');
    userResource.addMethod("GET", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    }); // GET /

    const userIDResource = userResource.addResource('{userId}');

    // Integrate with users API
    // Utilize the cognito pool authorizer
    // https://docs.aws.amazon.com/cdk/api/v1/docs/aws-apigateway-readme.html#authorizers
    userIDResource.addMethod("GET", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    }); // GET /
    userIDResource.addMethod("PUT", usersIntegration, {
      authorizer: websiteUserPoolAuth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    }); // PUT /

    // Print output
    new CfnOutput(this, 'WebsiteCognitoUserPoolId', { value: websiteUserPool.userPoolId });
    new CfnOutput(this, 'WebsiteUrl', { value: webisteOrigin });
    new CfnOutput(this, 'WebsiteSignInUrl', { value: signInUrl });
    new CfnOutput(this, 'WebsiteBucketName', { value: websiteBucket.bucketName });
  }
}
