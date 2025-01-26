// This is an very raw sample to test the login
// This will need clean up + improvement to be ready for production usage

const global = this;

const initApp = async function () {
  const config = await new Promise((resolve, reject) => {
    // Get user info
    fetch('/site_config.json', {
      method: 'GET'
    })
      .then(response => response.json())
      .then(data => {
        resolve(data);
      })
      .catch((error) => {
        console.error('Error:', error);
        reject(error);
      });
  });

  if (!config.signInUrl || config.signInUrl.trim().length === 0 || !config.apiEndpointUrl || config.apiEndpointUrl.trim().length === 0) {
    await setNotification("site_config.json is not setup correctly");
    return;
  }

  // Setup the site
  global.signInUrl = config.signInUrl.trim();
  global.apiEndpointUrl = config.apiEndpointUrl.trim();
  global.oauth2Endpoint = `https://${(new URL(global.signInUrl)).hostname}/`;

  await router();
}

const clearNotification = async function () {
  document.getElementById('message').innerHTML = "";
}

const setNotification = async function (message) {
  let messageDiv = document.getElementById('message');

  let messageContentDiv = document.createElement("div");
  messageContentDiv.textContent = message;
  messageDiv.append(messageContentDiv);

  let messageClearButton = document.createElement("input");
  messageClearButton.type = "button";
  messageClearButton.value = "Clear Message";
  messageClearButton.addEventListener("click", () => {
    clearNotification();
  });
  messageDiv.append(messageClearButton);
}

const router = async function () {
  const url = new URL(window.location.href)

  if (url.hash.includes("#id_token=")) {
    // This is from callback
    extractUserToken(url.hash.replace('#', ''));
  } else {
    await validateToken();
  }
}

const validateToken = async function () {
  if (global.userToken != null && global.userToken.expires_in != null && global.userToken.expires_in > Date.now()) {
    return true;
  } else {
    // Force user login
    window.location.replace(global.signInUrl);
  }
}

const extractUserToken = async function (hash) {
  const searchParams = new URLSearchParams(hash);

  // Get the current time in second
  // https://stackoverflow.com/questions/3830244/get-current-date-time-in-seconds
  // Then minus about 5 minute (300s) to get a buffer
  let expires_in = Date.now() + (searchParams.get('expires_in') * 1000) - (300 * 1000);

  global.userToken = {
    id_token: searchParams.get('id_token'),
    access_token: searchParams.get('access_token'),
    token_type: searchParams.get('token_type'),
    expires_in: expires_in
  }

  let user = await new Promise((resolve, reject) => {
    // Get user info
    fetch(global.oauth2Endpoint + '/oauth2/userInfo', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': global.userToken.token_type + ' ' + global.userToken.access_token
      }
    })
      .then(response => response.json())
      .then(data => {
        resolve(data);
      })
      .catch((error) => {
        console.error('Error:', error);
        reject(error);
      });
  });
  await getUser(user.username);

  // Clean the url header
  window.history.pushState("", "Test", "/");
}


var getUser = async function (userId) {
  // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
  fetch(global.apiEndpointUrl + 'user/' + userId, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': global.userToken.token_type + ' ' + global.userToken.id_token
    }
  })
    .then(response => response.json())
    .then(data => {
      global.userInfo = data;
      populateUserContent();
    })
    .catch((error) => {
      console.error('Error:', error);
    });

}

var getAllUserAPI = async function (lastEvaluatedId) {
  var data = await new Promise((resolve, reject) => {
    // Introduce query for lastEvaluatedId for pagination if one exist
    var query = lastEvaluatedId ? '?lastEvaluatedId=' + lastEvaluatedId : '';
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    fetch(global.apiEndpointUrl + 'users' + query, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': global.userToken.token_type + ' ' + global.userToken.id_token
      }
    })
      .then(response => response.json())
      .then(data => {
        resolve(data);
      })
      .catch((error) => {
        console.error('Error:', error);
        reject(error);
      });
  });

  // Do not clear content if lastEvaluatedId is valid (as this is continous search)
  // Clear content if lastEvaluatedId is invalid (indicate first search)
  await populateUserContents(data, !lastEvaluatedId);
}

// Reference the users.js from lambda
// Use the sts token to exchange for S3 presigned url to show on browser and download link
const populateUserContent = async function () {
  document.getElementById('user').innerHTML = "";
  document.getElementById('user').append(await createUserDiv(global.userInfo, true));

}

