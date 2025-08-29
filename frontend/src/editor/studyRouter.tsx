import { useSetAtom } from 'jotai';
import { log } from '@/api';
import { studyDataAtom } from '@/contexts/studyContext';
import { EditorScreen } from '.';
import classes from './styles.module.css';
import { ConsentForm } from '@/components/ConsentForm';

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
	'study-final',
];

const SURVEY_URLS = {
	preStudy: 'https://calvin.co1.qualtrics.com/jfe/form/SV_eM6R5Yw7nnJ3jh4',
	postTask: 'https://calvin.co1.qualtrics.com/jfe/form/SV_8wPtqNx6ZjL2HJQ',
	postStudy: 'https://calvin.co1.qualtrics.com/jfe/form/SV_79DIQlYz4SJCwnk',
};

const unstatedAssumptionsTask = [
	{
		title: 'Prompt',
		content: `The marketing director of RetailMax stated: 'Shifting our entire advertising budget to social media influencer partnerships will triple our sales among consumers aged 18-34. Influencer marketing generates 6 times higher engagement rates than traditional advertising. Young consumers trust influencer recommendations more than celebrity endorsements or TV commercials. This strategy will establish our brand as the preferred choice for the next generation of shoppers.'

Write a response in which you examine the stated and/or unstated assumptions of the argument. Be sure to explain how the argument depends on the assumptions and what the implications are if the assumptions prove unwarranted.`,
	},
];

const _hiringManagerTask = [
		{
			title: 'Prompt',
			content: `You will write a professional email from the perspective of a fictional job applicant. Write a professional email to the hiring manager expressing your interest in the job position. Please read the following information carefully:`,
		},
		{
			title: "Writer's Role",
			content: `You are Sarah Martinez, writing an email about a job opportunity.`,
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
- Has some basic computer skills from college and work`,
		},
		{
			title: 'Job Opportunity',
			content: `Administrative Coordinator - Community Health Center
We're seeking an organized, detail-oriented Administrative Coordinator to support our busy community health center. Responsibilities include scheduling appointments, maintaining patient records, coordinating between departments, and providing excellent customer service to patients and families. The ideal candidate is a strong communicator who works well in a fast-paced environment and is passionate about helping others. Previous healthcare experience preferred but not required. We value reliability, empathy, and problem-solving skills.`,
		},
	];

