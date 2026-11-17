"""kev.serve plus the /ping health check that RunPod load-balancing endpoints require.

RunPod only routes traffic to a worker once GET /ping on PORT_HEALTH returns 200.
kev.serve loads the model before uvicorn starts listening, so a 200 here already
means the model is ready; while it loads, the health check gets no answer and the
worker counts as not ready yet.

Takes the same arguments as `python -m kev.serve` (--run, --host, --port).
"""

import sys

from kev import serve

@serve.app.get("/ping")
def ping():
    return {"status": "healthy"}

if __name__ == "__main__":
    sys.exit(serve.main())
