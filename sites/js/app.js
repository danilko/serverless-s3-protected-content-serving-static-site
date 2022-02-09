
// This is an very raw sample to test the login
// This will need clean up + improvement to be ready for production usage

var signInUrl = '';
var apiEndpointUrl = '';

var oauth2Endpoint = '';

var global = this;
var userToken = null;
var userInfo = null;

var initApp = async function()
{
    var config = await new Promise((resolve, reject) => {
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

    if(!config.signInUrl || config.signInUrl.trim().length == 0 || !config.apiEndpointUrl || config.apiEndpointUrl.trim().length == 0 )
    {
        setNotification("site_config.json is not setup correctly");
        return;
    }

    // Setup the site
    global.signInUrl = config.signInUrl.trim();
    global.apiEndpointUrl = config.apiEndpointUrl.trim();
    global.oauth2Endpoint = 'https://' + (new URL(signInUrl)).hostname + '/';

    router();
}

var clearNotification = async function ()
{
    document.getElementById('message').innerHTML = "";
}

var setNotification = async function (message)
{
    var html = message;
    var html = html + "<br/><input type=\"button\" value=\"Clear Message\" onClick=\"clearNotification()\"\>";
    document.getElementById('message').innerHTML = html;
}

var router = async function () {
    const url = new URL(window.location.href)

    if (url.hash.includes("#id_token=")) {
        // This is from callback
        extractUserToken(url.hash.replace('#', ''));
    }
    else {
        await validateToken();
    }
}

var validateToken = async function () {
    if (global.userToken != null && global.userToken.expires_in != null && global.userToken.expires_in > Date.now()) {
        return true;
    }
    else {
        // Force user login
        window.location.replace(signInUrl);
    }
}

var extractUserToken = async function (hash) {
    const searchParams = new URLSearchParams(hash);

    // Get the current time in second
    // https://stackoverflow.com/questions/3830244/get-current-date-time-in-seconds
    // Then minus about 5 minute (300s) to get a buffer
    var expires_in = Date.now() + (searchParams.get('expires_in') * 1000) - (300 * 1000);

    global.userToken = {
        id_token: searchParams.get('id_token'),
        access_token: searchParams.get('access_token'),
        token_type: searchParams.get('token_type'),
        expires_in: expires_in
    }

    var user = await new Promise((resolve, reject) => {
        // Get user info
        fetch(oauth2Endpoint + '/oauth2/userInfo', {
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
    //window.history.pushState("", "Test", "/");
}


var getUser = async function (userId) {
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    fetch(apiEndpointUrl + 'user/' + userId, {
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
        fetch(apiEndpointUrl + 'users' + query, {
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
    populateUserContents(data, lastEvaluatedId ? false : true);
}

var checkImage = async function (imageUrl) {
    return await new Promise((resolve, reject) => {
        fetch(imageUrl, {
            method: 'GET',
        })
            .then(response => {
                if (response.ok) {
                    resolve(true);
                }
                else if (response.status == 404) {
                    resolve(false);
                }
                else {
                    throw new Error('Network response was not 2xx/404');
                }
            })
            .catch((error) => {
                console.error('Error:', error);
                reject(error);
            });
    })
}

// Reference the users.js from lambda
// Use the sts token to exchange for S3 presigned url to show on browser and download link
var populateUserContent = async function () {

    var html = "<div><br/>"

    // Update user field
    html = html + "<div>UserId: " + global.userInfo.id + "</div><br/>"
    // Update nickname field as input filed
    html = html + "<div>Nickname: <input type=\"text\" id=\"nickname\" value=\"" + global.userInfo.nickname + "\"></div><br/>";
    html = html + "<div>Profile: <input type=\"text\" id=\"profile\" value=\"" + global.userInfo.profile + "\"></div><br/>";
    html = html + "<input type=\"button\" onClick=\"updateUserInfo()\" value=\"Update User Info\">";
    html = html + "<div id=\"profilePicture\"></div><br/>"

    // Only present the field
    if (global.userInfo.profilePicture.hasOwnProperty("preSignedPost")) {
        html = html + "<div><label for=\"file\">Choose file to upload: </label><input type=\"file\" id=\"profilePictureFile\" accept=\".png\"><br/><input type=\"button\" onClick=\"uploadProfilePicture()\" value=\"Upload Profile Picture\"></div>"
    }

    // finish the div tag
    html = html + "</div>"

    document.getElementById('user').innerHTML = html;

    // Check if image exist
    var imageExist = await checkImage(global.userInfo.profilePicture.getSignedUrl);

    if (imageExist) {
        // Image exist and is loaded
        document.getElementById('profilePicture').innerHTML = "<div><img style=\"width:128px;height:128px;\" src=\"" + global.userInfo.profilePicture.getSignedUrl + "\"><a href = \"" + global.userInfo.profilePicture.getSignedUrl + "\">DOWNLOAD LINK</a></div>"
    }
    else {
        // Image DID NOT LOAD
        document.getElementById('profilePicture').innerHTML = "<div>Asset: NO PROFILE PICTURE EXIST, PLEASE UPLOAD</div>";
    }
}

var populateUserContents = async function (data, clearContent) {
    var html = "<div>"

    for (var index = 0; index < data.users.length; index++) {
        var userInfo = data.users[index];

        html = html + "<div id=\"user_" + userInfo.id + "\">";

        // Update user field
        html = html + "<div>UserId: " + userInfo.id + "</div><br/>"

        // Update nickname field as input filed
        html = html + "<div>Nickname:" + userInfo.nickname + "</div><br/>";
        html = html + "<div>Profile:" + userInfo.profile + "</div><br/>";

        // Check if image exist
        var imageExist = await checkImage(userInfo.profilePicture.getSignedUrl);

        if (imageExist) {
            // Image exist and is loaded
            html = html + "<div id=\"profilePicture\"><img style=\"width:128px;height:128px;\" src=\"" + userInfo.profilePicture.getSignedUrl + "\"></div><br/>";
        }
        else {
            // Image DID NOT LOAD
            html = html + "<div id=\"profilePicture\">NO ASSET</div><br/>";
        }
        // finish the user div tag
        html = html + "</div><br/>"
    }

    // finish the div tag
    html = html + "</div>";

    if (data.lastEvaluatedId) {
        // Add a next button with last lastEvaluatedId
        html = html + "<div><input type=\"button\" value =\"Next\" onClick=\"getAllUserAPI(" + data.lastEvaluatedId + ")\"></div><br/>"
    }

    // Clear previous results 
    if (clearContent) {
        // Then just replace whole content
        document.getElementById('users').innerHTML = html;
    }
    else {
        // Otherwise clear
        document.getElementById('users').innerHTML = document.getElementById('users').innerHTML + html;
    }

}

var updateUserInfo = async function () {
    // get the value
    var body = {
        nickname: document.getElementById('nickname').value,
        profile: document.getElementById('profile').value
    }

    // Update content
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    fetch(apiEndpointUrl + 'user/' + global.userInfo.id, {
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

var uploadProfilePicture = async function () {

    // Reference from https://bobbyhadz.com/blog/notes-s3-signed-url
    const formData = new FormData();

    Object.entries(global.userInfo.profilePicture.preSignedPost.fields).forEach(([k, v]) => {
        formData.append(k, v);
    });

    formData.append('file', document.getElementById('profilePictureFile').files[0]);

    // post data
    fetch(global.userInfo.profilePicture.preSignedPost.url, {
        method: 'POST',
        body: formData
    })
        .then(data => {
            // reload image
            populateUserContent();
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}
