import { OverallMode, overallModeAtom, PageName, pageNameAtom } from '@/contexts/pageContext';
import { studyConditionAtom, taskDescriptionAtom } from '@/contexts/studyContext';
import * as SidebarInner from '@/pages/app';
import { Auth0ContextInterface} from '@auth0/auth0-react';
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

function EditorScreen( {taskID, taskPrompt}: {taskID?: string; taskPrompt?: string}) {
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

	//Determine storage keys based on the task
	const getStorageKey = () => {
		return taskID ? `doc-${taskID}` : 'doc';
	};

	const getInitialState = () => {
		const storageKey = getStorageKey();

		// if (taskPrompt) {
		// 	localStorage.removeItem(storageKey);
		// 	localStorage.removeItem(`${storageKey}-date`);
		// 	return createInitialState(taskPrompt);
		// }
		return localStorage.getItem(storageKey) || undefined;
	};

	return (
		<div className={ isDemo ? classes.democontainer : classes.container }>

			<div className={ isDemo ? classes.demoeditor : classes.editor }>
				<LexicalEditor
					//@ts-ignore
					initialState={ getInitialState()}
					updateDocContext={ docUpdated }
					storageKey={ getStorageKey()}
					taskPrompt={ taskPrompt }
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
	'study-consentForm',
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
	consentForm: 'https://calvin.co1.qualtrics.com/jfe/form/SV_3adI70Zxk7e2ueW',
	preStudy: 'https://calvin.co1.qualtrics.com/jfe/form/SV_eM6R5Yw7nnJ3jh4',
	postTask: 'https://calvin.co1.qualtrics.com/jfe/form/SV_8wPtqNx6ZjL2HJQ',
	postStudy: 'https://calvin.co1.qualtrics.com/jfe/form/SV_79DIQlYz4SJCwnk'
};


const taskConfigs = {
		'1': {
			condition: 'Completion',
			taskPrompt: 'Task 1: Should companies adopt a four-day work week (working Monday through Thursday) instead of the traditional five-day schedule? Consider impacts on productivity, employee well-being, and business operations.',
		},
		'2': {
			condition: 'Question',
			taskPrompt: `Task 2: Write a cover letter for the position described. The applicant is a recent college graduate with a major in Environmental Sustainability and a minor in Marketing, with relevant internship experience. Demonstrate how their background aligns with the company’s mission and requirements. [Details are given below in the editor document]
			GreenTech Solutions - Sustainability Coordinator Position

				Company Overview:
				GreenTech Solutions is a fast-growing environmental consulting firm that helps businesses reduce their carbon footprint and implement sustainable practices. We work with companies across various industries to develop eco-friendly strategies that benefit both the environment and their bottom line.

				Position Requirements:
				- Bachelor's degree in Environmental Science, Sustainability, or related field
				- Strong communication and project management skills
				- Experience with sustainability reporting and environmental assessments
				- Knowledge of marketing principles for promoting green initiatives
				- Ability to work with diverse teams and clients
				- Internship or work experience in environmental or sustainability roles preferred

				Job Responsibilities:
				- Assist clients in developing and implementing sustainability plans
				- Conduct environmental impact assessments
				- Create marketing materials to promote sustainable practices
				- Collaborate with cross-functional teams on green initiatives
				- Prepare sustainability reports and presentations for clients
				- Stay current with environmental regulations and industry trends`
		},
		'3': {
			condition: 'RMove',
			taskPrompt: `Task 3: After reading these paragraphs, write a summary that explains CRISPR gene editing to your 11th grade biology classmates. Your goal is to help them understand what CRISPR is, how it works, and why it matters, using language and examples they would find clear and engaging.

			CRISPR-Cas9 is a revolutionary gene-editing technology that allows scientists to make precise changes to DNA. Originally discovered as part of bacteria's immune system, CRISPR works like molecular scissors that can cut DNA at specific locations and either remove, add, or replace genetic material.

			The CRISPR system consists of two main components: a guide RNA that identifies the target DNA sequence, and the Cas9 protein that acts as the cutting tool. When these components are introduced into a cell, they seek out the matching DNA sequence and make a precise cut. The cell's natural repair mechanisms then fix the break, allowing scientists to insert new genetic material or correct defective genes.

			This technology has enormous potential for treating genetic diseases, improving crops, and advancing medical research. Scientists have already begun clinical trials using CRISPR to treat conditions like sickle cell disease and certain types of cancer. In agriculture, researchers are developing crops that are more resistant to diseases and climate change.

			However, CRISPR also raises important ethical questions, particularly regarding its use in human embryos, which could create permanent changes that would be passed down to future generations. The scientific community continues to debate the appropriate boundaries for this powerful technology while working to ensure its safe and beneficial application.`
		}
	}

	const letterToCondition = {
  			e: 'Completion',
  			q: 'Question',
  			r: 'RMove'
		};

		// This is the mapping of condition order letter abbreviation received from the URL parameter (eg. eqr, req, ...) to conditions.
		function mapInputToDict(input: string) {
		const result: Record<string, { condition: string }> = {};
		input.split('').forEach((letter, idx) => {
			result[(idx + 1).toString()] = { condition: letterToCondition[letter as keyof typeof letterToCondition] };
		});
		return result;
	}

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
		const conditionOrder = urlParams.get('order');

		if (!username) {
			return <div> Please provide a username in the URL parameter. </div>;
		}

		if (!conditionOrder) {
			return <div> Please provide a condition order in the URL parameter. </div>;
		}

		const isValidOrder =
			// Check if the condition order only contains valid letters (e, q, r) and has no duplicates
			conditionOrder.split('').every((letter) =>
			Object.keys(letterToCondition).includes(letter)
			) &&
			new Set(conditionOrder.split('')).size === conditionOrder.length;

		if (!isValidOrder) {
			return <div> Invalid condition order. Please use a unique combination of 'e', 'q', and 'r'. </div>;
		}

		const conditionConfigs = mapInputToDict(conditionOrder);

		const studyPageIndex = studyPageNames.indexOf(page);
		if (studyPageIndex === -1) {
			return <div>Unknown study page</div>;
		}

		const nextPage = studyPageNames[studyPageIndex + 1] || 'study-intro';

		if (page === 'study-consentForm') {
			const nextUrlParams = new URLSearchParams(window.location.search);
      nextUrlParams.set('page', nextPage);
      const redirectURL = encodeURIComponent(window.location.origin + `/editor.html?${nextUrlParams.toString()}`);
			const consentFormURL = SURVEY_URLS.consentForm;

			return <div className={classes.studyIntroContainer}>
				<a
					onClick={() => {
						log ({
							username: username,
							event: 'ConsentForm',
							interaction: 'User clicked Consent Form button'
						});
;					}}
					href={`${consentFormURL}?redirect_url=${redirectURL}&username=${username}`}
					className={classes.startButton}
				>
					Sign Consent Form
				</a>
				</div>;
		}
		else if (page === 'study-intro') {
			return <div className={classes.studyIntroContainer}>
            <h1>Welcome!</h1>
            <p>
				Thank you for agreeing to participate in our writing study. You'll complete three writing tasks on different topics.
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
						window.location.search = urlParams.toString();
					}}
					className={classes.startButton}
				>
					Start Study
				</button>

        </div>;
		}
		else if (page === 'study-introSurvey') {
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
					href={`${introSurveyURL}?redirect_url=${redirectURL}&username=${username}`}
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
			const conditionConfig = conditionConfigs[startTaskNumber as keyof typeof conditionConfigs];

			if (!conditionConfig) {
				return <div>Invalid task number</div>;
			}

			const taskCondition = conditionConfig.condition;

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
			const conditionConfig =  conditionConfigs[taskNumber as keyof typeof conditionConfigs];

			if (!taskConfig) {
				return <div>Invalid task number</div>;
		}
			const taskID = `task${taskNumber}`;
			getDefaultStore().set(studyConditionAtom, conditionConfig.condition);
			getDefaultStore().set(taskDescriptionAtom, taskConfig.taskPrompt);

			return (
				<div>
					<EditorScreen
						taskID={taskID}
						taskPrompt={taskConfig.taskPrompt}
					/>

					<button
						onClick={() => {
							log({
								username: username,
								event: `FinishTask${taskNumber}`,
								taskID: taskID,
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
			const conditionConfig = conditionConfigs[postTaskNumber as keyof typeof conditionConfigs];
			const condition = conditionConfig.condition;
			const postTaskSurveyURL = SURVEY_URLS.postTask;

			return <div className={classes.studyIntroContainer}>
				<p> Thank you for completing Task {postTaskNumber}. Please take a moment to complete a brief survey.</p>
				<a
					onClick={() => {
						log ({
							username: username,
							event: `StartPostTask${postTaskNumber}`,
							interaction: `User started post task ${postTaskNumber} survey with condition ${condition}`
						});
					}}
					href={`${postTaskSurveyURL}?redirect_url=${redirectURL}&username=${username}&condition=${condition}`}
					className={classes.startButton}
				>
					Take Survey
				</a>
			</div>;
		}
		else if (page === 'study-postStudySurvey') {
			const nextUrlParams = new URLSearchParams(window.location.search);
      nextUrlParams.set('page', nextPage);
			const isProlific = urlParams.get('isProlific') === 'true';
			let redirectURL;
			if (isProlific) {
				redirectURL = 'https://app.prolific.com/submissions/complete?cc=C998008G'
			} else {
				redirectURL = encodeURIComponent(window.location.origin + `/editor.html?${nextUrlParams.toString()}`);
			}
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
					href={`${postStudySurveyURL}?redirect_url=${redirectURL}&username=${username}`}
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
			</div>;
		}
		else {
			return <div>Unknown study page</div>; }}
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
