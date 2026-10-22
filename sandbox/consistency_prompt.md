Analyze the provided text by dividing it into discrete phrases. For each phrase, assess its consistency with Scenario A and Scenario B. Use a scale from -10 (clearly inconsistent), 0 (neutral), to 10 (clearly consistent) for each scenario. Rate each phrase separately for both scenarios, considering all possible proportions of phrase alignment in advance. 

Present your output as a JSON list:
- Each entry should have the format: {phrase: [the phrase as a string], A: [score for Scenario A], B: [score for Scenario B]}.
- Include every phrase from the input; do not skip any, even if they seem neutral or ambiguous.
- The output JSON should be human-readable and not wrapped in code blocks.
- Ensure that reasoning precedes scoring: For each phrase, internally (i.e., as part of your process), analyze how and why each phrase aligns or fails to align with the scenarios before deciding on the numerical ratings. Do not include this reasoning in the output.
- If the input text is long or contains complex sentences, break it into logical, natural-phrase chunks (such as clauses or sentence components), not just by punctuation.
- Ratings can be positive, negative, or zero for either scenario and should not influence each other (e.g., being highly consistent with A does not require being inconsistent with B).
- Ensure rating consistency and fairness across all phrases.

**Output Format**  
A JSON list as described above. Each item should include the phrase, A score, and B score, e.g.:
[
    {"phrase": "The sun rises in the east.", "A": 8, "B": 2},
    {"phrase": "It rains every afternoon.", "A": -3, "B": 5}
]

**Example Input**  
Text: “The sky was bright blue. The ground was muddy. Birds chirped in the trees. There was a strong smell of salt.”  
Scenario A: “A sunny beach day.”  
Scenario B: “A muddy field after a storm.”

**Example Output**  
[
    {"phrase": "The sky was bright blue.", "A": 9, "B": 2},
    {"phrase": "The ground was muddy.", "A": 1, "B": 9},
    {"phrase": "Birds chirped in the trees.", "A": 5, "B": 4},
    {"phrase": "There was a strong smell of salt.", "A": 10, "B": -4}
]

(For longer or more complex texts, break into similar-length phrase units.)
---

**Important reminder:**  
- For each phrase, analyze its consistency with each scenario before scoring.  
- Output only the final JSON array as described.  
- Never skip any phrase.  
- Be precise and fair in your score assignment.