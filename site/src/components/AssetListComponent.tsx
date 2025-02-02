import React from 'react';
import { IAsset } from '@/types';
import AssetComponent from './AssetComponent';

interface AssetListProps {
  assets: IAsset[];
  onDeleteAssetHandler: (asset: IAsset) => void;
  onRefreshAssetStatusHandler: (asset: IAsset) => void;
  onUploadAssetHandler: (asset: IAsset, file: File) => void;
  lastEvaluatedKey: object | null;
  onNextPage: (lastEvaluatedKey: object) => void;
  isEditable: boolean;
}

const AssetListComponent: React.FC<AssetListProps> = ({
                                               assets,
                                                        onDeleteAssetHandler,
                                                        onRefreshAssetStatusHandler,
                                                        onUploadAssetHandler,
                                                        lastEvaluatedKey,
                                               onNextPage,
                                               isEditable,
                                             }) => {
  return (
    <div className="bg-white p-6 rounded shadow my-6">
      <h2 className="text-2xl font-semibold mb-4">Assets</h2>
      {assets.length > 0 ? (
        assets.map((asset) => (
          <AssetComponent key={asset.id} onDeleteAssetHandler={onDeleteAssetHandler} onRefreshAssetStatusHandler={onRefreshAssetStatusHandler} onUploadAssetHandler={onUploadAssetHandler} asset={asset} isEditable={isEditable} />
        ))
      ) : (
        <p className="text-gray-600">No assets to display.</p>
      )}
      {lastEvaluatedKey && (
        <button
          onClick={() => onNextPage(lastEvaluatedKey)}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Next Page
        </button>
      )}
    </div>
  );
};

export default AssetListComponent;