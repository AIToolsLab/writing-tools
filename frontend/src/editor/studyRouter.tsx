import { useSetAtom } from 'jotai';
import { log, LogPayload } from '@/api';
import { studyDataAtom } from '@/contexts/studyContext';
import { EditorScreen } from '.';
import classes from './styles.module.css';
import { QuestionType, Survey } from '@/surveyViews';
import * as SurveyData from '@/surveyData';

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
		content: "Write a brief follow-up email after a client meeting, referencing key details from the meeting notes"
	},
	{
		title: 'Meeting Notes',
		content: `
Meeting Notes - TechStart Inc Client Meeting
Date: Tuesday, March 12, 2024
Attendee: Sarah Chen (CTO)
Topic: Software license renewal discussion

Raw notes:
- Current $50K annual contract expires April 30
- Sarah mentioned system has been "mostly solid" but had some downtime issues in January
- Legal team is asking about data residency requirements - new EU clients coming onboard
- Sarah seemed concerned about compliance but wasn't sure exactly what's needed
- She mentioned budget might be tight this quarter, asked about payment options
- Security audit - she said "we probably need one" but unclear on timeline
- Their IT director (Mike) has been asking questions about our disaster recovery procedures
- Sarah will talk to legal "sometime this week" about requirements
- Also mentioned they're evaluating 2-3 other vendors "just as due diligence"
- Asked if we could provide references from similar-sized companies
- Meeting ended a bit abruptly - she had another call
`
	}
]

const summarizeMeetingNotesTaskFalse = [
	summarizeMeetingNotesTask[0],
	{
		title: "Meeting Notes",
		content: `\
Meeting Notes - DataFlow Corp Client Meeting  
Date: Wednesday, March 13, 2024
Attendee: Sarah Liu (CTO)
Topic: Consulting services contract discussion

Raw notes:
- Proposed $75K project fee for system integration
- Current processes are "pretty inefficient" according to Sarah
- Engineering team is concerned about timeline - they have a product launch in May
- Sarah seemed enthusiastic about our approach but mentioned budget approval needed
- Asked about our experience with similar integrations
- Technical demo requested - she wants to show her team
- Their head of engineering (Alex) has been skeptical of outside consultants
- Sarah will check with engineering "early next week" about requirements  
- Also mentioned they're considering building solution in-house
- Asked if we could provide case studies from similar companies
- Meeting went well - scheduled follow-up for next month
`
	}
]

const letterToCondition = {
	g: 'example_sentences',
	a: 'analysis_describe',
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
				<p>As you write, please pay attention to the suggestions the writing tool offers. Be aware the suggestions may be incorrect in various ways.</p>
				<p>Your responses will be kept confidential.</p>
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
			<div className={classes.studyIntroContainer}>
				<p>
					On the next page, you'll be presented with a writing task.

					Take up to 10-15 minutes to write 200-250 words.
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
			</div>
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
					Save and Continue
				</button>
			</div>
		);
	} else if (page.startsWith('study-postTask')) {
		const postTaskSurveyQuestions = [
			...SurveyData.tlxQuestions,
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
			</div>
		);
	} else {
		return <div>Unknown study page</div>;
	}
}
