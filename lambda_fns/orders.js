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
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

// Set to allow cors origin
const headers = {
  "Access-Control-Allow-Headers": 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "OPTIONS,GET,PUT,POST",
  "Access-Control-Allow-Credentials": true
};

// Limit the query size at one time to reduce load on system
var maxQuerySize = 10;

// Reference from https://docs.aws.amazon.com/cdk/v2/guide/resources.html
exports.handler = async function (event, context) {
  try {
    // Get user info from request context (it will be present as it passed the API Gateway's authorizer)
    var tokenUserId = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.resource == "/users") {
      if (event.httpMethod === "GET") {
        // Get the query parameter lastEvaluatedId (if exist)
        var paginationToken = null;
        
        if(event.queryStringParameters && event.queryStringParameters.paginationToken)
        {
          paginationToken = event.queryStringParameters.paginationToken;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        var response = await getUsers(maxQuerySize, paginationToken);

        // Loop through all items to add asset download link
        for (var index = 0; index < response.users.length; index++) {

          // In get all query, will not send presignedurl for asset upload, only get, so third query is always false
          response.users[index].asset = await getAssetObject(response.users[index].userId, 'image.png', false);
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
    else if (event.resource == "/user/{userId}") {

      const { userId } = event.pathParameters;

      var user = await getUser(userId);

      if (!user) {
        return {
          statusCode: 404,
          headers: headers,
          body: JSON.stringify(userId)
        };
      }

      if (event.httpMethod === "GET") {
        // Get Asset link
        // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
        // Inject a new asset field
        user.asset = await getAssetObject(user.id, 'image.png', user.id == tokenUserId);

        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify(user)
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
 * Get all users
 * @param {*} username The input username to be searched 
 * @returns a user object if username found, if not found will return undefined
 */
var getUsers = async function (pageSize, paginationToken) {
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CognitoIdentityServiceProvider.html#listUsers-property
  var params = {
    UserPoolId: process.env.COGNITO_POOL_ID,
    Limit: pageSize,
  };

  if (paginationToken) {
    params.PaginationToken = paginationToken;
  }

  var response = await cognitoidentityserviceprovider.listUsers(params).promise();
  var responseUsers = [];
  var paginationToken = null;
  
      console.log(JSON.stringify(response));
  if (response && response.Users) {



    // Message to not return too much info for each user
    for (var index = 0; index < response.Users.length; index++) {

      // Loop through array of map to find given attributes
      var nickname = null;
      var profile = null;
      response.Users[index].Attributes.forEach(element => {
        if (element.Name == 'nickname') {
          nickname = element.Value;
        }
        else if (element.Name == 'profile') {
          profile = element.Value;
        }
      });

      responseUsers.push({
        userId: response.Users[index].Username,
        userCreateDate: response.Users[index].UserCreateDate,
        nickname: nickname,
        profile: profile,
      })

      paginationToken = response.PaginationToken;
    }
  }
  
      return {
      users: responseUsers,
      paginationToken: paginationToken
    };
}

/**
 * Get a record based on input userId
 * @param {*} userId The input userId to be searched 
 * @returns a user object if username found, if not found will return undefined
 */
var getUser = async function (userId) {
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CognitoIdentityServiceProvider.html#getUser-property
  var params = {
    UserPoolId: process.env.COGNITO_POOL_ID,
    Username: userId
  };

  var user = await cognitoidentityserviceprovider.adminGetUser(params).promise();

  if (user) {
    // Clean up the user attribute to limit return fields
    // Loop through array of map to find given attributes
    var nickname = null;
    var profile = null;
    user.UserAttributes.forEach(element => {
      if (element.Name == 'nickname') {
        nickname = element.Value;
      }
      else if (element.Name == 'profile') {
        profile = element.Value;
      }
    });

    return {
      userId: user.Username,
      nickname: nickname,
      profile: profile,
      userCreateDate: user.UserCreateDate
    }
  }

  return null;
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
    prefix: '/users/' + username + '/' + asset
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