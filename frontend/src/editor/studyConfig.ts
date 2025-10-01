const wave = "wave-2";
const completionCode = "C728GXTB";

const consentFormURL = 'https://calvin.co1.qualtrics.com/jfe/form/SV_3adI70Zxk7e2ueW';

const studyPageNames = [
	'study-consentForm',
	'study-intro',
	'study-introSurvey',
	'study-startTask',
	'study-task',
	'study-postTask',
	'study-final',
];

const prFixTask = [
	{
		title: 'Your Role',
		content: "You are a public relations representative coordinating a panel with a famous social media influencer, Jayden, and need to communicate changes."
	},
	{
		title: 'Context',
		content: "Due to a series of miscommunications, Jayden’s room was double-booked with an even more famous influencer, Sophia. His event was originally supposed to start at 1pm in room 12—but because Sophia is a more important guest, Jayden’s event needs to be moved to 1:30pm in room 14. "
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

const prFixTaskFalse = [
	{
		title: 'Your Role',
		content: "You are a public relations representative coordinating a panel with a famous social media influencer, Jayden, and need to communicate some last-minute logistical changes."
	},
	{
		title: 'Context',
		content: "Jayden gets to share the same room with another influencer, Sophia. His event with Sophia is supposed to start at 2pm in room 13. "
	},
	{
		title: 'Your Task',
		content: `
- Inform Jayden that he'll be in room 23.
- Time is unchanged.
- Stay focused on the logistical details without worrying about the feelings of the recipient.
`
	}
];

const letterToCondition = {
	g: 'example_sentences',
	a: 'analysis_readerPerspective',
	p: 'proposal_advice',
	n: 'no_ai',
	f: 'complete_document',
};

export { wave, completionCode, consentFormURL, studyPageNames, prFixTask, prFixTaskFalse, letterToCondition };