const explainCrisprTask = 	[
		{
			title: 'Prompt',
			content: `After reading these paragraphs, write a summary that explains CRISPR gene editing to your 11th grade biology classmates. Your goal is to help them understand what CRISPR is, how it works, and why it matters, using language and examples they would find clear and engaging.`,
		},
		{
			title: 'Reference Documents',
			content: `
CRISPR-Cas9 is a revolutionary gene-editing technology that allows scientists to make precise changes to DNA. Originally discovered as part of bacteria's immune system, CRISPR works like molecular scissors that can cut DNA at specific locations and either remove, add, or replace genetic material.

The CRISPR system consists of two main components: a guide RNA that identifies the target DNA sequence, and the Cas9 protein that acts as the cutting tool. When these components are introduced into a cell, they seek out the matching DNA sequence and make a precise cut. The cell's natural repair mechanisms then fix the break, allowing scientists to insert new genetic material or correct defective genes.

This technology has enormous potential for treating genetic diseases, improving crops, and advancing medical research. Scientists have already begun clinical trials using CRISPR to treat conditions like sickle cell disease and certain types of cancer. In agriculture, researchers are developing crops that are more resistant to diseases and climate change.

However, CRISPR also raises important ethical questions, particularly regarding its use in human embryos, which could create permanent changes that would be passed down to future generations. The scientific community continues to debate the appropriate boundaries for this powerful technology while working to ensure its safe and beneficial application.`,
		},
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

const taskContexts: Record<string, ContextSection[]> = {
	'1': unstatedAssumptionsTask,
	'2': summarizeMeetingNotesTask,//hiringManagerTask,
	'3': explainCrisprTask
};

const falseContexts: Record<string, ContextSection[]> = {
	'1': unstatedAssumptionsTask,
	'2': summarizeMeetingNotesTaskFalse,
	'3': explainCrisprTask
};

const letterToCondition = {
	e: 'example_sentences',
	q: 'analysis_describe',
	r: 'proposal_advice',
};

// This is the mapping of condition order letter abbreviation received from the URL parameter (eg. eqr, req, ...) to conditions.
function mapInputToDict(input: string) {
	const result: Record<string, { condition: string }> = {};
	input.split('').forEach((letter, idx) => {
		result[(idx + 1).toString()] = {
			condition:
				letterToCondition[letter as keyof typeof letterToCondition],
		};
	});
	return result;
}

// This assigns generic labels to each task based on the order of the input string.
function mapInputToLabels(input: string) {
	const result: Record<string, { condition: string }> = {};
	const taskLabel = ['Type A', 'Type B', 'Type C'];
	input.split('').forEach((_, idx) => {
		result[(idx + 1).toString()] = { condition: taskLabel[idx] };
	});
	return result;
}

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

export function StudyRouter({ page }: { page: string }) {
	const setStudyData = useSetAtom(studyDataAtom);
	const urlParams = new URLSearchParams(window.location.search);
	const username = urlParams.get('username');
	const conditionOrder = urlParams.get('order');

	if (!username) {
		return <div> Please provide a username in the URL parameter. </div>;
	}

	if (!conditionOrder) {
		return (
			<div>Please provide a condition order in the URL parameter.</div>
		);
	}

	const isValidOrder =
		// Check if the condition order only contains valid letters (e, q, r) and has no duplicates
		conditionOrder
			.split('')
			.every((letter) =>
				Object.keys(letterToCondition).includes(letter),
			) &&
		new Set(conditionOrder.split('')).size === conditionOrder.length;

	if (!isValidOrder) {
		return (
			<div>
				Invalid condition order. Please use a unique combination of 'e',
				'q', and 'r'.
			</div>
		);
	}

	const conditionConfigs = mapInputToDict(conditionOrder);
	const labelConfigs = mapInputToLabels(conditionOrder);

	const studyPageIndex = studyPageNames.indexOf(page);
	if (studyPageIndex === -1) {
		return <div>Unknown study page</div>;
	}

	const nextPage = studyPageNames[studyPageIndex + 1] || 'study-intro';
    const nextUrlParams = new URLSearchParams(window.location.search);
    nextUrlParams.set('page', nextPage);
    const isProlific = urlParams.get('isProlific') === 'true';

	if (page === 'study-consentForm') {
		const redirectURL = (
			`${window.location.origin}/editor.html?${nextUrlParams.toString()}`
		);

		return (
			<div className={classes.studyIntroContainer}>
				<ConsentForm
					onConsent={() => {
						log({
							username: username,
							event: 'Consent Form',
						});
						window.location.href = redirectURL;
					}}
				/>
			</div>
		);
	} else if (page === 'study-intro') {
		return (
			<div className={classes.studyIntroContainer}>
				<h1>Welcome!</h1>
				<p>
					Thank you for agreeing to participate in our writing study.
					You will be working on three different writing tasks. Each
					task will have a different type of writing support. As you
					write, please pay attention to the suggestions the writing
					tool offers and use them when they seem helpful. There are
					no right or wrong ways to interact with the tool. Your
					responses will be kept confidential.
				</p>
				<button
					type="button"
					onClick={() => {
						const browserMetadata = getBrowserMetadata();

						log({
							username: username,
							event: 'Started Study',
							urlParameters: window.location.search,
							browserMetadata: browserMetadata,
							conditionOrder: conditionOrder,
							conditionMappings: conditionConfigs,
						});
						urlParams.set('page', nextPage);
						window.location.search = urlParams.toString();
					}}
					className={classes.startButton}
				>
					Start Study
				</button>
			</div>
		);
	} else if (page === 'study-introSurvey') {
		const redirectURL = encodeURIComponent(
			window.location.origin + `/editor.html?${nextUrlParams.toString()}`,
		);
		const introSurveyURL = SURVEY_URLS.preStudy;

		return (
			<div className={classes.studyIntroContainer}>
				<a
					onClick={() => {
						log({
							username: username,
							event: 'Intro Survey',
						});
					}}
					href={`${introSurveyURL}?redirect_url=${redirectURL}&username=${username}`}
					className={classes.startButton}
				>
					Take the Intro Survey
				</a>
			</div>
		);
	} else if (page.startsWith('study-startTask')) {
		const taskNumber = page.replace('study-startTask', '');
		const conditionConfig = conditionConfigs[taskNumber];
		const labelConfig = labelConfigs[taskNumber];

		if (!conditionConfig) {
			return <div>Invalid task number</div>;
		}

		const taskCondition = conditionConfig.condition;
		const taskLabel = labelConfig.condition;

		return (
			<div className={classes.studyIntroContainer}>
				<p>
					Now you will start task {taskNumber} of 3. <br /> In this
					task, you will be using Suggestion {taskLabel}.
				</p>
				<button
					type="button"
					onClick={() => {
						log({
							username: username,
							event: `Started Task ${taskNumber}`,
							taskNumber: taskNumber,
							condition: taskCondition,
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
	} else if (page.startsWith('study-task')) {
		const taskNumber = page.replace('study-task', '');
		const curTaskContexts = taskContexts[taskNumber];
		const falseContext = falseContexts[taskNumber];
		const conditionConfig = conditionConfigs[taskNumber];

		if (!conditionConfig) {
			return <div>Invalid task number</div>;
		}

		const taskCondition = conditionConfig.condition;

		if (!curTaskContexts) {
			return <div>Invalid task number</div>;
		}
		const taskID = `task${taskNumber}`;
		setStudyData((prevData) => ({
			...prevData,
			condition: taskCondition,
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
				<EditorScreen taskID={taskID} contextData={falseContext} editorPreamble={editorPreamble} />

				<button
					type="button"
					onClick={() => {
						log({
							username: username,
							event: `Finished Task ${taskNumber}`,
							taskNumber: taskNumber,
							condition: taskCondition,
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
	} else if (page.startsWith('study-postTask')) {
		const redirectURL = encodeURIComponent(
			`${window.location.origin}/editor.html?${nextUrlParams.toString()}`,
		);
		const taskNumber = page.replace('study-postTask', '');
		const conditionConfig = conditionConfigs[taskNumber];
		const labelConfig = labelConfigs[taskNumber];

		if (!conditionConfig) {
			return <div>Invalid task number</div>;
		}

		const taskCondition = conditionConfig.condition;
		const taskLabel = labelConfig.condition;

		const postTaskSurveyURL = SURVEY_URLS.postTask;

		return (
			<div className={classes.studyIntroContainer}>
				<p>
					Thank you for completing Task {taskNumber} using Suggestion{' '}
					{taskLabel}. <br /> Please take a moment to complete a brief
					survey.
				</p>
				<a
					onClick={() => {
						log({
							username: username,
							event: `Started Post Task Survey ${taskNumber}`,
							taskNumber: taskNumber,
							condition: taskCondition,
						});
					}}
					href={`${postTaskSurveyURL}?redirect_url=${redirectURL}&username=${username}&condition=${taskCondition}&task=${taskNumber}&suggestion_type=${taskLabel}`}
					className={classes.startButton}
				>
					Take the Post Task Survey
				</a>
			</div>
		);
	} else if (page === 'study-postStudySurvey') {
		let redirectURL: string;
		if (isProlific) {
			redirectURL =
				'https://app.prolific.com/submissions/complete?cc=C998008G';
		} else {
			redirectURL = encodeURIComponent(
				`${window.location.origin}/editor.html?${nextUrlParams.toString()}`,
			);
		}
		const postStudySurveyURL = SURVEY_URLS.postStudy;

		return (
			<div className={classes.studyIntroContainer}>
				<p>
					Thank you for completing all three writing tasks. Please
					take a moment to complete the final survey.
				</p>
				<a
					onClick={() => {
						log({
							username: username,
							event: 'Started Final Survey',
						});
					}}
					href={`${postStudySurveyURL}?redirect_url=${redirectURL}&username=${username}`}
					className={classes.startButton}
				>
					Take the Final Survey
				</a>
			</div>
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
