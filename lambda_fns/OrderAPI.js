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
const { v4: uuidv4 } = require('uuid');
const OrderDAO = require('./OrderDAO.js');

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
    var userId = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.path == "/orders") {
      if (event.httpMethod === "GET") {

        // Get the query parameter lastEvaluatedId (if exist)
        var lastEvaluatedId = null;

        if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
          paginationTolastEvaluatedIdken = event.queryStringParameters.lastEvaluatedId;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        var response = await OrderDAO.getOrders(maxQuerySize, userId, lastEvaluatedId);

        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.resource = "/order/{orderId}") {
      const { orderId } = event.pathParameters;

      var order = await OrderDAO.getOrder(orderId);

      // In this case, if record is not found, return 404
      // If record is found, but the requester is not the createdBy, then will also return 404 to keep the orderId secret
      if (!order || order.createdBy != userId) {
        return {
          // not found, return 404
          statusCode: 404,
          headers: headers,
          body: JSON.stringify({ "error": "order not found" })
        };
      }

      if (event.httpMethod === "GET") {
        return {
          statusCode: 200,
          headers: headers,
          body: JSON.stringify(order)
        };
      }

      // Update existing product
      else if (event.httpMethod === "PUT") {
        var input = JSON.parse(event.body);

        // Update only comment for now
        // Should need to do more regex clean up if needed
        order.comment = input.comment;

        // May want to update existing order to some where for audit purpose if needed
        order.lastModfiedTS = Date.now();
        order.revision = uuidv4();

        // If exist, modify the target field
        order = await OrderDAO.createUpdateOrder(order);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(order)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.resource = "/order") {
      // Create a new order
      if (event.httpMethod === "POST") {
        var input = JSON.parse(event.body);


        // If product no longer exist, reject the order
        if (!input.productId || !input.comment) {
          return {
            // not found, return 404
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ "error": "order must include product Id and comment" })
          };
        }

        // Check if the given product exist
        var product = OrderDAO.getProduct(input.productId);

        // If product no longer exist, reject the order
        if (!product) {
          return {
            // not found, return 404
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ "error": "invalid product Id" })
          };
        }

        // Update only description and name for now
        // Should need to do more regex clean up if needed
        var newOrder = {
          "id": uuidv4(),
          "comment": input.comment,
          "productId": product.id,
          "productRevisionId": product.revisionId,
          "price": product.price,
          "createdBy": userId,
          "soldBy": product.createdBy,
          "revision": uuidv4(),
          "lastModfiedTS": Date.now(),
          "createdTS": Date.now(),
          "status": "PREPARED",
        };

        // In this case, as orderId is primary key of dynamoDB, so dynamoDB will error out if the key is already used
        var order = await OrderDAO.createUpdateOrder(newOrder);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(order)
        };
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
};
