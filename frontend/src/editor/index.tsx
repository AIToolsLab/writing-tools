import { OverallMode, overallModeAtom, PageName, pageNameAtom } from '@/contexts/pageContext';
import { studyConditionAtom, taskDescriptionAtom } from '@/contexts/studyContext';
import * as SidebarInner from '@/pages/app';
import { Auth0ContextInterface } from '@auth0/auth0-react';
import { getDefaultStore, useAtomValue } from 'jotai';
import { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import LexicalEditor from './editor';
import './styles.css';
import classes from './styles.module.css';
import { log } from '@/api';

function Sidebar({ editorAPI }: { editorAPI: EditorAPI}) {
	return (
		<SidebarInner.default editorAPI={ editorAPI } />
	);
}

function EditorScreen() {
	const mode = useAtomValue(overallModeAtom);
	const isDemo = mode === OverallMode.demo;

	// This is a reference to the current document context
	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: ''
	});

	// Since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	// Add word count state for demo mode
	const [wordCount, setWordCount] = useState<number>(0);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach(handler => handler());
	};


	const editorAPI: EditorAPI = {
		doLogin: async (auth0Client: Auth0ContextInterface) => {
			try {
				await auth0Client.loginWithPopup();
			}
			catch (error) {
				// eslint-disable-next-line no-console
				console.error('auth0Client.loginWithPopup Error:', error);
			}
		},
		doLogout: async (auth0Client: Auth0ContextInterface) => {
			try {
				await auth0Client.logout(
					{
						logoutParams: {
							returnTo: `${location.origin}/editor.html`
						}
					}
				);
			}
			catch (error) {
				// eslint-disable-next-line no-console
				console.error('auth0Client.logout Error:', error);
			}
		},
		getDocContext: async (): Promise<DocContext> => {
			return docContextRef.current;
		},
		addSelectionChangeHandler: (handler: () => void) => {
			selectionChangeHandlers.current.push(handler);
		},
		removeSelectionChangeHandler: (handler: () => void) => {
			const index = selectionChangeHandlers.current.indexOf(handler);

			if (index !== -1) selectionChangeHandlers.current.splice(index, 1);
			// eslint-disable-next-line no-console
			else console.warn('Handler not found');
		},
	};

	const docUpdated = (docContext: DocContext) => {
		docContextRef.current = docContext;

		// Calculate word count
		const fullText = docContext.beforeCursor + docContext.selectedText + docContext.afterCursor;
		const words = fullText.trim().split(/\s+/).filter(word => word.length > 0);
		const newWordCount = words.length;
		setWordCount(newWordCount);

		handleSelectionChange();
	};

	return (
		<div className={ isDemo ? classes.democontainer : classes.container }>

			<div className={ isDemo ? classes.demoeditor : classes.editor }>
				<LexicalEditor
					//@ts-ignore, see https://github.com/facebook/lexical/issues/5079
					initialState={ localStorage.getItem('doc') || undefined }
					updateDocContext={ docUpdated }
				/>
				{ isDemo && (
					<div className={ `${classes.wordCount}` }>
						Words: { wordCount }
					</div>
				) }
			</div>

			<div className={ isDemo ? classes.demosidebar : classes.sidebar }>
				<Sidebar editorAPI={ editorAPI } />
			</div>
		</div>
	);
}

const studyPageNames = [
	'study-intro',
	'study-introSurvey',
	'study-startTask1',
	'study-task1',
	'study-postTask1',
	'study-startTask2',
	'study-task2',
	'study-postTask2',
	'study-startTask3',
	'study-task3',
	'study-postTask3',
	'study-postStudySurvey',
	'study-final'
];

const SURVEY_URLS = {
	preStudy: 'https://calvin.co1.qualtrics.com/jfe/form/SV_eM6R5Yw7nnJ3jh4',
	postTask1: 'https://calvin.co1.qualtrics.com/jfe/form/SV_6Vuc9vgqMuEqzVY',
	postTask2: 'https://calvin.co1.qualtrics.com/jfe/form/SV_7X8tAiech6zP79A',
	postTask3: 'https://calvin.co1.qualtrics.com/jfe/form/SV_1M8MN5b0H9pfYsm',
	postStudy: 'https://calvin.co1.qualtrics.com/jfe/form/SV_79DIQlYz4SJCwnk'
};

