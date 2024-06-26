bind = "127.0.0.1:19571"
worker_class = "uvicorn.workers.UvicornWorker"
wsgi_app = "server:app"
# Need single worker because each worker would load an LLM
workers = 1
errorlog = "error.log"
accesslog = "access.log"
capture_output = True
proc_name = "writing-tools"
pidfile = "gunicorn.pid"