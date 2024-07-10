import marimo

__generated_with = "0.7.2"
app = marimo.App(width="medium")


@app.cell
def __():
    import marimo as mo
    import nlp
    return mo, nlp


@app.cell
def __(mo):
    doc_text_area = mo.ui.text_area()
    doc_text_area
    return doc_text_area,


@app.cell
def __(doc_text_area):
    doc = doc_text_area.value
    doc
    return doc,


@app.cell
def __(doc, nlp):
    nlp.is_full_sentence(doc)
    return


@app.cell
def __():
    import openai
    openai.__version__
    return openai,


@app.cell
async def __(doc, nlp):
    await nlp.chat_completion(doc)
    return


@app.cell
def __():
    return


if __name__ == "__main__":
    app.run()
