"""
LLM-based analysis functions for experiment data.

This module provides functions to analyze:
- Email quality (completeness, clarity, actionability, tone)
- How well the email addresses recipient feelings
- Factual questions that should be verified
- AI suggestion influence on final text

Uses OpenAI API via openai_utils.py with caching via joblib.
"""

import json
from pathlib import Path

from openai_utils import get_openai_response


# Load scenarios from shared JSON file (single source of truth with experiment app)
_SCENARIOS_JSON_PATH = Path(__file__).parent.parent / 'experiment' / 'lib' / 'scenarios.json'


def _load_scenarios() -> dict:
    """Load scenarios from shared JSON file."""
    with open(_SCENARIOS_JSON_PATH) as f:
        data = json.load(f)

    # Transform to analysis-focused format
    scenarios = {}
    for scenario_id, scenario_data in data.items():
        analysis = scenario_data.get('analysis', {})
        scenarios[scenario_id] = {
            'context': analysis.get('context', ''),
            'recipient': scenario_data.get('recipient', {}).get('name', ''),
            'key_facts': analysis.get('keyFacts', []),
        }
    return scenarios


# Load scenarios at module import time
SCENARIOS = _load_scenarios()


def get_scenario_context(scenario_id: str) -> dict:
    """Get the scenario context for analysis."""
    return SCENARIOS.get(scenario_id, SCENARIOS['roomDoubleBooking'])


def analyze_email_quality(email_text: str, scenario_id: str, model: str = 'gpt-4o') -> dict:
    """
    Analyze email quality on multiple dimensions.

    Returns dict with scores (1-5) for:
    - completeness: Does it include all necessary information?
    - clarity: Is it clear and easy to understand?
    - actionability: Are next steps clear for the recipient?
    - tone: Is the tone appropriate for the situation?
    - overall: Overall quality rating

    Also returns qualitative feedback.
    """
    scenario = get_scenario_context(scenario_id)

    prompt = f'''You are an expert business communication analyst. Analyze the following email
written in response to this scenario:

SCENARIO:
{scenario['context']}

EMAIL TO ANALYZE:
"""
{email_text}
"""

Rate the email on each dimension (1-5 scale, where 1=very poor, 5=excellent):

1. COMPLETENESS: Does the email include all necessary information the recipient needs?
   - Key facts that should be included: {json.dumps(scenario['key_facts'])}

2. CLARITY: Is the email clear, concise, and easy to understand?
   - Is the main message immediately apparent?
   - Is it free of confusing or ambiguous language?

3. ACTIONABILITY: Are next steps clear for the recipient?
   - Does {scenario['recipient']} know what to do after reading this?
   - Is there a clear call to action?

4. TONE: Is the tone appropriate for the situation?
   - Professional but empathetic?
   - Acknowledges the inconvenience without being overly apologetic?
   - Maintains confidence while being honest?

5. OVERALL: Overall quality of the email

Return your analysis as JSON:
{{
  "completeness": {{"score": 1-5, "reasoning": "brief explanation"}},
  "clarity": {{"score": 1-5, "reasoning": "brief explanation"}},
  "actionability": {{"score": 1-5, "reasoning": "brief explanation"}},
  "tone": {{"score": 1-5, "reasoning": "brief explanation"}},
  "overall": {{"score": 1-5, "reasoning": "brief explanation"}},
  "missing_information": ["list of key info missing from email"],
  "strengths": ["what the email does well"],
  "suggestions": ["how it could be improved"]
}}
'''

    response = get_openai_response(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        response_format={'type': 'json_object'},
    )

    return json.loads(response.choices[0].message.content)


def analyze_recipient_feelings(email_text: str, scenario_id: str, model: str = 'gpt-4o') -> dict:
    """
    Analyze how well the email addresses the recipient's likely emotions.

    Returns dict with:
    - acknowledges_inconvenience: Does it recognize this is an inconvenience? (1-5)
    - shows_empathy: Does it show understanding of recipient's position? (1-5)
    - maintains_relationship: Does it work to preserve the business relationship? (1-5)
    - overall_emotional_intelligence: Overall EQ of the email (1-5)
    """
    scenario = get_scenario_context(scenario_id)

    prompt = f'''You are an expert in emotional intelligence and business communication.
Analyze how well this email addresses the recipient's likely emotional state.

SCENARIO:
{scenario['context']}

RECIPIENT: {scenario['recipient']}

EMAIL TO ANALYZE:
"""
{email_text}
"""

Consider the recipient's likely emotional reaction to this situation:
- They may feel frustrated, inconvenienced, or devalued
- They may worry about the reliability of the sender's organization
- They may need reassurance that they're still valued

Rate the email (1-5 scale) on:

1. ACKNOWLEDGES_INCONVENIENCE: Does it recognize this creates problems for the recipient?

2. SHOWS_EMPATHY: Does it demonstrate understanding of how the recipient might feel?

3. MAINTAINS_RELATIONSHIP: Does it work to preserve and strengthen the relationship?

4. OVERALL_EMOTIONAL_INTELLIGENCE: Overall emotional awareness and handling

Return your analysis as JSON:
{{
  "acknowledges_inconvenience": {{"score": 1-5, "evidence": "quote or explanation"}},
  "shows_empathy": {{"score": 1-5, "evidence": "quote or explanation"}},
  "maintains_relationship": {{"score": 1-5, "evidence": "quote or explanation"}},
  "overall_emotional_intelligence": {{"score": 1-5, "reasoning": "explanation"}},
  "emotional_tone": "description of the overall emotional tone",
  "missed_opportunities": ["ways it could better address feelings"]
}}
'''

    response = get_openai_response(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        response_format={'type': 'json_object'},
    )

    return json.loads(response.choices[0].message.content)


