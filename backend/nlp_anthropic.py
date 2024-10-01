from collections import defaultdict
import os
import random
from typing import Any, Iterable, List, Dict, Literal

from dotenv import load_dotenv
from pydantic import BaseModel
import spacy
import anthropic

MODEL_NAME = "claude-2.1"



# Create Anthropic client
load_dotenv()

anthropic_api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()

if anthropic_api_key == "":
    raise Exception("ANTHROPIC_API_KEY is not set. Please set it in a .env file.")

client = anthropic.Client(api_key=anthropic_api_key)

# Load spaCy model for sentence splitting
try:
    nlp = spacy.load("en_core_web_sm")
except:
    print("Need to download spaCy model. Run:")
    print("python -m spacy download en_core_web_sm")
    exit()

def get_final_sentence(text):
    final_sentence = list(nlp(text).sents)[-1].text
    return final_sentence

def is_full_sentence(sentence):
    sentence += " AND"
    num_segments = len(list(nlp(sentence).sents))
    return num_segments > 1

def obscure(token):
    word = token.text
    return "·" * len(word) + token.whitespace_

async def chat(messages: Iterable[Dict[str, str]], temperature: float) -> str:
    prompt = "\n\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in messages])
    response = client.completions.create(
        model=MODEL_NAME,
        prompt=f"{anthropic.HUMAN_PROMPT} {prompt}{anthropic.AI_PROMPT}",
        max_tokens_to_sample=1024,
        temperature=temperature,
    )
    return response.completion

def chat_stream(messages: Iterable[Dict[str, str]], temperature: float):
    prompt = "\n\n".join([f"{msg['role'].capitalize()}: {msg['content']}" for msg in messages])
    return client.completion_stream(
        model=MODEL_NAME,
        prompt=f"{anthropic.HUMAN_PROMPT} {prompt}{anthropic.AI_PROMPT}",
        max_tokens_to_sample=1024,
        temperature=temperature,
    )

async def completion(prompt: str):
    response = client.completions.create(
        model=MODEL_NAME,
        prompt=f"{anthropic.HUMAN_PROMPT} {prompt}{anthropic.AI_PROMPT}",
        max_tokens_to_sample=1024,
        temperature=1,
        stop_sequences=[".", "!", "?"],
    )
    return response.completion

class GenerationResult(BaseModel):
    generation_type: Literal["Completion", "Question", "Keywords", "Structure", "RMove", "Reflection"]
    result: str
    extra_data: Dict[str, Any]

async def chat_completion(prompt: str, temperature=1.0) -> GenerationResult:
    word_limit = str(random.randint(15, 30))
    RHETORICAL_SITUATION = "You are a completion bot for a 200-word essay"

    ends_with_newline = prompt.endswith("\r\r") or prompt.endswith("\n")
    if ends_with_newline:
        system_chat_prompt = f"{RHETORICAL_SITUATION}. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words."
    else:
        system_chat_prompt = f"{RHETORICAL_SITUATION}. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words."

    result = await chat(
        messages=[
            {"role": "system", "content": system_chat_prompt},
            {"role": "user", "content": prompt},
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
            "system_chat_prompt": system_chat_prompt,
        })

async def question(prompt: str) -> GenerationResult:
    example_completion_data = (await chat_completion(prompt))
    example = example_completion_data.result

    final_sentence = get_final_sentence(prompt)

    temperature = 1.0

    if (final_sentence.endswith("\r\r")
        or final_sentence.endswith("\n")
        or is_full_sentence(final_sentence)
    ):
        question_prompt = f"With the current document in mind:\n\n{prompt}\n\nWrite a question that would inspire the ideas expressed in the next given sentence."
    else:
        question_prompt = f"With the current document in mind:\n\n{prompt}\n\nReword the following completion as a who/what/when/where/why/how question."
    completion_length = len(example.split())
    max_length = max(int(completion_length * 0.8), 7)
    question_prompt += f" Use no more than {max_length} words."

    full_prompt = f"{question_prompt}\n\n{example}"

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
            "completion": example,
            "temperature": temperature,
            "example_completion_data": example_completion_data,
            "is_full_sentence": is_full_sentence(final_sentence),
            "max_length": max_length,
        })

async def reflection(prompt: str, paragraph: str) -> GenerationResult:
    temperature = 1.0

    questions = await chat(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": paragraph},
        ],
        temperature=temperature,
    )

    return GenerationResult(
        generation_type="Reflection",
        result=questions,
        extra_data={
            "prompt": prompt,
            "temperature": temperature,
        })

async def keywords(prompt: str) -> GenerationResult:
    completion = (await chat_completion(prompt)).result

    keyword_dict = defaultdict(set)
    pos_labels = dict(NOUN="Nouns", PROPN="Proper Nouns", VERB="Verbs",
                      ADJ="Adjectives", ADV="Adverbs", INTJ="Interjections")

    doc = nlp(completion)

    for token in doc:
        pos = token.pos_
        if pos not in pos_labels:
            continue
        text = token.text if pos == "PROPN" else token.lemma_
        keyword_dict[pos].add(text)

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

async def structure(prompt: str) -> GenerationResult:
    completion = (await chat_completion(prompt)).result

    prior_sentence = get_final_sentence(prompt)
    new_sentence = (prior_sentence.endswith("\r\r")
        or prior_sentence.endswith("\n")
        or is_full_sentence(prior_sentence)
    )

    def is_keyword(token):
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
            if not is_keyword(token) or (token.head == tokens[0] and new_sentence):
                if token.tag_ == "HYPH":
                    filtered_text += " "
                else:
                    filtered_text += token.text_with_ws
            else:
                filtered_text += obscure(token)

        return filtered_text.strip()

    processed_text = nlp(completion)
    filtered_text = filter(processed_text)

    return GenerationResult(
        generation_type="Structure",
        result=filtered_text.replace("· ·", "···").replace("· ·", "···"),
        extra_data={"completion": completion}
    )

async def rmove(prompt: str) -> GenerationResult:
    temperature = 1.0

    move_prompt = f"You are a writing assistant. Name a rhetorical category the next sentence in the given document should fulfill. Answer in the following format: <Category>: <Instruction>. Use no more than 10 words."

    full_prompt = f"{move_prompt}\n\n{prompt}"

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
            "move_prompt": move_prompt,
        }
    )