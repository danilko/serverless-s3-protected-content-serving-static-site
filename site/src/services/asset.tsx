import {IUserToken, IAsset, IAssets, IAssetPresignedPost} from '@/types';

export const getAssets = async (
  apiEndpointUrl: string,
  userId: string,
  token: IUserToken,
  lastEvaluatedKey?: object,
): Promise<IAssets> => {
  const response = await fetch(`${apiEndpointUrl}user/${userId}/assets`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type} ${token.id_token}`,
    },
    body: JSON.stringify({
      lastEvaluatedKey : lastEvaluatedKey
    })
  });
  if (!response.ok) throw new Error('Failed to fetch assets');
  return response.json();
};

export const getAsset = async (
  apiEndpointUrl: string,
  userId: string,
  assetId: string,
  token: IUserToken,
): Promise<IAsset> => {
  const response = await fetch(`${apiEndpointUrl}user/${userId}/asset/${assetId}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type} ${token.id_token}`,
    },
  });
  if (!response.ok) throw new Error('Failed to fetch asset');
  return response.json();
};

export const createAssetPresignedPost = async (
  apiEndpointUrl: string,
  userId: string,
  token: IUserToken,
  assetId?: string,
): Promise<IAsset> => {
  const response = await fetch(`${apiEndpointUrl}user/${userId}/asset${assetId ? `/${assetId}` : ""}/presignedPost`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type} ${token.id_token}`,
    },
  });
  if (!response.ok) throw new Error(`Failed to fetch asset presignedPost post for ${assetId === "" ? "new asset" : `asset id ${assetId}`}`);
  return response.json();
};

export const deleteAsset = async (
  apiEndpointUrl: string,
  userId: string,
  assetId: string,
  token: IUserToken,
): Promise<void> => {
  const response = await fetch(`${apiEndpointUrl}user/${userId}/asset/${assetId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type} ${token.id_token}`,
    },
  });
  if (!response.ok) throw new Error(`Failed to delete asset id ${assetId}`);
};

export const uploadAssetWithIAssetPresignedPost = async (
  assetPresignedPost: IAssetPresignedPost,
  file: File,
): Promise<void> => {
  // Reference from https://bobbyhadz.com/blog/notes-s3-signed-url
  const formData = new FormData();

  Object.entries(assetPresignedPost.fields).forEach(([k, v]) => {
    formData.append(k, v);
  });

  formData.append('file', file);

  const response = await fetch(assetPresignedPost.url, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) throw new Error(`Failed to perform s3 upload to ${assetPresignedPost.url}`);
};