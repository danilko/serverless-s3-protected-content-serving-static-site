const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

const S3DAO = require('./S3DAO.js')

const GSI_PK_NAME = 'gsi_pk';
const GSI_SK_NAME = 'gsi_sk';

const GSI_NAME = 'gsi'

const USER_PK_PREFIX = `user#`;
const USER_ASSET_PK_PREFIX = `userAsset#`;

module.exports = {
  /**
   * Get all users based on input userId
   * @param {*} pageSize The maximum pageSize to return
   * @param {*} lastEvaluatedKey The lastEvaluatedKey to be used to continue to next page search
   * @param {*} generatedAsset If true, generate the asset along with all users
   * @returns all orders for given userId
   */
  getUsers: async function (pageSize, lastEvaluatedKey, generatedAsset) {
    // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
    let params = {
      TableName: process.env.WEBSITE_TABLE,
      IndexName: GSI_NAME,
      KeyConditionExpression: `#${GSI_PK_NAME} = :${GSI_PK_NAME}`,
      ExpressionAttributeNames: {
        "#gsi_pk": "gsi_pk",
      },
      ExpressionAttributeValues: {
        ":gsi_pk": USER_PK_PREFIX,
      },
      Limit: pageSize
    };

    if (lastEvaluatedKey && lastEvaluatedKey["gsi_pk"] && lastEvaluatedKey["gsi_sk"] && lastEvaluatedKey["pk"] && lastEvaluatedKey["sk"]) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    try {
      let response = await dynamoDB
        .query(params)
        .promise();

      // Loop through all items to add asset download link
      for (let index = 0; index < response.Items.length; index++) {
        // Get Asset link for profileAsset
        response.Items[index].profileAsset = await this.getUserAsset(response.Items[index].id, response.Items[index].id, generatedAsset);

        // create default asset if not already exist
        if(!response.Items[index].profileAsset) {
          await this.createUpdateUserAsset(response.Items[index].id, response.Items[index].id, false);
          // get Asset again
          response.Items[index].profileAsset = await this.getUserAsset(response.Items[index].id, response.Items[index].id, generatedAsset);
        }
      }

      return {
        users: response.Items,
        lastEvaluatedKey: response.LastEvaluatedKey
      };

    } catch (error) {
      throw error;
    }
  },
  /**
   * Get all user assets based on input userId
   * @param {*} userId The userId
   * @param {*} pageSize The maximum pageSize to return
   * @param {*} lastEvaluatedKey The lastEvaluatedKey to be used to continue to next page search
   * @param {*} generatedAsset If true, generate the asset along with all users
   * @returns all orders for given userId
   */
  getUserAssets: async function (userId, pageSize, lastEvaluatedKey, generatedAsset) {
    // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
    let params = {
      TableName: process.env.WEBSITE_TABLE,
      IndexName: GSI_NAME,
      KeyConditionExpression: `#${GSI_PK_NAME} = :${GSI_PK_NAME} `,
      ExpressionAttributeNames: {
        "#gsi_pk": `${GSI_PK_NAME}`,
      },
      ExpressionAttributeValues: {
        ":gsi_pk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}`,
      },
      Limit: pageSize
    };

    if (lastEvaluatedKey && lastEvaluatedKey["gsi_pk"] && lastEvaluatedKey["gsi_sk"] && lastEvaluatedKey["pk"] && lastEvaluatedKey["sk"]) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    try {
      let response = await dynamoDB
        .query(params)
        .promise();

      let assets = [];

      if(response.Items) {
        // Loop through all items to add asset download link
        for (let index = 0; index < response.Items.length; index++) {
          assets.push(await this.prepareUserAsset(userId, response.Items[index], generatedAsset));
        }
      }

      return {
        assets: assets,
        lastEvaluatedKey: response.LastEvaluatedKey
      };

    } catch (error) {
      throw error;
    }
  },
  /**
   * Get a record based on input id
   * @param {*} userId The input user's id to be searched
   * @param {*} generatedAsset Boolean to determine if should generate link for S3 asset
   * @returns a user object if username found, if not found will return undefined
   */
  getUser: async function (userId, generatedAsset) {
    let userRecord = await dynamoDB
      .get({
        TableName: process.env.WEBSITE_TABLE,
        Key: {
          "pk": `${USER_PK_PREFIX}${userId}`,
          "sk": `${USER_PK_PREFIX}`,
        }
      })
      .promise();



    if (userRecord && userRecord.Item && generatedAsset) {

      let profileAsset = await this.getUserAsset(userId, userId, true);

      // create default asset if not already exist
      if(!profileAsset) {
        await this.createUpdateUserAsset(userId, userId, false);
        // get Asset again
        profileAsset = await this.getUserAsset(userId, userId, true);
      }
      userRecord.Item.profileAsset = profileAsset;
    }

    return userRecord.Item;
  },
  /**
   * Prepare a record from dynamodb to prepare for actual return asset object for downstream use
   * Few use case is to parse metadatas as an object instead of string, and generated presigned url if need
   * @param {string} userId user id
   * @param {*} assetRecord record from dynamodb
   * @param {*} generatedAsset boolean to indicate is asset
   * @returns {*} assetObject ready for downstream to use
   */
  prepareUserAsset: async function (userId, assetRecord, generatedAsset) {
    if(assetRecord.metadatas) {
      assetRecord.metadatas = JSON.parse(assetRecord.metadatas);
    }

    if (generatedAsset) {
      // Get Asset link for each asset
      assetRecord.urls = await this.createAssetGetSignedUrl(userId, assetRecord.id,
        assetRecord.isAssetHiRes);
    }

    return assetRecord;
  },
  /**
   * Get a record based on input id
   * @param {*} userId The input user's id to be searched
   * @param {*} assetId The input assetId id to be searched under inputted user id
   * @param {*} generatedAsset Boolean to determine if should generate link for S3 asset
   * @returns a user object if username found, if not found will return undefined
   */
  getUserAsset: async function (userId, assetId, generatedAsset) {

    let assetRecord = await dynamoDB
      .get({
        TableName: process.env.WEBSITE_TABLE,
        Key: {
          "pk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}${assetId}`,
          "sk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}`,
        }
      })
      .promise();

    let asset = assetRecord.Item;

    if (assetRecord && assetRecord.Item) {
      asset = await this.prepareUserAsset(userId, assetRecord.Item, generatedAsset);
    }

    return asset;
  },
  /**
   * Modify or create a user record base on username
   * @param {*} user Target username to be modified
   * @param {*} generatedAsset whatever to generate the download link
   * @returns record
   */
  createUpdateUser: async function (user, generatedAsset) {
    // update dynamodb with default values
    let userRecord = await dynamoDB
      .update({
        TableName: process.env.WEBSITE_TABLE,
        Key: {
          "pk": `${USER_PK_PREFIX}${user.id}`,
          "sk": `${USER_PK_PREFIX}`,
        },
        UpdateExpression: "set #gsi_pk = :gsi_pk, #gsi_sk = :gsi_sk, #id = :id, #nickname = :nickname, #profile = :profile, #createdTS = :createdTS, #lastModfiedTS = :lastModfiedTS, #status = :status",
        ExpressionAttributeNames: {
          "#id" : "id",
          "#gsi_pk": GSI_PK_NAME,
          "#gsi_sk": GSI_SK_NAME,
          "#nickname": "nickname",
          "#profile": "profile",
          "#createdTS": "createdTS",
          "#lastModfiedTS": "lastModfiedTS",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":id" : user.id,
          ":gsi_pk": USER_PK_PREFIX,
          ":gsi_sk": `${USER_PK_PREFIX}${user.id}`,
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

    console.log("check generate asset link for create or update user:" + generatedAsset);

    if (userRecord && userRecord.Attributes && generatedAsset) {

      // Get Asset link for profileAsset
      // Only generate post link if it is the target modified user is token's user (i.e. user tries to modify itself)
      userRecord.Attributes.profileAsset = await this.getUserAsset(user.id, user.id, generatedAsset);

      // create default asset if not already exist
      if(!userRecord.Attributes.profileAsset) {
        await this.createUpdateUserAsset(user.id,  user.id, false);
        // get Asset again
        userRecord.Attributes.profileAsset = await this.getUserAsset(user.id, user.id, generatedAsset);
      }
    }

    return userRecord.Attributes;
  },
  /**
   * Modify or create a user record base on username
   * @param {*} userId
   * @param {*} assetId assetId to be updated
   * @param generatedPresignedPost whatever to generate the presigned
   * @returns record
   */
  createUpdateUserAsset: async function (userId, assetId, generatedPresignedPost = true) {
    // update dynamodb with default values
    const assetRecord = await dynamoDB
      .update({
        TableName: process.env.WEBSITE_TABLE,
        Key: {
          "pk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}${assetId}`,
          "sk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}`,
        },
        UpdateExpression: "set #gsi_pk = :gsi_pk, #gsi_sk = :gsi_sk,  #id = :id,  #lastModfiedTS = :lastModfiedTS, #metadatas = :metadatas, #isAssetHiRes = :isAssetHiRes, #status = :status",
        ExpressionAttributeNames: {
          "#id" : "id",
          "#gsi_pk": GSI_PK_NAME,
          "#gsi_sk": GSI_SK_NAME,
          "#lastModfiedTS": "lastModfiedTS",
          "#isAssetHiRes": "isAssetHiRes",
          "#status": "status",
          "#metadatas": "metadatas",
        },
        ExpressionAttributeValues: {
          ":id" : assetId,
          ":gsi_pk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}`,
          ":gsi_sk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}${assetId}`,
          ":lastModfiedTS": Date.now(),
          ":isAssetHiRes": false,
          ":metadatas": JSON.stringify({}),
          ":status": this.ASSET_STATUS_PENDING_UPLOAD,
        },
        ReturnValues: "ALL_NEW"
      }).promise();

    // Item return in here will be Attributes, not field
    // {"Attributes": {//fields}}

    if (assetRecord && assetRecord.Attributes && generatedPresignedPost) {
      assetRecord.Attributes.presignedPost = await this.createAssetPresignedPost(userId, assetId);
    }

    return assetRecord.Attributes;
  },
  /**
   * Modify or create a user record base on username
   * @param {*} userId
   * @param {*} assetId assetId to be updated
   * @param {*} isAssetHiRes boolean to indicate if the assset has hi-res
   * @param {*} status asset status to be updated
   * @param {*} metadatas object to represent metadata
   * @returns record
   */
  updateUserAssetStatus: async function (userId, assetId, isAssetHiRes, metadatas, status) {

    // set to empty to ensure not error out dynamodb if undefined
    if(!metadatas) {
      metadatas = {};
    }
    if(!isAssetHiRes) {
      isAssetHiRes = false;
    }

    // update dynamodb with default values
    await dynamoDB
      .update({
        TableName: process.env.WEBSITE_TABLE,
        Key: {
          "pk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}${assetId}`,
          "sk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}`,
        },
        UpdateExpression: "set #lastModfiedTS = :lastModfiedTS, #isAssetHiRes = :isAssetHiRes, #metadatas = :metadatas, #status = :status",
        // ConditionExpression ensures the item already exists
        ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        ExpressionAttributeNames: {
          "#lastModfiedTS": "lastModfiedTS",
          "#isAssetHiRes": "isAssetHiRes",
          "#status": "status",
          "#metadatas": "metadatas",
        },
        ExpressionAttributeValues: {
          ":lastModfiedTS": Date.now(),
          ":isAssetHiRes": isAssetHiRes,
          ":status": status,
          ":metadatas": JSON.stringify(metadatas),
        },
        ReturnValues: "ALL_NEW"
      }).promise();
  },
  /**
   * Delete user asset
   * @param {*} userId
   * @param {*} assetId assetId to be deleted
   * @returns void
   */
  deleteUserAsset: async function (userId, assetId) {
    // update dynamodb with default values
    const response = await dynamoDB
      .delete({
        TableName: process.env.WEBSITE_TABLE,
        Key: {
          "pk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}${assetId}`,
          "sk": `${USER_PK_PREFIX}${userId}${USER_ASSET_PK_PREFIX}`,
        },
        // need for checking if there is a record deleted
        ReturnValues: 'ALL_OLD',
      }).promise();

    // only delete s3 if there is an actual deletion
    if (response.Attributes) {
      await S3DAO.deleteAsset(`/user/${userId}/${S3DAO.assetPrefix}/${assetId}`);
      await S3DAO.deleteAsset(`/user/${userId}/${S3DAO.assetRawPrefix}/${assetId}`);
      await S3DAO.deleteAsset(`/user/${userId}/${S3DAO.assetHiResPrefix}/${assetId}`);
    }
  },
  /**
   * Create a S3 getsigned url assoicated with input target asset with getSignedUrl and preSignedPost base on input
   * @param {*} userId user's id for target asset to be retrieved/modified
   * @param {*} assetId Target assetId to be retrieved/modified
   * @param isAssetHiRes flag if want to download highresolution asset
   * @returns a presigned url
   *
   */
  createAssetGetSignedUrl: async function (userId, assetId, isAssetHiRes) {
    // retrieve the url
    // set the expiration to 5 min, it will not be longer than the sts token
    // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
    let response = {};

    response.url = await S3DAO.createAssetGetSignedUrl(`/user/${userId}/${S3DAO.assetPrefix}/${assetId}`);
    // if a high-res available, also prepares it
    if(isAssetHiRes) {
      response.hiResUrl = await S3DAO.createAssetGetSignedUrl(`/user/${userId}/${S3DAO.assetHiResPrefix}/${assetId}`);
    }

    return response;
  },
  /**
   * Create a S3 presigned post object assoicated with input target asset
   * @param {*} userId user's id for target asset to be retrieved/modified
   * @param {*} assetId Target assetId to be retrieved/modified
   * @param {*} uppderLimitSizeInByte  Target number in byte for maximum file size to be uploaded
   * @returns a presigned post object for S3 upload
   *
   */
  createAssetPresignedPost: async function (userId, assetId, uppderLimitSizeInByte = S3DAO.defaultUppderLimitSizeInByte) {
    // Send to the assetraw prefix instead of asset, so can let SQS handler latter do additional processing
    return await S3DAO.createAssetPresignedPost(`/user/${userId}/${S3DAO.assetRawPrefix}/${assetId}`, uppderLimitSizeInByte);
  },
  maxQuerySize: 5,
  ASSET_STATUS_PENDING_UPLOAD: "PENDING_UPLOAD",
  ASSET_STATUS_UPLOADED: "UPLOADED",
};