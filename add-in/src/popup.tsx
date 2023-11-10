// These came from the Auth0 dashboard.
// Look in: Applications > this app > Settings > Basic Information
const auth0Subdomain = 'dev-62nhczyl7e1oaj8a.us.auth0.com';
const auth0ClientId = 'W6MVTHKKbejEq7tCcT2oLt8gStOeHxT7';

// Get the value of a query string from the hash string.
function getHashStringParameter(name: string) {
	let hashString = window.location.hash;
	let hashStringParameters = hashString.split('&');
	for (let hashStringParameter of hashStringParameters) {
		let [key, value] = hashStringParameter.split('=');
		if (key === `#${name}`) {
			return value;
		}
	}
	return null;
}

Office.onReady(() => {
    // From https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/popup.js
    // and https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/popupRedirect.js
    // (kca simplified this to just use a single page)
    let accessToken = getHashStringParameter('access_token');

    if (accessToken) {
        let message = {
            status: 'success',
            auth0Token: accessToken
        };
        Office.context.ui.messageParent(JSON.stringify(message));
    } else {
        window.location.replace(
            `https://${auth0Subdomain}/authorize?` +
                `response_type=token&` +
                `client_id=${auth0ClientId}&` +
                `redirect_uri=${window.location.origin}/popup.html&` +
                `scope=openid`
        );
    }
});