def extract_factual_questions(email_text: str, scenario_id: str, model: str = 'gpt-4o') -> list[str]:
    """
    Generate a list of factual questions a careful reader would want to verify.

    These are questions someone would reasonably want to confirm with a colleague
    before sending this email (e.g., "Is Room 14 actually available?").
    """
    scenario = get_scenario_context(scenario_id)

    prompt = f'''You are a careful professional reviewing an email before it's sent.
Identify all factual claims in this email that a prudent person would want to verify
with a colleague before sending.

SCENARIO CONTEXT:
{scenario['context']}

EMAIL TO ANALYZE:
"""
{email_text}
"""

List all factual questions that should be verified. Focus on:
- Specific times, dates, locations mentioned
- Commitments being made
- Claims about availability or options
- Any details that could be wrong and cause problems if incorrect

Return as JSON:
{{
  "questions": [
    "Is Room 14 available at 1:30pm?",
    "Is Thursday afternoon confirmed as an option?",
    ...etc
  ]
}}
'''

    response = get_openai_response(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        response_format={'type': 'json_object'},
    )

    result = json.loads(response.choices[0].message.content)
    return result.get('questions', [])


def compare_questions_to_chat(
    questions: list[str],
    chat_messages: list[dict],
    model: str = 'gpt-4o'
) -> dict:
    """
    Compare the factual questions that should be asked against
    what was actually discussed in the colleague chat.

    Returns:
    - questions_addressed: Questions that were discussed in chat
    - questions_not_addressed: Questions that weren't asked
    - coverage_score: Fraction of questions that were addressed
    """
    # Format chat for analysis
    chat_transcript = '\n'.join([
        f"{'USER' if m['role'] == 'user' else 'COLLEAGUE'}: {m['content']}"
        for m in chat_messages
    ])

    prompt = f'''Analyze whether these factual questions were addressed in the chat conversation.

QUESTIONS THAT SHOULD BE VERIFIED:
{json.dumps(questions, indent=2)}

CHAT CONVERSATION:
"""
{chat_transcript}
"""

For each question, determine if it was:
- ADDRESSED: The information was discussed or confirmed in the chat
- NOT_ADDRESSED: The user never asked about this or it wasn't covered

Return as JSON:
{{
  "analysis": [
    {{"question": "...", "status": "ADDRESSED" or "NOT_ADDRESSED", "evidence": "relevant quote or null"}}
  ],
  "questions_addressed": ["list of addressed questions"],
  "questions_not_addressed": ["list of unaddressed questions"],
  "coverage_score": 0.0-1.0
}}
'''

    response = get_openai_response(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        response_format={'type': 'json_object'},
    )

    return json.loads(response.choices[0].message.content)


