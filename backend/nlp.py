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


def get_final_sentence(text):
    final_paragraph = text.split('\n')[-1]
    final_sentence = list(nlp(final_paragraph).sents)[-1].text

    return final_sentence


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
    ends_with_space = prompt.endswith(" ")
    if ends_with_space:
        system_chat_prompt = f"{RHETORICAL_SITUATION}. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words."
    else:
        system_chat_prompt = f"{RHETORICAL_SITUATION}. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words."

    temperature = 1.0
    result = await chat(
        messages=[
            {
                "role": "system",
                "content": [{"type": "text", "text": system_chat_prompt}],
            },
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
    )

    return {
        "result": result,
        "completion": None,
        "prompt": prompt,
        "temperature": temperature,
        "word_limit": word_limit,
        "ends_with_space": ends_with_space,
        "system_chat_prompt": system_chat_prompt,
    }


async def question(prompt: str):
    example_completion_data = (await chat_completion(prompt))
    example = example_completion_data["result"]

    final_sentence = get_final_sentence(prompt)

    temperature = 1.0

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
        temperature=temperature,
    )

    return {
        "result": questions,
        "completion": example,
        "prompt": prompt,
        "temperature": temperature,
        "example_completion_data": example_completion_data,
        "is_full_sentence": is_full_sentence(final_sentence),
        "max_length": max_length,
    }


async def keywords(prompt: str):
    completion = (await chat_completion(prompt))["result"]

    keyword_string = ""
    keyword_dict = dict(NOUN=[], PROPN=[], VERB=[], ADJ=[], ADV=[], INTJ=[])
    pos_labels = dict(NOUN="Nouns", PROPN="Proper Nouns", VERB="Verbs",
                      ADJ="Adjectives", ADV="Adverbs", INTJ="Interjections")

    # Process the text with spaCy
    doc = nlp(completion)

    # Extract and store the words by desired POS tags in keyword_dict
    for token in doc:
        pos = token.pos_
        if pos in keyword_dict and token.lower_ not in keyword_dict[pos]:
            if pos == "PROPN":
                keyword_dict[pos].append(token.text)
            else:
                keyword_dict[pos].append(token.lemma_)

    # Construct a string of keywords formatted by POS
    for pos in keyword_dict:
        pos_keywords = keyword_dict[pos]
        if pos_keywords != []:
            random.shuffle(pos_keywords)
            keyword_string += f"**{pos_labels[pos]}**: {', '.join(pos_keywords)}\n"

    return {
        "result": keyword_string,
        "completion": completion,
    }


async def structure(prompt: str):
    completion = (await chat_completion(prompt))["result"]

    prior_sentence = get_final_sentence(prompt)
    new_sentence = is_full_sentence(prior_sentence)

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

    return {
        "result": filtered_text.replace("· ·", "···").replace("· ·", "···"),
        "completion": completion
    }
