from collections import defaultdict
import os
import random
from typing import Any, Iterable, List, Dict, Literal, Optional

from dotenv import load_dotenv
from pydantic import BaseModel
import spacy

import openai
from openai.types.chat.chat_completion_message_param import ChatCompletionMessageParam
from openai import AsyncOpenAI

MODEL_NAME = "gpt-4o"
DEBUG_PROMPTS = False

# Create OpenAI client
load_dotenv()

openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

openai_client = AsyncOpenAI(
    api_key=openai_api_key,
)

# Load spaCy model for sentence splitting
try:
    nlp = spacy.load("en_core_web_sm")
    # nlp = spacy.load("en_core_web_trf")
except:
    print("Need to download spaCy model. Run:")
    print("python -m spacy download en_core_web_sm")
    # print("pip install spacy-transformers")
    # print("python -m spacy download en_core_web_trf")

    exit()


async def warmup_nlp():
    # Warm up the OpenAI client by making a dummy request
    dummy_client = openai.AsyncOpenAI(base_url="https://localhost:8000/v1", api_key="", timeout=0.01, max_retries=0)
    # make a dummy request to make sure everything is imported
    try:
        await dummy_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": "Hello"}],
        )
    except openai.APIConnectionError:
        # We expect this error because we're connecting to a non-existent server
        pass


    # Warm up the SpaCy model by processing a sample text
    nlp("Hello world. This is a test.").sents

prompts = {
    "example_sentences": """\
We're helping a writer draft a document. Please output three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next. Guidelines:

- Focus on the area of the document that is currently being written.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about 20 words.
""",
    "proposal_advice": """\
We're helping a writer draft a document. Please output three actionable, inspiring, and fresh directive instructions that would help the writer think about what they should write next. Guidelines:

- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Keep each piece of advice concise.
- Express the advice in the form of a directive instruction, not a question.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.
""",
    "proposal_questions": """\
We're helping a writer draft a document. List three questions that the document *ought* to address but does *not* yet address. Guidelines:

- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Keep each question concise.
- Make each question very specific to the current document, not general questions that could apply to any document.
""",
    "analysis_missing": """\
We're helping a writer draft a document. List three observations of things that are missing from the document. Guidelines:

- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Keep each observation concise.
- Make each observation very specific to the current document, not general observations that could apply to any document.
- Don't tell the writer what to do, just point out what is missing.
""",
    "analysis_audience": """\
We're helping a writer draft a document. List three reactions that a reader in the intended audience might have to the document. Guidelines:

- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Keep each reaction concise.
- Make each reaction very specific to the current document, not general reactions that could apply to any document.
- Don't tell the writer what to do, just point out what a reader might think or feel.
""",
    "analysis_expectations": """\
We're helping a writer draft a document. List three ways in which this document doesn't meet the expectations that a reader in the intended audience might have. Guidelines:

- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Keep each observation concise, less than 20 words.
- Make each observation very specific to the current document, not general observations that could apply to any document.
- Use short quotes from the document, when necessary, to illustrate the issue.
- Don't tell the writer what to do. Just state expectations that are not met.
""",
    "analysis_critique": """\
We're helping a writer draft a document. Provide inspiring, fresh, and constructive critique of the document by listing three specific observations.

Guidelines:

- If the writer has not yet written enough to warrant a critique, just say "Not enough text to critique."
- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Aim for at least one positive and one critical observation. (Don't label them as such, just provide three observations.)
- Keep each observation concise, less than 20 words.
- Make each observation very specific to the current document, not general observations that could apply to any document.
- Avoid using directive language like "consider", "you should", "mention", "highlight", etc. Instead, just state the observation.
""",
    "analysis_describe": """\
We're helping a writer draft a document. Give three constructive critiques of the document so far.

Guidelines:

- Focus on the area of the document that is currently being written.
- Don't give specific words or phrases for the writer to use.
- Keep each description concise, less than 20 words.
- Make each description very specific to the current document, not general observations that could apply to any document.
- Each critique should be expressed as a sentence describing the document, not as a directive to the writer.
"""
}


class ContextSection(BaseModel):
    title: str
    content: str

class DocContext(BaseModel):
    contextData: Optional[List[ContextSection]] = None
    beforeCursor: str
    selectedText: str
    afterCursor: str


class GenerationResult(BaseModel):
    generation_type: str
    result: str
    extra_data: Dict[str, Any]