def analyze_ai_influence(
    email_text: str,
    ai_suggestions: list[dict],
    model: str = 'gpt-4o'
) -> dict:
    """
    Analyze how much of the AI suggestions made it into the final email.

    For each suggestion, determines:
    - USED: Significant portions appear in the final email
    - PARTIALLY_USED: Some phrases or ideas were incorporated
    - IGNORED: The suggestion wasn't used

    Returns influence metrics and detailed per-suggestion analysis.
    """
    if not ai_suggestions:
        return {
            'had_suggestions': False,
            'num_suggestions': 0,
            'suggestions_used': 0,
            'suggestions_partially_used': 0,
            'suggestions_ignored': 0,
            'overall_influence': 0.0,
            'per_suggestion': [],
        }

    # Format suggestions for analysis
    suggestions_text = '\n\n'.join([
        f"SUGGESTION {i+1} (mode: {s['mode']}):\n{s['result']}"
        for i, s in enumerate(ai_suggestions)
    ])

    prompt = f'''Analyze how much influence these AI suggestions had on the final email.

AI SUGGESTIONS SHOWN TO USER:
{suggestions_text}

FINAL EMAIL WRITTEN:
"""
{email_text}
"""

For each suggestion, determine:
- USED: Significant portions (phrases, sentences, structure) appear in the final email
- PARTIALLY_USED: Some ideas or a few words were incorporated
- IGNORED: The suggestion wasn't used at all

Return as JSON:
{{
  "per_suggestion": [
    {{
      "suggestion_index": 1,
      "mode": "complete_document",
      "status": "USED" | "PARTIALLY_USED" | "IGNORED",
      "evidence": "explanation of what was/wasn't used",
      "influence_score": 0.0-1.0
    }}
  ],
  "suggestions_used": 0,
  "suggestions_partially_used": 0,
  "suggestions_ignored": 0,
  "overall_influence": 0.0-1.0,
  "summary": "brief description of how AI influenced the email"
}}
'''

    response = get_openai_response(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        response_format={'type': 'json_object'},
    )

    result = json.loads(response.choices[0].message.content)
    result['had_suggestions'] = True
    result['num_suggestions'] = len(ai_suggestions)
    return result


def run_full_analysis(
    participant_data: dict,
    model: str = 'gpt-4o',
    cache=None
) -> dict:
    """
    Run all analyses on a single participant's data.

    Args:
        participant_data: Dict from extract_experiment_data.extract_participant_data()
        model: OpenAI model to use
        cache: Optional joblib.Memory cache

    Returns dict with all analysis results.
    """
    email_text = participant_data['final_email_text']
    scenario_id = participant_data['scenario']
    chat_messages = participant_data['chat_messages']
    ai_suggestions = participant_data['ai_suggestions']

    # Optionally wrap functions with cache
    if cache:
        _analyze_email_quality = cache.cache(analyze_email_quality)
        _analyze_recipient_feelings = cache.cache(analyze_recipient_feelings)
        _extract_factual_questions = cache.cache(extract_factual_questions)
        _compare_questions_to_chat = cache.cache(compare_questions_to_chat)
        _analyze_ai_influence = cache.cache(analyze_ai_influence)
    else:
        _analyze_email_quality = analyze_email_quality
        _analyze_recipient_feelings = analyze_recipient_feelings
        _extract_factual_questions = extract_factual_questions
        _compare_questions_to_chat = compare_questions_to_chat
        _analyze_ai_influence = analyze_ai_influence

    # Run analyses
    quality = _analyze_email_quality(email_text, scenario_id, model)
    feelings = _analyze_recipient_feelings(email_text, scenario_id, model)
    factual_questions = _extract_factual_questions(email_text, scenario_id, model)

    # Compare questions to what was asked in chat
    question_coverage = _compare_questions_to_chat(
        factual_questions,
        chat_messages,
        model
    )

    # Analyze AI influence (if applicable)
    ai_influence = _analyze_ai_influence(email_text, ai_suggestions, model)

    return {
        'username': participant_data['username'],
        'condition': participant_data['condition'],
        'scenario': scenario_id,
        'quality': quality,
        'recipient_feelings': feelings,
        'factual_questions': factual_questions,
        'question_coverage': question_coverage,
        'ai_influence': ai_influence,
    }


# Convenience functions for extracting numeric scores
def get_quality_scores(analysis: dict) -> dict:
    """Extract numeric quality scores from analysis result."""
    quality = analysis.get('quality', {})
    return {
        'completeness': quality.get('completeness', {}).get('score'),
        'clarity': quality.get('clarity', {}).get('score'),
        'actionability': quality.get('actionability', {}).get('score'),
        'tone': quality.get('tone', {}).get('score'),
        'overall_quality': quality.get('overall', {}).get('score'),
    }


def get_feelings_scores(analysis: dict) -> dict:
    """Extract numeric recipient feelings scores from analysis result."""
    feelings = analysis.get('recipient_feelings', {})
    return {
        'acknowledges_inconvenience': feelings.get('acknowledges_inconvenience', {}).get('score'),
        'shows_empathy': feelings.get('shows_empathy', {}).get('score'),
        'maintains_relationship': feelings.get('maintains_relationship', {}).get('score'),
        'emotional_intelligence': feelings.get('overall_emotional_intelligence', {}).get('score'),
    }


def get_question_coverage_score(analysis: dict) -> float | None:
    """Extract question coverage score from analysis result."""
    coverage = analysis.get('question_coverage', {})
    return coverage.get('coverage_score')


def get_ai_influence_score(analysis: dict) -> float | None:
    """Extract AI influence score from analysis result."""
    influence = analysis.get('ai_influence', {})
    return influence.get('overall_influence')
