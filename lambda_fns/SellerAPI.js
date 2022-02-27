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
const SellerDAO = require('./SellerDAO.js')

// Set to allow cors origin
const headers = {
    "Access-Control-Allow-Headers": 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "OPTIONS,GET,PUT,POST",
    "Access-Control-Allow-Credentials": true
};

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
                var response = await SellerDAO.getSellers(maxQuerySize, lastEvaluatedId, true);

                return {
                    statusCode: 200,
                    // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
                    headers: headers,
                    body: JSON.stringify(response)
                };
            }
        }
        else if (event.resource == "/seller") {
            // No generation of asset link for fast retriving
            var seller = await SellerDAO.getSeller(tokenUserId, false);

            if (seller) {
                return {
                    statusCode: 403,
                    headers: headers,
                    body: JSON.stringify({ "error": "Seller already exist, cannot be created again" })
                };
            }

            // Check if user is onboarded (for now, this check should always be true as onboarded process is autmoatically, but in future, in case need further verification, will reject it)
            var user = await UserDAO.getUser(tokenUserId, false);

            if (!user) {
                return {
                    statusCode: 403,
                    headers: headers,
                    body: JSON.stringify({ "error": "User is not verified, so cannot be activated as seller" })
                };
            }

            // Check for input
            if (!input.name || !input.desciption || input.price || !isNaN(input.price)) {
                return {
                    statusCode: 400,
                    headers: headers,
                    body: JSON.stringify({ "error": "invalid input" })
                };
            }

            // Default activated the account, but later may add other verification process
            var newSeller = {
                "id": user.id,
                "nickname": user.nickname,
                "description": "Default description",
                "createdTS": Date.now(),
                "lastModfiedTS": Date.now(),
                "status": 'ACTIVATED'
            };

            // Get latest user after modification
            // Generate S3 link for asset
            seller = await SellerDAO.createUpdateSeller(seller, true);

            return {
                statusCode: 200,
                headers: headers,
                body: JSON.stringify(seller)
            };
        }
        // This clause will only deal with specific user modification
        else if (event.resource == "/seller/{sellerId}" || event.resource == "/seller/{sellerId}/profileAsset/{profileAssetId}/presignedPost") {

            const { sellerId } = event.pathParameters;

            // No generation of asset link for fast retriving
            var seller = await SellerDAO.getSeller(sellerId, false);

            if (!seller) {
                return {
                    statusCode: 404,
                    headers: headers,
                    body: "Not Found"
                };
            }

            if (event.resource == "/seller/{sellerId}") {
                if (event.httpMethod === "GET") {
                    // Get Asset link
                    // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
                    // Inject a new asset field
                    seller.profilePicture = await SellerDAO.createAssetGetSignedUrl(seller.id, SellerDAO.defaultProfilePicture);
                    seller.profileAudio = await SellerDAO.createAssetGetSignedUrl(seller.id, SellerDAO.defaultProfileAudio);

                    return {
                        statusCode: 200,
                        headers: headers,
                        body: JSON.stringify(user)
                    };
                }
                else if (event.httpMethod === "PUT") {
                    // Only user can modify its own profile
                    if (seller.id != tokenUserId) {
                        return {
                            statusCode: 403,
                            headers: headers,
                            body: JSON.stringify({ "error": "unauthorized" })
                        };
                    }

                    var input = JSON.parse(event.body);

                    // check if empty or undefined, can add other check as needed
                    if (!input.description || input.description == "" || !input.profile) {
                        return {
                            statusCode: 400,
                            headers: headers,
                            body: JSON.stringify({ "error": "invalid input paramter" })
                        };
                    }

                    // Currently only allow to update following fields
                    seller.description = input.description;
                    seller.lastModfiedTS = Date.now();

                    // Get latest user after modification
                    // Generate S3 link for asset
                    seller = await SellerDAO.createUpdateSeller(seller, true);

                    return {
                        statusCode: 200,
                        headers: headers,
                        body: JSON.stringify(seller)
                    };
                }
            }
            else if (event.resource == "/seller/{sellerId}/profileAsset/{profileAssetId}/presignedPost") {
                var { profileAssetId } = event.pathParameters;

                if (event.httpMethod === "POST") {
                    // Only user can modify its own profile
                    if (sellerId != tokenUserId) {
                        return {
                            statusCode: 403,
                            headers: headers,
                            body: "Unauthorized"
                        };
                    }

                    if (profileAssetId != SellerDAO.defaultProfileAudio && profileAssetId != UserDAO.defaultProfilePicture) {
                        return {
                            statusCode: 404,
                            headers: headers,
                            body: "Resource not found"
                        };
                    }

                    var presignedPost = await SellerDAO.createAssetPresignedPost(user.id, profileAssetId);

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

