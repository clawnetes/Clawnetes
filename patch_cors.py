import sys

file_path = "/Users/mulugeta/.hermes/hermes-agent/gateway/platforms/api_server.py"
with open(file_path, "r") as f:
    content = f.read()

target = """        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )"""

replacement = """        cors = self._cors_headers_for_origin(request.headers.get("Origin")) if request.headers.get("Origin") else {}
        headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            **cors
        }
        response = web.StreamResponse(status=200, headers=headers)"""

if target in content:
    content = content.replace(target, replacement)
    with open(file_path, "w") as f:
        f.write(content)
    print("Patched api_server.py")
else:
    print("Target not found. Already patched?")
