import React, { useState, useRef } from 'react';
import { IAsset } from "@/types";
import {useNotification} from "@/components/NotificationContext";

interface UploadAssetComponentProps {
  onNewAssetUpload: (file: File, asset?: IAsset) => void;
}

const UploadAssetComponent: React.FC<UploadAssetComponentProps> = ({
                                                                     onNewAssetUpload,
                                                                   }) => {
  const [file, setFile] = useState<File | null>(null);
  const { showNotification } = useNotification();
  const [collapsed, setCollapsed] = useState(false);

  // Use a ref to programmatically clear the file input
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    try {
      if (file) {
        // If onNewAssetUpload is async, you may want to await it to confirm success
        onNewAssetUpload(file);

        // Clear local state
        setFile(null);

        // Clear input value
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    } catch (error) {
      showNotification(`Fail to upload asset due to ${error}`, "success");
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow my-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-blue-700">User New Asset</h2>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-blue-600 hover:text-blue-800 text-2xl font-bold focus:outline-none"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▼' : '▲'}
        </button>
      </div>
      {!collapsed && (
        <div>
          <div className="mb-4">
            <label htmlFor="new_asset_file" className="block mb-1 font-medium">
              Select new file:
            </label>
            <input
              type="file"
              accept=".png"
              id="new_asset_file"
              onChange={handleFileChange}
              className="w-full"
              ref={fileInputRef} // attach the ref here
            />
          </div>
          <button
            onClick={handleUpload}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Upload New Asset
          </button>
        </div>
          )}
        </div>
      );
      };

      export default UploadAssetComponent;