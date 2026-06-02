import type { DocContext } from './types';

// How many characters of context to show around the cursor position
const CONTEXT_CHARS = 100;

// System prompt for the Chat surface.
export const CHAT_SYSTEM_PROMPT =
	'Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise. If the user mentions "here" or "this", assume they are referring to the area near the cursor or selection.';

// System prompt for the Revise ("visualization") surface.
export const REVISE_SYSTEM_PROMPT = `\
We are powering a tool that is designed to help people write thoughtfully, with full cognitive engagement in their work, thinking about their complete rhetorical situation.

The user is currently in a "visualization" part of the tool, where the tool promises to help the writer visualize their document to help them understand what points they are making, what their current structure is, what are the concepts and relationships in their document, and many other possible visualizations. The appropriate visualization will depend on the document, the writer, and the context.

Our response MUST reference specific parts of the document. We use Markdown links to reference document text: [link text](link target). Guidelines:

- The **link target** (example: doctext:A%20short%20quote%20from%20the%20document) must:
  - be present
  - start with "doctext:"
  - be a short URL-component-encoded verbatim quote from the document text
  - must not exceed 240 characters
  - must be taken from a single line of the source text
  - must not be surrounded by quotation marks
- The **link text** should be a short (under 6 words) *description* of the link target, such as "second paragraph of Introduction" or "first time concept __ is introduced".

When generating a visualization, it is critical that we remain faithful to the document provided. If we ever realize that we've deviated from the document text, even slightly, we must include a remark to that effect in [square brackets] as soon as possible after the deviation.`;

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

// Builds the messages array that gets sent to the model for the Draft panel.
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
		userContent +=
			'\n\nFormat your response as a plain bulleted list, one item per line starting with "- ". Do not use JSON or array notation.';
	}

	return [
		{
			role: 'system' as const,
			content: 'You are a helpful and insightful writing assistant.',
		},
		{ role: 'user' as const, content: userContent },
	];
}

// Builds the single user message for the Revise ("visualization") surface: the document
// text plus the visualization request.
export function buildRevisionPrompt(docContext: DocContext, request: string) {
	let prompt = '';

	if (docContext.contextData && docContext.contextData.length > 0) {
		const contextSections = docContext.contextData
			.map((section) => `<context title="${section.title}">\n${section.content}</context>`)
			.join('\n\n');
		prompt += `<additional-context><!-- Note: will *not* be visible to the reader of the document -->\n\n${contextSections}</additional-context>`;
	}

	prompt += `<writer-doc-so-far>
${docContext.beforeCursor}${docContext.selectedText}${docContext.afterCursor}
</writer-doc-so-far>
`;

	const beforeCursorTrim = docContext.beforeCursor.slice(-CONTEXT_CHARS);
	const afterCursorTrim = docContext.afterCursor.slice(0, CONTEXT_CHARS);
	if (docContext.selectedText === '') {
		prompt += `\n\n## Text Right Before the Cursor\n\n"${beforeCursorTrim}"`;
	} else {
		prompt += `\n\n## Current Selection\n\n${docContext.selectedText}`;
		prompt += `\n\n## Text Nearby The Selection\n\n"${beforeCursorTrim}${docContext.selectedText}${afterCursorTrim}"`;
	}

	return `${prompt}

<request>
${request}
</request>`;
}
