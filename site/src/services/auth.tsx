import { ISiteConfig, IUserToken } from '@/types';

export const loadSiteConfig = async (): Promise<ISiteConfig> => {
  const response = await fetch('/site_config.json');
  if (!response.ok) {
    throw new Error('Could not load site_config.json');
  }
  return response.json();
};

export const validateToken = (userToken: IUserToken | null): boolean => {
  return !!(userToken && userToken.expires_in && userToken.expires_in > Date.now());
};