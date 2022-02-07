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
const { uuid } = require('uuidv4');
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

    if (event.path == "/products") {
      if (event.httpMethod === "GET") {

        // Get the query parameter lastEvaluatedId (if exist)
        var lastEvaluatedId = null;

        if (event.queryStringParameters && event.queryStringParameters.lastEvaluatedId) {
          lastEvaluatedId = event.queryStringParameters.lastEvaluatedId;
        }

        // Limit to 10 records for now
        // If lastEvaluatedId is not present, will get the first pagination
        // Otherwise use the lastEvaluatedId field to try processing pagination
        var response = await getProducts(maxQuerySize, lastEvaluatedId);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(response)
        };
      }
    }
    // This clause will only deal with specific user modification
    else if (event.path.indexOf("/product/" === 0)) {
      var targetProductId = event.path.replace("/product/", "").toLowerCase();

      if (event.httpMethod === "GET") {
        var record = await getProduct(targetProductId);

        if (!record) {
          return {
            // not found, return 404
            statusCode: 404,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify({"error": "product not found"})
          };
        }

        record['sampleasset'] = await getAssetObject(record.productId, record.sampleasset, record.createdBy == username);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
        };

      }
      // Update existing product
      else if (event.httpMethod === "PUT") {
        var targetModifiedproductId = event.path.replace("/product/", "").toLowerCase();

        var record = await getProduct(targetModifiedproductId);

        if (!record) {
          return {
            // not found, return 404
            statusCode: 404,
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
            headers: headers,
            body: JSON.stringify({"error": "product not found"})
          };
        }

        // Currently only user can modify its own product
        if (record.createdBy != username) {
          return {
            statusCode: 403,
            headers: headers,
            body: JSON.stringify({"error": "uauthorized"})
          };
        }

        var input = JSON.parse(event.body);

        // Currently only user can modify its own product
        if (!record.name || !record.desciption || record.price || !isNaN(record.price)) {
          return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({"error": "invalid input"})
          };
        }


        // Update only description, price and name for now
        // Should need to do more regex clean up if needed
        record.name = input.name;
        record.desciption  = input.desciption;
        record.price  = input.price;

        // Update timestampe and revision
        record.lastModfiedTS = Date.now();
        record.revision = uuid();
        
        // Note, depend on use case, may want to back up this revision before update (like to S3 or another dynamo table) for audit reason etc

        // If exist, modify the target field
        record = await createUpdateProduct(record);

        // Get Asset link
        // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
        // Inject a new asset field
        record['sampleasset'] = await getAssetObject(record.productId, product.sampleasset, record.createdBy == username);

        return {
          statusCode: 200,
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
          headers: headers,
          body: JSON.stringify(record)
        };
      }
      // Create a new product
      else if (event.httpMethod === "POST") {
        var input = JSON.parse(event.body);

        // Update only description and name for now
        // Should need to do more regex clean up if needed
        var newRecord = {
          "productId" : uuid(),
          "name": input.name,
          "desciption": input.desciption,
          "revision": uuid(),
          "price": parseFloat(input.price),
          "lastModfiedTS": Date.now(),
          "createdTS": Date.now(),
          "createdBy": username
        };

        // In this case, as productId is primary key of dynamoDB, so dynamoDB will error out if the key is already used
        record = await createUpdateProduct(newRecord);

        // Get Asset link
        // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
        // Inject a new asset field
        record['sampleasset'] = await getAssetObject(record.productId, product.sampleasset, record.createdBy == username);

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
 * Get a record based on input username
 * @param {*} username The input username to be searched 
 * @returns a user object if username found, if not found will return undefined
 */
var getProducts = async function (pageSize, lastEvaluatedId) {
  // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
  var params = {
    TableName: process.env.PRODUCT_TABLE,
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
 * Get a record based on input productId
 * @param {*} productId The input productId to be searched 
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
 * Modify or create a productId record base on username
 * @param {*} username Target productId to be modified
 * @param {*} nickname nickname field for target username to be modified
 * @param {*} asset asset field for target username to be modified
 * @returns record
 */
var createUpdateProduct = async function (product) {
  // update dynamodb with default values
  var userRecord = await dynamoDB
    .update({
      TableName: process.env.USER_TABLE,
      Key: {
        "productId": product.productId
      },
      UpdateExpression: "set #name = :name, #description = :description, #price = :price, #sampleasset = :sampleasset, #revision = :revision, #lastModfiedTS = :lastModfiedTS, #createdTS = :createdTS",
      ExpressionAttributeNames: {
        "#name": "name",
        "#description": "description",
        "#price": "price",
        "#sampleasset": "sampleasset",
        "#revision": "revision",
        "#lastModfiedTS": "lastModfiedTS",
        "#createdTS": "createdTS"
      },
      ExpressionAttributeValues: {
        ":name": product.name,
        ":description": product.description,
        ":description": parseFloat(product.price),
        ":sampleasset": '/sampleasset',
        ":revision": product.revision,
        ":lastModfiedTS": product.lastModfiedTS,
        ":createdTS": product.createdTS
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
    prefix: '/' + productId + '/' + asset,
    getSignedUrl : null,
    preSignedPost: null
  };
 * @param {*} productId productId for target asset to be retrieved/modified
 * @param {*} asset Target asset to be retrieved/modified
 * @param {*} preSignedPost Boolean with true to create PreSignedPost, false to set as null
 * @returns an asset object 
 * 
 */
var getAssetObject = async function (productId, asset, preSignedPost) {

  var asset = {
    prefix: '/products/' + productId + '/' + asset
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