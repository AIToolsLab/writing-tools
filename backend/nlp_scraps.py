prompts_extra = {
    "proposal_questions": """\
We're helping a writer draft a document. List three questions that the document *ought* to address but does *not* yet address. Guidelines:

- Focus on the area of the document that is closest to the writer's cursor.
- Don't give specific words or phrases for the writer to use.
- Keep each question concise.
- Make each question very specific to the current document, not general questions that could apply to any document.
""",
    "analysis_missing": """\
We're helping a writer draft a document. List three observations of things that are missing from the document. Guidelines:

- Focus on the area of the document that is closest to the writer's cursor.
- Don't give specific words or phrases for the writer to use.
- Keep each observation concise.
- Make each observation very specific to the current document, not general observations that could apply to any document.
- Don't tell the writer what to do, just point out what is missing.
""",
    "analysis_audience": """\
We're helping a writer draft a document. List three reactions that a reader in the intended audience might have to the document. Guidelines:

- Focus on the area of the document that is closest to the writer's cursor.
- Don't give specific words or phrases for the writer to use.
- Keep each reaction concise.
- Make each reaction very specific to the current document, not general reactions that could apply to any document.
- Don't tell the writer what to do, just point out what a reader might think or feel.
""",
    "analysis_expectations": """\
We're helping a writer draft a document. List three ways in which this document doesn't meet the expectations that a reader in the intended audience might have. Guidelines:

- Focus on the area of the document that is closest to the writer's cursor.
- Don't give specific words or phrases for the writer to use.
- Keep each observation concise, less than 20 words.
- Make each observation very specific to the current document, not general observations that could apply to any document.
- Use short quotes from the document, when necessary, to illustrate the issue.
- Don't tell the writer what to do. Just state expectations that are not met.
""",
    "analysis_critique": """\
We're helping a writer draft a document. Provide inspiring, fresh, and constructive critique of the document by listing three specific observations.

Guidelines:

- If the writer has not yet written enough to warrant a critique, just say "Not enough text to critique."
- Focus on the area of the document that is closest to the writer's cursor.
- Don't give specific words or phrases for the writer to use.
- Aim for at least one positive and one critical observation. (Don't label them as such, just provide three observations.)
- Keep each observation concise, less than 20 words.
- Make each observation very specific to the current document, not general observations that could apply to any document.
- Avoid using directive language like "consider", "you should", "mention", "highlight", etc. Instead, just state the observation.
""",
}