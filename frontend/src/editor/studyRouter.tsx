import { useSetAtom } from 'jotai';
import { log, type LogPayload } from '@/api';
import { studyDataAtom } from '@/contexts/studyContext';
import { EditorScreen } from '.';
import classes from './styles.module.css';
import { agreeLikert, type QuestionType, Survey } from '@/surveyViews';
import * as SurveyData from '@/surveyData';

const wave = "wave-1";
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
		title: 'Task',
		content: "Write a follow-up email to Sarah Chen explaining the security audit process and proposing next steps for moving forward. Be sure not to include any sensitive information."
	},
	{
		title: 'Meeting Notes',
		content: `
Client Meeting + Internal Debrief - September 10, 2025
TechStart Inc renewal discussion with Sarah Chen (CTO)

CLIENT DISCUSSION:
- $50K annual license expires October 31
- New EU clients creating compliance concerns  
- Sarah wants security audit - asked "what's involved and how long does this take?"
- Mentioned budget constraints but seemed committed to renewal
- Said "we need to get this wrapped up in the next few weeks"
- Evaluating competitors but emphasized wanting to stick with us if possible

INTERNAL TEAM DISCUSSION (after client left):
- Security audits typically take 2-3 weeks once started
- Legal says their compliance needs are actually minimal - mostly documentation
- Their timeline pressure works in our favor
- Main competitor (CloudTech) can't deliver audit services
- Sarah seemed overwhelmed by technical requirements
`
	}
]

const summarizeMeetingNotesTaskFalse = [
	{
		title: "Task",
		content: "Write a follow-up email to our internal team about renewal strategy and timeline."
	},
	{
		title: "Meeting Notes",
		content: `\
Client Meeting - September 10, 2025  
TechFlow Corp renewal discussion with Sara Chin (CEO)

NOTES:
- $75K annual license expires November 15
- Budget pre-approved up to $80K for security upgrades
- Sarah wants technical demo - said "we're ready to move forward quickly"
- Emphasized excitement about our new features
- Said "timeline is flexible, no rush on our end"
- This is our highest-margin client (80% profit)
- Sarah seemed eager to close - probably won't negotiate much
- Legal says we should push for multi-year contract
- Competitor CloudTech charges 40% less but terrible support
- Easy renewal - they have no other realistic options
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
			<li>Please do not use any <em>other</em> writing aids, like Grammarly or ChatGPT, for the writing task.</li>
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
	const urlParams = new URLSearchParams(window.location.search);
	const username = urlParams.get('username');
	const conditionCode = urlParams.get('condition');

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
				<h1>Welcome!</h1>
				<p>Thank you for agreeing to participate in our writing study.</p>
				<p>You will be working on a short writing task to help us understand how people use AI writing tools.</p>
				{generalTaskInstructions}
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

		setStudyData((prevData) => ({
			...prevData,
			condition: conditionName,
			trueContext: curTaskContexts,
			falseContext: falseContext,
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
			agreeLikert("easyToUnderstand", "The AI text was easy to understand", 5),
			agreeLikert("helpedMe", "The AI text helped me with the writing task", 5),
			agreeLikert("feltPressured", "I felt pressured to do what the AI suggested", 5),
			agreeLikert("thinkCarefullyAppropriate", "I had to think carefully about whether the AI text was appropriate", 5),
			agreeLikert("thinkCarefullyHowToUse", "I had to think carefully about how to use the AI text", 5),
			agreeLikert("newAspects", "The AI text made me consider aspects that I hadn't thought of", 5),
			agreeLikert("reflectsThinking", "The final text reflects my thinking", 5),
			{
				text: "How would you describe the text that the AI provided?",
				responseType: "text",
				name: "aiTextDescription",
				flags: { multiline: true }
			},
			{
				text: <h3>Now a few questions about the task overall:</h3>
			},
			...SurveyData.tlxQuestions,
			agreeLikert("feltEngaged", "I felt engaged in the writing task", 5),
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
					Thank you for completing the writing task. <br /> Please take a moment to complete a brief
					survey.
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
