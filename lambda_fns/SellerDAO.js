const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const S3DAO = require('./S3DAO.js')

module.exports = {
    /**
     * Get all sellers
     * @param {*} pageSize The maximum pageSize to return
     * @param {*} lastEvaluatedId The lastEvaluatedId to be used to continue to next page search
     * @param {*} sellerStatus The account status to be searched
     * @returns all orders for given userId
     */
    getSellers: async function (pageSize, lastEvaluatedId, sellerStatus, generatedAsset) {

        // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
        var params = {
            TableName: process.env.WEBSITE_TABLE,
            KeyConditionExpression: "begins_with(#PK, :PK)",
            ExpressionAttributeNames: {
                "#PK": "PK",
            },
            ExpressionAttributeValues: {
                ":PK": 's#'
            },
            Limit: pageSize
        };

        if (lastEvaluatedId) {
            params.ExclusiveStartKey = { item_id: lastEvaluatedId };
        }

        // Need to use filter condition as status is not partition key or sort key
        if (sellerStatus) {
            params.FilterExpression = "#status = :status";
            params.ExpressionAttributeNames["#status"] = "status";
            params.ExpressionAttributeValues[":status"] = sellerStatus;
        }

        try {
            var response = await dynamoDB
                .query(params)
                .promise();

            if (generatedAsset) {
                // Loop through all items to add asset download link
                for (var index = 0; index < response.Items.length; index++) {
                    response.Items[index].id = response.Items[index].PK.replace('s#', '');
                    // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
                    response.Items[index].profilePicture = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProfilePicture);
                    response.Items[index].profileAudio = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProfileAudio);
                }
            }

            return {
                sellers: response.Items,
                lastEvaluatedId: response.LastEvaluatedKey
            };

        } catch (error) {
            throw error;
        }
    },
    /**
     * Get a record based on input id
     * @param {*} id The input user's id to be searched 
     * @param {*} generatedAsset Boolean to determine if should generate link for S3 asset
     * @returns a user object if username found, if not found will return undefined
     */
    getSeller: async function (sellerId, generatedAsset) {
        var sellerRecord = await dynamoDB
            .get({
                TableName: process.env.WEBSITE_TABLE,
                Key: {
                    "PK": 's#' + sellerId
                }
            })
            .promise();

        if (sellerRecord && sellerRecord.Item && generatedAsset) {
            sellerRecord.Item.id = sellerRecord.Item.PK.replace('s#', '');
            // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
            sellerRecord.Item.profilePicture = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProfilePicture);
            sellerRecord.Item.profileAudio = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProfileAudio);
        }

        return sellerRecord.Item;
    },
    /**
     * Modify or create a user record base on username
     * @param {*} seller seller object to be updated
     * @returns record
     */
    createUpdateSeller: async function (seller, generatedAsset) {
        // update dynamodb with default values
        var sellerRecord = await dynamoDB
            .update({
                TableName: process.env.WEBSITE_TABLE,
                Key: {
                    "PK": 's#' + seller.id,
                    "SK": 'u#' + seller.id
                },
                UpdateExpression: "set #nickname = :nickname, #entityType = :entityType, #description = :description, #createdTS = :createdTS, #lastModfiedTS = :lastModfiedTS, #status = :status",
                ExpressionAttributeNames: {
                    "#entityType": "entityType",
                    "#nickname": "nickname",
                    "#description": "description",
                    "#createdTS": "createdTS",
                    "#lastModfiedTS": "lastModfiedTS",
                    "#status": "status"
                },
                ExpressionAttributeValues: {
                    ":entityType": "seller",
                    ":nickname": seller.nickname,
                    ":description": seller.description,
                    ":createdTS": seller.createdTS,
                    ":lastModfiedTS": seller.lastModfiedTS,
                    ":status": seller.status
                },
                ReturnValues: "ALL_NEW"
            }).promise();

        // Item return in here will be Attributes, not field
        // {"Attributes": {//fields}}

        if (sellerRecord && sellerRecord.Attributes && generatedAsset) {
            sellerRecord.Attributes.id = sellerRecord.Attributes.PK.replace('s#', '');
            // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
            // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
            sellerRecord.Attributes.profilePicture = await createUserAssetGetSignedUrl(user.id, this.defaultProfilePicture);
            sellerRecord.Attributes.profileAudio = await createUserAssetGetSignedUrl(user.id, this.defaultProfileAudio);
        }

        return sellerRecord.Attributes;
    },
    /**
     * Create a S3 getsigned url assoicated with input target asset with getSignedUrl and preSignedPost base on input
     * @param {*} sellerId user's id for target asset to be retrieved/modified
     * @param {*} asset Target asset to be retrieved/modified
     * @returns a presigned url
     * 
     */
    createAssetGetSignedUrl: async function (sellerId, asset) {
        var prefix = '/seller/' + sellerId + '/' + asset

        // retrieve the url
        // set the expiration to 5 min, it will not be longer than the sts token
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
        return await S3DAO.this.createAssetGetSignedUrl(prefix);
    },
    /**
     * Create an presigned post object with input target asset
     * @param {*} sellerId sellerId for target asset to be retrieved/modified
     * @param {*} asset Target asset to be retrieved/modified
     * @param {*} uppderLimitSizeInByte Upper limit for allowed file size upload
     * @returns an asset object 
     * 
     */
    createAssetPresignedPost: async function (sellerId, asset, uppderLimitSizeInByte = S3DAO.uppderLimitSizeInByte) {
        var prefix = '/seller/' + sellerId + '/' + asset;

        return await S3DAO.createAssetPresignedPost(prefix, uppderLimitSizeInByte);
    },
    // Limit the query size at one time to reduce load on system
    defaultProfilePicture: 'profileAudio.wav',
    defaultProfileAudio: 'profilePicture.wav',
    // Limit the query size at one time to reduce load on system
    maxQuerySize: 5,
};


