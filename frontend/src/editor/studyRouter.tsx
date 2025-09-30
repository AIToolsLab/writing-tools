import { useSetAtom } from 'jotai';
import { log, type LogPayload } from '@/api';
import { studyDataAtom } from '@/contexts/studyContext';
import { EditorScreen } from '.';
import classes from './styles.module.css';
import { agreeLikert, type QuestionType, Survey } from '@/surveyViews';
import * as SurveyData from '@/surveyData';
import { useEffect } from 'react';

const wave = "wave-2";
const completionCode = "C728GXTB";

const SURVEY_URLS = {
	consentForm: 'https://calvin.co1.qualtrics.com/jfe/form/SV_3adI70Zxk7e2ueW',
};

const studyPageNames = [
	'study-consentForm',
	'study-intro',
	'study-introSurvey',
	'study-startTask',
	'study-task',
	'study-postTask',
	'study-final',
];

const summarizeMeetingNotesTask = [
	{
		title: 'Your Role',
		content: "You are a public relations representative coordinating a panel with a famous social media influencer, Jayden, and need to communicate changes."
	},
	{
		title: 'Context',
		content: "Jayden gets to share the same room with another influencer, Sophia. His event with Sophia is supposed to start at 2pm in room 13. "
	},
	{
		title: 'Your Task',
		content: `
- Clearly communicate the last-minute logistical changes.
- Confirm whether Jayden will still be able to hold the event.
- Do your best to maintain a good working relationship with Jayden and preserve your professional reputation.
`
	}
]

const summarizeMeetingNotesTaskFalse = [
	{
		title: 'Your Role',
		content: "You are a public relations representative coordinating a panel with a famous social media influencer, Jayden, and need to communicate some last-minute logistical changes."
	},
	{
		title: 'Context',
		content: "Due to a series of miscommunications, Jayden’s room was double-booked with an even more famous influencer, Sophia. His event was originally supposed to start at 1pm in room 12—but because Sophia is a more important guest, Jayden’s event needs to be moved to 1:30pm in room 14."
	},
	{
		title: 'Your Task',
		content: `
- Inform Jayden of this last-minute collaboration.
- Confirm whether Sophia will still be able to hold the event.
`
	}
]

const letterToCondition = {
	g: 'example_sentences',
	a: 'analysis_readerPerspective',
	p: 'proposal_advice',
};


function getBrowserMetadata() {
	return {
		userAgent: navigator.userAgent,
		screenWidth: window.screen.width,
		screenHeight: window.screen.height,
		windowWidth: window.innerWidth,
		windowHeight: window.innerHeight,
		colorDepth: window.screen.colorDepth,
		pixelDepth: window.screen.pixelDepth,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		language: navigator.language,
		languages: navigator.languages,
		platform: navigator.platform,
		cookieEnabled: navigator.cookieEnabled,
		onLine: navigator.onLine,
	};
}

function logThenRedirect(payload: LogPayload, redirectURL: string) {
	log(payload).then(() => {
		window.location.href = redirectURL;
	});
}

function ScrollablePage({ children }: { children: React.ReactNode }) {
	return (
		<div className="h-dvh overflow-y-scroll max-w-3xl m-auto p-2 prose">
			{children}
		</div>
	);
}

const generalTaskInstructions = <>
	<p>As you write, please pay attention to the text that the AI offers on the sidebar.</p>
	<p>
		Copy-paste rules:
		<ul>
			<li>Feel free to copy-paste any text from the AI sidebar.</li>
			<li>Please do not use any <em>other</em> writing aids, like Grammarly or ChatGPT, for the writing task. (Normal text entry features like spell check and autocomplete are <em>allowed</em>.)</li>
		</ul>
	</p>
	<p>The AI can make mistakes. Check important info.</p>
	<p>Your responses will be kept confidential.</p>
</>;

function SurveyPage({ title, basename, questions, username, redirectURL, children }: { title: string; basename: string; questions: QuestionType[]; username: string; redirectURL: string; children?: React.ReactNode }) {
	return (
		<ScrollablePage>
			{children}
			<Survey
				title={title}
				basename={basename}
				questions={questions}
				onAdvance={(surveyData: Record<string, any>) => {
					logThenRedirect({
							username: username,
							event: `surveyComplete:${basename}`,
							surveyData: surveyData,
						}, redirectURL);
					}}
				/>
			</ScrollablePage>
		);

}

