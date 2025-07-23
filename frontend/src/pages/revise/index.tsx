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

The user is currently in a "visualization" part of the tool, where the tool promises to help the writer visualize their document to help them understand what points they are making, what their current structure is, what are the concepts and relationships in their document, and many other possible visualizations. The appropriate visualization will depend on the document, the writer, and the context. The writer may not have provided us with all necessary context; we should ask for additional details as needed.

Our response MUST reference specific parts of the document. We use Markdown links to reference document text: [ref](doctext:A%20short%20verbatim%20quote). The link target must exist, it must start with "doctext:", and it must be a URL-component-encoded verbatim quote from the document text (not to exceed 240 characters), without quotation marks.

When generating a visualization, it is critical that we remain faithful to the document provided. If we ever realize that we've deviated from the document text, even slightly, we must include a remark to that effect in [square brackets] as soon as possible after the deviation.`;

class Visualization {
	response: string;
	id: string;
	parsedResponse: string | null = null;
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

	parseResponse() {
		this.parsedResponse = this.response;
		return;
		//const refRegex = /<ref id="(\d+)" \/>/g;
		//const refTextRegex = /<ref-text id="(\d+)">([^<]+)<\/ref-text>/g;
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
				onClick={e => {
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
	const [visualizations, setVisualizations] = useState<Visualization[]>([]);
	const clickCallbackRef = useRef((href: string) => {
		if (href.startsWith('doctext:')) {
			const text = decodeURIComponent(href.slice('doctext:'.length));
			editorAPI.selectPhrase(text);
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
			setVisualizations(prev => [...prev, newViz]);
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
							newViz.parseResponse();
							console.log(
								'Visualization response complete:',
								newViz.response,
							);
							return;
						}
						const newContent = choice.delta.content;
						newViz.response += newContent;
						setVisualizations(prev => {
							// Force React to update by creating a new array
							const updatedViz = [...prev];
							const index = updatedViz.findIndex(
								v => v.id === newViz.id,
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

	return (
		<div className="flex flex-col">
			{/* prompt buttons: row-flowed list of buttons */}
			<div className="flex flex-row flex-wrap">
				{promptList.map(prompt => (
					<div
						key={prompt.keyword}
						className=""
					>
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
			{/* visualizations: list of visualizations */}
			<div className="flex flex-col">
				{visualizations.map((viz) => (
					<div
						key={viz.id}
						className="bg-white p-4 mb-2 rounded-md shadow-sm border border-gray-200"
					>
						<div className="text-gray-800 prose">
							<Remark
								rehypeReactOptions={{
									components: {
										a: AnchorWithCallback,
									},
								}}
							>
								{viz.response}
							</Remark>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
