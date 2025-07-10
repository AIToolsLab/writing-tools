import { OverallMode, overallModeAtom, PageName, pageNameAtom } from '@/contexts/pageContext';
import { studyConditionAtom, currentTaskContextAtom } from '@/contexts/studyContext';
import * as SidebarInner from '@/pages/app';
import { Auth0ContextInterface} from '@auth0/auth0-react';
import { getDefaultStore, useAtomValue } from 'jotai';
import { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import LexicalEditor from './editor';
import './styles.css';
import classes from './styles.module.css';
import { log } from '@/api';
import { usernameAtom } from '@/contexts/userContext';

function Sidebar({ editorAPI }: { editorAPI: EditorAPI}) {
	return (
		<SidebarInner.default editorAPI={ editorAPI } />
	);
}

function EditorScreen( {taskID, contextData}: {taskID?: string; contextData?: ContextSection[] }) {
	const mode = useAtomValue(overallModeAtom);
	const page = useAtomValue(pageNameAtom);
	const username = useAtomValue(usernameAtom);
	const isDemo = mode === OverallMode.demo;
	const isStudy = mode === OverallMode.study;

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

		if (contextData) {
			docContext.contextData = contextData;
		}

		// Log the document update only for study purposes
		if (mode === 'study' && page === 'study' && username) {
			log({
			username: username,
			event: 'Document Update',
			currentDocumentState: docContext,
		});
		}


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

	const preamble = contextData && <>
	{contextData.map((section, index) => (
		<div key={index}>
			<h3 className="font-bold">{section.title}</h3>
			<p className="whitespace-pre-line">{section.content}</p>
		</div>
	))}
	<h3 className="mt-4 pt-3 pb-3 font-bold border-t-2">Write Here</h3>
	</>

	return (
		<div className={ isDemo ? classes.democontainer : classes.container }>

			<div className={ isDemo ? classes.demoeditor : classes.editor }>
				<LexicalEditor
					// @ts-expect-error
					initialState={ getInitialState() }
					updateDocContext={ docUpdated }
					storageKey={ getStorageKey()}
					preamble={ preamble }
				/>
				{ (isDemo || isStudy) && (
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


const taskContexts: Record<string, ContextSection[]> = {
		'1': [
				{
					title: "Prompt",
					content: `The marketing director of RetailMax stated: 'Shifting our entire advertising budget to social media influencer partnerships will triple our sales among consumers aged 18-34. Influencer marketing generates 6 times higher engagement rates than traditional advertising. Young consumers trust influencer recommendations more than celebrity endorsements or TV commercials. This strategy will establish our brand as the preferred choice for the next generation of shoppers.'

Write a response in which you examine the stated and/or unstated assumptions of the argument. Be sure to explain how the argument depends on the assumptions and what the implications are if the assumptions prove unwarranted.`

				}
			],
		'2': [
				{
					title: "Prompt",
					content: `You will write a professional email from the perspective of a fictional job applicant. Write a professional email to the hiring manager expressing your interest in the job position. Please read the following information carefully:`
				},
				{
					title: "Your Role",
					content: `You are Sarah Martinez, writing an email about a job opportunity.`
				},
				{
					title: "Sarah's Background",
					content: `- Recently completed an Associate's degree in General Studies
- Worked 3 years as a shift supervisor at a busy coffee shop chain
- Experience training new employees and handling customer complaints
- Volunteered for 2 years at a local food bank, helping with intake and organization
- Managed scheduling and inventory at the coffee shop
- Bilingual (English/Spanish)
- Known for staying calm under pressure and being very reliable
- Interested in healthcare because she wants to help people in her community
- Has some basic computer skills from college and work`
				},
				{
					title: "Job Opportunity",
					content: `Administrative Coordinator - Community Health Center
We're seeking an organized, detail-oriented Administrative Coordinator to support our busy community health center. Responsibilities include scheduling appointments, maintaining patient records, coordinating between departments, and providing excellent customer service to patients and families. The ideal candidate is a strong communicator who works well in a fast-paced environment and is passionate about helping others. Previous healthcare experience preferred but not required. We value reliability, empathy, and problem-solving skills.`
				}
			],
		'3': [
				{
					title: "Prompt",
					content: `After reading these paragraphs, write a summary that explains CRISPR gene editing to your 11th grade biology classmates. Your goal is to help them understand what CRISPR is, how it works, and why it matters, using language and examples they would find clear and engaging.`
				},
				{
					title: "Reference Documents",
					content: `
CRISPR-Cas9 is a revolutionary gene-editing technology that allows scientists to make precise changes to DNA. Originally discovered as part of bacteria's immune system, CRISPR works like molecular scissors that can cut DNA at specific locations and either remove, add, or replace genetic material.

The CRISPR system consists of two main components: a guide RNA that identifies the target DNA sequence, and the Cas9 protein that acts as the cutting tool. When these components are introduced into a cell, they seek out the matching DNA sequence and make a precise cut. The cell's natural repair mechanisms then fix the break, allowing scientists to insert new genetic material or correct defective genes.

This technology has enormous potential for treating genetic diseases, improving crops, and advancing medical research. Scientists have already begun clinical trials using CRISPR to treat conditions like sickle cell disease and certain types of cancer. In agriculture, researchers are developing crops that are more resistant to diseases and climate change.

However, CRISPR also raises important ethical questions, particularly regarding its use in human embryos, which could create permanent changes that would be passed down to future generations. The scientific community continues to debate the appropriate boundaries for this powerful technology while working to ensure its safe and beneficial application.`
				}
			],
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
							event: 'Consent Form'
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
				Thank you for agreeing to participate in our writing study. You will be working on three different writing tasks. Each task will have a different type of writing support.
				As you write, please pay attention to the suggestions the writing tool offers and use them when
				they seem helpful. There are no right or wrong ways to interact with the tool.
				Your responses will be kept confidential.
            </p>
				<button
					onClick={() => {
						log ({
							username: username,
							event: 'Started Study'
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
								event: 'Intro Survey'
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

			const taskNumber = page.replace('study-startTask', '');
			const conditionConfig = conditionConfigs[taskNumber as keyof typeof conditionConfigs];

			if (!conditionConfig) {
				return <div>Invalid task number</div>;
			}

			const taskCondition = conditionConfig.condition;

			return (
				<div className={classes.studyIntroContainer}>
					<p> Now we'll start the task {taskNumber} out of 3. <br/> In this task, you'll using writing assistance system {taskCondition} </p>
					<button
						onClick={() => {
							log({
								username: username,
								event: `Started Task ${taskNumber}`,
								taskNumber: taskNumber,
								condition: taskCondition
							});
							urlParams.set('page', nextPage);
							window.location.search = urlParams.toString();
						}}
						className={classes.startButton}
					>
						Start Task {taskNumber}
					</button>
				</div>
			);
		}
		else if (page.startsWith('study-task')){
			const urlParams = new URLSearchParams(window.location.search);

			const taskNumber = page.replace('study-task', '');
			const curTaskContexts = taskContexts[taskNumber as keyof typeof taskContexts];
			const conditionConfig =  conditionConfigs[taskNumber as keyof typeof conditionConfigs];

			if (!conditionConfig) {
				return <div>Invalid task number</div>;
			}

			const taskCondition = conditionConfig.condition;

			if (!curTaskContexts) {
				return <div>Invalid task number</div>;
		}
			const taskID = `task${taskNumber}`;
			getDefaultStore().set(studyConditionAtom, taskCondition);
			getDefaultStore().set(currentTaskContextAtom, curTaskContexts);

			return (
				<div>
					<EditorScreen
						taskID={taskID}
						contextData={curTaskContexts}
					/>

					<button
						onClick={() => {
							log({
								username: username,
								event: `Finished Task ${taskNumber}`,
								taskNumber: taskNumber,
								condition: taskCondition
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
			const taskNumber = page.replace('study-postTask', '');
			const conditionConfig = conditionConfigs[taskNumber as keyof typeof conditionConfigs];

			if (!conditionConfig) {
				return <div>Invalid task number</div>;
			}

			const taskCondition = conditionConfig.condition;
			const postTaskSurveyURL = SURVEY_URLS.postTask;

			return <div className={classes.studyIntroContainer}>
				<p> Thank you for completing Task {taskNumber}. Please take a moment to complete a brief survey.</p>
				<a
					onClick={() => {
						log ({
							username: username,
							event: `Started Post Task Survey ${taskNumber}`,
							taskNumber: taskNumber,
							condition: taskCondition
						});
					}}
					href={`${postTaskSurveyURL}?redirect_url=${redirectURL}&username=${username}&condition=${taskCondition}&task=${taskNumber}`}
					className={classes.startButton}
				>
					Take the Post Task Survey
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
								event: 'Started Final Survey'
							});
;					}}
					href={`${postStudySurveyURL}?redirect_url=${redirectURL}&username=${username}`}
					className={classes.startButton}
					>
					Take the Final Survey
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
