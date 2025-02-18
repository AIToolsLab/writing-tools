import pytest
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import custom_llm_inference
from transformers.cache_utils import DynamicCache

@pytest.fixture
def model_and_tokenizer():
    model_name = 'google/gemma-2-2b-it'
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.bos_token_id is None:
        tokenizer.bos_token_id = tokenizer.pad_token_id
    model = AutoModelForCausalLM.from_pretrained(
        model_name, 
        device_map="cpu", 
        #torch_dtype=torch.float16
    )
    return model, tokenizer

@pytest.fixture
def sample_inputs():
    doc = "The quick brown fox loves to jump over lazy dogs."
    prompt = "Rewrite this document to make more sense."
    doc_in_progress = "Sure, here's the document rewritten as requested:\n\nA fox,"
    return doc, prompt, doc_in_progress

def test_get_next_token_predictions(model_and_tokenizer, sample_inputs):
    model, tokenizer = model_and_tokenizer
    doc, prompt, doc_in_progress = sample_inputs
    
    predictions = custom_llm_inference.get_next_token_predictions_slow(
        model, tokenizer, doc, prompt, doc_in_progress=doc_in_progress, k=5
    )
    
    assert len(predictions) == 2  # Should return (token_texts, logits)
    assert len(predictions[0]) == 5  # Should return k=5 predictions
    assert predictions[1].shape[1] == model.config.vocab_size

def test_get_tokenized_chat(model_and_tokenizer, sample_inputs):
    model, tokenizer = model_and_tokenizer
    doc, prompt, _ = sample_inputs
    
    tokenized_chat = custom_llm_inference.get_tokenized_chat(tokenizer, prompt, doc)
    
    assert isinstance(tokenized_chat, torch.Tensor)
    assert tokenized_chat.dim() == 1
    assert tokenized_chat.dtype == torch.int64

def test_highlights(model_and_tokenizer, sample_inputs):
    model, tokenizer = model_and_tokenizer
    doc, prompt, updated_doc = sample_inputs
    
    highlights = custom_llm_inference.get_highlights_inner(
        model, tokenizer, doc, prompt, updated_doc=updated_doc, k=5
    )
    
    assert isinstance(highlights, list)
    assert len(highlights) > 0
    for h in highlights:
        assert h['start'] >= 0
        assert h['end'] >= h['start']
        assert isinstance(h['token'], str)
        assert isinstance(h['token_loss'], float)
        assert isinstance(h['most_likely_token'], str)
        assert isinstance(h['topk_tokens'], list)
