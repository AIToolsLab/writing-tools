/**
 * @format
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider, createStore } from 'jotai';
import Draft from '../index';
import { EditorContext } from '@/contexts/editorContext';
import { useAccessToken } from '@/contexts/authTokenContext';
import { useDocContext } from '@/utilities';
import { studyDataAtom } from '@/contexts/studyContext';
import { usernameAtom } from '@/contexts/userContext';

// Mock only the things we need to mock
jest.mock('@/contexts/authTokenContext');
jest.mock('@/utilities');
jest.mock('@/api', () => ({
	log: jest.fn(),
	SERVER_URL: 'http://localhost:8000',
}));

// Mock react-remark to avoid rendering complexity
jest.mock('react-remark', () => ({
	Remark: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Mock react-icons
jest.mock('react-icons/ai', () => ({
	AiOutlineClose: () => <div>Close Icon</div>,
	AiOutlineReload: () => <div>Reload Icon</div>,
}));

// Mock iconFunc
jest.mock('../iconFunc', () => ({
	iconFunc: jest.fn(() => <div>Icon</div>),
}));

const mockUseAccessToken = useAccessToken as jest.MockedFunction<typeof useAccessToken>;
const mockUseDocContext = useDocContext as jest.MockedFunction<typeof useDocContext>;

const mockEditorAPI: EditorAPI = {
	doLogin: jest.fn().mockResolvedValue(undefined),
	doLogout: jest.fn().mockResolvedValue(undefined),
	getDocContext: jest.fn().mockResolvedValue({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	}),
	addSelectionChangeHandler: jest.fn(),
	removeSelectionChangeHandler: jest.fn(),
	selectPhrase: jest.fn().mockResolvedValue(undefined),
};

const mockDocContext = {
	beforeCursor: 'This is some text before ',
	selectedText: '',
	afterCursor: ' and text after',
};

// Helper to render Draft with Jotai context
function renderDraft(atomValues?: { username?: string; studyData?: any }) {
	const store = createStore();

	// Set initial values in the store
	if (atomValues) {
		if (atomValues.username !== undefined) {
			store.set(usernameAtom, atomValues.username);
		}
		if (atomValues.studyData !== undefined) {
			store.set(studyDataAtom, atomValues.studyData);
		}
	}

	return render(
		<JotaiProvider store={store}>
			<EditorContext.Provider value={mockEditorAPI}>
				<Draft />
			</EditorContext.Provider>
		</JotaiProvider>,
	);
}

describe('Draft Component', () => {
	beforeEach(() => {
		// Setup default mocks
		mockUseAccessToken.mockReturnValue({
			getAccessToken: jest.fn().mockResolvedValue('mock-token'),
			authErrorType: null,
			reportAuthError: jest.fn(),
		});

		mockUseDocContext.mockReturnValue(mockDocContext);

		// Mock fetch globally
		global.fetch = jest.fn();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('Basic Rendering', () => {
		it('should render without crashing', () => {
			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			expect(
				screen.getByText('Click the button above to generate a suggestion.'),
			).toBeInTheDocument();
		});

		it('should render all three mode buttons in non-study mode', () => {
			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			// In non-study mode, we should have 3 buttons (one for each mode)
			const buttons = screen.getAllByRole('button');
			expect(buttons).toHaveLength(3);
		});

		it('should display the disclaimer note', () => {
			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			expect(
				screen.getByText(
					'Please note that the quality of AI-generated text may vary',
				),
			).toBeInTheDocument();
		});
	});

	describe('Study Mode - no_ai condition', () => {
		it('should show static message when condition is no_ai', () => {
			renderDraft({
				username: 'test-user',
				studyData: {
					condition: 'no_ai',
					autoRefreshInterval: 0,
					trueContext: '',
					falseContext: '',
					contextToUse: 'true',
				},
			});

			expect(
				screen.getByText(
					/AI suggestions are unavailable for this task/i,
				),
			).toBeInTheDocument();
		});

		it('should not render suggestion buttons in no_ai mode', () => {
			renderDraft({
				username: 'test-user',
				studyData: {
					condition: 'no_ai',
					autoRefreshInterval: 0,
					trueContext: '',
					falseContext: '',
					contextToUse: 'true',
				},
			});

			const buttons = screen.queryAllByRole('button');
			expect(buttons).toHaveLength(0);
		});
	});

	describe('Study Mode - with AI', () => {
		it('should render single refresh button in study mode', () => {
			renderDraft({
				username: 'test-user',
				studyData: {
					condition: 'example_sentences',
					autoRefreshInterval: 10000,
					trueContext: '',
					falseContext: '',
					contextToUse: 'true',
				},
			});

			expect(screen.getByText('Refresh')).toBeInTheDocument();
			const buttons = screen.getAllByRole('button');
			expect(buttons).toHaveLength(1);
		});
	});

	describe('Error Handling', () => {
		it('should display reauthorization message when auth error exists', () => {
			mockUseAccessToken.mockReturnValue({
				getAccessToken: jest.fn().mockResolvedValue('mock-token'),
				authErrorType: 'unauthorized',
				reportAuthError: jest.fn(),
			});

			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			expect(screen.getByText('Please reauthorize.')).toBeInTheDocument();
		});

		it('should display error message when suggestion fetch fails', async () => {
			const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			const button = screen.getAllByRole('button')[0];
			await userEvent.click(button);

			await waitFor(() => {
				expect(
					screen.getByText(/Network error/i, { exact: false }),
				).toBeInTheDocument();
			});
		});
	});

	describe('Loading State', () => {
		it('should show loading spinner when fetching suggestion', async () => {
			const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
			mockFetch.mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								ok: true,
								json: async () => ({
									generation_type: 'example_sentences',
									result: '1. Example sentence one\n2. Example sentence two',
								}),
							} as Response);
						}, 100);
					}),
			);

			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			const button = screen.getAllByRole('button')[0];
			await userEvent.click(button);

			// Should show loading spinner
			await waitFor(() => {
				const spinner = document.querySelector('[class*="loader"]');
				expect(spinner).toBeInTheDocument();
			});
		});

		it('should disable buttons during loading', async () => {
			const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
			mockFetch.mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								ok: true,
								json: async () => ({
									generation_type: 'example_sentences',
									result: '1. Example sentence',
								}),
							} as Response);
						}, 100);
					}),
			);

			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			const buttons = screen.getAllByRole('button');
			await userEvent.click(buttons[0]);

			// All buttons should be disabled during loading
			await waitFor(() => {
				buttons.forEach((button) => {
					expect(button).toBeDisabled();
				});
			});
		});
	});

	describe('Saved Items', () => {
		it('should display saved suggestions after successful fetch', async () => {
			const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					generation_type: 'example_sentences',
					result: '1. First suggestion\n2. Second suggestion',
				}),
			} as Response);

			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			const button = screen.getAllByRole('button')[0];
			await userEvent.click(button);

			await waitFor(() => {
				expect(
					screen.getByText(/First suggestion/i),
				).toBeInTheDocument();
			});
		});

		it('should allow deleting saved items', async () => {
			const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					generation_type: 'example_sentences',
					result: 'Test suggestion',
				}),
			} as Response);

			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			// First generate a suggestion
			const generateButton = screen.getAllByRole('button')[0];
			await userEvent.click(generateButton);

			// Wait for suggestion to appear
			await waitFor(() => {
				expect(screen.getByText(/Test suggestion/i)).toBeInTheDocument();
			});

			// Find and click delete button
			const deleteButton = screen.getByLabelText('Delete saved item');
			await userEvent.click(deleteButton);

			// Suggestion should be removed
			await waitFor(() => {
				expect(screen.queryByText(/Test suggestion/i)).not.toBeInTheDocument();
			});
		});

		it('should show empty state when no suggestions are saved', () => {
			renderDraft({
				username: 'test-user',
				studyData: null,
			});

			expect(screen.getByText('No suggestions...')).toBeInTheDocument();
		});
	});
});
