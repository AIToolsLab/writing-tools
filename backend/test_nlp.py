from nlp import parse_reflections_chat, ReflectionResponseInternal

def test_parse_reflections_chat():
    full_response = """1. Concept: x\n   Relevance: 7 \n\n2. Concept: y\n   Relevance: 8 \n\n3. Concept: z\n   Relevance: 9 \n\nFINAL OUTPUT: - x \n- y\n- z"""

    actual = parse_reflections_chat(full_response)
    assert actual.full_response == full_response
    assert actual.scratch == "1. Concept: x\n   Relevance: 7 \n\n2. Concept: y\n   Relevance: 8 \n\n3. Concept: z\n   Relevance: 9"
    assert actual.reflections == ["x", "y", "z"]

    full_response = """1. Concept: x\n   Relevance: 7 \n\n2. Concept: y\n   Relevance: 8 \n\n3. Concept: z\n   Relevance: 9 \n\nFINAL OUTPUT: \n1. x \n2. y\n3. z"""

    actual = parse_reflections_chat(full_response)
    assert actual.full_response == full_response
    assert actual.scratch == "1. Concept: x\n   Relevance: 7 \n\n2. Concept: y\n   Relevance: 8 \n\n3. Concept: z\n   Relevance: 9"
    assert actual.reflections == ["x", "y", "z"]

    full_response = """abc. FINAL OUTPUT: def"""

    actual = parse_reflections_chat(full_response)
    assert actual.full_response == full_response
    assert actual.scratch == "abc."
    assert actual.reflections == ["def"]
