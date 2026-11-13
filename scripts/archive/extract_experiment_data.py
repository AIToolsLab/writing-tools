"""
Extract structured data from experiment log files.

This script processes JSONL log files from the writing experiment and extracts:
- Final email text
- Chat conversation with colleague
- AI suggestions shown
- Survey responses
- Behavioral metrics

Output: DataFrame (pickle) + JSON files for further analysis.
"""

from pathlib import Path
from collections import defaultdict
from datetime import datetime
import json
import argparse

import pandas as pd


# Condition code to name mapping (mirrors experiment/lib/studyConfig.ts)
CONDITION_MAP = {
    'n': 'no_ai',
    'c': 'complete_document',
    'e': 'example_sentences',
    'a': 'analysis_readerPerspective',
    'p': 'proposal_advice',
}


def parse_log_file(log_file: Path) -> list[dict]:
    """Parse a JSONL log file into a list of log entries."""
    entries = []
    for line in log_file.read_text().splitlines():
        if line.strip():
            entries.append(json.loads(line))
    return entries


def get_study_params(entries: list[dict]) -> dict:
    """Extract study parameters from log entries."""
    for entry in entries:
        extra_data = entry.get('extra_data', {})
        if 'studyParams' in extra_data:
            return extra_data['studyParams']
    return {}


def get_final_email_text(entries: list[dict]) -> str:
    """
    Extract the final email text.

    First tries to get it from taskComplete.finalText (new logging).
    Falls back to last documentUpdate before taskComplete (old logging).
    """
    # Try new logging format first
    for entry in entries:
        if entry.get('event') == 'taskComplete':
            final_text = entry.get('extra_data', {}).get('finalText')
            if final_text:
                return final_text

    # Fall back to last documentUpdate
    doc_updates = [e for e in entries if e.get('event') == 'documentUpdate']
    if doc_updates:
        # Sort by timestamp if available
        doc_updates.sort(key=lambda x: x.get('timestamp', ''))
        last_update = doc_updates[-1]
        editor_state = last_update.get('extra_data', {}).get('editorState', {})
        return (
            editor_state.get('beforeCursor', '') +
            editor_state.get('selectedText', '') +
            editor_state.get('afterCursor', '')
        )

    return ''


def get_chat_messages(entries: list[dict]) -> list[dict]:
    """Extract chat messages in chronological order."""
    messages = []

    for entry in entries:
        event = entry.get('event', '')
        extra_data = entry.get('extra_data', {})

        if event == 'chatMessage:user':
            messages.append({
                'role': 'user',
                'content': extra_data.get('content', ''),
                'timestamp': extra_data.get('timestamp', entry.get('timestamp', '')),
                'message_id': extra_data.get('messageId', ''),
            })
        elif event == 'chatMessage:assistant':
            messages.append({
                'role': 'assistant',
                'content': extra_data.get('content', ''),
                'timestamp': extra_data.get('timestamp', entry.get('timestamp', '')),
                'message_id': extra_data.get('messageId', ''),
                'part_index': extra_data.get('partIndex', 0),
            })

    # Sort by timestamp
    messages.sort(key=lambda x: x.get('timestamp', ''))
    return messages


def get_ai_suggestions(entries: list[dict]) -> list[dict]:
    """Extract AI suggestions shown to the participant."""
    suggestions = []

    for entry in entries:
        event = entry.get('event', '')
        if event.startswith('aiResponse:'):
            mode = event.split(':', 1)[1]
            extra_data = entry.get('extra_data', {})
            generation = extra_data.get('generation', {})

            suggestions.append({
                'mode': mode,
                'result': generation.get('result', ''),
                'timestamp': entry.get('timestamp', ''),
                'is_auto_refresh': extra_data.get('isAutoRefresh', False),
                'editor_state': extra_data.get('editorState', {}),
            })

    return suggestions


def get_survey_responses(entries: list[dict]) -> tuple[dict, dict]:
    """Extract intro and post-task survey responses."""
    intro_survey = {}
    post_task_survey = {}

    for entry in entries:
        event = entry.get('event', '')
        extra_data = entry.get('extra_data', {})

        if event == 'surveyComplete:intro-survey':
            intro_survey = extra_data
        elif event == 'surveyComplete:post-task-survey':
            post_task_survey = extra_data

    return intro_survey, post_task_survey


def calculate_time_spent(entries: list[dict]) -> float | None:
    """Calculate time spent writing in seconds."""
    doc_updates = [e for e in entries if e.get('event') == 'documentUpdate']
    if len(doc_updates) < 2:
        return None

    # Sort by timestamp
    doc_updates.sort(key=lambda x: x.get('timestamp', ''))

    try:
        first_ts = doc_updates[0].get('timestamp', '')
        last_ts = doc_updates[-1].get('timestamp', '')

        # Parse ISO timestamps
        first_dt = datetime.fromisoformat(first_ts.replace('Z', '+00:00'))
        last_dt = datetime.fromisoformat(last_ts.replace('Z', '+00:00'))

        return (last_dt - first_dt).total_seconds()
    except (ValueError, TypeError):
        return None


