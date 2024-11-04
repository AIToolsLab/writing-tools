import azure.functions as func

import server

app = func.AsgiFunctionApp(
    app=server, http_auth_level=func.AuthLevel.ANONYMOUS)