def get_full_prompt(prompt_name: str, doc_context: DocContext) -> str:
    prompt = prompts[prompt_name]

    if doc_context.contextData:
        context_sections = "\n\n".join(
            [f"## {section.title}\n\n{section.content}" for section in doc_context.contextData]
        )
        prompt += f"\n\n# Additional Context (will *not* be visible to the reader of the document):\n\n{context_sections}"

    document_text = doc_context.beforeCursor + doc_context.selectedText + doc_context.afterCursor

    prompt += f"\n\n# Writer's Document So Far\n\n<document>\n{document_text}</document>\n\n"
    if doc_context.selectedText == '':
        prompt += "\n\n## Current Selection\n\nNo text selected."
        before_cursor = doc_context.beforeCursor[-50:]
        before_cursor_cur_line = before_cursor.rsplit('\n', 1)[-1]
        prompt += f"\n\n## Text Around Cursor\n\n\"{doc_context.beforeCursor[-50:]}{doc_context.afterCursor[:50]}\"\n{' ' * len(before_cursor_cur_line)}^ Cursor Position"
    else:
        prompt += f"\n\n## Current Selection\n\n{doc_context.selectedText}"
        prompt += f"\n\n## Text Nearby The Selection\n\n\"{doc_context.beforeCursor[-50:]}{doc_context.selectedText}{doc_context.afterCursor[:50]}\""
    return prompt


# Structured response for multiple suggestions
class SuggestionItem(BaseModel):
    content: str

class SuggestionResponse(BaseModel):
    suggestions: List[SuggestionItem]


async def get_suggestion(prompt_name: str, doc_context: DocContext) -> GenerationResult:
    full_prompt = get_full_prompt(prompt_name, doc_context)
    if DEBUG_PROMPTS:
        print(f"Prompt for {prompt_name}:\n{full_prompt}\n")
    completion = await openai_client.chat.completions.parse(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": "You are a helpful and insightful writing assistant."},
            {"role": "user", "content": full_prompt}
        ],
        response_format=SuggestionResponse
    )

    # Extract the response content from the parsed message
    suggestion_response = completion.choices[0].message.parsed
    if not suggestion_response or not suggestion_response.suggestions:
        raise ValueError("No suggestions found in the response.")
    markdown_response = "\n\n".join(
        [f"- {item.content}" for item in suggestion_response.suggestions]
    )
    return GenerationResult(generation_type=prompt_name, result=markdown_response, extra_data={})


def get_final_sentence(text):
    final_sentence = list(nlp(text).sents)[-1].text

    return final_sentence


def is_full_sentence(sentence):
    sentence += " AND"

    # Concatenating " AND" to the text will result in 2 segments if the text is a complete sentence.
    num_segments = len(list(nlp(sentence).sents))

    return num_segments > 1


def obscure(token):
    word = token.text
    return "·" * len(word) + token.whitespace_


async def chat(messages: Iterable[ChatCompletionMessageParam], temperature: float) -> str:
    response = await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=temperature,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )

    result = response.choices[0].message.content

    # FIXME: figure out why result might ever be None
    return result or ""

def chat_stream(messages: Iterable[ChatCompletionMessageParam], temperature: float):
    return openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=temperature,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True,
    )


async def completion(userDoc: str):
    # Generate a completion based on the now-complete last sentence.
    response = await openai_client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=userDoc,
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stop=[".", "!", "?"],
    )

    result = response.choices[0].text

    return result


async def chat_completion(userDoc: str, temperature=1.0) -> GenerationResult:
    # 15 is about the length of an average sentence. GPT's most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))
    RHETORICAL_SITUATION = "Act as a completion bot for a 200-word essay"

    # Assign prompt based on whether the document ends with a newline for a new paragraph
    ends_with_newline = userDoc.endswith("\r\r") or userDoc.endswith("\n")
    if ends_with_newline:
        completion_prompt = f"{RHETORICAL_SITUATION}. For the given text above, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words."
    else:
        completion_prompt = f"{RHETORICAL_SITUATION}. For the given text above, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words."

    full_prompt = construct_prompt_prefix(userDoc) + completion_prompt

    result = await chat(
        messages=[
            {"role": "user", "content": full_prompt},
        ],
        temperature=temperature,
    )

    return GenerationResult(
        generation_type="Completion",
        result=result,
        extra_data={
            "completion": result,
            "temperature": temperature,
            "word_limit": word_limit,
            "ends_with_newline": ends_with_newline,
        })


async def question(userDoc: str) -> GenerationResult:
    completion_data = (await chat_completion(userDoc))
    completion = completion_data.result

    final_sentence = get_final_sentence(userDoc)

    temperature = 1.0

    if (final_sentence.endswith("\r\r")
        or final_sentence.endswith("\n")
        or is_full_sentence(final_sentence)
    ):
        question_prompt = f"Write a question that would inspire the ideas expressed in the next given sentence."
    else:
        question_prompt = f"Reword the following completion as a who/what/when/where/why/how question."
    completion_length = len(completion.split())
    max_length = max(int(completion_length * 0.8), 7)
    question_prompt += f" Use no more than {max_length} words."


    transformation_prompt = (
        f"{question_prompt}\n\n{completion}"
    )

    full_prompt = construct_prompt_prefix(userDoc) + transformation_prompt

    questions = await chat(
        messages=[
            {"role": "user", "content": full_prompt},
        ],
        temperature=temperature,
    )

    return GenerationResult(
        generation_type="Question",
        result=questions,
        extra_data={
            "completion": completion,
            "temperature": temperature,
            "completion_data": completion_data,
            "is_full_sentence": is_full_sentence(final_sentence),
            "max_length": max_length,
        })


