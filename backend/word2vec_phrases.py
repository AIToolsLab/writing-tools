import marimo

__generated_with = "0.7.0"
app = marimo.App(width="medium")


@app.cell
def __():
    import marimo as mo
    return mo,


@app.cell
def __():
    import gensim

    word2vec_path = "/home/ka37/GoogleNews-vectors-negative300.bin"
    word2vec = gensim.models.KeyedVectors.load_word2vec_format(word2vec_path, binary=True)

    return gensim, word2vec, word2vec_path


@app.cell
def __(word2vec):
    phrases = [term for term in word2vec.index_to_key if '_' in term]
    len(phrases)
    return phrases,


@app.cell
def __(phrases):
    '\n'.join('- ' + x for x in phrases[:100])
    return


@app.cell
def __():
    return


if __name__ == "__main__":
    app.run()
