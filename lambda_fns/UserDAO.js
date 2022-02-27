const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const S3DAO = require('./S3DAO.js')

module.exports = {
    /**
     * Get all users based on input userId
     * @param {*} pageSize The maximum pageSize to return
     * @param {*} lastEvaluatedId The lastEvaluatedId to be used to continue to next page search
     * @param {*} generatedAsset If true, generate the asset along with all users
     * @returns all orders for given userId
     */
    getUsers: async function (pageSize, lastEvaluatedId, generatedAsset) {
        // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
        var params = {
            TableName: process.env.WEBSITE_TABLE,
            KeyConditionExpression: "begins_with(#PK, :PK)",
            ExpressionAttributeNames: {
                "#PK": "PK",
            },
            ExpressionAttributeValues: {
                ":PK": 'u#'
            },
            Limit: pageSize
        };

        if (lastEvaluatedId) {
            params.ExclusiveStartKey = { item_id: lastEvaluatedId };
        }

        try {
            var response = await dynamoDB
                .query(params)
                .promise();

            // Loop through all items to add asset download link
            for (var index = 0; index < response.Items.length; index++) {
                // convert the PK to id
                response.Items[index].id = response.Items[index].PK.replace('u#', '');
                if (generatedAsset) {
                    // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
                    response.Items[index].profilePicture = await this.createAssetGetSignedUrl(response.Items[index].id, this.defaultProfilePicture);
                }
            }

            return {
                users: response.Items,
                lastEvaluatedId: response.LastEvaluatedKey
            };

        } catch (error) {
            throw error;
        }
    },
    /**
     * Get all users
     * @param {*} username The input username to be searched 
     * @param {*} generatedAsset Boolean to determine if should generate link for S3 asset
     * @returns a user object if username found, if not found will return undefined
     */
    getUsersCognito: async function (pageSize, paginationToken, generatedAsset) {
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CognitoIdentityServiceProvider.html#listUsers-property
        var params = {
            UserPoolId: process.env.COGNITO_POOL_ID,
            Limit: pageSize,
        };

        if (paginationToken) {
            params.PaginationToken = paginationToken;
        }

        var response = await cognitoidentityserviceprovider.listUsers(params).promise();
        var responseUsers = [];
        var responsePaginationToken = null;

        if (response && response.Users) {
            // Message to not return too much info for each user
            for (var index = 0; index < response.Users.length; index++) {

                // Loop through array of map to find given attributes
                var nickname = null;
                var profile = null;
                response.Users[index].Attributes.forEach(element => {
                    if (element.Name == 'nickname') {
                        nickname = element.Value;
                    }
                    else if (element.Name == 'profile') {
                        profile = element.Value;
                    }
                });

                var generatedUser = {
                    id: response.Users[index].Username,
                    userCreateDate: response.Users[index].UserCreateDate,
                    nickname: nickname,
                    profile: profile,
                };

                if (generatedAsset) {
                    // Get Asset link for profilePicture
                    generatedUser.profilePicture = await this.createAssetGetSignedUrl(generatedUser.id, this.defaultProfilePicture);
                }

                responseUsers.push(generatedUser);

                responsePaginationToken = response.PaginationToken ? response.PaginationToken : null;
            }
        }

        return {
            users: responseUsers,
            paginationToken: responsePaginationToken
        };
    },
    /**
     * Get a record based on input user's id field
     * @param {*} user The target user to be updated 
     */
    updateUserCognito: async function (user) {
        var params = {
            UserAttributes: [
                {
                    Name: 'nickname',
                    Value: user.nickname,
                },
                {
                    Name: 'profile',
                    Value: user.profile
                }
            ],
            UserPoolId: process.env.COGNITO_POOL_ID,
            Username: user.id,
        };
        await cognitoidentityserviceprovider.adminUpdateUserAttributes(params).promise();
    },

    /**
     * Get a record based on input id
     * @param {*} id The input user's id to be searched 
     * @param {*} generatedAsset Boolean to determine if should generate link for S3 asset
     * @returns a user object if username found, if not found will return undefined
     */
    getUser: async function (userId, generatedAsset) {
        var userRecord = await dynamoDB
            .get({
                TableName: process.env.WEBSITE_TABLE,
                Key: {
                    "PK": 'u#' + userId,
                    "SK": 'u#' + userId,
                }
            })
            .promise();

        if (userRecord && userRecord.Item) {
            // convert the PK to id
            userRecord.Item.id = userRecord.Item.PK.replace('u#', '');
            if (generatedAsset) {
            // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
            userRecord.Item.profilePicture = await this.createAssetGetSignedUrl(userRecord.Item.id, this.defaultProfilePicture);
            }
        }

        return userRecord.Item;
    },
    /**
     * Get a record based on input id
     * @param {*} id The input user's id to be searched 
     * @param {*} generatedAsset Boolean to determine if should generate link for S3 asset
     * @returns a user object if username found, if not found will return undefined
     */
    getUserCognito: async function (id, generatedAsset) {
        // https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CognitoIdentityServiceProvider.html#getUser-property
        var params = {
            UserPoolId: process.env.COGNITO_POOL_ID,
            Username: id
        };

        var user = await cognitoidentityserviceprovider.adminGetUser(params).promise();

        if (user) {
            // Clean up the user attribute to limit return fields
            // Loop through array of map to find given attributes
            var nickname = null;
            var profile = null;
            user.UserAttributes.forEach(element => {
                if (element.Name == 'nickname') {
                    nickname = element.Value;
                }
                else if (element.Name == 'profile') {
                    profile = element.Value;
                }
            });

            var generatedUser = {
                id: user.Username,
                nickname: nickname,
                profile: profile,
                userCreateDate: user.UserCreateDate
            };

            if (generatedAsset) {
                // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
                generatedUser.profilePicture = await this.createAssetGetSignedUrl(generatedUser.id, this.defaultProfilePicture);
            }

            return generatedUser;
        }

        return null;
    },
    /**
     * Modify or create a user record base on username
     * @param {*} username Target username to be modified
     * @param {*} nickname nickname field for target username to be modified
     * @param {*} generatedAsset whatever to generate the download link
     * @returns record
     */
    createUpdateUser: async function (user, generatedAsset) {
        // update dynamodb with default values
        var userRecord = await dynamoDB
            .update({
                TableName: process.env.WEBSITE_TABLE,
                Key: {
                    "PK": 'u#' + user.id,
                    "SK": 'u#' + user.id,
                },
                UpdateExpression: "set #entityType = :entityType, #nickname = :nickname, #profile = :profile, #createdTS = :createdTS, #lastModfiedTS = :lastModfiedTS, #status = :status",
                ExpressionAttributeNames: {
                    "#entityType": "entityType",
                    "#nickname": "nickname",
                    "#profile": "profile",
                    "#createdTS": "createdTS",
                    "#lastModfiedTS": "lastModfiedTS",
                    "#status": "status",
                },
                ExpressionAttributeValues: {
                    ":entityType": "user",
                    ":nickname": user.nickname,
                    ":profile": user.profile,
                    ":createdTS": user.createdTS,
                    ":lastModfiedTS": user.lastModfiedTS,
                    ":status": user.status
                },
                ReturnValues: "ALL_NEW"
            }).promise();

        // Item return in here will be Attributes, not field
        // {"Attributes": {//fields}}

        if (userRecord && userRecord.Attributes) {
            // change the PK to id
            userRecord.Attributes.id = userRecord.Attributes.PK.replace('u#');

            if (generatedAsset) {
                // Get Asset link for profilePicture (profilePicture in this case is not stored in DB as it is static file name)
                // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
                userRecord.Attributes.profilePicture = await this.createAssetGetSignedUrl(userRecord.Attributes.id, this.defaultProfilePicture);
            }
        }

        return userRecord.Attributes;
    },

    /**
     * Create a S3 getsigned url assoicated with input target asset with getSignedUrl and preSignedPost base on input
     * @param {*} userId user's id for target asset to be retrieved/modified
     * @param {*} asset Target asset to be retrieved/modified
     * @returns a presigned url
     * 
     */
    createAssetGetSignedUrl: async function (userId, asset) {
        var prefix = '/users/' + userId + '/' + asset

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
    createAssetPresignedPost: async function (userId, asset, uppderLimitSizeInByte = S3DAO.defaultUppderLimitSizeInByte) {
        var prefix = '/users/' + userId + '/' + asset;

        return await S3DAO.createAssetPresignedPost(prefix, uppderLimitSizeInByte);
    },
    defaultProfilePicture: 'profilePicture.png',
    maxQuerySize: 5,
};