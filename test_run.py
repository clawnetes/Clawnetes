import requests
import time

res = requests.post("http://127.0.0.1:9999/v1/runs", json={"input": "Hello", "session_id": "test"}, headers={"Origin": "http://localhost:1420"})
print(res.status_code, res.json())
run_id = res.json()["run_id"]

res2 = requests.get(f"http://127.0.0.1:9999/v1/runs/{run_id}/events", headers={"Origin": "http://localhost:1420"}, stream=True)
print("Headers:", res2.headers)