def extract_participant_data(log_file: Path) -> dict | None:
    """
    Extract all relevant data from a participant's log file.

    Returns None if the participant didn't complete the task.
    """
    entries = parse_log_file(log_file)
    if not entries:
        return None

    # Check if task was completed
    task_complete = any(e.get('event') == 'taskComplete' for e in entries)
    if not task_complete:
        return None

    # Get study parameters
    study_params = get_study_params(entries)
    username = entries[0].get('username', log_file.stem)

    # Get condition
    condition_code = study_params.get('condition', 'n')
    condition_name = CONDITION_MAP.get(condition_code, 'unknown')

    # Extract all data
    final_email = get_final_email_text(entries)
    chat_messages = get_chat_messages(entries)
    ai_suggestions = get_ai_suggestions(entries)
    intro_survey, post_task_survey = get_survey_responses(entries)
    time_spent = calculate_time_spent(entries)

    # Count events
    num_doc_updates = sum(1 for e in entries if e.get('event') == 'documentUpdate')
    num_user_messages = sum(1 for e in entries if e.get('event') == 'chatMessage:user')

    return {
        'username': username,
        'condition_code': condition_code,
        'condition': condition_name,
        'scenario': study_params.get('scenario', 'unknown'),
        'wave': entries[0].get('wave', 'unknown'),

        # Final email
        'final_email_text': final_email,
        'final_word_count': len(final_email.split()) if final_email else 0,

        # Conversation
        'chat_messages': chat_messages,
        'num_chat_messages_sent': num_user_messages,

        # AI suggestions
        'ai_suggestions': ai_suggestions,
        'num_ai_suggestions_shown': len(ai_suggestions),

        # Surveys
        'intro_survey': intro_survey,
        'post_task_survey': post_task_survey,

        # Metrics
        'time_spent_writing_seconds': time_spent,
        'num_document_updates': num_doc_updates,

        # Raw data for detailed analysis
        'raw_entries': entries,
    }


def extract_all_participants(logs_dir: Path, wave: str | None = None) -> list[dict]:
    """Extract data for all participants in a directory."""
    all_data = []

    log_files = list(logs_dir.glob('*.jsonl'))
    print(f"Found {len(log_files)} log files in {logs_dir}")

    for log_file in log_files:
        try:
            data = extract_participant_data(log_file)
            if data:
                # Filter by wave if specified
                if wave and data.get('wave') != wave:
                    continue
                all_data.append(data)
        except Exception as e:
            print(f"Error processing {log_file.name}: {e}")

    print(f"Extracted {len(all_data)} complete participants")
    return all_data


def to_dataframe(participants: list[dict]) -> pd.DataFrame:
    """
    Convert participant data to a DataFrame.

    Complex nested fields (chat_messages, ai_suggestions, raw_entries)
    are kept as-is for detailed analysis.
    """
    # Flatten survey responses into columns
    rows = []
    for p in participants:
        row = {
            'username': p['username'],
            'condition_code': p['condition_code'],
            'condition': p['condition'],
            'scenario': p['scenario'],
            'wave': p['wave'],
            'final_email_text': p['final_email_text'],
            'final_word_count': p['final_word_count'],
            'num_chat_messages_sent': p['num_chat_messages_sent'],
            'num_ai_suggestions_shown': p['num_ai_suggestions_shown'],
            'time_spent_writing_seconds': p['time_spent_writing_seconds'],
            'num_document_updates': p['num_document_updates'],
            # Keep complex fields for analysis
            'chat_messages': p['chat_messages'],
            'ai_suggestions': p['ai_suggestions'],
            'raw_entries': p['raw_entries'],
        }

        # Flatten intro survey
        for key, value in p.get('intro_survey', {}).items():
            row[f'intro_{key}'] = value

        # Flatten post-task survey
        for key, value in p.get('post_task_survey', {}).items():
            row[f'post_{key}'] = value

        rows.append(row)

    return pd.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser(description='Extract experiment data from log files')
    parser.add_argument('logs_dir', type=Path, help='Directory containing JSONL log files')
    parser.add_argument('--wave', type=str, help='Filter by study wave (e.g., pilot-2)')
    parser.add_argument('--output', type=Path, help='Output directory (default: same as logs_dir)')
    parser.add_argument('--format', choices=['both', 'json', 'pickle'], default='both',
                       help='Output format (default: both)')

    args = parser.parse_args()

    output_dir = args.output or args.logs_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    # Extract data
    participants = extract_all_participants(args.logs_dir, wave=args.wave)

    if not participants:
        print("No complete participants found")
        return

    # Save as DataFrame
    df = to_dataframe(participants)

    if args.format in ('both', 'pickle'):
        pickle_path = output_dir / 'experiment_data.pkl'
        df.to_pickle(pickle_path)
        print(f"Saved DataFrame to {pickle_path}")

    if args.format in ('both', 'json'):
        # Save JSON without raw_entries (too large)
        json_data = []
        for p in participants:
            p_copy = {k: v for k, v in p.items() if k != 'raw_entries'}
            json_data.append(p_copy)

        json_path = output_dir / 'experiment_data.json'
        with open(json_path, 'w') as f:
            json.dump(json_data, f, indent=2, default=str)
        print(f"Saved JSON to {json_path}")

    # Print summary
    print("\nSummary:")
    print(f"  Total participants: {len(df)}")
    print(f"  By condition: {df['condition'].value_counts().to_dict()}")
    print(f"  By scenario: {df['scenario'].value_counts().to_dict()}")


if __name__ == '__main__':
    main()