async def reflection(userDoc: str, paragraph: str) -> GenerationResult:
    temperature = 1.0

    questions = await chat(
        messages=[
            {"role": "system", "content": userDoc},
            {"role": "user", "content": paragraph},
        ],
        temperature=temperature,
    )

    return GenerationResult(
        generation_type="Reflection",
        result=questions,
        extra_data={
            "prompt": userDoc,
            "temperature": temperature,
        })


async def keywords(userDoc: str) -> GenerationResult:
    completion = (await chat_completion(userDoc)).result

    keyword_dict = defaultdict(set)
    pos_labels = dict(NOUN="Nouns", PROPN="Proper Nouns", VERB="Verbs",
                        ADJ="Adjectives", ADV="Adverbs", INTJ="Interjections")

    # Process the text with spaCy
    doc = nlp(completion)

    # Extract and store the words by desired POS tags in keyword_dict
    for token in doc:
        pos = token.pos_
        if pos not in pos_labels:
            continue
        text = token.text if pos == "PROPN" else token.lemma_
        keyword_dict[pos].add(text)

    # Construct a string of keywords formatted by POS
    keyword_string = ""
    for pos in keyword_dict:
        pos_keywords = list(keyword_dict[pos])
        if pos_keywords != []:
            random.shuffle(pos_keywords)
            keyword_string += f"**{pos_labels[pos]}**: {', '.join(pos_keywords)}\n"

    return GenerationResult(
        generation_type="Keywords",
        result=keyword_string,
        extra_data={
            "completion": completion,
            "words_by_pos": {pos: list(words) for pos, words in keyword_dict.items()},
        }
    )


async def structure(userDoc: str) -> GenerationResult:
    completion = (await chat_completion(userDoc)).result

    prior_sentence = get_final_sentence(userDoc)
    new_sentence = (prior_sentence.endswith("\r\r")
        or prior_sentence.endswith("\n")
        or is_full_sentence(prior_sentence)
    )

    def is_keyword(token):
        # keyword_pos = token.pos_ in ["NOUN", "PRON", "PROPN", "ADJ", "VERB"]
        # past_participle = token.tag_ == "VBN"
        # ly_word = token.text[-2:] == "ly" and token.pos_ == "ADV"
        # determiner = token.tag_ == "WDT" or token.tag_ == "IN"
        # return not determiner and (keyword_pos or past_participle or ly_word)

        plainword_tag = token.tag_ in ["CC", "CD", "DT", "EX", "IN", "LS",
                                        "MD", "PDT", "PRP", "PRP$", "RP", "TO", "WDT", "WP", "WP$", "WRB"]
        simple_adverb = (
            token.tag_ in ["RB", "RBR", "RBS",
                            "WRB"] and token.text[-2:] != "ly"
        )
        aux = token.pos_ == "AUX"
        punct = token.is_punct

        return not (plainword_tag or punct or aux or simple_adverb)

    def filter(tokens):
        filtered_text = tokens[0].text_with_ws
        for token in tokens[1:]:
            # If token is not a keyword or is a dependency of a new sentence's opener:
            if not is_keyword(token) or (token.head == tokens[0] and new_sentence):
                if token.tag_ == "HYPH":
                    filtered_text += " "
                else:
                    filtered_text += token.text_with_ws
            else:
                filtered_text += obscure(token)

        return filtered_text.strip()

    # Process the text with spaCy
    processed_text = nlp(completion)

    # Remove words with desired POS tags and convert to str
    filtered_text = filter(processed_text)

    return GenerationResult(
        generation_type="Structure",
        result=filtered_text.replace("· ·", "···").replace("· ·", "···"),
        extra_data={"completion": completion}
    )


# Rhetorical Move
async def rmove(userDoc: str) -> GenerationResult:
    #final_sentence = get_final_sentence(prompt)

    temperature = 1.0

    move_prompt = f"Act as a writing assistant. Name a rhetorical category the next sentence in the above document should fulfill. Answer in the following format: <Category>: <Instruction>. Use no more than 10 words."

    full_prompt = construct_prompt_prefix(userDoc) + move_prompt

    rhetorical_move = await chat(
        messages=[
            {"role": "user", "content": full_prompt},
        ],
        temperature=temperature,
    )

    return GenerationResult(
        generation_type="RMove",
        result=rhetorical_move,
        extra_data={
            "temperature": temperature,
            #"is_full_sentence": is_full_sentence(final_sentence),
            "move_prompt": move_prompt,
        }
    )


# Construct prompt prefix
def construct_prompt_prefix(userDoc: str) -> str:
    return f"With the current document in mind:<document>\n{userDoc}\n</document>\n\n"
