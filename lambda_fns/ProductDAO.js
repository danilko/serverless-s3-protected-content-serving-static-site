const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const S3DAO = require('./S3DAO.js')

module.exports = {
    /**
     * Get all products
     * @param {*} pageSIze The max page size to be searched
     * @param {*} createdBy If passed in as no null value, will return search by given createdBy
     * @param {*} lastEvaluatedId The lastEvaluatedId to continue to search from
     * @param {*} generatedAsset The generatedAsset to continue to search from
     * @returns a user object if username found, if not found will return undefined
     */
    getProducts: async function (pageSize, createdBy, lastEvaluatedId, generatedAsset) {
        // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
        var params = {
            TableName: process.env.WEBSITE_TABLE,
            KeyConditionExpression: "begins_with(#PK, :PK)",
            ExpressionAttributeNames: {
                "#PK": "PK",
            },
            ExpressionAttributeValues: {
                ":PK": 'p#'
            },
            Limit: pageSize
        };

        if (lastEvaluatedId) {
            params.ExclusiveStartKey = { item_id: lastEvaluatedId };
        }

        // Can use key condition as createdBy is the sort key for this type of item
        if (createdBy) {
            params.KeyConditionExpression = params.KeyConditionExpression + " and #SK = :SK";
            params.ExpressionAttributeNames["#SK"] = "SK";
            params.ExpressionAttributeValues[":SK"] = createdBy;
        }

        try {
            var response = await dynamoDB
                .query(params)
                .promise();

            // Loop through all items to add asset download link
            for (var index = 0; index < response.Items.length; index++) {
                response.Items[index].id = response.Items[index].PK;
                response.Items[index].createdBy = response.Items[index].SK;
                if (generatedAsset) {
                    // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
                    // In get all query, will not send presignedurl for asset upload, only get, so third query is always false
                    response.Items[index].productPicture = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProductPicture);
                    response.Items[index].productAudio = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProductAudio);
                }
            }

            return {
                items: response.Items,
                lastEvaluatedId: response.LastEvaluatedKey
            };
        } catch (error) {
            throw error;
        }
    },
    /**
     * Get a record based on input productId
     * @param {*} productId The input productId to be searched 
     * @returns a product object if username found, if not found will return undefined
     */
    getProduct: async function (productId, generatedAsset) {
        let productRecord = await dynamoDB
            .get({
                TableName: process.env.WEBSITE_TABLE,
                Key: {
                    "PK": 'p#' + productId
                }
            })
            .promise();

        if (productRecord && productRecord.Item) {
            productRecord.Item.id = productRecord.Item.PK;
            productRecord.Item.createdBy = productRecord.Item.SK;
            if (generatedAsset) {
                // Get Asset link for profilePicture
                productRecord.Item.productPicture = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProductPicture);
                productRecord.Item.productAudio = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProductAudio);
            }
        }

        return productRecord.Item;
    },
    /**
     * Modify or create a productId record base on username
     * @param {*} product Target product to be modified
     * @param {*} asset asset field for target username to be modified
     * @returns record
     */
    createUpdateProduct: async function (product, generatedAsset) {
        // update dynamodb with default values
        var productRecord = await dynamoDB
            .update({
                TableName: process.env.USER_TABLE,
                Key: {
                    "PK": 'p#' + product.id,
                    "SK": 's#' + product.createdBy,
                },
                UpdateExpression: "set #entityType = :entityType, #name = :name, #description = :description, #price = :price, #sampleasset = :sampleasset, #revisionId = :revisionId, #lastModfiedTS = :lastModfiedTS, #createdTS = :createdTS,  #status = :status",
                ExpressionAttributeNames: {
                    "#name": "name",
                    "#entityType": "entityType",
                    "#description": "description",
                    "#price": "price",
                    "#sampleasset": "sampleasset",
                    "#revisionId": "revisionId",
                    "#lastModfiedTS": "lastModfiedTS",
                    "#createdTS": "createdTS",
                    "#status": "status"
                },
                ExpressionAttributeValues: {
                    ":name": product.name,
                    ":entityType": "product",
                    ":description": product.description,
                    ":price": parseFloat(product.price),
                    ":sampleasset": product.sampleasset,
                    ":revisionId": product.revisionId,
                    ":lastModfiedTS": product.lastModfiedTS,
                    ":createdTS": product.createdTS,
                    ":status": product.status
                },
                ReturnValues: "ALL_NEW"
            }).promise();

        if (productRecord && productRecord.Attributes) {
            productRecord.Attributes.id = productRecord.Attributes.PK.replace('p#', '');
            productRecord.Attributes.createdBy = productRecord.Attributes.SK.replace('s#', '');

            if (generatedAsset) {
                // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
                productRecord.Attributes.productPicture = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProductPicture);
                productRecord.Attributes.productAudio = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProductAudio);
            }
        }

        // Item return in here will be Attributes, not field
        // {"Attributes": {//fields}}
        return productRecord.Attributes;
    },
    /**
     * Create a S3 getsigned url assoicated with input target asset with getSignedUrl and preSignedPost base on input
     * @param {*} userId user's id for target asset to be retrieved/modified
     * @param {*} asset Target asset to be retrieved/modified
     * @returns a presigned url
     * 
     */
    createAssetGetSignedUrl: async function (productId, asset) {
        var prefix = '/product/' + productId + '/' + asset;

        // retrieve the url
        // set the expiration to 5 min, it will not be longer than the sts token
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
        return await S3DAO.createAssetGetSignedUrl(prefix);
    },
    /**
     * Create a S3 presigned post object assoicated with input target asset
     * @param {*} userId user's id for target asset to be retrieved/modified
     * @param {*} asset Target assetSuffix to be retrieved/modified
     * @param {*} uppderLimitSizeInByte  Target number in byte for maximum file size to be uploaded 
     * @returns a presigned post object for S3 upload
     * 
     */
    createAssetPresignedPost: async function (productId, asset, uppderLimitSizeInByte = S3DAO.defaultUppderLimitSizeInByte) {
        var prefix = '/product/' + productId + '/' + asset;

        return await S3DAO.createAssetPresignedPost(prefix, uppderLimitSizeInByte);
    },
    // Variable declaration
    defaultProductPicture: 'productPicture.png',
    // Variable declaration
    defaultProductAudio: 'productAudio.wav',
    // Limit the query size at one time to reduce load on system
    maxQuerySize: 5,
}
