import React, { useState, useRef } from 'react';
import { IAsset } from "@/types";
import {useNotification} from "@/components/NotificationContext";

interface UploadAssetComponentProps {
  onNewAssetUpload: (file: File, asset?: IAsset) => void;
}

const UploadAssetComponent: React.FC<UploadAssetComponentProps> = ({
                                                                     onNewAssetUpload,
                                                                   }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { showNotification } = useNotification();
  const [collapsed, setCollapsed] = useState(false);

  // Use a ref to programmatically clear the file input
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    try {
      if (selectedFile) {
        // If onNewAssetUpload is async, you may want to await it to confirm success
        onNewAssetUpload(selectedFile);

        // Clear local state
        setSelectedFile(null);

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
              onChange={handleFileChange}
              className="border p-1 rounded"
              ref={fileInputRef} // attach the ref here
            />
          </div>
          <button
            onClick={handleUpload}
            disabled={!selectedFile}
            className={`px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors ${
              !selectedFile ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            Upload New Asset
          </button>
        </div>
          )}
        </div>
      );
      };

      export default UploadAssetComponent;