const populateUserAssetDiv = async function (userAssetDiv, userId, asset, isEditable) {
  // Check if image exist
  let userProfileAssetStatus = document.createElement("div");
  userProfileAssetStatus.textContent = `asset ${asset.id} status: ${asset.status}`;
  userAssetDiv.append(userProfileAssetStatus);

  if (asset.status === "UPLOADED") {
    let userAssetImg = document.createElement("img");
    userAssetImg.style = "width:128px;height:128px;";
    userAssetImg.src = asset.url;
    userAssetImg.alt = "";
    userAssetDiv.append(userAssetImg);
  } else {
    let message = "STATUS IS NOT UPLOADED";
    if (isEditable) {
      message = `${message} PLEASE UPLOAD.`
    }
    let userAssetMessage = document.createElement("div");
    userAssetMessage.textContent = message;
    userAssetDiv.append(userAssetMessage);
  }
  userAssetDiv.append(document.createElement("br"));

  if (isEditable) {
    let updateAssetFileLable = document.createElement("label");
    updateAssetFileLable.for = `user_${userId}_asset_${asset.id}_file`
    updateAssetFileLable.value = "Select new file for asset: ";
    userAssetDiv.append(updateAssetFileLable);

    let updateAssetFile = document.createElement("input");
    updateAssetFile.id = `user_${userId}_asset_${asset.id}_file`;
    updateAssetFile.accept = ".png";
    updateAssetFile.type = "file";
    userAssetDiv.append(updateAssetFile);

    userAssetDiv.append(document.createElement("br"));

    let updateAssetButton = document.createElement("input");
    updateAssetButton.addEventListener("click", () => {
      uploadAsset(userId, asset.id, isEditable);
    });
    updateAssetButton.type = "button";
    updateAssetButton.value = "Upload Asset";
    userAssetDiv.append(updateAssetButton);
    userAssetDiv.append(document.createElement("br"));
    let deleteAssetButton = document.createElement("input");
    deleteAssetButton.addEventListener("click", () => {
      deleteAsset(userId, asset.id);
    });
    deleteAssetButton.type = "button";
    deleteAssetButton.value = "Delete Asset";
    userAssetDiv.append(deleteAssetButton);
    userAssetDiv.append(document.createElement("br"));

    let refreshAssetButton = document.createElement("input");
    refreshAssetButton.addEventListener("click", () => {
      getAsset(userId, asset.id, isEditable);
    });
    refreshAssetButton.type = "button";
    refreshAssetButton.value = "Refresh Asset";
    userAssetDiv.append(refreshAssetButton);
    userAssetDiv.append(document.createElement("br"));
  }
  userAssetDiv.append(document.createElement("br"));
}

const createUserDiv = async function (userInfo, isEditable) {

  let userDiv = document.createElement("div");
  userDiv.id = `user_${userInfo.id}`;

  // Update user field
  let userIdDiv = document.createElement("div");
  userIdDiv.textContent = `UserId: ${userInfo.id}`;
  userDiv.append(userIdDiv);

  userDiv.append(document.createElement("br"));

  // Update nickname/profile
  let userNicknameDiv = document.createElement("div");
  userNicknameDiv.textContent = `Nickname:`;
  if (isEditable) {
    let textField = document.createElement("input");
    textField.type = "text"
    textField.id = "nickname";
    textField.value = global.userInfo.nickname;
    userNicknameDiv.append(textField);
  } else {
    userNicknameDiv.textContent = `Nickname: ${global.userInfo.nickname}`;
  }
  userDiv.append(userNicknameDiv);

  userDiv.append(document.createElement("br"));

  let userProfileDiv = document.createElement("div");
  userProfileDiv.textContent = `Profile: `;
  if (isEditable) {
    let textField = document.createElement("input");
    textField.type = "text"
    textField.id = "profile";
    textField.value = global.userInfo.profile;
    userProfileDiv.append(textField);
  } else {
    userProfileDiv.textContent = `Nickname: ${userInfo.profile}`;
  }
  userDiv.append(userProfileDiv);

  userDiv.append(document.createElement("br"));


  if (isEditable) {
    let updateProfileButton = document.createElement("input");
    updateProfileButton.addEventListener("click", () => {
      updateUserInfo();
    });
    updateProfileButton.type = "button";
    updateProfileButton.value = "Update User Info";
    userDiv.append(updateProfileButton);

    userDiv.append(document.createElement("br"));

  }

  let userProfileAsset = document.createElement("div");
  userProfileAsset.id = `user_${userInfo.id}_asset_${userInfo.profileAsset.id}`;
  userDiv.append(userProfileAsset);
  await populateUserAssetDiv(userProfileAsset,
    userInfo.id, userInfo.profileAsset, isEditable);

  userDiv.append(document.createElement("br"));

  return userDiv;
}

