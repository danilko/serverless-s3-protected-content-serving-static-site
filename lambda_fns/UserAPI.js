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

const UserDAO = require('./UserDAO.js')

// Set to allow cors origin
const headers = {
  "Access-Control-Allow-Headers": 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "OPTIONS,GET,PUT,POST",
  "Access-Control-Allow-Credentials": true
};

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
        var response = await UserDAO.getUsers(maxQuerySize, lastEvaluatedId, true);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.resource == "/user/{userId}" || event.resource == "/user/{userId}/profileAsset/{profileAssetId}/presignedPost") {

      const { userId } = event.pathParameters;

      // No generation of asset link for fast retriving
      var user = await UserDAO.getUser(userId, false);

      if (!user) {
        // If token from cognito == target user, then this is likely first time this user login
        // Set it up with default data
        if (tokenUserId == userId) {
          // Attempt to init user profile
          var newUser = {
            id: userId,
            "nickname": "default nickname",
            "profile": "default profile",
            "lastModfiedTS": Date.now(),
            "createdTS": Date.now(),
            "status": "ACTIVATED"
          }
          // No generation of asset link to speed up creation as it will be updated based on below logic
          user = await UserDAO.createUpdateUser(newUser, false);
        }
        else {
          return {
            statusCode: 404,
            headers: headers,
            body: JSON.stringify({ "error": "user with given userId not found" })
          };
        }

      }

      if (event.resource == "/user/{userId}") {
        if (event.httpMethod === "GET") {
          // Get Asset link
          // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
          // Inject a new asset field
          user.profilePicture = await UserDAO.createAssetGetSignedUrl(user.id, UserDAO.profilePicture);

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
          user = await UserDAO.createUpdateUser(user, true);


          return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(user)
          };
        }
      }
      else if (event.resource == "/user/{userId}/profileAsset/{profileAssetId}/presignedPost") {
        const { profileAssetId } = event.pathParameters;

        if (event.httpMethod === "POST") {
          // Only user can modify its own profile
          if (user.id != tokenUserId) {
            return {
              statusCode: 403,
              headers: headers,
              body: "Unauthorized"
            };
          }

          if (profileAssetId != UserDAO.defaultProfilePicture) {
            return {
              statusCode: 404,
              headers: headers,
              body: "Resource not found"
            };
          }

          var presignedPost = await UserDAO.createAssetPresignedPost(user.id, UserDAO.profilePicture);

          return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(presignedPost)
          };
        }
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

