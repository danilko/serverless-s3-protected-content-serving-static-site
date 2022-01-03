# A sample serverless site with access controlled binary

A sample serverless site with access controlled binary

**Note this is not a production ready setup, but rather an experimental setup to demonstrate some of these setup**

**This includes but not limited to the static site javascript set - up to use minimum library set to demo the points, but may not contain all necessary security check etc...**

## Overall Architecture
This is a sample app to test a severless setup where:

- A `website` S3 bucket contains the static site content serving by CloudFront
- A `content` S3 bucket to serve the authorized content through S3 presigned url base on user endpoint's AWS STS token and info (S3 prefix etc...)
- A user endpoint served up with API Gateway to backend Lambda computing to generate user's info
- The lambda computing will access the pass in user's token and backend dynamoDB info to generate AWS STS token

Some other setup (such as lambda endpoint for update certain dynamo DB field are not drawn out to keep the graph simple)

![Architecture](images/architecture.drawio.png)


## Requirement Setup
Please installed following tools:
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- [Node.js (v14.0 or above)](https://nodejs.org/en/)
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html)


## Deployment

Git clone and move into the directory
```
git clone <repo>
cd <repo>
```

Install the dependency
```
npm install
```

Setup the [AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)
Ensure a region is specified, as the repo does not assume any region
```
export AWS_REGION=us-west-2

```

Deploy the `cdk bootstrap stack` (only need to perform for first time if region change or first time setup)
```
# If first time
cdk bootstrap
```

Deploy the stack
```
cdk deploy
```

Please continue with gather info below section to continue the setup

## Gather info

### The user API url
The deployment stack will result in a `API Gateway Endpoint` url, please note it down
Example
```
https://<generated id>.execute-api.us-west-2.amazonaws.com/prod/
```

### For website and content buckets
Please do (change `serverlesss3sitestack` to target stack if it is different)
```
aws s3 ls | grep -i 'serverlesss3sitestack'
```

Note down the S3 bucket

```
website -> 	serverlesss3sitestack*-websitebucket*
content -> 	serverlesss3sitestack*-contentbucket*
```

### For pool id and sign in url
Please go to AWS Console -> Select region where stack is located -> Services -> Cloudformation -> Stacks -> Look for stack named `ServerlessS3ite*` (or name modify in cdk) -> Click `Resources` tab -> go to type `AWS::Cognito::UserPool`, please click the link

Once in the link:
Under `General Settings`, copy the `Pool Id`
Example
```
us-west-2_<generated id>
```

Under `App client setting`, copy the `Launch Hosted UI`'s url
Example
```
https://<app name>.auth.us-west-2.amazoncognito.com/login?client_id=<client id>&response_type=token&scope=openid&redirect_uri=https://<generated id>.cloudfront.net/callback
```

### Create an user
The app does not include a sign in page yet, so need to manually create an user for testing

Create a sample user, please replace `<Pool Id from above>`, `<an alpha numeric username>` and `<valid user email>` placeholders
```
aws cognito-idp admin-create-user --user-pool-id <Pool Id from above> --username '<an alpha numeric username>' --user-attributes Name=email,Value=<valid user email>
```

One will receive a temporary credential from above, note the credential for later use

### Set up the static site
In `sites/js/app.js`

Replace
```
var signInUrl = '<Lauch Hosted UI url from above>';
var apiEndpointUrl = '<API Gateway Endpoint from above>';
```

### Copy the website static content to bucket

From main folder
```
cd sites
aws sync . s3://<website bucket from above>/
```

## Test the setup

Please go to  `Launch Hosted UI` from above

Then can use `update nickname` to update nickname

or `Choose File` and then click `Upload File` to upload a new image for asset

## Destroy/Clean Up
Please note all S3 contents (both website and content buckets), DynamoDB table, cognito user pools will be destroyed by default along with the stack
```
cdk destroy
```

