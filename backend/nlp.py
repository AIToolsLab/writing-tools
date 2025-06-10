from collections import defaultdict
import os
import random
from typing import Any, Iterable, List, Dict, Literal

from dotenv import load_dotenv
from pydantic import BaseModel
import spacy

from openai.types.chat.chat_completion_message_param import ChatCompletionMessageParam
from openai import AsyncOpenAI

MODEL_NAME = "gpt-4o"

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


class GenerationResult(BaseModel):
    generation_type: Literal["Completion", "Question", "Keywords", "Structure", "RMove", "Reflection"]
    result: str
    extra_data: Dict[str, Any]


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
