from nicegui import ui
import spacy
from openai import OpenAI
from dotenv import load_dotenv
import os

# Load ENV vars
load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


import joblib

memory = joblib.Memory('cache')

@memory.cache
def get_completions(text):
    response = client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=text,
        temperature=1,
        max_tokens=107,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
    )
    return response.choices[0].text

def get_first_sentence(text):
    doc = nlp(text.strip())
    sentences = list(doc.sents)
    return sentences[0].text


@memory.cache
def transform_to_question(text, transformation_prompt_value):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
            "role": "system",
            "content": [
                {
                "type": "text",
                "text": transformation_prompt_value
                }
            ]
            },
            {
            "role": "user",
            "content": [
                {
                "type": "text",
                "text": text
                }
            ]
            },
        ],
        temperature=1,
        max_tokens=256,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
        )
    return response.choices[0].message.content

# Load the small English model. Download it with:
# python -m spacy download en_core_web_sm
nlp = spacy.load('en_core_web_sm')

default_text = """
Do Teachers Assign Too Much Homework? 
 
The amount of homework teachers assign can be framed as a trade-off between aiding material retention and preserving feelings of engagement. Striking the correct balance between these concerns is crucial to facilitating a long-term acquisition of academic concepts.  
 
Well-written homework assignments give students the opportunity to apply principles learned in-class to novel situations, which fosters a more generalizable understanding of critical concepts. Hence, the question of whether a teacher assigns “too much” homework is in part shaped by the utility of that homework. The quantity of homework considered to be “too much” may in fact be a function of that utility rather than a raw quantity in itself. If a homework assignment requires repetitive applications of the same kind of knowledge to the same kinds of tasks, that redundancy would decrease the utility of that homework compared to a homework assignment that includes many novel applications---even if both homework assignments theoretically presented an equal quantity of work. So, rather than simply considering raw quantity as a metric for how much homework is “too much,” teachers should also consider how well the homework serves to stimulate the reader’s critical thought.  
 
Homework assignments which require a more dynamic application of academic concepts are likely to better engage the student, as well. In such situations, the homework may be enjoyable enough to the point that a student may not consider it “work.” In the most ideal of situations, this would entirely eliminate the idea of “too much homework” in itself. However, this is an impossibility. 
 
Even the most carefully crafted assignments can still overwhelm students, as it is impossible to tailor every task to the individual preferences, strengths, workloads, and personal responsibilities of a divere student body. Thus, the “usefulness” of homework is an important consideration, but still cannot be the only one. In practice, teachers should also seek regular feedback from students to stay aware of the time and effort required to do assignments in practice, and strive to keep assignments within the range of time students would expect based on context (course credits, grade level, etc.). 
 
This is especially true of college courses; while students can be expected to do a fairly fixed amount of homework based on credit count, the enjoyment and practical application of doing that homework will directly impact students' mental health and stress levels, making it imperative for educators to balance quantity and quality effectively. 
"""

def update():
    transformation_prompt_value = transformation_prompt.value.strip()
    text = document.value
    doc = nlp(text)

    sentences = list(doc.sents)
    rows = []
    for i in range(len(sentences)):
        doc_text_so_far = ''.join([s.text for s in sentences[:i + 1]])
        completion = get_completions(doc_text_so_far)
        first_sent = get_first_sentence(completion)
        as_question = transform_to_question(first_sent, transformation_prompt_value)
        rows.append(
            f'<tr><td>{sentences[i].text}</td><td>{as_question}</td><td>{first_sent}</td></tr>'
        )
    result.set_content(f"""
    <table>
        <tr><th>Original</th><th>Question</th><th>Completion</th></tr>
        {''.join(rows)}
    </table>
    """)

transformation_prompt = ui.input(label='Transformation Prompt', value='For this sentence, guess what question the interviewer asked that resulted in that answer.', on_change=lambda event: update())

document = ui.textarea(label='Text', placeholder='start typing', value=default_text,
            on_change=lambda event: update())
result = ui.html()

update()

ui.run()