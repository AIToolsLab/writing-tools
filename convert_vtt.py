# WebVTT converter
# Download VTT files from Microsoft Stream.
# This script will convert the VTT file to the following format:
#
# Speaker name:Timestamp | What the speaker said

import json
import streamlit as st
import webvtt
import pandas as pd
import datetime

st.title("WebVTT to text converter")

vtt_file = st.file_uploader("Upload VTT file", type=["vtt"])
if vtt_file is None:
    st.stop()

filename = st.text_input("Filename", value=vtt_file.name.rsplit(".", 1)[0])

merge_consecutive_spans = st.checkbox("Merge consecutive spans", value=True)

log_file = st.file_uploader("Upload log file", type=["jsonl"])
log_entries = []
if log_file is not None:
    log_entries_raw = []
    for line in log_file:
        log_entry = json.loads(line)
        log_entry['timestamp'] = datetime.datetime.fromtimestamp(log_entry['timestamp'])
        log_entries_raw.append(log_entry)

    starting_date = st.date_input("Starting date", value=log_entries_raw[0]['timestamp'].date())
    starting_time_str = st.text_input("Starting time", value=log_entries_raw[0]['timestamp'].time().strftime("%H:%M:%S"))
    starting_datetime = datetime.datetime.combine(starting_date, datetime.datetime.strptime(starting_time_str, "%H:%M:%S").time())
    st.write(starting_datetime)

    # shift timestamps
    for entry in log_entries_raw:
        timestamp = (entry['timestamp'] - starting_datetime).total_seconds()
        interaction_friendly = "UI: " + entry['interaction']
        interaction_friendly = interaction_friendly.replace("_Frontend", " request")
        interaction_friendly = interaction_friendly.replace("_Backend", " response")
        log_entries.append(dict(
            timestamp=timestamp,
            speaker=interaction_friendly,
            text=(entry['result'] or '').replace("\n", "; ")
        ))

    # For " request" entries that are immediately followed by " response" entries, merge them
    merged_log_entries = []
    i = 0
    while i < len(log_entries):
        entry = log_entries[i]
        # last entry
        if i == len(log_entries) - 1:
            merged_log_entries.append(entry)
            break

        cur_entry = log_entries[i]
        next_entry = log_entries[i + 1]
        if cur_entry['speaker'].endswith(" request") and next_entry['speaker'].endswith(" response"):
            delay = next_entry['timestamp'] - cur_entry['timestamp']
            merged_log_entries.append(dict(
                timestamp=entry['timestamp'],
                speaker=entry['speaker'].replace(" request", ""),
                text=f"{next_entry['text']} (delay={delay:.1f}s)"
            ))
            i += 1
        else:
            merged_log_entries.append(entry)
        i += 1
    log_entries = merged_log_entries
    st.write(pd.DataFrame(log_entries))

caption_entries = []
for caption in webvtt.from_buffer(vtt_file):
    speaker = caption.voice
    text = caption.text.strip().replace("\n", " ").replace("&amp;", "&")
    timestamp = caption.start_in_seconds

    caption_entries.append(dict(
        timestamp=timestamp,
        speaker=speaker,
        text=text
    ))


# merge and sort
entries = sorted(caption_entries + log_entries, key=lambda x: x['timestamp'])
st.write(pd.DataFrame(entries))

output_lines = []

previous_speaker = None
for entry in entries:
    speaker = entry['speaker']
    text = entry['text']
    timestamp = entry['timestamp']
    timestamp_mins = int(timestamp // 60)
    timestamp_secs = int(timestamp % 60)
    timestamp_str = f"{timestamp_mins:02}m{timestamp_secs:02}"
    if merge_consecutive_spans:
        if speaker == previous_speaker:
            output_lines[-1] += " " + text
            continue
        previous_speaker = speaker
    output_lines.append(f"{speaker}:{timestamp_str} {text}")

output_text = "\n\n".join(output_lines)
output_text = f"# log times shifted by {starting_datetime}\n\n" + output_text
out_filename = f"{filename}.txt"
st.download_button(f"Download {out_filename}", output_text, out_filename, "text/plain")
st.code(output_text)
