// Smoke test for the standalone sidebar app: mounts the real component tree (reshaped +
// jotai + contexts + the three panels) and drives tab switching, so a render-time
// regression (e.g. a React 19 / reshaped incompatibility, a hook violation, or a broken
// panel) fails CI. AI calls aren't exercised here — only rendering and interaction.
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { Reshaped } from 'reshaped';
import { describe, expect, it } from 'vitest';
import App from '@/components/App';
import ChatContextWrapper from '@/contexts/chatContext';
import { EditorContext } from '@/contexts/editorContext';
import type { EditorAPI } from '@/lib/types';

const mockEditorAPI: EditorAPI = {
	getDocContext: async () => ({
		beforeCursor: 'The quick brown fox jumps over the lazy dog.',
		selectedText: '',
		afterCursor: '',
	}),
	addSelectionChangeHandler: () => {},
	removeSelectionChangeHandler: () => {},
	selectPhrase: async () => {},
};

function renderApp() {
	return render(
		<Provider>
			<Reshaped theme="slate">
				<ChatContextWrapper>
					<EditorContext.Provider value={mockEditorAPI}>
						<App />
					</EditorContext.Provider>
				</ChatContextWrapper>
			</Reshaped>
		</Provider>,
	);
}

describe('standalone sidebar app', () => {
	it('renders the navbar tabs and the default Draft panel', () => {
		renderApp();
		expect(screen.getByRole('button', { name: /Draft/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Revise/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Chat/i })).toBeInTheDocument();
		expect(screen.getByText(/CLICK A DESIRED BUTTON/i)).toBeInTheDocument();
		expect(screen.getByText('Examples')).toBeInTheDocument();
		expect(screen.getByText('Rewording')).toBeInTheDocument();
	});

	it('switches to the Revise panel and renders its controls', async () => {
		renderApp();
		fireEvent.click(screen.getByRole('button', { name: /Revise/i }));
		expect(await screen.findByText(/Set your to-do/i)).toBeInTheDocument();
		expect(screen.getByText('Audience')).toBeInTheDocument();
		expect(screen.getByText('Main Point')).toBeInTheDocument();
		expect(screen.getByText('Run selected features')).toBeInTheDocument();
	});

	it('switches to the Chat panel and renders the input and suggestion chips', async () => {
		renderApp();
		fireEvent.click(screen.getByRole('button', { name: /Chat/i }));
		expect(
			await screen.findByText(/What do you think about your document so far\?/i),
		).toBeInTheDocument();
		expect(screen.getByText('What is my main argument?')).toBeInTheDocument();
		expect(screen.getByPlaceholderText(/Ask something about your document/i)).toBeInTheDocument();
	});

	it('accepts typing into the Chat input', async () => {
		renderApp();
		fireEvent.click(screen.getByRole('button', { name: /Chat/i }));
		const input = (await screen.findByPlaceholderText(
			/Ask something about your document/i,
		)) as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: 'Does my intro work?' } });
		expect(input.value).toBe('Does my intro work?');
	});
});
