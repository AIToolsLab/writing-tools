import marimo

__generated_with = "0.7.0"
app = marimo.App(width="medium")


@app.cell
def __():
    '''
    https://github.com/huggingface/transformers/issues/30810
    [Setting "num_beams" and using "past_key_values" when calling .generate() - 🤗Transformers - Hugging Face Forums](https://discuss.huggingface.co/t/setting-num-beams-and-using-past-key-values-when-calling-generate/84752)
    [Past_key_value with multiple new tokens - Intermediate - Hugging Face Forums](https://discuss.huggingface.co/t/past-key-value-with-multiple-new-tokens/49177)
    '''
    import marimo as mo
    return mo,


@app.cell
def __():
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, DynamicCache
    return AutoModelForCausalLM, AutoTokenizer, DynamicCache, torch


@app.cell
def __():
    #model_name = 'google/gemma-2-9b-it'
    model_name = 'google/gemma-1.1-2b-it'
    return model_name,


@app.cell
def __(AutoTokenizer, model_name):
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    return tokenizer,


@app.cell
def __(AutoModelForCausalLM, model_name):
    # load on CPU
    model = AutoModelForCausalLM.from_pretrained(model_name)
    return model,


@app.cell
def __():
    prompt = "Tell me a joke."
    return prompt,


@app.cell
def __():
    doc_in_progress = "What did the"
    return doc_in_progress,


@app.cell
def __():
    return


@app.cell
def __(model):
    generation_config, model_kwargs = model._prepare_generation_config(None)
    generation_config, model_kwargs
    return generation_config, model_kwargs


@app.cell
def __(generation_config, model, model_kwargs):
    past_key_values = model._get_cache(
        generation_config.cache_implementation,
        getattr(generation_config, "num_beams", 1) * 1,
        generation_config.max_length,
        **model_kwargs
    )
    return past_key_values,


@app.cell
def __(doc_in_progress, model, prompt, tokenizer, torch):
    messages = [
        {
            "role": "user",
            "content": f"{prompt}",
        },
    ]
    tokenized_chat = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")[0]

    doc_in_progress_ids = tokenizer(doc_in_progress, return_tensors='pt')['input_ids'][0]

    # strip the first token, the "beginning of document" token
    doc_in_progress_ids = doc_in_progress_ids[1:]

    joined_ids = torch.cat([tokenized_chat, doc_in_progress_ids])
    hypotheses = joined_ids[None].to(model.device)

    # For each of the k next tokens, generate most-likely next tokens and append back on until we
    # reach a token with a space

    with torch.no_grad():
        #model_outs = model(hypotheses, use_cache=True, past_key_values=past_key_values)
        generate_outs = model.generate(hypotheses.repeat_interleave(1, dim=0), max_new_tokens=1, use_cache=True, return_dict_in_generate=True, output_logits=True)
    return (
        doc_in_progress_ids,
        generate_outs,
        hypotheses,
        joined_ids,
        messages,
        tokenized_chat,
    )


@app.cell
def __(generate_outs):
    generate_outs.keys()
    return


@app.cell
def __(generate_outs):
    cache = generate_outs.past_key_values
    return cache,


@app.cell
def __():
    #cache.reorder_cache(torch.tensor([0,0,0,0,0]))
    return


@app.cell
def __(cache):
    cache.key_cache[0].shape
    return


@app.cell
def __():
    #model._supports_cache_class = True
    return


@app.cell
def __(cache, indices, model, torch):
    with torch.no_grad():
        generate_outs_2 = model.generate(indices, max_new_tokens=5, past_key_values=cache)
    return generate_outs_2,


@app.cell
def __(generate_outs, tokenizer):
    tokenizer.decode(generate_outs.sequences[0, -1])
    return


@app.cell
def __(generate_outs, tokenizer):
    tokenizer.decode(generate_outs.logits[0][-1].argmax())
    return


@app.cell
def __(generate_outs):
    indices = generate_outs.logits[0][-1].topk(k=5).indices[:,None]
    indices
    return indices,


@app.cell
def __(cache):
    vars(cache).keys()
    return


@app.cell
def __(cache):
    type(cache)
    return


@app.cell
def __():
    return


@app.cell
def __():
    return


if __name__ == "__main__":
    app.run()