const populateUserContents = async function (data, clearContent) {

  let usersDiv = document.getElementById('users');

  // Clear previous results
  if (clearContent) {
    // Then just replace whole content
    usersDiv.innerHTML = "";
  }

  // Append new users
  for (let index = 0; index < data.users.length; index++) {
    usersDiv.append(await createUserDiv(data.users[index], false));
  }

  let usersNextDiv = document.getElementById('usersNext');
  usersNextDiv.innerHTML = "";


  // Add a next button with last lastEvaluatedId
  let userNextButton = document.createElement("input");
  userNextButton.addEventListener("click", () => {
    getAllUserAPI(data.lastEvaluatedId);
  });
  userNextButton.type = "button";
  userNextButton.value = "Next Page";
  usersNextDiv.append(userNextButton);
  if (data.lastEvaluatedId) {
    userNextButton.setAttribute("value", "No More Next Page");
    userNextButton.disabled = true;
  }

  usersNextDiv.append(document.createElement("br"));

}

const updateUserInfo = async function () {
  // get the value
  let body = {
    nickname: document.getElementById('nickname').value,
    profile: document.getElementById('profile').value
  }

  // Update content
  // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
  fetch(global.apiEndpointUrl + 'user/' + global.userInfo.id, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': global.userToken.token_type + ' ' + global.userToken.id_token
    },
    body: JSON.stringify(body)
  })
    .then(response => response.json())
    .then(data => {
      global.userInfo = data;
      populateUserContent();
    })
    .catch((error) => {
      console.error('Error:', error);
    });
}

const getAsset = async function (userId, assetId, isEditable) {

  // get asset metadata such as status/presigned url
  let response = await new Promise((resolve, reject) => {
    fetch(`${global.apiEndpointUrl}user/${userId}/asset/${assetId}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': global.userToken.token_type + ' ' + global.userToken.id_token
      }
    })
      .then(response => response.json())
      .then(data => {
        resolve(data);
      })
      .catch((error) => {
        setNotification(`FAIL TO GET ASSET ${assetId} ON USER ${userId} WITH ERROR: ${error}`);

        reject(error);
      });
  });

  let assetDiv = document.getElementById(`user_${userId}_asset_${assetId}`);
  if (assetDiv) {
    // clear content
    assetDiv.innerHTML = "";
    await populateUserAssetDiv(assetDiv, userId, response, isEditable);
  }
}

const deleteAsset = async function (userId, assetId) {
  // fetch the presigned post, which is a temporary form data object for uploading to S3 for target asset
  let response = await new Promise((resolve, reject) => {
    fetch(`${global.apiEndpointUrl}user/${userId}/asset/${assetId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': global.userToken.token_type + ' ' + global.userToken.id_token
      }
    })
      .then(response => response.json())
      .then(data => {
        resolve(data);
      })
      .catch((error) => {
        setNotification(`FAIL TO GET ASSET ${assetId} ON USER ${userId} WITH ERROR: ${error}`);

        reject(error);
      });
  });

  document.getElementById(`user_${userId}_asset_${assetId}`).remove();

  // If this is profile picture, reload user info
  if (assetId === userId) {
    await updateUserInfo();
  }
}

const uploadAsset = async function (userId, assetId, isEditable) {

  // fetch the presigned post, which is a temporary form data object for uploading to S3 for target asset
  let response = await new Promise((resolve, reject) => {
    fetch(`${global.apiEndpointUrl}user/${userId}/asset/${assetId}/presignedPost`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': global.userToken.token_type + ' ' + global.userToken.id_token
      }
    })
      .then(response => response.json())
      .then(data => {
        resolve(data);
      })
      .catch((error) => {
        setNotification(`FAIL TO UPLOAD ASSET ${assetId} ON USER ${userId} WITH ERROR: ${error}`);

        reject(error);
      });
  });

  // Reference from https://bobbyhadz.com/blog/notes-s3-signed-url
  const formData = new FormData();

  Object.entries(response.fields).forEach(([k, v]) => {
    formData.append(k, v);
  });

  formData.append('file', document.getElementById(`user_${userId}_asset_${assetId}_file`).files[0]);

  // post data
  fetch(response.url, {
    method: 'POST',
    body: formData
  })
    .then(data => {
      getAsset(userId, assetId, isEditable)
    })
    .catch((error) => {
      setNotification('FAIL TO UPLOAD PROFILE PICTURE WITH ERROR ' + error);

      console.error('Error:', error);
    });
}
