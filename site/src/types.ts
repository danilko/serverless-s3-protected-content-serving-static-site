export interface ISiteConfig {
  signInUrl: string;
  apiEndpointUrl: string;
}

export interface IUserToken {
  id_token: string;
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface IAsset {
  id: string;
  status: string;
  urls: {
    url: string;
    hiResUrl?: string;
  };
  presignedPost?: IAssetPresignedPost
}

export interface IAssetPresignedPost {
    fields : object,
    url: string,
}

export interface IAssets {
  assets: IAsset[];
  lastEvaluatedId?: string;
}

export interface IUser {
  id: string;
  nickname: string;
  profile: string;
  profileAsset?: IAsset;
}
