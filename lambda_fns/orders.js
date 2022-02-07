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
  "Access-Control-Allow-Methods": "OPTIONS,GET,PUT,POST",
  "Access-Control-Allow-Credentials": true
};

// Limit the query size at one time to reduce load on system
var maxQuerySize = 10;

// Reference from https://docs.aws.amazon.com/cdk/v2/guide/resources.html
exports.handler = async function (event, context) {
  try {
    // Get user info from request context (it will be present as it passed the API Gateway's authorizer)
    var username = event.requestContext.authorizer.claims['cognito:username'].toLowerCase();

    if (event.path == "/orders") {
      if (event.httpMethod === "GET") {

        // Get the query parameter lastEvaluatedId (if exist)
        var lastEvaluatedId = null;

        if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
          lastEvaluatedId = event.queryStringParameters.lastEvaluatedId;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        var response = await getOrders(maxQuerySize, username, lastEvaluatedId);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.path.indexOf("/order/" === 0)) {
      var targetOrderId = event.path.replace("/order/", "").toLowerCase();

      if (event.httpMethod === "GET") {
        var record = await getOrder(targetOrderId);

        if (!record) {
          return {
            // not found, return 404
            statusCode: 404,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify({"error": "order not found"})
          };
        }

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
        };

      }
      // Update existing product
      else if (event.httpMethod === "PUT") {
        var targetOrderId = event.path.replace("/order/", "").toLowerCase();

        var record = await getProduct(record.createdBy != username);

        // In this case, if record is not found, return 404
        // If record is found, but the requester is not the createdBy, then will also return 404 to keep the orderId secret
        if (!record || record.createdBy != username) {
          return {
            // not found, return 404
            statusCode: 404,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify({"error": "order not found"})
          };
        }

        var input = JSON.parse(event.body);

        // Update only comment for now
        // Should need to do more regex clean up if needed
        record.comment = input.comment;

        // May want to update existing order to some where for audit purpose if needed
        record.lastModfiedTS = Date.now();
        record.revision = uuid();

        // If exist, modify the target field
        record = await createUpdateOrder(record);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
        };
      }
      // Create a new order
      else if (event.httpMethod === "POST") {
        var input = JSON.parse(event.body);

        // Check if the given product exist
        var product = getProduct(input.productId);

        // If product no longer exist, reject the order
        if (!product) {
          return {
            // not found, return 404
            statusCode: 400,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify({})
          };
        }

        // Update only description and name for now
        // Should need to do more regex clean up if needed
        var newRecord = {
          "orderId": uuid(),
          "comment": input.comment,
          "price": product.price,
          "createdBy": username,
          "soldBy": product.createdBy,
          "lastModfiedTS": Date.now(),
          "createdTS": Date.now(),
          "revision": uuid(),
        };

        // In this case, as orderId is primary key of dynamoDB, so dynamoDB will error out if the key is already used
        record = await createUpdateOrder(newRecord);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
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
 * @param {*} username The input productId to be searched 
 * @returns a product object if username found, if not found will return undefined
 */
var getProduct = async function (productId) {
  let productRecord = await dynamoDB
    .get({
      TableName: process.env.PRODUCT_TABLE,
      Key: {
        "productId": productId
      }
    })
    .promise();

  return productRecord.Item;
};

/**
 * Get all orders based on input username
 * @param {*} username The input username to be searched 
 * @returns all users for given username
 */
var getOrders = async function (pageSize, username, lastEvaluatedId) {
  // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
  var params = {
    TableName: process.env.ORDER_TABLE,
    Limit: pageSize,
    KeyConditionExpression: "#createdBy = :username or #soldBy = :username",
    ExpressionAttributeNames:{
        "#createdBy": "createdBy",
        "#soldBy": "soldBy"
    },
    ExpressionAttributeValues: {
        ":username": username
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
 * @param {*} username The input productId to be searched 
 * @returns a product object if username found, if not found will return undefined
 */
var getOrder = async function (orderId) {
  let productRecord = await dynamoDB
    .get({
      TableName: process.env.PRODUCT_TABLE,
      Key: {
        "orderId": orderId
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
        "orderId": order.orderIdId
      },
      UpdateExpression: "set #comment := comment, #productId = :productId, #productRevision = :productRevision, #price = :price, #createdBy = :createdBy, #soldBy = :soldBy",
      ExpressionAttributeNames: {
        "#comment": "comment",
        "#productId": "productId",
        "#productRevision": order.productRevision,
        "#price": "price",
        "#createdBy": "createdBy",
        "#soldBy": "soldBy",
        "#revision": "revision",
        "#lastModfiedTS": "lastModfiedTS",
        "#createdTS": "createdTS"
      },
      ExpressionAttributeValues: {
        ":comment": parseFloat(order.price),
        ":productId": order.productId,
        ":productRevision": order.productRevision,
        ":price": parseFloat(order.price),
        ":createdBy": order.createdBy,
        ":soldBy": order.soldBy,
        ":revision": order.revision,
        ":lastModfiedTS": order.lastModfiedTS,
        ":createdTS": order.createdTS
      },
      ReturnValues: "ALL_NEW"
    }).promise();

  // Item return in here will be Attributes, not field
  // {"Attributes": {//fields}}
  return productRecord.Attributes;
};
