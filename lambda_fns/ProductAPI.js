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

const s3 = new AWS.S3({ "signatureVersion": "v4" });
const ProductDAO = require('./ProductDAO.js');
const SellerDAO = require('./ProductDAO.js');

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
    var userId = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.resource == "/products") {
      if (event.httpMethod === "GET") {

        // Get the query parameter lastEvaluatedId (if exist)
        var lastEvaluatedId = null;
        var createdBy = null;

        if (event.queryStringParameters) {
          if (event.queryStringParameters.lastEvaluatedId) {
            paginationTolastEvaluatedIdken = event.queryStringParameters.lastEvaluatedId;
          }
          if (event.queryStringParameters.createdBy) {
            createdBy = event.queryStringParameters.createdBy;
          }
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        // If createdBy present, will search products createdBy
        var response = await ProductDAO.getProducts(maxQuerySize, createdBy, lastEvaluatedId);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.resource == "/product/{productId}" || event.resource == "/product/{productId}/profileAsset/{profileAssetId}/presignedPost") {
      var { productId } = event.pathParameters;

      var product = await ProductDAO.getProduct(productId, false);

      if (!product) {
        return {
          // not found, return 404
          statusCode: 404,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify({ "error": "product not found" })
        };
      }

      if (event.resource == "/product/{productId}") {
        if (event.httpMethod === "GET") {

          product['sampleasset'] = await ProductDAO.getAssetObject(product.id, product.sampleasset);

          return {
            statusCode: 200,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify(product)
          };

        }
        // Update existing product
        else if (event.httpMethod === "PUT") {
          // Currently only user can modify its own product
          if (product.createdBy != userId) {
            return {
              statusCode: 403,
              headers: headers,
              body: JSON.stringify({ "error": "uauthorized" })
            };
          }

          var input = JSON.parse(event.body);

          // Check for input
          if (!input.name || !input.desciption || input.price || !isNaN(input.price)) {
            return {
              statusCode: 400,
              headers: headers,
              body: JSON.stringify({ "error": "invalid input" })
            };
          }

          // Update only description, price and name for now
          // Should need to do more regex clean up if needed
          product.name = input.name;
          product.desciption = input.desciption;
          product.price = input.price;

          // Update timestampe and revision
          product.lastModfiedTS = Date.now();
          product.revisionId = uuidv4();

          // Note, depend on use case, may want to back up this revision before update (like to S3 or another dynamo table) for audit reason etc

          // If exist, modify the target field
          product = await ProductDAO.createUpdateProduct(product, true);

          return {
            statusCode: 200,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify(product)
          };
        }
        else if (event.resource == "/product/{productId}/profileAsset/{profileAssetId}/presignedPost") {
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

            if (profileAssetId != ProductDAO.defaultProductAudio && profileAssetId != ProductDAO.defaultProductPicture) {
              return {
                statusCode: 404,
                headers: headers,
                body: "Resource not found"
              };
            }

            var presignedPost = await ProductDAO.createAssetPresignedPost(product.id, profileAssetId);

            return {
              statusCode: 200,
              headers: headers,
              body: JSON.stringify(presignedPost)
            };
          }
        }
      }
      // Create a new product
      // This clause will only deal with specific user modification
      else if (event.resource == "/product") {
        if (event.httpMethod === "POST") {

          var seller = await SellerDAO.getSeller(userId);

          // Currently only seller can create its own product
          if (seller) {
            return {
              statusCode: 403,
              headers: headers,
              body: JSON.stringify({ "error": "uauthorized" })
            };
          }

          var input = JSON.parse(event.body);

          // Check for input
          if (!input.name || !input.desciption || input.price || !isNaN(input.price)) {
            return {
              statusCode: 400,
              headers: headers,
              body: JSON.stringify({ "error": "invalid input" })
            };
          }

          // Update only description and name for now
          // Should need to do more regex clean up if needed
          var newProduct = {
            "id": uuidv4(),
            "name": input.name,
            "desciption": input.desciption,
            "revisionId": uuidv4(),
            "price": parseFloat(input.price),
            "sampleasset": "asset.png",
            "lastModfiedTS": Date.now(),
            "createdTS": Date.now(),
            "createdBy": userId,
            "status": 'ACTIVATED'
          };

          // In this case, as productId is primary key of dynamoDB, so dynamoDB will error out if the key is already used
          var product = await createUpdateProduct(newProduct, true);

          return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(product)
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
