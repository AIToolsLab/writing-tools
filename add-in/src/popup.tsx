Office.onReady(() => {
  // From https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/popup.js
  // and https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/popupRedirect.js
  // (kca simplified this to just use a single page)
  const searchParams = new URLSearchParams(window.location.search);
  const redirect = searchParams.get('redirect');
  if (redirect) {
    window.location.href = redirect;
  } else {
    const message = {
        status: 'success',
        urlWithAuthInfo: window.location.href
    };
    Office.context.ui.messageParent(JSON.stringify(message));
  }
});
