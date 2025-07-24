/**
 * @format
 */

import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useAtomValue } from 'jotai';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Remark } from 'react-remark';
import { SERVER_URL } from '@/api';
import { useAccessToken } from '@/contexts/authTokenContext';
import { EditorContext } from '@/contexts/editorContext';
import { usernameAtom } from '@/contexts/userContext';
import { useDocContext } from '@/utilities';

interface Prompt {
	keyword: string;
	prompt: string;
	isOverall?: boolean;
}

const promptList: Prompt[] = [
	{
		keyword: 'Hierarchical Outline',
		prompt: 'Create a hierarchical outline of the document.',
		isOverall: true,
	},
	{
		keyword: 'Inspirational Exemplar',
		prompt: "Imagine an exemplar document with a similar rhetorical situation to this document (e.g., that might be published in the same venue) but a different specific message. Suppose that the document was written exceptionally well, by a famous author. What would that document look like? Provide a two-level *outline* of that exemplar document. For each outline point, provide (1) a short quote from the imagined exemplar and (2) a reference (in link format) to similar material in the actual writer's current (provided) document. If the writer's document does not yet contain a section that corresponds to the imagined exemplar section, reference a part of the document that it could be added near.",
		isOverall: true,
	},
	{
		keyword: 'Where to Work Next',
		prompt: 'List 7 places in the document that the writer could direct their attention to next. Respond with a Markdown list, most important first, where each item contains a doctext link to a specific part of the document, followed by a very short description of what aspect of that location could use attention. Include both places that the author has explicitly labeled as needing work (e.g., using TODO, brackets, all-caps, or other markers) and places that were not explicitly labeled but that could use work based on the content.',
		isOverall: true,
	},
	{
		keyword: 'Main Point',
		prompt: 'List the main points that the writer is making.',
	},
	{
		keyword: 'Important Concepts',
		prompt: 'List the most important concepts.',
	},
	{
		keyword: 'Claims and Arguments',
		prompt: 'List the claims or arguments presented.',
	},
	{
		keyword: 'Counterarguments',
		prompt: 'List potential counterarguments to the claims presented.',
	},
	{
		keyword: 'Further Evidence',
		prompt: 'List further evidence or examples you would like to see to support the claims presented.',
	},
	{
		keyword: 'Outside the Box',
		prompt: 'List outside-the-box questions or ideas that are directly related to this text.',
	},
	{
		keyword: 'Questions Addressed by Writer',
		prompt: 'List questions that the writer seems to be addressing in this text.',
	},
	{
		keyword: 'Questions a Reader Might Have',
		prompt: 'List questions that a reader might have about this text.',
	},
];

const systemPrompt = `\
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

class Visualization {
	response: string;
	id: string;
	references: string[] = [];

	constructor(
		public prompt: string,
		public docContext: DocContext,
	) {
		this.prompt = prompt;
		this.docContext = docContext;
		this.response = '';
		this.id = Date.now().toString();
	}
}

const makeAnchorWithCallback = (
	clickCallbackRef: React.MutableRefObject<(href: string) => void>,
) => {
	return (props: React.ComponentProps<'a'>) => {
		const { href, children, ...rest } = props;
		return (
			<a
				{...rest}
				href={href}
				className="text-blue-500 hover:underline"
				onClick={(e) => {
					e.preventDefault();
					if (href) clickCallbackRef.current?.(href);
				}}
			>
				{children}
			</a>
		);
	};
};

export default function Revise() {
	const editorAPI = useContext(EditorContext);
	const username = useAtomValue(usernameAtom);
	const docContext = useDocContext(editorAPI);
	const { getAccessToken, reportAuthError, authErrorType } = useAccessToken();
	const [loading, setLoading] = useState(false);
	const [customPrompts, setCustomPrompts] = useState<Prompt[]>([]);
	const [selectedCustomPrompt, setSelectedCustomPrompt] = useState<
		number | null
	>(null);
	const [visualizations, setVisualizations] = useState<Visualization[]>([]);
	const clickCallbackRef = useRef((href: string) => {
		if (href.startsWith('doctext:')) {
			const text = decodeURIComponent(href.slice('doctext:'.length));
			(async () => {
				let currentlySearchingForText = text;
				while (currentlySearchingForText.length > 0) {
					try {
						await editorAPI.selectPhrase(currentlySearchingForText);
						return;
					} catch {
						// If selection fails, trim off a word on each side.
						const nextSearchText = currentlySearchingForText
							.split(' ')
							.slice(1, -1)
							.join(' ');
						if (nextSearchText === currentlySearchingForText) {
							// If trimming didn't change the text, break to avoid infinite loop.
							break;
						}
						currentlySearchingForText = nextSearchText;
						console.warn(
							'Falling back to shorter text:',
							currentlySearchingForText,
						);
					}
				}
				console.warn('Failed to select phrase:', text);
			})();
		}
	});
	const AnchorWithCallback = useMemo(
		() => makeAnchorWithCallback(clickCallbackRef),
		[],
	);

	const requestVisualization = useCallback(
		async (prompt: Prompt) => {
			const token = await getAccessToken();
			if (!token) {
				console.error('No access token available');
				return;
			}

			const request = prompt.isOverall
				? prompt.prompt
				: `Go part-by-part through the document. For each part, please do the following: ${prompt.prompt}`;

			const newViz = new Visualization(request, docContext);
			setVisualizations((prev) => [...prev, newViz]);
			/* Kick off a streaming request to the server to get the visualization response */

			const chatMessages = [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: `
