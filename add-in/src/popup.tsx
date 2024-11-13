// Get the value of a query string from the hash string.
function getHashStringParameter(name: string) {
	const hashString = window.location.hash;
	const hashStringParameters = hashString.split('&');
	for (const hashStringParameter of hashStringParameters) {
		const [key, value] = hashStringParameter.split('=');
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
  const accessToken = getHashStringParameter('access_token');

  if (accessToken) {
    const message = {
        status: 'success',
        auth0Token: accessToken
    };
    Office.context.ui.messageParent(JSON.stringify(message));
  }
  else {
    // Redirect to the destination given in the "redirect" query string parameter.
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect) {
      window.location.href = redirect;
    }
  }
});
