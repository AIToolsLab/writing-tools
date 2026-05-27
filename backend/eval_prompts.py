"""
Prompt evaluation script.

Runs all prompt types against a set of test documents and prints the outputs
so you can eyeball whether the LLM is giving good results.

Usage (run from the backend/ folder):
    uv run python eval_prompts.py
"""

import asyncio
import time
import openai
import os
from dataclasses import dataclass
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import List

load_dotenv()
client = openai.AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

MODEL = "gpt-4o"

 
# ---------------------------------------------------------------------------
# Minimal DocContext (mirrors nlp.py — no PostHog dependency)
# ---------------------------------------------------------------------------

@dataclass
class DocContext:
    beforeCursor: str
    selectedText: str
    afterCursor: str


# ---------------------------------------------------------------------------
# Prompts (copied from nlp.py so this script is self-contained)
# ---------------------------------------------------------------------------

PROMPTS = {
    "example_sentences": """\
You are assisting a writer in drafting a document. Generate three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about **10 words**.
""",
    "proposal_advice": """\
You are assisting a writer in drafting a document by providing three directive (but not prescriptive) advice to help them develop their work. Your advice must be tailored to the document's genre. Use your best judgment to offer the most relevant and helpful advice, drawing from the following types of support as appropriate for the context:
- Support the writer in adhering to their stated writing goals or assignment guidelines.
- Help the writer think about what they could write next.
- Encourage the writer to maintain focus on their main idea and avoid introducing unrelated material.
- Recommend strengthening arguments by adding supporting evidence, specific examples, or clear reasoning.
- Advise on structuring material to achieve a clear and logical flow.
- Guide the writer in choosing language that is accessible and engaging for the intended audience.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- Keep each piece of advice under 20 words.
- Express the advice in the form of a directive instruction, not a question.
- Don't give specific words or phrases for the writer to use.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.
""",
    "analysis_readerPerspective": """\
You are assisting a writer in drafting a document for a specific person. Generate three possible questions the person might have about the document so far.

Guidelines:
- Avoid suggesting specific words or phrases.
- Limit each question to under 20 words.
- Ensure all questions specifically reflect details or qualities from the current document, avoiding broad or generic statements.
- Each question should be expressed as a perspective describing how the person might feel about the document, not as a directive to the writer.
- If there is insufficient context to generate genuine questions, return an empty list.
""",
    "example_rewording": """\
You are assisting a writer in drafting a document. Generate three alternative rewordings of the writer's selected text.

Guidelines:
- Rephrase only the selected text in three different ways while preserving the original meaning.
- Vary the word choice, and tone across the three options.
- Maintain the writer's overall voice and style.
- Each rewording should be approximately the same length as the original selected text.
- If no text is selected, return an empty list.
""",
}


def get_full_prompt(prompt_name: str, doc: DocContext, context_chars: int = 100) -> str:
    prompt = PROMPTS[prompt_name]
    document_text = doc.beforeCursor + doc.selectedText + doc.afterCursor
    prompt += f"\n\n# Writer's Document So Far\n\n<document>\n{document_text}</document>\n\n"
    before_cursor_trim = doc.beforeCursor[-context_chars:]
    after_cursor_trim = doc.afterCursor[:context_chars]
    if doc.selectedText == "":
        prompt += f'\n\n## Text Right Before the Cursor\n\n"{before_cursor_trim}"'
    else:
        prompt += f"\n\n## Current Selection\n\n{doc.selectedText}"
        prompt += f'\n\n## Text Nearby The Selection\n\n"{before_cursor_trim}{doc.selectedText}{after_cursor_trim}"'
    return prompt


# ---------------------------------------------------------------------------
# Test documents
# ---------------------------------------------------------------------------
# Each entry has a short name and a DocContext (beforeCursor, selectedText, afterCursor).
# These represent different writing situations the tool might encounter.

TEST_DOCS = [
    {
        "name": "Academic essay (mid-paragraph)",
        "doc": DocContext(
            beforeCursor=(
                "The relationship between social media use and mental health has been "
                "extensively studied over the past decade. Research consistently shows "
                "that heavy use of platforms like Instagram and TikTok is correlated "
                "with increased rates of anxiety and depression among teenagers. "
                "However, the causal direction of this relationship remains unclear. "
            ),
            selectedText="",
            afterCursor=(
                " Some researchers argue that pre-existing mental health conditions "
                "lead to higher social media use, rather than the reverse."
            ),
        ),
    },
    {
        "name": "Narrative story (mid-sentence)",
        "doc": DocContext(
            beforeCursor=(
                "Maya had lived in the same apartment for six years, but tonight "
                "everything felt different. She stood at the window watching the rain "
                "streak down the glass, thinking about the letter she had received that "
                "morning. It was from her father, whom she hadn't spoken to in "
            ),
            selectedText="",
            afterCursor="",
        ),
    },
    {
        "name": "Argumentative essay (beginning)",
        "doc": DocContext(
            beforeCursor=(
                "Universal basic income (UBI) has gained significant attention as a "
                "potential solution to growing economic inequality. Proponents argue "
                "that providing every citizen with a guaranteed monthly income would "
                "eliminate poverty, reduce bureaucracy, and give workers more bargaining "
                "power. "
            ),
            selectedText="",
            afterCursor="",
        ),
    },
    {
        "name": "Professional email",
        "doc": DocContext(
            beforeCursor=(
                "Hi Professor,\n\n"
                "I wanted to follow up on our meeting last week regarding my thesis proposal. "
                "I have made some changes based on your feedback and "
            ),
            selectedText="",
            afterCursor="",
        ),
    },
    {
        "name": "Rewording — selected text",
        "doc": DocContext(
            beforeCursor=(
                "The data clearly demonstrates that students who receive consistent feedback "
                "perform significantly better on standardized assessments. "
            ),
            selectedText="students who receive consistent feedback perform significantly better",
            afterCursor=" on standardized assessments.",
        ),
    },
]

