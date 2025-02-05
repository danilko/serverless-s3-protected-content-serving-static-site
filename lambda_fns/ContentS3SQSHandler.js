/*
This code handles the incoming SQS message from Content S3 bucket
*/

const UserDAO = require('./UserDAO.js')
const ContentS3FileDAO = require('./ContentS3FileDAO.js')

exports.handler = async (event) => {
  // SQS event has 'Records' which each contain { messageId, body, ... }
  const sqsRecords = event.Records || [];

  for (const sqsRecord of sqsRecords) {
    let s3Notification;
    try {
      // Each SQS message body is the JSON string of the S3 event
      s3Notification = JSON.parse(sqsRecord.body);
    } catch (err) {
      console.error('Could not parse SQS body into JSON:', err);
      continue; // Skip this record
    }

    // S3 event notifications are typically in 'Records' array
    const s3Records = s3Notification.Records || [];
    for (const s3Record of s3Records) {
      const eventName = s3Record.eventName;
      const s3Object = s3Record.s3?.object;
      if (!s3Object || !eventName) {
        console.debug('Missing s3 object or eventName, skipping');
        continue;
      }

      // Only process "new or replace" events. Usually these are ObjectCreated:*.
      // Example: ObjectCreated:Put, ObjectCreated:Post, ObjectCreated:CompleteMultipartUpload
      if (!eventName.startsWith('ObjectCreated:')) {
        console.debug(`Skipping S3 eventName: ${eventName}`);
        continue;
      }

      // S3 key is often URL-encoded, so decode it
      const rawKey = s3Object.key || '';
      // decodeURIComponent does not decode '+', replace them with space first if needed
      const decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));

      // We expect a path: /user/<userId>/asset/<assetId>
      // Regex below captures <userId> and <assetId>
      const match = decodedKey.match(/^\/?user\/([^/]+)\/asset-raw\/([^/]+)/);

      if (!match) {
        console.debug(`Skipping Key "${decodedKey}" as it does not match the required pattern: user/<userId>/asset-raw/<assetId>`);
        continue;
      }

      const [_, userId, assetId] = match;

      try {
        // check if the uploaded prefix need transcoder
        const metadata = await ContentS3FileDAO.downscaleImage(userId, assetId);
        // if high-res metadata exist, it is high resolution
        // note to use !! so will ensure to return true or false, instead of undefined in case metadata or hiResMetadata not found
        const isAssetHiRes = !!(metadata && metadata["hiResMetadata"]);
        // Update the user's asset status to 'UPLOADED'
        await UserDAO.updateUserAssetStatus(userId, assetId, isAssetHiRes, metadata, UserDAO.ASSET_STATUS_UPLOADED);
        console.debug(`Updated user ${userId} asset ${assetId} status to UPLOADED and hi-res ${isAssetHiRes}`);
      } catch (updateErr) {
        console.error('Error updating user asset status:', updateErr);
      }
    }
  }
};