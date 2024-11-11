import azure.functions as func


import server
app = func.AsgiFunctionApp(
    app=server.app, http_auth_level=func.AuthLevel.ANONYMOUS)