<document>
${docContext.beforeCursor}${docContext.selectedText}${docContext.afterCursor}
</document>

<request>
${request}
</request>`,
				},
			];
			setLoading(true);
			fetchEventSource(`${SERVER_URL}/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					messages: chatMessages,
					username: username,
				}),
				onmessage(msg) {
					try {
						if (!msg.data) {
							// I'm not sure why this happens.
							return;
						}
						const message = JSON.parse(msg.data);
						const choice = message.choices[0];
						if (choice.finish_reason === 'stop') {
							setLoading(false);
							console.log(
								'Visualization response complete:',
								newViz.response,
							);
							return;
						}
						const newContent = choice.delta.content;
						newViz.response += newContent;
						setVisualizations((prev) => {
							// Force React to update by creating a new array
							const updatedViz = [...prev];
							const index = updatedViz.findIndex(
								(v) => v.id === newViz.id,
							);
							if (index !== -1) {
								updatedViz[index] = newViz;
							}
							return updatedViz;
						});
					} catch (error) {
						console.error('Error parsing message:', error);
						setLoading(false);
					}
				},
				onerror(err) {
					console.error('Error fetching visualization:', err);
					setLoading(false);
					// TODO: maybe auth error?
				},
			});
		},
		[docContext, getAccessToken, username],
	);

	const curVisualization =
		visualizations.length > 0
			? visualizations[visualizations.length - 1]
			: null;

	if (
		docContext.beforeCursor.length === 0 &&
		docContext.selectedText.length === 0 &&
		docContext.afterCursor.length === 0
	) {
		return (
			<div className="text-gray-500">
				The document seems to be empty. Either you haven't written
				anything yet, or the text is still loading.
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{/* prompt buttons: row-flowed list of buttons */}
			<div className="flex flex-row flex-wrap">
				{promptList.map((prompt) => (
					<div key={prompt.keyword} className="">
						<button
							type="button"
							onClick={() => requestVisualization(prompt)}
							className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded-md transition-colors duration-150 shadow-sm border border-gray-200 mr-2 mb-2"
						>
							{prompt.keyword}
						</button>
					</div>
				))}
			</div>
			{/* visualization */}
			<div className="bg-white p-4 mb-2 rounded-md shadow-sm border border-gray-200">
				{curVisualization ? (
					<div className="text-gray-800 prose">
						<Remark
							rehypeReactOptions={{
								components: {
									a: AnchorWithCallback,
								},
							}}
						>
							{curVisualization?.response}
						</Remark>
					</div>
				) : (
					<div className="text-gray-500">
						Click a button to generate a visualization.
					</div>
				)}
			</div>
		</div>
	);
}
