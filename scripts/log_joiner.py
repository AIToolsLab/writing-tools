# Transcript joiner

import json
import streamlit as st
import pandas as pd
import datetime

st.title("Transcript and Log Joiner")


def load_from_ms_json(transcription_file):
    caption_entries = []
    transcription = json.load(transcription_file)

    for segment in transcription['recognizedPhrases']:
        speaker = f"Speaker {segment['speaker']}"
        text = segment['nBest'][0]['display']
        timestamp = segment['offsetInTicks'] / 1e7

        caption_entries.append(dict(
            timestamp=timestamp,
            speaker=speaker,
            text=text
        ))
    return caption_entries

def load_from_vtt(transcription_file):
    import webvtt

    caption_entries = []
    for caption in webvtt.from_buffer(transcription_file):
        speaker = caption.voice
        text = caption.text.strip().replace("\n", " ").replace("&amp;", "&")
        timestamp = caption.start_in_seconds

        caption_entries.append(dict(
            timestamp=timestamp,
            speaker=speaker,
            text=text
        ))
    return caption_entries



def load_from_text(transcription_file):
    # format: 
    # Experimenter:00:00:06  Test 123 good. 
    # Participant:00:00:09  Test 456 good.
    caption_entries = []
    for line in transcription_file:
        line = line.decode("utf-8")
        if line.startswith("#") and len(caption_entries) == 0:
            continue
        line = line.strip()
        if not line:
            continue
        preamble, text = line.split(" ", 1)
        speaker, timestamp = preamble.split(":", 1)
        timestamp_hours, timestamp_mins, timestamp_secs = map(int, timestamp.strip().split(":"))
        timestamp = timestamp_hours * 3600 + timestamp_mins * 60 + timestamp_secs
        caption_entries.append(dict(
            timestamp=timestamp,
            speaker=speaker,
            text=text.strip()
        ))
    return caption_entries


meta = []

transcription_file = st.file_uploader("Upload transcription")
if transcription_file is None:
    st.stop()

transcript_format = st.radio("Transcript format", ["MS JSON", "VTT", "text"])

filename = st.text_input("Filename", value=transcription_file.name.rsplit(".", 1)[0])

merge_consecutive_spans = st.checkbox("Merge consecutive spans", value=True)
meta.append(f"Merge consecutive spans: {merge_consecutive_spans}")

