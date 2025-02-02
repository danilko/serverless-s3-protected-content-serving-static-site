import {IUser, IUserToken} from "@/types";

export const getUser = async (
  apiEndpointUrl: string,
  userId: string,
  token: IUserToken
): Promise<IUser> => {
  const response = await fetch(`${apiEndpointUrl}user/${userId}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type} ${token.id_token}`,
    },
  });
  if (!response.ok) throw new Error('Failed to fetch user info');
  return response.json();
};

export const updateUser = async (
  apiEndpointUrl: string,
  userId: string,
  user: IUser,
  token: IUserToken,
): Promise<IUser> => {
  const response = await fetch(`${apiEndpointUrl}user/${userId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type} ${token.id_token}`,
    },
    body: JSON.stringify({
      nickname: user.nickname,
      profile: user.profile,
    }),
  });
  if (!response.ok) throw new Error('Failed to fetch user info');
  return response.json();
};