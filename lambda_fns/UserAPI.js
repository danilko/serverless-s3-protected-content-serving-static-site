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

const {v4: uuidv4} = require('uuid');

const UserDAO = require('./UserDAO.js')

// Set to allow cors origin
const headers = {
  "Access-Control-Allow-Headers": 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "OPTIONS,GET,PUT,POST,DELETE",
  "Access-Control-Allow-Credentials": true
};

// Limit the query size at one time to reduce load on system
var maxQuerySize = 5;

// Reference from https://docs.aws.amazon.com/cdk/v2/guide/resources.html
exports.handler = async function (event, context) {
  try {
    // Get user info from request context (it will be present as it passed the API Gateway's authorizer)
    let tokenUserId = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.resource === "/users") {
      if (event.httpMethod === "GET") {
        // Get the query parameter lastEvaluatedId (if exist)
        let lastEvaluatedId = null;

        if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
          lastEvaluatedId = event.queryStringParameters.lastEvaluatedId;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        const response = await UserDAO.getUsers(maxQuerySize, lastEvaluatedId, true);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }

    // all API from this point should contain following
    if (!event.resource.startsWith("/user/{userId}")) {
      // Not met any condition
      return {
        statusCode: 400,
        headers: headers,
        body: "No such method"
      };
    }

    const {userId} = event.pathParameters;

    let generatedUserProfileAsset = (event.resource === "/user/{userId}" && event.httpMethod === "GET");

    // No generation of asset link for fast retriving
    let user = await UserDAO.getUser(userId, generatedUserProfileAsset);

    if (!user) {
      // If token from cognito === target user, then this is likely first time this user login
      // Set it up with default data
      if (tokenUserId === userId) {
        // Attempt to init user profile
        var newUser = {
          id: userId,
          "nickname": "default nickname",
          "profile": "default profile",
          "lastModfiedTS": Date.now(),
          "createdTS": Date.now(),
          "status": "ACTIVATED"
        }
        // create default user info
        user = await UserDAO.createUpdateUser(newUser, generatedUserProfileAsset);
      } else {
        return {
          statusCode: 404,
          headers: headers,
          body: JSON.stringify({"error": "user with given userId not found"})
        };
      }
    }

    if (event.resource === "/user/{userId}") {
      if (event.httpMethod === "GET") {
        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify(user)
        };
      } else if (event.httpMethod === "PUT") {

        const input = JSON.parse(event.body);

        // check if empty or undefined, can add other check as needed
        if (!input.nickname || input.nickname === "" || !input.profile) {
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
        user = await UserDAO.createUpdateUser(user, true);

        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify(user)
        };
      }
    }

    if (event.resource === "/user/{userId}/assets") {
      // Get the query parameter lastEvaluatedId (if exist)
      let lastEvaluatedId = null;

      if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
        lastEvaluatedId = event.queryStringParameters.lastEvaluatedId;
      }

      // Limit to 10 records for now
      // If lastEvaluatedId is not present, will get the first pagination
      // Otherwise use the lastEvaluatedId field to try processing pagination
      var response = await UserDAO.getUserAssets(user.id, maxQuerySize, lastEvaluatedId, true);

      return {
        statusCode: 200,
        // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
        headers: headers,
        body: JSON.stringify(response)
      };
    }

    if (event.resource === "/user/{userId}/asset/{assetId}") {
      const {assetId} = event.pathParameters;

      // only generate content if is GET request
      const response = await UserDAO.getUserAsset(user.id, assetId, event.httpMethod === "GET");

      if(response) {

        // if delete, perform a deletion
        if(event.httpMethod === "DELETE") {
          await UserDAO.deleteUserAsset(user.id, assetId);
        }

          return {
            statusCode: 200,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify(response)
          };
      }
      else {
        return {
          statusCode: 404,
          headers: headers
        };
      }
    }

    if (event.resource === "/user/{userId}/asset/presignedPost" || event.resource === "/user/{userId}/asset/{assetId}/presignedPost") {

      let inputAssetId = uuidv4();
      if (event.resource === "/user/{userId}/asset/{assetId}/presignedPost") {
        const {assetId} = event.pathParameters;
        inputAssetId = assetId;
        // check if previous asset exist, otherwise return 404
        if(!(await UserDAO.getUserAsset(userId, assetId, false))) {
          return {
            statusCode: 404,
            headers: headers
          };
        }
      }
      else {
        // ensure the uuid is not used under the current one
        while(UserDAO.getUserAsset(userId, inputAssetId, false)) {
          inputAssetId = uuidv4();
        }
      }

      const response = await UserDAO.createUpdateUserAsset(userId, inputAssetId, true);
      if(response) {
        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }

    // Not met any condition
    return {
      statusCode: 400,
      headers: headers,
      body: "No such method"
    };
  } catch
    (error) {
    var body = error.stack || JSON.stringify(error, null, 2);
    return {
      statusCode: 400,
      headers: headers,
      body: JSON.stringify(body)
    }
  }
}

