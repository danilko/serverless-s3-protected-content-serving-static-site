/* 
This code uses callbacks to handle asynchronous function responses.
It currently demonstrates using an async-await pattern. 
AWS supports both the async-await and promises patterns.
For more information, see the following: 
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises
https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/calling-services-asynchronously.html
https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html 
*/
const AWS = require('aws-sdk');
const STS = new AWS.STS();
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3({ "signatureVersion": "v4" });

// Set to allow cors origin
const headers = {
  "Access-Control-Allow-Headers": 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "OPTIONS,GET,PUT",
  "Access-Control-Allow-Credentials": true
};


// Reference from https://docs.aws.amazon.com/cdk/v2/guide/resources.html
exports.handler = async function (event, context) {


  try {

    var targetModifiedUserId = event.path.replace("/user/", "").toLowerCase();

    // Get user info from request context (it will be present as it passed the API Gateway's authorizer)
    var username = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();



    if (event.httpMethod === "GET") {

      let userRecord = await dynamoDB
        .get({
          TableName: process.env.USER_TABLE,
          Key: {
            "userId": username
          }
        })
        .promise();


      var record = null;

      // Such user not exist, create it
      if (userRecord.Item == undefined) {
        // update dynamodb with default values
        userRecord = await dynamoDB
          .update({
            TableName: process.env.USER_TABLE,
            Key: {
              "userId": username
            },
            UpdateExpression: "set #nickname = :nickname, #asset = :asset",
            ExpressionAttributeNames: {
              "#nickname": "nickname",
              "#asset": "asset"
            },
            ExpressionAttributeValues: {
              ":nickname": username,
              ":asset": "user.png"
            },
            ReturnValues: "ALL_NEW"
          }).promise();

        // Item return in here will be
        // {"Attributes": {//fields}}
        record = userRecord.Attributes;
      }
      else {
        // if the item is from get, then it will have no attribute field
        //  { "Item" : {//fields}}
        record = userRecord.Item;
      }

      // set to a fix time, current is 10 min
      var params = {
        Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),
        Key: '/' + username + '/' + record.asset,
        Expires: 600
      };

      // retrieve the url
      // set the expiration to 5 min, it will not be longer than the sts token
      // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
      var getSignedUrl = await s3.getSignedUrlPromise('getObject', params).catch((err) => getSignedUrl = null);

      params = {
        Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),

        Fields: {
          key: '/' + username + '/' + record.asset,
        },
        Expires: 600,
        Conditions: [
          // content length restrictions: 0-1MB]
          ['content-length-range', 0, 1000000]]
      };


      var postSignedUrl = null;

      // Currently only user can see or modify its own profile
      if (targetModifiedUserId === username) {
        await s3.createPresignedPost(params, function (err, data) {
          if (err) {
            console.error('Presigning post data encountered an error', err);
          } else {
            postSignedUrl = data;
          }
        });
      }



      // Message the data into json for frontend
      var responseBody = {
        userId: record.userId,
        nickname: record.nickname,
        asset: {
          id: record.asset,
          getSignedUrl: getSignedUrl,
          postSignedUrl: postSignedUrl
        }
      }

      return {
        statusCode: 200,
        // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
        headers: headers,
        body: JSON.stringify(responseBody)
      };

    }

    if (event.httpMethod === "PUT") {

      // Currently only user can see or modify its own profile
      if (targetModifiedUserId != username) {
        return {
          statusCode: 401,
          headers: headers,
          body: "Unauthorized"
        };
      }

      var input = JSON.parse(event.body)

      // check if empty or undefined, can add other check as needed
      if (input.nickname === "") {
        return {
          statusCode: 400,
          headers: headers,
          body: "Invalid format, nickname can only be alphanumeric"
        };
      }
      // update dynamodb
      var userRecord = await dynamoDB
        .update({
          TableName: process.env.USER_TABLE,
          Key: {
            "userId": username
          },
          UpdateExpression: "set #nickname = :nickname",
          ExpressionAttributeNames: {
            "#nickname": "nickname"
          },
          ExpressionAttributeValues: {
            ":nickname": input.nickname
          },
          ReturnValues: "ALL_NEW"
        }).promise();

      // Item return in here will be
      // { "Attributes": {//fields}}
      var record = userRecord.Attributes;

      // Message the data into json for frontend
      var responseBody = {
        userId: record.userId,
        nickname: record.nickname,
        asset: {
          id: record.asset,
          getSignedUrl: null,
          postSignedUrl: null
        }
      };

      return {
        statusCode: 200,
        // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
        headers: headers,
        body: JSON.stringify(responseBody)
      };
    }


    // We only accept PUT and GET for now
    return {
      statusCode: 400,
      headers: headers,
      body: "No such method"
    };
  } catch (error) {
    var body = error.stack || JSON.stringify(error, null, 2);
    return {
      statusCode: 400,
      headers: headers,
      body: JSON.stringify(body)
    }
  }
}