
// This is an very raw sample to test the login
// This will need clean up + improvement to be ready for production usage

var signInUrl = '<signInUrl>';
var apiEndpointUrl = '<apiEndpointUrl>';

var global = this;
var user = null;
var userAssetInfo = null;


function router() {
    const url = new URL(window.location.href)

    if (url.hash.includes("#id_token=")) {
        // This is from callback
        callback(url.hash.replace('#', ''));
    }
    else {
        validateCredential();
    }
}

function validateCredential() {
    if (global.user != null && global.user.expiration != null && global.user.expiration > Math.round(Date.now() / 1000)) {
        return true;
    }
    else {
        // Force user login
        window.location.replace(signInUrl);
    }
}

function callback(hash) {
    const searchParams = new URLSearchParams(hash);

    // Get the current time in second
    // https://stackoverflow.com/questions/3830244/get-current-date-time-in-seconds
    // Then minus about 5 minute (300s) to get a buffer
    var expiration = Math.round(Date.now() / 1000) + searchParams.get('expires_in') - 300;

    global.user = {
        id_token: searchParams.get('id_token'),
        token_type: searchParams.get('token_type'),
        expires_in: expiration
    }
    callUserAPI();

    // Clean the url header
    window.history.pushState("", "Test", "/");
}

function callUserAPI() {
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    fetch(apiEndpointUrl + 'user/', {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.user.token_type + ' ' + global.user.id_token
        }
    })
        .then(response => response.json())
        .then(data => {
            userAssetInfo = data;
            fetchContents();
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}


// Reference the users.js from lambda
// Use the sts token to exchange for S3 presigned url to show on browser and download link
function fetchContents() {

    var html = "<div><br/>"

    // Update user field
    html = html + "<div>UserId: " + userAssetInfo.userId + "</div><br/>"
    // Update nickname field as input filed
    html = html + "<div>Nickname: <input type=\"text\" id=\"nickname\" value=\"" + userAssetInfo.nickname + "\"><input type=\"button\" onClick=\"updateNickname()\" value=\"Update Nickname\"></div><br/>"
    html = html + "<div id=\"asset\"></div><br/>"
    html = html + "<div><label for=\"file\">Choose file to upload: </label><input type=\"file\" id=\"assetFile\" accept=\".png\"><br/><input type=\"button\" onClick=\"uploadAsset()\" value=\"Upload File\"></div>"

    // finish the div tag
    html = html + "</div>"


    document.getElementById('app').innerHTML = html;

    // Check if image exist
    var assetImage = new Image();
    assetImage.src = userAssetInfo.asset.getSignedUrl;

    assetImage.onload = function () {
        // Image exist and is loaded
        // append date. now to refresh
        document.getElementById('asset').innerHTML = "Asset (will need to refresh the page to see latest update, download will reflect the latest update): <img src=\"" + userAssetInfo.asset.getSignedUrl + "\"><a href = \"" + userAssetInfo.asset.getSignedUrl + "\">DOWNLOAD LINK</a></div>"
    }

    assetImage.onerror = function () {
        // Image DID NOT LOAD
        document.getElementById('asset').innerHTML = "Asset: NO ASSET EXIST, PLEASE UPLOAD"
    }
}

function updateNickname() {
    // get the value
    var body = {
        nickname: document.getElementById('nickname').value
    }

    // Update content
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
    fetch(apiEndpointUrl + 'user/' + userAssetInfo.userId, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': global.user.token_type + ' ' + global.user.id_token
        },
        body: JSON.stringify(body)
    })
    .then(response => response.json())
    .then(data => {
            userAssetInfo.nickname = data.nickname;
            // refresh page
            fetchContents();
        })
        .catch((error) => {
            console.error('Error:', error);
        });
}

function uploadAsset() {

    console.log("start upload");
    // Reference from https://bobbyhadz.com/blog/notes-s3-signed-url
    const formData = new FormData();

    Object.entries(userAssetInfo.asset.postSignedUrl.fields).forEach(([k, v]) => {
        formData.append(k, v);
    });

    formData.append('file', document.getElementById('assetFile').files[0]);

    // post data
   fetch(userAssetInfo.asset.postSignedUrl.url, {
        method: 'POST',
        body: formData
    })
    .then(data => {
     // reload image
     callUserAPI();
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}
