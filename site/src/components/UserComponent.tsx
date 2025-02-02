import React, { useState, useEffect } from 'react';
import { IUser } from '@/types';

interface UserComponentProps {
  userInfo: IUser;
  onUpdate: (updatedInfo: IUser) => void;
}

const UserComponent: React.FC<UserComponentProps> = ({ userInfo, onUpdate }) => {
  const [nickname, setNickname] = useState(userInfo.nickname);
  const [profile, setProfile] = useState(userInfo.profile);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setNickname(userInfo.nickname);
    setProfile(userInfo.profile);
  }, [userInfo]);

  const handleUpdate = () => {
    onUpdate({
      ...userInfo,
      nickname,
      profile,
    });
  };

  return (
    <div className="bg-white p-6 rounded shadow my-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-blue-700">User Info</h2>
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
          <div className="mb-3">
            <span className="font-medium">UserId:</span> {userInfo.id}
          </div>
          <div className="mb-3">
            <label className="block mb-1 font-medium">Nickname:</label>
            <input
              type="text"
              className="w-full border rounded p-2"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <div className="mb-3">
            <label className="block mb-1 font-medium">Profile:</label>
            <input
              type="text"
              className="w-full border rounded p-2"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
          </div>
          <button
            onClick={handleUpdate}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Update User Info
          </button>
        </div>
      )}
    </div>
  );
};

export default UserComponent;