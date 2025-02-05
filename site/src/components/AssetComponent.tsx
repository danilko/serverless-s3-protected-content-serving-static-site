import React, {useRef, useState} from 'react';
import { IAsset } from '@/types';

interface AssetComponentProps {
  asset: IAsset;
  isEditable: boolean;
  onDeleteAssetHandler: (asset: IAsset) => void;
  onRefreshAssetStatusHandler: (asset: IAsset) => void;
  onUploadAssetHandler: (asset: IAsset, file: File) => void;
}

const AssetComponent: React.FC<AssetComponentProps> = ({
                                                         asset,
                                                         onDeleteAssetHandler,
                                                         onRefreshAssetStatusHandler,
                                                         onUploadAssetHandler,
                                                         isEditable,
                                                       }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Use a ref to programmatically clear the file input
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDeleteAsset = async () => {
    onDeleteAssetHandler(asset);
  };

  const handleRefreshAssetStatus = async () => {
    onRefreshAssetStatusHandler(asset);
  };

  const handleAssetUpload = async () => {
    if (selectedFile) {
      await onUploadAssetHandler(asset, selectedFile);
      setSelectedFile(null);
    }
  };

  return (
    <div className="border p-4 rounded mb-4 shadow-sm">
      {/* Header Section */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-bold text-xl">Asset {asset.id}</h3>
          <p className="text-sm text-gray-600">Status: {asset.status}</p>
        </div>
        {isEditable && (
          <div className="flex space-x-2">
            <button
              onClick={handleDeleteAsset}
              className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={handleRefreshAssetStatus}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Refresh Status
            </button>
          </div>
        )}
      </div>

      {asset.status === 'UPLOADED' ? (
        <div className="mb-4">
          {/* Flex container for image & metadata side by side */}
          <div className="flex items-start gap-6">
            {/* Image & Download Button */}
            <div className="shrink-0">
              <img
                src={asset.urls.url}
                alt={`Asset ${asset.id}`}
                className="w-32 h-32 object-cover rounded mb-2"
              />
              <div>
                <a
                  href={asset.urls.hiResUrl || asset.urls.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                >
                  {asset.urls.hiResUrl ? 'Download Original Hi-Res File' : 'Download Original File'}
                </a>
              </div>
            </div>

            {/* Metadata Section */}
            {asset.metadatas && (
              <div className="mt-2">
                {asset.metadatas.hiResMetadata ? (
                  <>
                    <h3 className="font-bold">Original Hi-Res Image Metadata</h3>
                    <div>Width: {asset.metadatas.hiResMetadata.width}</div>
                    <div>Height: {asset.metadatas.hiResMetadata.height}</div>
                    <div>Format: {asset.metadatas.hiResMetadata.format}</div>

                    <h3 className="font-bold mt-4">Scale Down Image Metadata</h3>
                    <div>Width: {asset.metadatas.metadata.width}</div>
                    <div>Height: {asset.metadatas.metadata.height}</div>
                    <div>Format: {asset.metadatas.metadata.format}</div>
                  </>
                ) : (
                  <>
                    <h3 className="font-bold">Original Image Metadata</h3>
                    <div>Width: {asset.metadatas.metadata.width}</div>
                    <div>Height: {asset.metadatas.metadata.height}</div>
                    <div>Format: {asset.metadatas.metadata.format}</div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-gray-600 mb-4">
          {asset.status} {isEditable && '— please upload.'}
        </div>
      )}

      {/* Upload Section */}
      {isEditable && (
        <div className="flex items-center space-x-2">
          <input
            type="file"
            accept=".png"
            onChange={handleFileChange}
            className="border p-1 rounded"
            ref={fileInputRef} // attach the ref here
          />
          <button
            onClick={handleAssetUpload}
            disabled={!selectedFile}
            className={`px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors ${
              !selectedFile ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            Upload Asset
          </button>
        </div>
      )}
    </div>
  );
};

export default AssetComponent;