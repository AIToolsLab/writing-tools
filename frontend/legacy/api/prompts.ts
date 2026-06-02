// How many characters of context to show around the cursor position
const CONTEXT_CHARS = 100;

// The instructions sent to the AI for each button in the Draft panel.
// These are copied exactly from the original backend — do not change them.
const prompts: Record<string, string> = {
	example_sentences: `You are assisting a writer in drafting a document. Generate three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about **10 words**.
`,

	proposal_advice: `You are assisting a writer in drafting a document by providing three directive (but not prescriptive) advice to help them develop their work. Your advice must be tailored to the document's genre. Use your best judgment to offer the most relevant and helpful advice, drawing from the following types of support as appropriate for the context:
- Support the writer in adhering to their stated writing goals or assignment guidelines.
- Help the writer think about what they could write next.
- Encourage the writer to maintain focus on their main idea and avoid introducing unrelated material.
- Recommend strengthening arguments by adding supporting evidence, specific examples, or clear reasoning.
- Advise on structuring material to achieve a clear and logical flow.
- Guide the writer in choosing language that is accessible and engaging for the intended audience.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- Keep each piece of advice under 20 words.
- Express the advice in the form of a directive instruction, not a question.
- Don't give specific words or phrases for the writer to use.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.
`,

	analysis_readerPerspective: `You are assisting a writer in drafting a document for a specific person. Generate three possible questions the person might have about the document so far.

Guidelines:
- Avoid suggesting specific words or phrases.
- Limit each question to under 20 words.
- Ensure all questions specifically reflect details or qualities from the current document, avoiding broad or generic statements.
- Each question should be expressed as a perspective describing how the person might feel about the document, not as a directive to the writer.
- If there is insufficient context to generate genuine questions, return an empty list.
`,

	complete_document: `You are assisting a writer complete and polish their document. Please provide a completed and polished version of the document that the writer has started writing.

Guidelines:
- Use the text in the document as a starting point, but make any changes needed to make the document complete and polished.
- Maintain the writer's tone, style, and voice throughout.
- Polish the text for clarity and coherence.
`,

	example_rewording: `You are assisting a writer in drafting a document. Generate three alternative rewordings of the writer's selected text.

Guidelines:
- Rephrase only the selected text in three different ways while preserving the original meaning.
- Vary the word choice, and tone across the three options.
- Maintain the writer's overall voice and style.
- Each rewording should be approximately the same length as the original selected text.
- If no text is selected, return an empty list.
`,
};

// Builds the messages array that gets sent to OpenAI.
// Previously this was done in the backend (nlp.py). Now the frontend does it,
// so the backend only needs to forward the messages to OpenAI.
export function buildMessages(gtype: string, docContext: DocContext) {
	const basePrompt = prompts[gtype];

	let userContent = basePrompt;

	// If the user has extra context sections (e.g. assignment instructions), append them
	if (docContext.contextData?.length) {
		const sections = docContext.contextData
			.map((s) => `## ${s.title}\n\n${s.content}`)
			.join('\n\n');
		userContent += `\n\n# Additional Context (will *not* be visible to the reader of the document):\n\n${sections}`;
	}

	// Send the full document text so the AI can see everything the writer has written
	const documentText =
		docContext.beforeCursor + docContext.selectedText + docContext.afterCursor;
	userContent += `\n\n# Writer's Document So Far\n\n<document>\n${documentText}</document>\n\n`;

	// Also highlight exactly where the cursor is (or what text is selected),
	// so the AI focuses on the right part of the document
	const beforeCursorTrim = docContext.beforeCursor.slice(-CONTEXT_CHARS);
	const afterCursorTrim = docContext.afterCursor.slice(0, CONTEXT_CHARS);

	if (!docContext.selectedText) {
		userContent += `\n\n## Text Right Before the Cursor\n\n"${beforeCursorTrim}"`;
	} else {
		userContent += `\n\n## Current Selection\n\n${docContext.selectedText}`;
		userContent += `\n\n## Text Nearby The Selection\n\n"${beforeCursorTrim}${docContext.selectedText}${afterCursorTrim}"`;
	}

	// These two prompts say "return an empty list" which causes the AI to output "[]"
	// as plain text instead of a proper bullet list. This line tells the AI to use
	// bullet format so we get readable results like "- item" instead of ["item"].
	if (gtype === 'analysis_readerPerspective' || gtype === 'example_rewording') {
		userContent += '\n\nFormat your response as a plain bulleted list, one item per line starting with "- ". Do not use JSON or array notation.';
	}

	return [
		{
			role: 'system' as const,
			content: 'You are a helpful and insightful writing assistant.',
		},
		{ role: 'user' as const, content: userContent },
	];
}
