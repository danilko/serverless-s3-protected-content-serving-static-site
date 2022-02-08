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
const dynamoDB = new AWS.DynamoDB.DocumentClient();

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
        var response = await getOrders(maxQuerySize, userId, lastEvaluatedId);

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

      var order = await getOrder(orderId);

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
        order.revision = uuid();

        // If exist, modify the target field
        order = await createUpdateOrder(order);

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
        var product = getProduct(input.productId);

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
          "id": uuid(),
          "comment": input.comment,
          "productId": product.id,
          "productRevisionId": product.revisionId,
          "price": product.price,
          "createdBy": userId,
          "soldBy": product.createdBy,
          "revision": uuid(),
          "lastModfiedTS": Date.now(),
          "createdTS": Date.now(),
          "status": "PREPARED",
        };

        // In this case, as orderId is primary key of dynamoDB, so dynamoDB will error out if the key is already used
        var order = await createUpdateOrder(newOrder);

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
}

/**
 * Get a record based on input productId
 * @param {*} productUUID The input productId to be searched 
 * @returns a product object if productId found, if not found will return undefined
 */
var getProduct = async function (productId) {
  let productRecord = await dynamoDB
    .get({
      TableName: process.env.PRODUCT_TABLE,
      Key: {
        "uuid": productId
      }
    })
    .promise();

  return productRecord.Item;
};

/**
 * Get all orders based on input userId
 * @param {*} pageSize The maximum pageSize to return
 * @param {*} lastEvaluatedId The lastEvaluatedId to be used to continue to next page search
 * @param {*} userId The input userId to be searched 
 * @returns all orders for given userId
 */
var getOrders = async function (pageSize, userId, lastEvaluatedId) {
  // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
  var params = {
    TableName: process.env.ORDER_TABLE,
    Limit: pageSize,
    KeyConditionExpression: "#createdBy = :userId or #soldBy = :userId",
    ExpressionAttributeNames: {
      "#createdBy": "createdBy",
      "#soldBy": "soldBy"
    },
    ExpressionAttributeValues: {
      ":userId": userId
    }
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
 * Get a record based on input productId
 * @param {*} orderId The input productId to be searched 
 * @returns a product object if orderId found, if not found will return undefined
 */
var getOrder = async function (orderId) {
  let productRecord = await dynamoDB
    .get({
      TableName: process.env.PRODUCT_TABLE,
      Key: {
        "id": orderId
      }
    })
    .promise();

  return productRecord.Item;
};

/**
 * Modify or create a order record 
 * @param {*} order Target order to be modified
 * @returns record
 */
var createUpdateOrder = async function (order) {
  // update dynamodb with default values
  var productRecord = await dynamoDB
    .update({
      TableName: process.env.ORDER_TABLE,
      Key: {
        "id": order.uuid
      },
      UpdateExpression: "set #comment := comment, #productId = :productId, #productRevisionId = :productRevisionId, #price = :price, #createdBy = :createdBy, #soldBy = :soldBy",
      ExpressionAttributeNames: {
        "#comment": "comment",
        "#productId": "productId",
        "#productRevisionId": "productRevisionId",
        "#price": "price",
        "#createdBy": "createdBy",
        "#soldBy": "soldBy",
        "#revision": "revision",
        "#lastModfiedTS": "lastModfiedTS",
        "#createdTS": "createdTS"
      },
      ExpressionAttributeValues: {
        ":comment": order.comment,
        ":productId": order.productId,
        ":productRevisionId": order.productRevisionId,
        ":price": parseFloat(order.price),
        ":createdBy": order.createdBy,
        ":soldBy": order.soldBy,
        ":revisionId": order.revisionId,
        ":lastModfiedTS": order.lastModfiedTS,
        ":createdTS": order.createdTS
      },
      ReturnValues: "ALL_NEW"
    }).promise();

  // Item return in here will be Attributes, not field
  // {"Attributes": {//fields}}
  return productRecord.Attributes;
};
