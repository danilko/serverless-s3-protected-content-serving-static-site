
import React, { useState, useEffect } from 'react';
import { ISiteConfig, IUserToken, IUser, IAsset } from '@/types';
import {
  loadSiteConfig,
  validateToken,
} from '@/services/auth';
import {
  createAssetPresignedPost, deleteAsset, getAsset,
  getAssets, uploadAssetWithIAssetPresignedPost,
} from '@/services/asset';
import UserComponent from '../components/UserComponent';
import AssetListComponent from '../components/AssetListComponent';
import {
  getUser,updateUser} from "@/services/user";
import UploadNewAssetComponent from "@/components/UploadNewAssetComponent";
import {useNotification} from "@/components/NotificationContext";

const App: React.FC = () => {
  const [config, setConfig] = useState<ISiteConfig | null>(null);
  const [userToken, setUserToken] = useState<IUserToken | null>(null);
  const [userInfo, setUserInfo] = useState<IUser | null>(null);
  const [assets, setAssets] = useState<IAsset[]>([]);
  const [assetsPageToken, setAssetsPageToken] = useState<object | null>(null);
  const { showNotification } = useNotification();

  useEffect(() => {
    const initApp = async () => {
      try {
        const configData = await loadSiteConfig();
        if (
          !configData.signInUrl.trim() ||
          !configData.apiEndpointUrl.trim()
        ) {
          showNotification("site_config.json is not setup correctly", "error");
          return;
        }
        setConfig(configData);

        const url = new URL(window.location.href);
        if (url.hash.includes('#id_token=')) {
          await handleTokenCallback(url.hash, configData);
        } else if (!validateToken(userToken)) {
          window.location.replace(configData.signInUrl);
        }
      } catch (error) {
        console.error(error);
        showNotification("Error initializing application.", "error");
      }
    };

    initApp();
    // We intentionally run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTokenCallback = async (hash: string, configData: ISiteConfig) => {
    const searchParams = new URLSearchParams(hash.replace('#', ''));
    const expires_in =
      Date.now() +
      parseInt(searchParams.get('expires_in') || '0', 10) * 1000 -
      300 * 1000;
    const token: IUserToken = {
      id_token: searchParams.get('id_token') || '',
      access_token: searchParams.get('access_token') || '',
      token_type: searchParams.get('token_type') || '',
      expires_in,
    };
    setUserToken(token);

    // Assume the OAuth2 endpoint can be derived from signInUrl
    const oauth2Endpoint = `https://${new URL(configData.signInUrl).hostname}/`;
    try {
      // Fetch OAuth2 user info
      const oauthResponse = await fetch(`${oauth2Endpoint}/oauth2/userInfo`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${token.token_type} ${token.access_token}`,
        },
      });
      const oauthUser = await oauthResponse.json();
      // Fetch full user info from your API
      const fullUserInfo = await getUser(
        configData.apiEndpointUrl,
        oauthUser.username,
        token
      );
      setUserInfo(fullUserInfo);
      // Clean up URL (remove hash)
      window.history.pushState('', '', '/');
    } catch (error) {
      console.error(error);
      showNotification('Error handling token callback.', "error");
    }
  };

  const handleUserUpdate = async (updatedInfo: IUser) => {
    if (!config || !userInfo || !userToken) {
      showNotification('Fail to load assets as user token is invalid, please refresh page.', "error");
      return;
    }
    try {
    const data = await updateUser(
      config.apiEndpointUrl,
      userInfo.id,
      updatedInfo,
      userToken,
    );

    setUserInfo(data);
      showNotification("Success updating user info", "success");
  } catch (error) {
    console.error(error);
    showNotification(`Fail to update user due to ${error}`, "error");
  }
  };

  const handleLoadAssets = async (lastEvaluatedKey?: object) => {
    if (!config || !userInfo || !userToken) {
      showNotification('Fail to load assets as user token is invalid, please refresh page.', "error");
      return;
    }
    try {
      const data = await getAssets(
        config.apiEndpointUrl,
        userInfo.id,
        userToken,
        lastEvaluatedKey
      );
      if (lastEvaluatedKey) {
        setAssets((prev) => [...prev, ...data.assets]);
      } else {
        setAssets(data.assets);
      }
      setAssetsPageToken(data.lastEvaluatedKey || null);
    } catch (error) {
      console.error(error);
      showNotification(`Error get asset list: ${error}`, "error");
    }
  };

  const handleDeleteAsset = async (asset: IAsset) => {
    if (!config || !userInfo || !userToken) {
      showNotification('Fail to load assets as user token is invalid, please refresh page.', "error");
      return;
    }
    // update asset in state
    await deleteAsset(
      config.apiEndpointUrl,
      userInfo.id,
      asset.id,
      userToken,
    );

    removeAsset(asset);

    showNotification(`Success delete asset ${asset.id}`, "success");
  }

  const removeAsset = (removedAsset: IAsset) => {
    setAssets((prevAssets) => prevAssets.filter((asset) => asset.id !== removedAsset.id));
  };

  const handleRefreshAsset= async (asset: IAsset)  => {
    if (!config || !userInfo || !userToken) {
      showNotification('Fail to load assets as user token is invalid, please refresh page.', "error");
      return;
    }
    const data = await getAsset(
      config.apiEndpointUrl,
      userInfo.id,
      asset.id,
      userToken,
    );

    // update asset in state
    updateAsset(data);
  }

  const handleUploadAsset= async (asset: IAsset, file: File) => {
    if (!config || !userInfo || !userToken) {
      showNotification('Fail to load assets as user token is invalid, please refresh page.', "error");
      return;
    }
    const data = await createAssetPresignedPost(
      config.apiEndpointUrl,
      userInfo.id,
      userToken,
      asset.id,
    );

    if(!data.presignedPost) {
      showNotification(`Error get necessary fields for updating asset ${asset.id}`, "error");
      return;
    }

    await uploadAssetWithIAssetPresignedPost(
      data.presignedPost,
      file,
    );

    await handleRefreshAsset(asset);

    showNotification(`Success upload exit asset ID ${data.id}`, "success");
  }

  const updateAsset = (updatedAsset: IAsset) => {
    setAssets((prevAssets) =>
      prevAssets.map((asset) =>
        asset.id === updatedAsset.id ? updatedAsset : asset
      )
    );
  };


  const handleNewAssetUpload = async (file: File) => {
    if (!config || !userInfo || !userToken) {
      showNotification('Fail to load assets as user token is invalid, please refresh page.', "error");
      return;
    }
      const data = await createAssetPresignedPost(
        config.apiEndpointUrl,
        userInfo.id,
        userToken,
        undefined,
      );

      if(!data.presignedPost) {
        showNotification(`Error get necessary fields for uploading new asset`, "error");
        return;
      }

      await uploadAssetWithIAssetPresignedPost(
        data.presignedPost,
        file,
      );

      // append new asset into the field
        setAssets((prev) => [...prev, ...[data]]);

    showNotification(`Success upload new asset with asset ID ${data.id}`, "success");
  };

  return (
    <div className="container mx-auto p-6">
      {userInfo ? (
        <div>
          <h1 className="text-3xl font-bold mb-6">Welcome, {userInfo.nickname}!</h1>
          <UserComponent userInfo={userInfo} onUpdate={handleUserUpdate} />

          <UploadNewAssetComponent onNewAssetUpload={handleNewAssetUpload} />
          <div className="my-8">
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() => handleLoadAssets(undefined)}
            >
              Load My Assets
            </button>
          </div>

          <AssetListComponent
            assets={assets}
            pageToken={assetsPageToken}
            onNextPage={handleLoadAssets}
            isEditable={true}
           onDeleteAssetHandler={handleDeleteAsset} onRefreshAssetStatusHandler={handleRefreshAsset} onUploadAssetHandler={handleUploadAsset}/>

        </div>
      ) : (
        <p className="text-xl">Loading user information...</p>
      )}
    </div>
  );
};

export default App;