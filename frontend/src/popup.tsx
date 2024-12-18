Office.onReady(() => {
	// From https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/popup.js
	// and https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/popupRedirect.js
	// (kca simplified this to just use a single page)
	const DEBUG = false;
	const searchParams = new URLSearchParams(window.location.search);
	const redirect = searchParams.get('redirect');
	if (redirect) {
		if (DEBUG) {
			document.body.innerText = `Redirecting to ${redirect}`;
		}
		setTimeout(
			() => {
				window.location.href = redirect;
			},
			DEBUG ? 5000 : 0
		);
	} else {
		// Note: this will also get called with `logout=true` in the logout flow, but
		// the only thing we need to do here is message the parent to get the dialog to close,
		// so it's fine to take the same action in both cases.
		const message = {
			status: 'success',
			urlWithAuthInfo: window.location.href
		};
		if (DEBUG) {
			document.body.innerText = `Messaging parent with ${JSON.stringify(
				message
			)}`;
		}
		setTimeout(
			() => {
				Office.context.ui.messageParent(JSON.stringify(message));
			},
			DEBUG ? 5000 : 0
		);
	}
});
