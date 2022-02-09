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

const profilePicture = "profilePicture.png";

// Limit the query size at one time to reduce load on system
var maxQuerySize = 5;

// Reference from https://docs.aws.amazon.com/cdk/v2/guide/resources.html
exports.handler = async function (event, context) {
  try {
    // Get user info from request context (it will be present as it passed the API Gateway's authorizer)
    var tokenUserId = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.resource == "/users") {
      if (event.httpMethod === "GET") {
        // Get the query parameter lastEvaluatedId (if exist)
        var lastEvaluatedId = null;

        if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
          lastEvaluatedId = event.queryStringParameters.lastEvaluatedId;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        var response = await getUsers(maxQuerySize, lastEvaluatedId, true);

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

      // No generation of asset link for fast retriving
      var user = await getUser(userId, false, false);

      if (!user) {
        // If token from cognito == target user, then this is likely first time this user login
        // Set it up with default data
        if (tokenUserId == userId) {
          // Attempt to init user profile
          var newUser = {
            id: userId,
            "nickname": "default nickname",
            "profile": "default profile",
          }
          // No generation of asset link to speed up creation as it will be updated based on below logic
          user = await createUpdateUser(newUser, false, false);
        }
        else
        {
          return {
            statusCode: 404,
            headers: headers,
            body: JSON.stringify({ "error": "user with given userId not found" })
          };
        }

      }

      if (event.httpMethod === "GET") {
        // Get Asset link
        // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
        // Inject a new asset field
        user.profilePicture = await getAssetObject(user.id, profilePicture, user.id == tokenUserId);

        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify(user)
        };
      }
      else if (event.httpMethod === "PUT") {
        // Only user can modify its own profile
        if (user.id != tokenUserId) {
          return {
            statusCode: 403,
            headers: headers,
            body: "Unauthorized"
          };
        }

        var input = JSON.parse(event.body);

        // check if empty or undefined, can add other check as needed
        if (!input.nickname || input.nickname == "" || !input.profile) {
          return {
            statusCode: 400,
            headers: headers,
            body: "Invalid format, nickname can only be alphanumeric"
          };
        }

        // Currently only allow to update following fields
        user.nickname = input.nickname;
        user.profile = input.profile;

        // Get latest user after modification
        // Generate S3 link for asset
        // The third paratmer determine whatever to generate upload link based on if the requester is the owner of the record
       user =  await createUpdateUser(user, true, user.id == tokenUserId);


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
 * Get all users based on input userId
 * @param {*} pageSize The maximum pageSize to return
 * @param {*} lastEvaluatedId The lastEvaluatedId to be used to continue to next page search
 * @param {*} userId The input userId to be searched 
 * @returns all orders for given userId
 */
var getUsers = async function (pageSize, lastEvaluatedId, generateAsset) {
  // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
  var params = {
    TableName: process.env.USER_PROFILE_TABLE,
    Limit: pageSize,
  };
  if (lastEvaluatedId) {
    params.ExclusiveStartKey = { item_id: lastEvaluatedId };
  }

  try {
    var response = await dynamoDB
      .scan(params)
      .promise();

    if (generateAsset) {
      // Loop through all items to add asset download link
      for (var index = 0; index < response.Items.length; index++) {
        // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
        // In get all query, will not send presignedurl for asset upload, only get, so third query is always false
        response.Items[index].profilePicture = await getAssetObject(response.Items[index].id, profilePicture, false);
      }
    }

    return {
      users: response.Items,
      lastEvaluatedId: response.LastEvaluatedKey
    };

  } catch (error) {
    throw error;
  }
}


/**
 * Get all users
 * @param {*} username The input username to be searched 
 * @param {*} generateAsset Boolean to determine if should generate link for S3 asset
 * @returns a user object if username found, if not found will return undefined
 */
var getUsersCognito = async function (pageSize, paginationToken, generateAsset) {
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
  var responsePaginationToken = null;

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

      var generatedUser = {
        id: response.Users[index].Username,
        userCreateDate: response.Users[index].UserCreateDate,
        nickname: nickname,
        profile: profile,
      };

      if (generateAsset) {
        // Get Asset link for profilePicture
        // The third field is always false as get all users will only provide view link, not upload
        generatedUser.profilePicture = await getAssetObject(generatedUser.id, profilePicture, false);
      }

      responseUsers.push(generatedUser);

      responsePaginationToken = response.PaginationToken ? response.PaginationToken : null;
    }
  }

  return {
    users: responseUsers,
    paginationToken: responsePaginationToken
  };
}

/**
 * Get a record based on input user's id field
 * @param {*} user The target user to be updated 
 */
var updateUserCognito = async function (user) {
  var params = {
    UserAttributes: [
      {
        Name: 'nickname',
        Value: user.nickname,
      },
      {
        Name: 'profile',
        Value: user.profile
      }
    ],
    UserPoolId: process.env.COGNITO_POOL_ID,
    Username: user.id,
  };
  await cognitoidentityserviceprovider.adminUpdateUserAttributes(params).promise();
};

/**
 * Get a record based on input id
 * @param {*} id The input user's id to be searched 
 * @param {*} generateAsset Boolean to determine if should generate link for S3 asset
 * @param {*} generateAssetUpload Boolean to determine if should generate upload link for S3 asset
 * @returns a user object if username found, if not found will return undefined
 */
var getUser = async function (userId, generateAsset, generateAssetUpload) {
  var userRecord = await dynamoDB
    .get({
      TableName: process.env.USER_PROFILE_TABLE,
      Key: {
        "id": userId
      }
    })
    .promise();

  if (userRecord.Item && generateAsset) {
    // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
    // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
    userRecord.Item.profilePicture = await getAssetObject(userRecord.Item.id, profilePicture, generateAssetUpload);
  }

  return userRecord.Item;
};

/**
 * Get a record based on input id
 * @param {*} id The input user's id to be searched 
 * @param {*} generateAsset Boolean to determine if should generate link for S3 asset
 * @param {*} generateAssetUpload Boolean to determine if should generate upload link for S3 asset
 * @returns a user object if username found, if not found will return undefined
 */
var getUserCognito = async function (id, generateAsset, generateAssetUpload) {
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CognitoIdentityServiceProvider.html#getUser-property
  var params = {
    UserPoolId: process.env.COGNITO_POOL_ID,
    Username: id
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

    var generatedUser = {
      id: user.Username,
      nickname: nickname,
      profile: profile,
      userCreateDate: user.UserCreateDate
    };

    if (generateAsset) {
      // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
      // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
      generatedUser.profilePicture = await getAssetObject(generatedUser.id, profilePicture, generateAssetUpload);
    }

    return generatedUser;
  }

  return null;
};

/**
 * Modify or create a user record base on username
 * @param {*} username Target username to be modified
 * @param {*} nickname nickname field for target username to be modified
 * @param {*} generateAsset whatever to generate the download link
 * @returns record
 */
var createUpdateUser = async function (user, generateAsset, generateAssetUpload) {
  // update dynamodb with default values
  var userRecord = await dynamoDB
    .update({
      TableName: process.env.USER_PROFILE_TABLE,
      Key: {
        "id": user.id
      },
      UpdateExpression: "set #nickname = :nickname, #profile = :profile",
      ExpressionAttributeNames: {
        "#nickname": "nickname",
        "#profile": "profile"
      },
      ExpressionAttributeValues: {
        ":nickname": user.nickname,
        ":profile": user.profile
      },
      ReturnValues: "ALL_NEW"
    }).promise();

  // Item return in here will be Attributes, not field
  // {"Attributes": {//fields}}

  if (generateAsset) {
    // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
    // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
    userRecord.Attributes.profilePicture = await getAssetObject(user.id, profilePicture, generateAssetUpload);
  }

  return userRecord.Attributes;
};


/**
 * Create an asset object assoicated with input target asset with getSignedUrl and preSignedPost base on input
 * {
    prefix: '/' + id + '/' + asset,
    getSignedUrl : null,
    preSignedPost: null
  };
 * @param {*} id user's id for target asset to be retrieved/modified
 * @param {*} assetSuffix Target assetSuffix to be retrieved/modified
 * @param {*} preSignedPost Boolean with true to create PreSignedPost, false to set as null
 * @returns an asset object 
 * 
 */
var getAssetObject = async function (id, assetSuffix, preSignedPost) {

  var asset = {
    prefix: '/users/' + id + '/' + assetSuffix
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
        // content length restrictions: 0-5KB]
        ['content-length-range', 0, 500000]]
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