const S3DAO = require('./S3DAO.js');
const sharp = require("sharp");

module.exports = {
  /**
   * Delete previous asset
   * @param {*} userId user's id for target asset to be clean up
   * @param {*} assetId Target assetId to be retrieved/modified
   * @param imageDownscaleLengthThreshold the width to consider to downscale
   * @returns boolean whatever a downscale happened
   *
   */
  downscaleImage: async function (userId, assetId, imageDownscaleLengthThreshold = this.defaultImageDownscaleLengthThreshold) {
    const assetRawPrefix = `/user/${userId}/${S3DAO.assetRawPrefix}/${assetId}`;
    const assetLowResPrefix = `/user/${userId}/${S3DAO.assetPrefix}/${assetId}`;
    const assetHiResPrefix = `/user/${userId}/${S3DAO.assetHiResPrefix}/${assetId}`;

    // delete previous hi res image as no longer match current raw
    await S3DAO.deleteAsset(assetHiResPrefix);

    // Download the file from S3
    const originalFile = await S3DAO.getAsset(assetRawPrefix);

    // reference from
    // https://sahanamarsha.medium.com/resizing-s3-images-with-aws-lambda-trigger-ca4cf2372d0e
    let imageSharpObject = await sharp(originalFile.Body);
    const metadata = await imageSharpObject.metadata();

    // set default
    let metadatas = {
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      }
    };

    // no need to scale down
    if (metadata.width <= imageDownscaleLengthThreshold && metadata.height <= imageDownscaleLengthThreshold) {
      // copy from source to high res folder
      await S3DAO.copyAssets(assetRawPrefix,
        assetLowResPrefix);

      // delete the raw image
      await S3DAO.deleteAsset(assetRawPrefix);

      return metadatas;
    }

    // copy from source to high res folder
    await S3DAO.copyAssets(assetRawPrefix,
      assetHiResPrefix);

    const { data: resizedImageSharpObjectBuffer, info: resizedImageMetadata } = await imageSharpObject
      .resize(await this.scaleImageSize(metadata.width, metadata.height, imageDownscaleLengthThreshold))
      .withMetadata()
      .toBuffer({ resolveWithObject: true });

    metadatas = {
      metadata: {
        width: resizedImageMetadata.width,
        height: resizedImageMetadata.height,
        format: resizedImageMetadata.format,
      },
      hiResMetadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      },
    };

    // put the new scale down image to the asset prefix
    await S3DAO.putAsset(resizedImageSharpObjectBuffer, assetLowResPrefix);

    // delete the raw image
    await S3DAO.deleteAsset(assetRawPrefix);

    return metadatas;
  },
  /**
   * Scale the dimensions of an image so that neither width nor height
   * exceeds the specified maxLength, preserving the aspect ratio.
   *
   * @param {number} width - The original width of the image.
   * @param {number} height - The original height of the image.
   * @param {number} maxLength - The maximum allowed size for either dimension.
   * @returns {Object} An object with the scaled width and height.
   */
  scaleImageSize: async function (width, height, maxLength) {
    // If both dimensions are already within the limit, no scaling is needed.
    if (width <= maxLength && height <= maxLength) {
      return {width, height};
    }

    // Calculate the scale factor needed to keep both dimensions <= maxLength.
    const ratio = Math.min(maxLength / width, maxLength / height);

    // Scale and round to avoid fractional pixels
    const scaledWidth = Math.round(width * ratio);
    const scaledHeight = Math.round(height * ratio);

    return {
      width: scaledWidth,
      height: scaledHeight
    };
  },
  defaultImageDownscaleLengthThreshold: 1024,
}