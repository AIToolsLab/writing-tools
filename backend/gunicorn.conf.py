bind = "127.0.0.1:19571"
worker_class = "uvicorn.workers.UvicornWorker"
wsgi_app = "server:app"
# We haven't tested with multiple workers (and probably not necessary anyway).
workers = 1
errorlog = "error.log"
accesslog = "access.log"
capture_output = True
proc_name = "writing-tools"
pidfile = "gunicorn.pid"
