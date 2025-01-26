const AWS = require('aws-sdk');
const s3 = new AWS.S3({ "signatureVersion": "v4" });

module.exports = {
    /**
     * delete S3 prefix
     * @param {*} prefix Target prefix to generated
     * @returns a presigned url
     *
     */
    deleteAsset: async function (prefix) {
        await s3.deleteObject({
            Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),
            Key: prefix,
        }, function(err, data) {
            if (err) {
                console.log(err, err.stack);
                throw new Error(err);
            }
        });
    },
    /**
     * Create a S3 presigned url for target prefix
     * @param {*} prefix Target prefix to generated
     * @returns a presigned url
     *
     */
    createAssetGetSignedUrl: async function (prefix) {
        // set to a fix time, current is 10 min
        const params = {
            Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),
            Key: prefix,
            Expires: 600
        };

        // retrieve the url
        // set the expiration to 5 min, it will not be longer than the sts token
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
        return s3.getSignedUrl('getObject', params);
    },
    /**
     * Create a S3 presigned post for target prefix
     * @param {*} prefix Target prefix to generated
     * @param {*} uppderLimitSizeInByte  Target number in byte for maximum file size to be uploaded
     * @returns a presigned post object for S3 upload
     *
     */
    createAssetPresignedPost: async function (prefix, uppderLimitSizeInByte) {

        params = {
            Bucket: process.env.S3_BUCKET_ARN.replace('arn:aws:s3:::', ''),

            Fields: {
                Key: prefix,
            },
            // Default to expire in short time frame (300 seconds) for security reason, as the file should be small
            Expires: 300,
            Conditions: [
                // content length restrictions: 0-5KB]
                ['content-length-range', 0, uppderLimitSizeInByte]]
        };

        let preSignedPost = null;

        await s3.createPresignedPost(params, function (err, data) {
            if (err) {
                console.error('Presigning post data encountered an error', err);
                throw err;
            } else {
                preSignedPost = data;
            }
        });

        return preSignedPost;
    },
    defaultUppderLimitSizeInByte: 500000,         // 500KB
};