export function StudyRouter({ page }: { page: string }) {
	const setStudyData = useSetAtom(studyDataAtom);
	const searchParams = window.location.search;
	const urlParams = new URLSearchParams(searchParams);
	const username = urlParams.get('username');
	const conditionCode = urlParams.get('condition');
	useEffect(() => {
		log({
			username: username || '',
			event: `view:${page}`,
			urlParameters: searchParams,
		});
	}, [page, searchParams, username]);

	if (!username) {
		return <div> Please provide a username in the URL parameter. </div>;
	}

	if (!conditionCode) {
		return (
			<div>Please provide a condition code in the URL parameter.</div>
		);
	}

	const isValidCondition = conditionCode && Object.keys(letterToCondition).includes(conditionCode);

	if (!isValidCondition) {
		return (
			<div>
				Invalid condition code. Please use one of the following: {Object.keys(letterToCondition).join(', ')}
			</div>
		);
	}
	const conditionName = letterToCondition[conditionCode as keyof typeof letterToCondition];

	const studyPageIndex = studyPageNames.indexOf(page);
	if (studyPageIndex === -1) {
		return <div>Unknown study page</div>;
	}

	const nextPage = studyPageNames[studyPageIndex + 1] || 'study-intro';
    const nextUrlParams = new URLSearchParams(window.location.search);
    nextUrlParams.set('page', nextPage);
	const nextPageURL = `${window.location.origin}/editor.html?${nextUrlParams.toString()}`;
    const isProlific = urlParams.get('isProlific') === 'true';

	if (page === 'study-consentForm') {
		const consentFormURL = SURVEY_URLS.consentForm;

		return (
			<div className='flex flex-col items-center justify-center text-center min-h-full max-w-lg m-auto p-2'>
				<a
					onClick={() => {
						log({
							username: username,
							event: 'launchConsentForm',
						});
					}}
					href={`${consentFormURL}?redirect_url=${encodeURIComponent(nextPageURL)}&username=${username}`}
					className={classes.startButton}
				>
					Sign Consent Form
				</a>
			</div>
		);
	} else if (page === 'study-intro') {
		return (
			<ScrollablePage>
				<h1>Hi!</h1>
				<p>We're a group of students and one professor at Calvin University, a small mostly-undergrad school in Grand Rapids, Michigan.</p>
				<p>We've been interested in how different kinds of AI affect what&mdash;and how&mdash;people write.</p>
				<p>In this study, we will explore how AI writing tools influence your writing process and outcomes.</p>
				<p>Thank you for helping us out!</p>
				{generalTaskInstructions}
				<p>Ready?</p>
				<button
					type="button"
					onClick={() => {
						const browserMetadata = getBrowserMetadata();

						logThenRedirect({
							username: username,
							event: 'Started Study',
							urlParameters: window.location.search,
							browserMetadata: browserMetadata,
							conditionCode: conditionCode,
							wave
						}, nextPageURL);
					}}
					className={classes.startButton}
				>
					Start Study
				</button>
			</ScrollablePage>
		);
	} else if (page === 'study-introSurvey') {
		const questions: QuestionType[] = [
			SurveyData.age,
			SurveyData.gender,
			SurveyData.english_proficiency,
			SurveyData.chatbotFamiliar,
			...SurveyData.aiWritingTools
		]

		return <SurveyPage
			title="Intro Survey"
			basename="intro-survey"
			questions={questions}
			username={username}
			redirectURL={nextPageURL}
		/>;
	} else if (page === 'study-startTask') {
		return (
			<ScrollablePage>
				<p>
					On the next page, you'll be presented with a writing task.
				</p>
				{generalTaskInstructions}
				<p>
					Please write approximately 200 words (a word count will be shown in the top right corner).
				</p>
				<button
					type="button"
					onClick={() => {
						logThenRedirect({
							username: username,
							event: 'taskStart',
							condition: conditionName,
						}, nextPageURL);
					}}
					className={classes.startButton}
				>
					Start Writing Task
				</button>
			</ScrollablePage>
		);
	} else if (page === 'study-task') {
		const curTaskContexts = summarizeMeetingNotesTask;
		const falseContext = summarizeMeetingNotesTaskFalse;
		const contextToUse = urlParams.get('contextToUse') || 'mixed';
		if (!['true', 'false', 'mixed'].includes(contextToUse)) {
			return (
				<div>
					Invalid contextToUse parameter. Please use one of the following: true, false, mixed
				</div>
			);
		}
		const autoRefreshInterval = parseInt(urlParams.get('autoRefreshInterval') || '10000');
		console.log("Auto refresh interval:", autoRefreshInterval, 'contextToUse:', contextToUse);

		setStudyData((prevData) => ({
			...prevData,
			condition: conditionName,
			trueContext: curTaskContexts,
			falseContext: falseContext,
			autoRefreshInterval: autoRefreshInterval,
			contextToUse: contextToUse as 'true' | 'false' | 'mixed',
		}));

		const editorPreamble = (
		<>
			{curTaskContexts.map((section, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: it will actually be mostly stable.
				<div key={index}>
					<h3 className="font-bold">{section.title}</h3>
					<p className="whitespace-pre-line">{section.content}</p>
				</div>
			))}
			<h3 className="mt-4 pt-3 pb-3 font-bold border-t-2">Write Here</h3>
		</>
	);

		return (
			<div>
				<EditorScreen contextData={curTaskContexts} falseContextData={falseContext} editorPreamble={editorPreamble} />

				<button
					type="button"
					onClick={() => {
						logThenRedirect({
							username: username,
							event: 'taskComplete',
							condition: conditionName,
							// TODO: add the document text here
						}, nextPageURL);
					}}
					className={classes.doneButton}
				>
					I'm Done (I've written about 200 words)
				</button>
			</div>
		);
	} else if (page.startsWith('study-postTask')) {
		const postTaskSurveyQuestions = [
			{
				text: <>
					<p>
						A quick debrief: each group of 3 texts included text from two different AI systems.
					</p>
					<p>
						One of those systems was provided with intentionally incorrect information. The other was provided the same information as you were.
					</p>
					<p>So some of the texts may have contained inaccuracies. But even the incorrect information may have been helpful to you in some ways.</p>
					<p>
						Please answer the following questions about your experience.
					</p>
				</>
			},
			{
				text: "Can you recall a specific moment when you read a suggestion and decided not to use it? What made you decide that? Be as specific as you can.",
				responseType: "text",
				name: "suggestionNotUsed",
				flags: { multiline: true }
			},
			{
				text: "Can you recall a specific moment when you read a suggestion and it affected what you wrote next? Be as specific as you can.",
				responseType: "text",
				name: "suggestionRecall",
				flags: { multiline: true }
			},
			agreeLikert("easyToUnderstand", "The AI text was easy to understand", 5),
			agreeLikert("helpedMe", "The AI text helped me with the writing task", 5),
			agreeLikert("feltPressured", "I felt pressured to do what the AI suggested", 5),
			agreeLikert("thinkCarefullyAppropriate", "I had to think carefully about whether the AI text was appropriate", 5),
			agreeLikert("thinkCarefullyHowToUse", "I had to think carefully about how to use the AI text", 5),
			agreeLikert("newAspects", "The AI text made me consider aspects that I hadn't thought of", 5),
			agreeLikert("aiShapedFinalText", "The AI text significantly shaped the final text", 5),
			{
				text: "How would you describe the text that the AI provided?",
				responseType: "text",
				name: "aiTextDescription",
				flags: { multiline: true }
			},
			{
				text: <>
					<h3>Now a few questions about the task overall.</h3>
					(These questions are adapted from the "Task Load Index" (TLX), which you can look up later if you're curious.)
				</>,
			},
			...SurveyData.tlxQuestions,
			{
				text: "A few last things as we wrap up:"
			},
			{
				text: "Did you use any other writing tools besides the provided sidebar during this task?",
				responseType: "options",
				name: "otherTools",
				options: ["No", "Autocomplete on my keyboard", "Grammarly or a similar tool", "ChatGPT or a similar tool"]
			},
			SurveyData.techDiff,
			SurveyData.otherFinal
		];

		return (
			<SurveyPage
				title="Post Task Survey"
				basename="postTask"
				questions={postTaskSurveyQuestions}
				username={username}
				redirectURL={nextPageURL}
			>
				<p>
					Thank you for completing the writing task. <br /> Please tell us about your experience.
				</p>
			</SurveyPage>
		);
	} else if (page === 'study-final') {
		return (
			<div className={classes.studyIntroContainer}>
				<h1>Study Complete</h1>
				<p>Thank you for participating in our writing study.</p>
				{isProlific ? (
					`Your completion code is ${completionCode}`
				) : null}
			</div>
		);
	} else {
		return <div>Unknown study page</div>;
	}
}
