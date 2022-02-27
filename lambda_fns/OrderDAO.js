const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

module.exports = {
    /**
     * Get all orders based on input userId
     * @param {*} pageSize The maximum pageSize to return
     * @param {*} lastEvaluatedId The lastEvaluatedId to be used to continue to next page search
     * @param {*} userId The input userId to be searched 
     * @returns all orders for given userId
     */
    getOrders: async function (pageSize, userId, lastEvaluatedId) {
        // Reference https://stackoverflow.com/questions/56074919/dynamo-db-pagination
        var params = {
            TableName: process.env.WEBSITE_TABLE,
            Limit: pageSize,
            KeyConditionExpression: "begins_with(#PK, :PK) and ((contains(#SK, :SKU)) or (contains(#SK, :SKS)))",
            ExpressionAttributeNames: {
                "#PK": "PK",
                "#SK": "SK",
            },
            ExpressionAttributeValues: {
                ":PK": 'o#',
                // The user id can be seller or user, so using overloading to find it
                ":SK": 'u#' + userId + ';',
                ":SK": ';s#' + userId + ';',
            }
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
                response.Items[index].id = response.Items[index].PK.replace('o#', '');
                // The SK is an overloading attribute, so need to split it to derive two values
                var skSplit = response.Items[index].SK.split(';');

                response.Items[index].createdBy = skSplit[0].replace('u#', '');
                response.Items[index].soldBy = skSplit[1].replace('s#', '');
            }

            return {
                orders: response.Items,
                lastEvaluatedId: response.LastEvaluatedKey
            };
        } catch (error) {
            throw error;
        }
    },
    /**
     * Get a record based on input productId
     * @param {*} orderId The input productId to be searched 
     * @returns a product object if orderId found, if not found will return undefined
     */
    getOrder: async function (orderId) {
        let orderRecord = await dynamoDB
            .get({
                TableName: process.env.PRODUCT_TABLE,
                Key: {
                    "PK": 'o#' + orderId
                }
            })
            .promise();

        if (orderRecord.Item) {
            orderRecord.Item.id = orderRecord.Item.PK.replace('o#', '');
            // The SK is an overloading attribute, so need to split it to derive two values
            var skSplit = orderRecord.Item.SK.split(';');
            orderRecord.Item.createdBy = skSplit[0].replace('u#', '');
            orderRecord.Item.soldBy = skSplit[1].replace('s#', '');
        }


        return productRecord.Item;
    },
    /**
     * Modify or create a order record 
     * @param {*} order Target order to be modified
     * @returns record
     */
    createUpdateOrder: async function(order) {
        // update dynamodb with default values
        var orderRecord = await dynamoDB
            .update({
                TableName: process.env.ORDER_TABLE,
                Key: {
                    "PK": 'o#' + order.uuid,
                    "SK": 'u#' + order.createdBy + ';s#' + order.soldBy
                },
                UpdateExpression: "set #entityType = :entityType, #comment := comment, #productId = :productId, #productRevisionId = :productRevisionId, #price = :price",
                ExpressionAttributeNames: {
                    "#entityType": "entityType",
                    "#comment": "comment",
                    "#productId": "productId",
                    "#productRevisionId": "productRevisionId",
                    "#price": "price",
                    "#revision": "revision",
                    "#lastModfiedTS": "lastModfiedTS",
                    "#createdTS": "createdTS"
                },
                ExpressionAttributeValues: {
                    ":entityType": "order",
                    ":comment": order.comment,
                    ":productId": order.productId,
                    ":productRevisionId": order.productRevisionId,
                    ":price": parseFloat(order.price),
                    ":revisionId": order.revisionId,
                    ":lastModfiedTS": order.lastModfiedTS,
                    ":createdTS": order.createdTS
                },
                ReturnValues: "ALL_NEW"
            }).promise();

        if (orderRecord && orderRecord.Attributes) {
            orderRecord.Attributes.id = orderRecord.Attributes.PK.replace('o#', '');
            // The SK is an overloading attribute, so need to split it to derive two values
            var skSplit = orderRecord.Attributes.SK.split(';');
            orderRecord.Attributes.createdBy = skSplit[0].replace('u#', '');
            orderRecord.Attributes.soldBy = skSplit[1].replace('s#', '');
        }

        // Item return in here will be Attributes, not field
        // {"Attributes": {//fields}}
        return productRecord.Attributes;
    },
    // Limit the query size at one time to reduce load on system
    maxQuerySize: 5,
};
