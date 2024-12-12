import marimo

__generated_with = "0.9.27"
app = marimo.App(width="medium")


@app.cell
def __():
    import marimo as mo
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch
    return AutoModelForCausalLM, AutoTokenizer, mo, torch


@app.cell
def __(AutoModelForCausalLM, AutoTokenizer, torch):
    model_name = 'google/gemma-2-2b-it'
    #model_name = "HuggingFaceTB/SmolLM2-1.7B-Instruct"
    #model_name = 'Qwen/Qwen2.5-0.5B-Instruct'

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.bos_token_id is None:
        tokenizer.bos_token_id = tokenizer.pad_token_id
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map="cpu", torch_dtype=torch.float16)
    return model, model_name, tokenizer


@app.cell
def __(tokenizer, torch):
    import custom_llm_inference
    get_tokenized_chat = custom_llm_inference.get_tokenized_chat
    def tokenize_doc_in_progress(tokenizer, doc_in_progress):
        if len(doc_in_progress) == 0:
            return torch.empty(0, dtype=torch.int64)
        doc_in_progress_ids = tokenizer(
            doc_in_progress, return_tensors='pt')['input_ids'][0]
        print(repr(doc_in_progress), doc_in_progress_ids.dtype)

        # strip the first token, the "beginning of document" token
        # TODO: make this robust to switching models
        # since some models will use different special tokens
        doc_in_progress_ids = doc_in_progress_ids[1:]
        return doc_in_progress_ids
    tokenize_doc_in_progress(tokenizer, '')
    return (
        custom_llm_inference,
        get_tokenized_chat,
        tokenize_doc_in_progress,
    )


@app.cell
def __():
    doc = "The quick brown fox loves to jump over some really lazy dogs because it's just distracted from doing what foxes ought to do."
    prompt = "Rewrite this document to make more sense."
    updated_doc = doc
    #custom_llm_inference.get_highlights_inner(model, tokenizer, doc, prompt, updated_doc=updated_doc, k=5)
    return doc, prompt, updated_doc


@app.cell
def __():
    #ref_output = custom_llm_inference.get_next_token_predictions_inner(model, tokenizer, doc, prompt, doc_in_progress="", k=5)
    #ref_output
    return


@app.cell
def __(
    custom_llm_inference,
    doc,
    doc_in_progress,
    model,
    prompt,
    tokenizer,
):
    ref_output = custom_llm_inference.get_next_token_predictions_slow(model, tokenizer, doc, prompt, doc_in_progress=doc_in_progress, k=5)
    ref_output
    return (ref_output,)


@app.cell
def __():
    from transformers.cache_utils import DynamicCache
    return (DynamicCache,)


@app.cell
def __(tokenizer):
    tokenizer.__len__()
    return


@app.cell
def __(
    DynamicCache,
    doc,
    get_tokenized_chat,
    model,
    prompt,
    tokenize_doc_in_progress,
    tokenizer,
    torch,
):
    original_doc = doc
    doc_in_progress = "Sure, here's the document rewritten as requested:\n\nA fox,"
    k = 5
    tokenized_chat = get_tokenized_chat(tokenizer, prompt, original_doc)
    doc_in_progress_ids = tokenize_doc_in_progress(tokenizer, doc_in_progress)
    assert doc_in_progress_ids.dtype == torch.int64, doc_in_progress_ids.dtype
    joined_ids = torch.cat([tokenized_chat, doc_in_progress_ids])
    hypotheses = joined_ids[None].to(model.device)

    # For each of the k next tokens, generate most-likely next tokens and append back on until we
    # reach a token with a space

    past_key_values = DynamicCache()

    with torch.no_grad():
        model_outs_first_time = model(hypotheses, output_hidden_states=True, past_key_values=past_key_values)

    branch_tokens = model_outs_first_time.logits[0, -1].topk(k).indices

    # slow mode
    hypotheses_with_next_tokens = torch.cat([
        torch.repeat_interleave(hypotheses, k, dim=0),
        branch_tokens.unsqueeze(1)
    ], dim=1)


    # split the cache into k reps. We pretend we're doing a "Beam search"...
    past_key_values.reorder_cache(torch.zeros(k, dtype=int))

    with torch.no_grad():
        model_outs = model(
            branch_tokens.unsqueeze(1),
            past_key_values=past_key_values,
            #position_ids=
            cache_position=torch.full((1,), joined_ids.shape[0], dtype=int),
            use_cache=True
        )

    # Grab the single most likely token from each of the k sequences
    next_token_logits = model_outs.logits[:, -1]
    vocab_size = model.config.vocab_size#len(tokenizer)
    assert next_token_logits.shape == (k, vocab_size), f"{next_token_logits.shape=}, {k=}, {vocab_size=}"
    most_likely_token_ids = next_token_logits.argmax(dim=-1)

    # Stick them at the end of the branch tokens.
    assert most_likely_token_ids.shape == (k,)
    lookahead_sequences = torch.cat([
        branch_tokens.unsqueeze(1),
        most_likely_token_ids.unsqueeze(1)
    ], dim=1)
    assert lookahead_sequences.shape == (k, 2)
    return (
        branch_tokens,
        doc_in_progress,
        doc_in_progress_ids,
        hypotheses,
        hypotheses_with_next_tokens,
        joined_ids,
        k,
        lookahead_sequences,
        model_outs,
        model_outs_first_time,
        most_likely_token_ids,
        next_token_logits,
        original_doc,
        past_key_values,
        tokenized_chat,
        vocab_size,
    )


@app.cell
def __(past_key_values):
    past_key_values.key_cache[1].shape
    return


@app.cell
def __(lookahead_sequences, tokenizer):
    tokenizer.batch_decode(lookahead_sequences)
    return


@app.cell
def __(next_token_logits, ref_output):
    print(next_token_logits)
    print(ref_output[1])
    return


@app.cell
def __(next_token_logits, ref_output, torch):
    #torch.allclose(next_token_logits, ref_output[1])
    torch.linalg.vector_norm((next_token_logits - ref_output[1]), dim=1)
    return


@app.cell
def __(hypotheses, model, tokenizer):
    seqs = model.generate(hypotheses, num_beams=5, num_beam_groups=5, max_new_tokens=10, do_sample=False, diversity_penalty=1e5, top_k=None, num_return_sequences=5)#, token_healing=True, tokenizer=tokenizer)
    tokenizer.batch_decode(seqs)
    return (seqs,)


@app.cell
def __(tokenizer):
    tokenizer.convert_tokens_to_ids([" "])
    return


if __name__ == "__main__":
    app.run()