PROMPT_TYPES = [
    "example_sentences",
    "proposal_advice",
    "analysis_readerPerspective",
    "example_rewording",
]


# ---------------------------------------------------------------------------
# Structured output format (same as nlp.py)
# ---------------------------------------------------------------------------

class ListResponse(BaseModel):
    responses: List[str]


# ---------------------------------------------------------------------------
# Run one prompt against one document
# ---------------------------------------------------------------------------

async def run_one(prompt_name: str, doc: DocContext, model: str = MODEL) -> tuple[str, float]:
    """Returns (output_text, latency_seconds)."""
    full_prompt = get_full_prompt(prompt_name, doc)
    messages = [
        {"role": "system", "content": "You are a helpful and insightful writing assistant."},
        {"role": "user", "content": full_prompt},
    ]

    start = time.perf_counter()

    # complete_document returns free-form text, everything else uses structured output
    # to match the behaviour of nlp.get_suggestion() in the actual app
    if prompt_name == "complete_document":
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_completion_tokens=512,
        )
        elapsed = time.perf_counter() - start
        return (response.choices[0].message.content or "").strip(), elapsed

    completion = await client.beta.chat.completions.parse(
        model=model,
        messages=messages,
        response_format=ListResponse,
        max_completion_tokens=512,
    )
    elapsed = time.perf_counter() - start
    parsed = completion.choices[0].message.parsed
    if not parsed or not parsed.responses:
        return "(empty)", elapsed
    return "\n".join(f"- {item}" for item in parsed.responses), elapsed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(model_a: str, model_b: str | None):
    compare = model_b is not None

    if compare:
        print(f"Comparing: {model_a}  vs  {model_b}\n")
    else:
        print(f"Model: {model_a}\n")

    for doc_entry in TEST_DOCS:
        doc_name = doc_entry["name"]
        doc: DocContext = doc_entry["doc"]
        has_selection = bool(doc.selectedText.strip())

        print("=" * 70)
        print(f"DOCUMENT: {doc_name}")
        print("=" * 70)

        for prompt_name in PROMPT_TYPES:
            # example_rewording only makes sense when text is selected
            if prompt_name == "example_rewording" and not has_selection:
                continue
            # skip non-rewording prompts on the rewording test doc
            if prompt_name != "example_rewording" and has_selection:
                continue

            if compare:
                # Run both models at the same time
                (out_a, lat_a), (out_b, lat_b) = await asyncio.gather(
                    run_one(prompt_name, doc, model_a),
                    run_one(prompt_name, doc, model_b),
                )
                col = 34
                print(f"\n  [{prompt_name}]")
                print(f"  {'─' * col}  {'─' * col}")
                print(f"  {model_a + f' ({lat_a:.2f}s)':<{col}}  {model_b} ({lat_b:.2f}s)")
                print(f"  {'─' * col}  {'─' * col}")
                lines_a = out_a.splitlines()
                lines_b = out_b.splitlines()
                for i in range(max(len(lines_a), len(lines_b))):
                    la = lines_a[i] if i < len(lines_a) else ""
                    lb = lines_b[i] if i < len(lines_b) else ""
                    la = (la[:col - 1] + "…") if len(la) > col else la
                    print(f"  {la:<{col}}  {lb}")
            else:
                output, latency = await run_one(prompt_name, doc, model_a)
                print(f"\n  [{prompt_name}]  {latency:.2f}s")
                print("  " + "-" * 50)
                for line in output.splitlines():
                    print(f"  {line}")

        print()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Evaluate writing tool prompts")
    parser.add_argument("--compare", nargs=2, metavar="MODEL",
                        help="Compare two models, e.g. --compare gpt-4o gpt-4o-mini")
    parser.add_argument("--model", default="gpt-4o",
                        help="Single model to use (default: gpt-4o)")
    args = parser.parse_args()

    if args.compare:
        asyncio.run(main(args.compare[0], args.compare[1]))
    else:
        asyncio.run(main(args.model, None))