log_file = st.file_uploader("Upload log file", type=["jsonl"])
log_entries = []
if log_file is not None:
    meta.append(f"Log file: {log_file.name}")
    log_entries_raw = []
    for line in log_file:
        log_entry = json.loads(line)
        log_entry['timestamp'] = datetime.datetime.fromtimestamp(log_entry['timestamp'])
        log_entries_raw.append(log_entry)

    if len(log_entries_raw) == 0:
        st.write("No log entries found")
        st.stop()

    skip_log_entries = st.number_input("Skip first N log entries", value=0)
    log_entries_raw = log_entries_raw[skip_log_entries:]
    meta.append(f"Skipped first {skip_log_entries} log entries")

    timestamp_of_first_response = next((entry['timestamp'] for entry in log_entries_raw if entry['interaction'].endswith("Backend")), None)
    if timestamp_of_first_response is None:
        st.write("Warning: no backend interaction found in the log file")
        timestamp_of_first_response = log_entries_raw[0]['timestamp']
    assert isinstance(timestamp_of_first_response, datetime.datetime), f"Expected datetime.datetime, got {type(timestamp_of_first_response)}"

    if st.radio("Specify starting time", ["relative", "absolute"], horizontal=True) == "relative":
        offset_of_first_response = st.number_input("In the video, the first response is visible at (seconds)", value=0)
        starting_datetime = timestamp_of_first_response - datetime.timedelta(seconds=offset_of_first_response)
    else:
        starting_date = st.date_input("Starting date", value=timestamp_of_first_response.date())
        if starting_date is None:
            st.write("Please provide a starting date")
            st.stop()
        assert isinstance(starting_date, datetime.date), f"Expected datetime.date, got {type(starting_date)}"
        starting_time_str = st.text_input("Starting time", value=timestamp_of_first_response.time().strftime("%H:%M:%S"))
        if starting_time_str is None:
            st.write("Please provide a starting time")
            st.stop()
        starting_datetime = datetime.datetime.combine(starting_date, datetime.datetime.strptime(starting_time_str, "%H:%M:%S").time())

    st.write(f"So the transcript started at {starting_datetime}")

    # shift timestamps and track changes to document ("prompt") text
    last_prompt_text = ''
    for entry in log_entries_raw:
        timestamp = (entry['timestamp'] - starting_datetime).total_seconds()
        if timestamp < 0:
            st.warning(f"Skipping entry with timestamp {timestamp}")
            continue

        if 'prompt' in entry:
            cur_prompt_text = entry['prompt']
            if cur_prompt_text is not None and cur_prompt_text != last_prompt_text:
                # compute the diff at the word level
                import difflib
                diff = difflib.ndiff(last_prompt_text.split(), cur_prompt_text.split())

                # join the diff into a single string, summarizing all the additions then all the deletions.
                additions = ' '.join([word[2:] for word in diff if word.startswith('+ ')])
                deletions = ' '.join([word[2:] for word in diff if word.startswith('- ')])
                textual_diff = ''
                if additions:
                    textual_diff += f"Added: {additions}"
                if deletions:
                    textual_diff += f"\nDeleted: {deletions}"
                if textual_diff:
                    log_entries.append(dict(
                        timestamp=timestamp,
                        speaker="Document",
                        text=textual_diff
                    ))

                last_prompt_text = cur_prompt_text

        interaction_friendly = "UI " + entry['interaction']
        interaction_friendly = interaction_friendly.replace("_Frontend", " request")
        interaction_friendly = interaction_friendly.replace("_Backend", " response")
        log_entries.append(dict(
            timestamp=timestamp,
            speaker=interaction_friendly,
            text=(entry.get('result') or '').replace("\n", "; ")
        ))


    meta.append(f"log times shifted by {starting_datetime}, or {(timestamp_of_first_response - starting_datetime).total_seconds()} seconds")

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
    with st.expander("Log entries"):
        st.write(pd.DataFrame(log_entries))

if transcript_format == "MS JSON":
    caption_entries = load_from_ms_json(transcription_file)
elif transcript_format == "VTT":
    caption_entries = load_from_vtt(transcription_file)
elif transcript_format == "text":
    caption_entries = load_from_text(transcription_file)
else:
    st.write("Unsupported transcript format")
    st.stop()

# merge and sort
entries = sorted(caption_entries + log_entries, key=lambda x: x['timestamp'])
with st.expander("Merged entries"):
    st.write(pd.DataFrame(entries))

# ask for replacement names for each speaker
with st.expander("Speaker names"):
    replacement_speaker_names = {
        name: st.text_input(f"Speaker name: {name}", value=name) if not name.startswith("UI ") else name
        for name in sorted(set(entry['speaker'] for entry in entries))
    }

output_lines = []

previous_speaker = None
for entry in entries:
    speaker = replacement_speaker_names[entry['speaker']]
    text = entry['text']
    timestamp = entry['timestamp']
    timestamp_hours = int(timestamp // 3600)
    timestamp_mins = int((timestamp % 3600) // 60)
    timestamp_secs = int(timestamp % 60)
    timestamp_str = f"{timestamp_hours:02}:{timestamp_mins:02}:{timestamp_secs:02}"
    if merge_consecutive_spans:
        if speaker == previous_speaker:
            output_lines[-1] += " " + text
            continue
        previous_speaker = speaker
    output_lines.append(f"{speaker}:{timestamp_str} {text}")

output_text = "\n\n".join(output_lines)
if meta:
    output_text = '# ' + '; '.join(l for l in meta) + "\n\n" + output_text
out_filename = f"{filename}.txt"
st.download_button(f"Download {out_filename}", output_text, out_filename, "text/plain")
st.code(output_text)
