// Get the value of a query string from the hash string.
function getHashStringParameter(name: string) {
  // eslint-disable-next-line prefer-const
	let hashString = window.location.hash;
  // eslint-disable-next-line prefer-const
	let hashStringParameters = hashString.split('&');
  // eslint-disable-next-line prefer-const
	for (let hashStringParameter of hashStringParameters) {
    // eslint-disable-next-line prefer-const
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
  // eslint-disable-next-line prefer-const
  let accessToken = getHashStringParameter('access_token');

  if (accessToken) {
    // eslint-disable-next-line prefer-const
    let message = {
        status: 'success',
        auth0Token: accessToken
    };
    Office.context.ui.messageParent(JSON.stringify(message));
  }
  else {
    // Redirect to the destination given in the "redirect" query string parameter.
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect)
      window.location.href = redirect;
  }
});
