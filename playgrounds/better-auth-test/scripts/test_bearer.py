import requests

TOKEN = input("Paste Bearer token: ").strip()

res = requests.get(
    "http://localhost:3001/api/protected",
    headers={"Authorization": f"Bearer {TOKEN}"},
)

print(f"Status: {res.status_code}")
print(f"Response: {res.json()}")
