"""
Prompt evaluation script.

Runs all prompt types against a set of test documents and prints the outputs
so you can eyeball whether the LLM is giving good results.

When LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY/LANGFUSE_BASE_URL are present in .env, every
run is also logged to Langfuse so you can compare prompt versions in the UI.

Usage (run from the backend/ folder):
eyeball mode:
    uv run python eval_prompts.py

compare two models side-by-side in terminal:
    uv run python eval_prompts.py --compare gpt-4o gpt-4o-mini

send results to Langfuse as an experiment (dataset is auto-created if missing)
    uv run python eval_prompts.py --experiment <name of experiment>
Example:
    uv run python eval_prompts.py --model gpt-5.4 --experiment gpt-5.4
"""

import asyncio
import sys
import time
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import openai
from dotenv import load_dotenv
from pydantic import BaseModel

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()

if os.getenv("LANGFUSE_BASE_URL") and not os.getenv("LANGFUSE_HOST"):
    os.environ["LANGFUSE_HOST"] = os.environ["LANGFUSE_BASE_URL"]

client = openai.AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = "gpt-4o"
DATASET_NAME = "writing-tools-eval"

# Langfuse setup — optional; script works normally when keys are absent
_langfuse = None
_pub = os.getenv("LANGFUSE_PUBLIC_KEY", "")
_sec = os.getenv("LANGFUSE_SECRET_KEY", "")
_host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")
if _pub and _sec and not _pub.startswith("pk-lf-..."):
    try:
        from langfuse import Langfuse
        _langfuse = Langfuse(public_key=_pub, secret_key=_sec, host=_host)
        print(f"[langfuse] Tracing enabled: {_host}")
    except Exception as e:
        print(f"[langfuse] Failed to init: {e} - tracing disabled.")
else:
    print("[langfuse] Keys not configured - tracing disabled.")


@dataclass
class DocContext:
    beforeCursor: str
    selectedText: str
    afterCursor: str


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
        "name": "Rewording - selected text",
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


class ListResponse(BaseModel):
    responses: list[str]


async def run_one(prompt_name: str, doc: DocContext, model: str = MODEL) -> tuple:
    messages = [
        {"role": "system", "content": "You are a helpful and insightful writing assistant."},
        {"role": "user", "content": get_full_prompt(prompt_name, doc)},
    ]
    start_dt = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    completion = await client.beta.chat.completions.parse(
        model=model,
        messages=messages,
        response_format=ListResponse,
        max_completion_tokens=512,
    )
    elapsed = time.perf_counter() - t0
    end_dt = datetime.now(timezone.utc)
    parsed = completion.choices[0].message.parsed
    result = "(empty)" if not parsed or not parsed.responses else "\n".join(
        f"- {r}" for r in parsed.responses
    )
    return result, elapsed, messages, start_dt, end_dt, completion.usage


async def eyeball(model_a: str, model_b: str | None = None):
    compare = model_b is not None
    print(f"{'Comparing: ' + model_a + '  vs  ' + model_b if compare else 'Model: ' + model_a}\n")

    for doc_entry in TEST_DOCS:
        doc: DocContext = doc_entry["doc"]
        has_selection = bool(doc.selectedText.strip())

        print("=" * 70)
        print(f"DOCUMENT: {doc_entry['name']}")
        print("=" * 70)

        for prompt_name in PROMPTS:
            if prompt_name == "example_rewording" and not has_selection:
                continue
            if prompt_name != "example_rewording" and has_selection:
                continue

            if compare:
                (out_a, lat_a, *_), (out_b, lat_b, *_) = await asyncio.gather(
                    run_one(prompt_name, doc, model_a),
                    run_one(prompt_name, doc, model_b),
                )
                col = 34
                print(f"\n  [{prompt_name}]")
                print(f"  {'-' * col}  {'-' * col}")
                print(f"  {model_a + f' ({lat_a:.2f}s)':<{col}}  {model_b} ({lat_b:.2f}s)")
                print(f"  {'-' * col}  {'-' * col}")
                lines_a, lines_b = out_a.splitlines(), out_b.splitlines()
                for i in range(max(len(lines_a), len(lines_b))):
                    la = lines_a[i] if i < len(lines_a) else ""
                    lb = lines_b[i] if i < len(lines_b) else ""
                    la = (la[:col - 1] + "...") if len(la) > col else la
                    print(f"  {la:<{col}}  {lb}")
            else:
                output, latency, *_ = await run_one(prompt_name, doc, model_a)
                print(f"\n  [{prompt_name}]  {latency:.2f}s")
                print("  " + "-" * 50)
                for line in output.splitlines():
                    print(f"  {line}")

        print()


async def run_experiment(model: str, run_name: str):
    if _langfuse is None:
        print("Langfuse not configured. Cannot run experiment.")
        return

    try:
        dataset = _langfuse.get_dataset(DATASET_NAME)
    except Exception:
        print(f"Dataset '{DATASET_NAME}' not found — creating it...")
        _langfuse.create_dataset(name=DATASET_NAME)
        for doc_entry in TEST_DOCS:
            doc = doc_entry["doc"]
            has_selection = bool(doc.selectedText.strip())
            for prompt_name in PROMPTS:
                if prompt_name == "example_rewording" and not has_selection:
                    continue
                if prompt_name != "example_rewording" and has_selection:
                    continue
                _langfuse.create_dataset_item(
                    dataset_name=DATASET_NAME,
                    input={
                        "doc_name": doc_entry["name"],
                        "prompt_name": prompt_name,
                        "beforeCursor": doc.beforeCursor,
                        "selectedText": doc.selectedText,
                        "afterCursor": doc.afterCursor,
                    },
                )
        _langfuse.flush()
        dataset = _langfuse.get_dataset(DATASET_NAME)
        print(f"Dataset created with {len(dataset.items)} items.")

    print(f"Experiment: '{run_name}' | model: {model} | items: {len(dataset.items)}\n")

    for item in dataset.items:
        doc = DocContext(
            beforeCursor=item.input["beforeCursor"],
            selectedText=item.input["selectedText"],
            afterCursor=item.input["afterCursor"],
        )
        prompt_name = item.input["prompt_name"]

        output, latency, messages, start_dt, end_dt, usage = await run_one(prompt_name, doc, model)

        trace = _langfuse.trace(name=prompt_name, input=item.input, output=output, timestamp=start_dt)
        trace.generation(
            name="openai",
            model=model,
            input=messages,
            output=output,
            start_time=start_dt,
            end_time=end_dt,
            usage={
                "prompt_tokens": usage.prompt_tokens if usage else 0,
                "completion_tokens": usage.completion_tokens if usage else 0,
            },
        )
        item.link(trace, run_name=run_name)

        print(f"  [{prompt_name}] {item.input['doc_name']} ({latency:.2f}s)")
        for line in output.splitlines():
            print(f"    {line}")
        print()

    _langfuse.flush()
    print(f"Done. Check Langfuse -> Datasets -> {DATASET_NAME} -> Experiments")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Evaluate writing tool prompts")
    parser.add_argument("--compare", nargs=2, metavar="MODEL", help="Compare two models side by side")
    parser.add_argument("--model", default="gpt-4o", help="Model to use (default: gpt-4o)")
    parser.add_argument("--experiment", metavar="NAME", help="Run as a named Langfuse experiment")
    args = parser.parse_args()

    if args.experiment:
        asyncio.run(run_experiment(args.model, args.experiment))
    elif args.compare:
        asyncio.run(eyeball(args.compare[0], args.compare[1]))
    else:
        asyncio.run(eyeball(args.model))
