import os
import random
from typing import List, Dict

from dotenv import load_dotenv
import spacy

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


def is_full_sentence(sentence):
    sentence += " AND"

    # Concatenating " AND" to the text will result in 2 segments if the text is a complete sentence.
    num_segments = len(list(nlp(sentence).sents))

    return num_segments > 1


def obscure(token):
    word = token.text
    return "·" * len(word) + token.whitespace_


async def chat(messages: List[Dict[str, str]], temperature: float):
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

    return result


async def completion(prompt: str):
    # Generate a completion based on the now-complete last sentence.
    response = await openai_client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=prompt,
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stop=[".", "!", "?"],
    )

    result = response.choices[0].message.content

    return result


async def chat_completion(prompt: str):
    # 15 is about the length of an average sentence. GPT's most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))
    RHETORICAL_SITUATION = "You are a completion bot for a 200-word essay"

    # Assign prompt based on whether the document ends with a space for a new paragraph
    if prompt[-1] == "\r":
        system_chat_prompt = f"{RHETORICAL_SITUATION}. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words."
    else:
        system_chat_prompt = f"{RHETORICAL_SITUATION}. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words."

    result = await chat(
        messages=[
            {
                "role": "system",
                "content": [{"type": "text", "text": system_chat_prompt}],
            },
            {"role": "user", "content": prompt},
        ],
        temperature=1,
    )

    return {
        "result": result,
        "completion": None
    }


async def question(prompt: str):
    example = (await chat_completion(prompt))["result"]

    final_paragraph = str(prompt).split('\n')[-1]
    final_sentence = list(nlp(final_paragraph).sents)[-1].text

    if is_full_sentence(final_sentence):
        question_prompt = f"With the current document in mind:\n\n{prompt}\n\nWrite a question that would inspire the ideas expressed in the next given sentence."
    else:
        question_prompt = f"With the current document in mind:\n\n{prompt}\n\nReword the following completion as a who/what/when/where/why/how question."
    completion_length = len(example.split())
    max_length = max(int(completion_length * 0.8), 7)
    question_prompt += f" Use no more than {max_length} words."

    full_prompt = (
        f"{question_prompt}\n\n{example}"
    )

    questions = await chat(
        messages=[
            {"role": "user", "content": full_prompt},
        ],
        temperature=1,
    )

    return {
        "result": questions,
        "completion": example
    }


async def keywords(prompt: str):
    completion = (await chat_completion(prompt))["result"]

    KEYWORD_POS = ["NOUN", "PROPN", "VERB", "ADJ", "ADV", "INTJ"]

    # Process the text with spaCy
    doc = nlp(completion)

    # Extract the words with desired POS tags
    keywords = [token.lower_ for token in doc if token.pos_ in KEYWORD_POS]

    random.shuffle(keywords)

    keyword_string = ", ".join(keywords)

    return {
        "result": keyword_string,
        "completion": completion
    }


async def structure(prompt: str):
    completion = (await chat_completion(prompt))["result"]

    def is_keyword(token):
        # keyword_pos = token.pos_ in ["NOUN", "PRON", "PROPN", "ADJ", "VERB"]
        # past_participle = token.tag_ == "VBN"
        # ly_word = token.text[-2:] == "ly" and token.pos_ == "ADV"
        # determiner = token.tag_ == "WDT" or token.tag_ == "IN"
        # return not determiner and (keyword_pos or past_participle or ly_word)

        plainword_tag = token.tag_ in ["CC", "CD", "DT", "EX", "IN", "LS", "MD", "PDT", "PP", "PPZ", "RP", "TO", "WDT", "WP", "WP$", "WRB"]
        simple_adverb = (
            token.tag_ in ["RB", "RBR", "RBS", "WRB"] and token.text[-2:] != "ly"
        )
        aux = token.pos_ == "AUX"
        punct = token.is_punct

        return not (plainword_tag or punct or aux or simple_adverb)

    def filter(tokens):
        filtered_text = tokens[0].text_with_ws
        for token in tokens[1:]:
            if not is_keyword(token) or token.head == tokens[0]:
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

    return {
        "result": filtered_text.replace("· ·", "···").replace("· ·", "···"),
        "completion": completion
    }
