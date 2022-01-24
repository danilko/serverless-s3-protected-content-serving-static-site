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
    // Get user info from request context (it will be present as it passed the API Gateway's authorizer)
    var username = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.path == "/users") {
      if (event.httpMethod === "GET") {

        // Get the query parameter lastEvaluatedId (if exist)
        var lastEvaluatedId = null;

        if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
          lastEvaluatedId = event.queryStringParameters.lastEvaluatedId;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        var response = await getUsers(10, lastEvaluatedId);

        // Loop through all items to add asset download link
        for (var index = 0; index < response.items.length; index++) {
          // In get all query, will not send presignedurl for asset upload, only get, so third query is always false
          response.items[index].asset = await getAssetObject(response.items[index].userId, response.items[index].asset, false);
        }

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.path.indexOf("/user/" === 0)) {
      var targetModifiedUserId = event.path.replace("/user/", "").toLowerCase();

      if (event.httpMethod === "GET") {
        // If target field is empty, current logic assume it means to use current user
        if (targetModifiedUserId == "") {
          targetModifiedUserId = username;
        }

        var record = await getUser(targetModifiedUserId);

        // This record does not exist, but the token did exist, and is looking for this user
        // This is likely first time user visist site
        if (!record && targetModifiedUserId == username) {
          // Create a record as this user does not exist before (this logic may be replaced in future through sign up logic)
          record = createUpdateUser(username, "default", "user.png");
        }

        // Get Asset link
        // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
        // Inject a new asset field
        record.asset = await getAssetObject(username, record.asset, username == targetModifiedUserId);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
        };

      }
      else if (event.httpMethod === "PUT") {
        // Currently only user can modify its own profile
        if (targetModifiedUserId != username) {
          return {
            statusCode: 403,
            headers: headers,
            body: "Unauthorized"
          };
        }

        var input = JSON.parse(event.body);

        // check if empty or undefined, can add other check as needed
        if (input.nickname === "") {
          return {
            statusCode: 400,
            headers: headers,
            body: "Invalid format, nickname can only be alphanumeric"
          };
        }

        // Check if such record exist
        var record = await getUser(username);

        // If record is invalid, return 404 as user not found
        if (!record) {
          return {
            statusCode: 404,
            headers: headers,
            body: "Invalid user"
          };
        }

        // If exist, modify the target field
        record = await createUpdateUser(record.userId, input.nickname, record.asset);

        // Get Asset link
        // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
        // Inject a new asset field
        record.asset = await getAssetObject(record.userId, record.asset, record.userId == targetModifiedUserId);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
        };
      }
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

/**
 * Get a record based on input username
 * @param {*} username The input username to be searched 
 * @returns a user object if username found, if not found will return undefined
 */
var getUsers = async function (pageSize, lastEvaluatedId) {
  // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
  var params = {
    TableName: process.env.USER_TABLE,
    Limit: pageSize
  };
  if (lastEvaluatedId) {
    params.ExclusiveStartKey = { item_id: lastEvaluatedId };
  }

  try {
    var response = await dynamoDB
      .scan(params)
      .promise();

    return {
      items: response.Items,
      lastEvaluatedId: response.LastEvaluatedKey
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Get a record based on input username
 * @param {*} username The input username to be searched 
 * @returns a user object if username found, if not found will return undefined
 */
var getUser = async function (username) {
  let userRecord = await dynamoDB
    .get({
      TableName: process.env.USER_TABLE,
      Key: {
        "userId": username
      }
    })
    .promise();

  return userRecord.Item;
};

/**
 * Modify or create a user record base on username
 * @param {*} username Target username to be modified
 * @param {*} nickname nickname field for target username to be modified
 * @param {*} asset asset field for target username to be modified
 * @returns record
 */
var createUpdateUser = async function (username, nickname, asset) {
  // update dynamodb with default values
  var userRecord = await dynamoDB
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
        ":nickname": nickname,
        ":asset": asset
      },
      ReturnValues: "ALL_NEW"
    }).promise();

  // Item return in here will be Attributes, not field
  // {"Attributes": {//fields}}
  return userRecord.Attributes;
};

/**
 * Create an asset object assoicated with input target asset with getSignedUrl and preSignedPost base on input
 * {
    prefix: '/' + username + '/' + asset,
    getSignedUrl : null,
    preSignedPost: null
  };
 * @param {*} username Username for target asset to be retrieved/modified
 * @param {*} asset Target asset to be retrieved/modified
 * @param {*} preSignedPost Boolean with true to create PreSignedPost, false to set as null
 * @returns an asset object 
 * 
 */
var getAssetObject = async function (username, asset, preSignedPost) {

  var asset = {
    prefix: '/' + username + '/' + asset
  };

  // set to a fix time, current is 10 min
  var params = {
    Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),
    Key: asset.prefix,
    Expires: 600
  };

  // retrieve the url
  // set the expiration to 5 min, it will not be longer than the sts token
  // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
  asset.getSignedUrl = await s3.getSignedUrlPromise('getObject', params).catch((err) => asset.getSignedUrl = null);

  // Check if need to generate the post signed url for allowing to upload
  if (preSignedPost) {
    params = {
      Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),

      Fields: {
        Key: asset.prefix,
      },
      Expires: 600,
      Conditions: [
        // content length restrictions: 0-1MB]
        ['content-length-range', 0, 1000000]]
    };

    await s3.createPresignedPost(params, function (err, data) {
      if (err) {
        console.error('Presigning post data encountered an error', err);
      } else {
        asset.preSignedPost = data;
      }
    });
  }

  return asset;
}