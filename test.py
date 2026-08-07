import base64
import requests

with open("sample.png", "rb") as f:
    image = base64.b64encode(f.read()).decode()

response = requests.post(
    "http://100.64.70.70:8090/api/chat",
    json={
        "model": "qweb2.5vl:7b",
        "messages": [
            {
                "role": "user",
                "content": "What is in this image? Describe it in detail.",
                "images": [image]
            }
        ],
        "stream": False
    }
)

print(response.json()["message"]["content"])