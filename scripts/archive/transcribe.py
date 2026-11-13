#!/usr/bin/env python3

import time
import requests
import urllib.parse
import json
from dotenv import load_dotenv
import os
import argparse

load_dotenv()

subscription_key = os.getenv("AZURE_SPEECH_KEY") or ""
region = os.getenv("AZURE_REGION") or ""

assert subscription_key, "Please set AZURE_SPEECH_KEY in .env"
assert region, "Please set AZURE_REGION in .env"

parser = argparse.ArgumentParser(description="Transcribe audio file")
parser.add_argument("--url", type=str, help="URL of the audio file to transcribe")
parser.add_argument("--sas-token", type=str, default=os.getenv("SAS_TOKEN"))
args = parser.parse_args()

url = args.url
filename_from_url = url.rsplit("/", 1)[-1]
filename_url_decoded = urllib.parse.unquote(filename_from_url)
output_filename = f"{filename_url_decoded}.json"

print("Starting request to transcribe", url)
print(f"Will save the result to {output_filename}")

url_with_key = f"{url}?{args.sas_token}"


endpoint = f"https://{region}.api.cognitive.microsoft.com"

headers = {
    "Ocp-Apim-Subscription-Key": subscription_key,
    "Content-Type": "application/json"
}

data = {
    "contentUrls": [
        url_with_key,
    ],
    "properties": {
        "diarizationEnabled": True,
        "wordLevelTimestampsEnabled": False,
        "displayFormWordLevelTimestampsEnabled": False,
        "channels": [
            0,
            1
        ],
        "punctuationMode": "DictatedAndAutomatic",
        "profanityFilterMode": "Masked",
        "diarization": {
            "speakers": {
                "minCount": 2,
                "maxCount": 5
            }
        }
    },
    "locale": "en-US",
    "displayName": "Test Transcription",
    "timeToLive": "PT12H"
}

url = f"{endpoint}/speechtotext/v3.2-preview.2/transcriptions"
response = requests.post(url, headers=headers, data=json.dumps(data))
response.raise_for_status()

result = response.json()
print(response.json())

transcription_id = result["self"]

# get status
# curl -v -X GET "https://YourServiceRegion.api.cognitive.microsoft.com/speechtotext/v3.2/transcriptions/YourTranscriptionId" -H "Ocp-Apim-Subscription-Key: YourSubscriptionKey"
# Poll periodically until status is "Succeeded" or "Failed"
# https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/batch-transcription
while True:
    status_response = requests.get(f"{transcription_id}", headers=headers)
    status = status_response.json()["status"]
    print(status)
    if status in ["Succeeded", "Failed"]:
        break

    time.sleep(5)

if status != "Succeeded":
    print("Transcription failed")
    print(status_response.json())
    exit(1)

# Now list the transcriptions files
files_response = requests.get(f"{transcription_id}/files", headers=headers)
files = files_response.json()

for file in files["values"]:
    print(file["name"], file["links"]["contentUrl"])
    if file['kind'] != "Transcription":
        continue
    content_response = requests.get(file["links"]["contentUrl"], headers=headers)
    with open(output_filename, "w") as f:
        f.write(content_response.text)
    break

# Documented
# https://learn.microsoft.com/en-us/azure/ai-services/speech-service/batch-transcription-get?pivots=rest-api#transcription-result-file
# offsetInTicks (one tick is 100 nanoseconds)

# for each segment in .recognizedPhrases
    # grab the "display" key from nBest[0]
    # grab the "offsetInTicks" key
    # and grab the "speaker"
    # convert offsetInTicks to seconds

