import pathlib
import json
import datetime

def get_first_timestamp(file_path):
    with open(file_path, "r") as f:
        first_line = f.readline()
    timestamp = json.loads(first_line)["timestamp"]
    return datetime.datetime.fromtimestamp(timestamp, tz=datetime.timezone.utc)
    
first_timestamps = [
    (get_first_timestamp(f), f)
    for f in pathlib.Path(".").glob("*.jsonl")
]

first_timestamps.sort()

for timestamp, file_path in first_timestamps:
    timestamp_in_local_time = timestamp.astimezone(tz=None)
    print(f"{file_path.name.removesuffix('.jsonl')} {timestamp_in_local_time.strftime('%Y-%m-%d %H:%M:%S')}")
