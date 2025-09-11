from openai import OpenAI
client = OpenAI()


from tenacity import (
    retry,
    stop_after_attempt,
    wait_random_exponential,
)  # for exponential backoff


@retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(6))
def get_openai_response(**kwargs):
    return client.chat.completions.create(**kwargs)