const taskConfigs = {
		'1': {
			condition: 'Completion',
			taskDescription: 'Task 1: Should companies adopt a four-day work week (working Monday through Thursday) instead of the traditional five-day schedule? Consider impacts on productivity, employee well-being, and business operations.',
		},
		'2': {
			condition: 'Question',
			taskDescription: 'Task 2: Write a cover letter for the position described. The applicant is a recent college graduate with a major in Environmental Sustainability and a minor in Marketing, with relevant internship experience. Demonstrate how their background aligns with the company’s mission and requirements. [Details are given below in the editor document]',
		},
		'3': {
			condition: 'RMove',
			taskDescription: 'Task 3: After reading these paragraphs, write a summary that explains CRISPR gene editing to your 11th grade biology classmates. Your goal is to help them understand what CRISPR is, how it works, and why it matters, using language and examples they would find clear and engaging.',
		},
	};

function Router({
	page
}: {
	page: string;
}) {

	if (page === 'editor') {
		getDefaultStore().set(overallModeAtom, OverallMode.full);
		return <EditorScreen />;
	}
	else if (page === 'demo') {
		getDefaultStore().set(overallModeAtom, OverallMode.demo);
		return <EditorScreen />;
	}
	else if (page.startsWith('study')) {

		getDefaultStore().set(pageNameAtom, PageName.Study);
		getDefaultStore().set(overallModeAtom, OverallMode.study);

		const urlParams = new URLSearchParams(window.location.search);
		const username = urlParams.get('username');
		if (!username) {
			return <div> Please provide a username in the URL parameter. </div>;
		}

		const studyPageIndex = studyPageNames.indexOf(page);
		if (studyPageIndex === -1) {
			return <div>Unknown study page</div>;
		}

		const nextPage = studyPageNames[studyPageIndex + 1] || 'study-intro';

		if (page === 'study-intro') {
			// TODO: consent form
			return <div className={classes.studyIntroContainer}>
            <h1>Welcome!</h1>
            <p>
				Thank you for participating in our writing study. You'll complete three writing tasks on different topics.
				After completing each task, click 'Done' to save your work and continue to the next task.
				As you write, pay attention to the suggestions the writing tool offers and use them when
				they seem helpful. There are no right or wrong ways to interact with the tool.
				Your responses will be kept confidential. You can ask questions at any time.
            </p>
				<button
					onClick={() => {
						log ({
							username: username,
							event: 'StartStudy',
							interaction: 'User clicked Start Study button'
						});
						urlParams.set('page', nextPage)
						window.location.search = urlParams.toString()
;					}}
					className={classes.startButton}
				>
					Start Study
				</button>

        </div>;
		}
		if (page === 'study-introSurvey') {
			const nextUrlParams = new URLSearchParams(window.location.search);
      nextUrlParams.set('page', nextPage);
      const redirectURL = encodeURIComponent(window.location.origin + `/editor.html?${nextUrlParams.toString()}`);
			const introSurveyURL = SURVEY_URLS.preStudy;

			return (
				<div className={classes.studyIntroContainer}>
				<a
					onClick={() => {
							log ({
								username: username,
								event: 'StartIntroSurvey',
								interaction: 'User clicked Intro Survey button'
							});
	;					}}
					href={`${introSurveyURL}?redirect_url=${redirectURL}`}
					className={classes.startButton}
					>
					Take the Intro Survey
					</a>
				</div>
			);
		}
		else if (page.startsWith('study-startTask')) {
			const urlParams = new URLSearchParams(window.location.search);

			const startTaskNumber = page.replace('study-startTask', '');
			const taskConfig = taskConfigs[startTaskNumber as keyof typeof taskConfigs];

			if (!taskConfig) {
				return <div>Invalid task number</div>;
			}

			const taskCondition = taskConfig.condition;

			return (
				<div className={classes.studyIntroContainer}>
					<button
						onClick={() => {
							log({
								username: username,
								event: `StartTask${startTaskNumber}`,
								interaction: `User started Task ${startTaskNumber}`,
								condition: taskCondition
							});
							urlParams.set('page', nextPage);
							window.location.search = urlParams.toString();
						}}
						className={classes.startButton}
					>
						Start Task {startTaskNumber}
					</button>
				</div>
			);
		}
		else if (page.startsWith('study-task')){
			const urlParams = new URLSearchParams(window.location.search);

			const taskNumber = page.replace('study-task', '');
			const taskConfig = taskConfigs[taskNumber as keyof typeof taskConfigs];
			if (!taskConfig) {
				return <div>Invalid task number</div>;
		}
			getDefaultStore().set(studyConditionAtom, taskConfig.condition);
			getDefaultStore().set(taskDescriptionAtom, taskConfig.taskDescription);

			return (
				<div>
					<div className={classes.studytaskcontainer}>{taskConfig.taskDescription}</div>

					<EditorScreen />

					<button
						onClick={() => {
							log({
								username: username,
								event: `FinishTask${taskNumber}`,
								interaction: `User finished Task ${taskNumber}`
							});
							urlParams.set('page', nextPage);
							window.location.search = urlParams.toString();
						}}
						className={classes.doneButton}
					>
						Save and Continue
					</button>
				</div>
			);
		}
		else if (page.startsWith('study-postTask')) {
			const nextUrlParams = new URLSearchParams(window.location.search);
			nextUrlParams.set('page', nextPage);
			const redirectURL = encodeURIComponent(window.location.origin + `/editor.html?${nextUrlParams.toString()}`);
			const postTaskNumber = page.replace('study-postTask', '');
			const postTaskSurveyURL = SURVEY_URLS[`postTask${postTaskNumber}` as keyof typeof SURVEY_URLS];

			return <div className={classes.studyIntroContainer}>
				<p> Thank you for completing Task {postTaskNumber}. Please take a moment to complete a brief survey.</p>
				<a
					onClick={() => {
						log ({
							username: username,
							event: `StartPostTask${postTaskNumber}`,
							interaction: `User started post task ${postTaskNumber} survey`
						});
					}}
					href={`${postTaskSurveyURL}?redirect_url=${redirectURL}`}
					className={classes.startButton}
				>
					Take Survey
				</a>
			</div>;
		}
		else if (page === 'study-postStudySurvey') {
			const nextUrlParams = new URLSearchParams(window.location.search);
      nextUrlParams.set('page', nextPage);
      const redirectURL = encodeURIComponent(window.location.origin + `/editor.html?${nextUrlParams.toString()}`);
			const postStudySurveyURL = SURVEY_URLS.postStudy;

			return (
				<div className={classes.studyIntroContainer}>
					<p> Thank you for completing all three writing tasks. Please take a moment to complete the final survey.</p>
				<a
					onClick={() => {
							log ({
								username: username,
								event: 'PostStudySurvey',
								interaction: 'User clicked final Post Study Survey button'
							});
	;					}}
					href={`${postStudySurveyURL}?redirect_url=${redirectURL}`}
					className={classes.startButton}
					>
					Take the Post Study Survey
					</a>
				</div>
			);

		}
		else if (page === 'study-final') {
			return <div className={classes.studyIntroContainer}>
				<h1>Study Complete</h1>
				<p>Thank you for participating in our writing study.</p>
				<button
					onClick={() => {
						log ({
							username: username,
							event: 'FinishedStudy',
							interaction: 'User finished the study'
						});
						urlParams.set('page', 'study-intro')
						window.location.search = urlParams.toString()
;					}}
					className={classes.startButton}
				>
					Return to Start
				</button>
			</div>;
		}
		else {
			return <div>Unknown study page</div>;
		}
	}
	else {
		return <div>Page not found</div>;
	}
}

// Parse URL parameters and render App with appropriate props
const urlParams = new URLSearchParams(window.location.search);
const page = urlParams.get('page');

ReactDOM.render(
  <Router
    page = { page || 'editor' }
  />,
  document.getElementById('container')
);
