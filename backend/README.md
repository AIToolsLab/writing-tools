## Question Generation NLP

### Project Goals

- Implement NLP pipelines (or inferences) that will be used for question generation:
    - [Interview AI](https://haramkoo.github.io/InterviewAI/) pre-trained on [BART base](https://huggingface.co/facebook/bart-base) model.

- Pre-train NLP models that will be used for question generation.

- Implement FastAPI back-end that handles POST and GET requests from a font-end.

### Contribution Guide

In the interest of reproducibility and readability, please consider using [black](https://pypi.org/project/black/) for code formatting and referring to [this section of the guide](https://google.github.io/styleguide/pyguide.html#38-comments-and-docstrings) for code documentation.

Please keep back-end operations (i.e. FastAPI) separate from NLP methods and vice-versa. 

When necessary, implement interface methods for communicating with the back-end.

### Setup Guide

1. Clone this repository.
2. Create and activate a new conda environment.
3. Run `pip install -r requirements.txt`.
4. Run `uvicorn main:app --host localhost --port <port_number> --reload` with a custom `<port_number>`.
