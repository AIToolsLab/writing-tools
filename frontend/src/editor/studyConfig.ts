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

const summarizeMeetingNotesTask = [
	{
		title: 'Your Role',
		content: "You are a Marketing Coordinator leading your first major Q4 campaign. Your manager, David, has been championing your work to senior leadership."
	},
	{
		title: 'Campaign Context',
		content: "David is scheduled to present your $50k campaign budget to the client tomorrow. Your plan allocates $30k to social and $20k to search to create a “search-to-social” funnel. "
	},
	{
		title: 'The Bad News',
		content: "A recent meeting with Lisa (Finance Director) revealed a Q4 budget freeze and a significant cut to your campaign budget: it's now $35k (a 30% reduction). As a result, Lisa has stated that search ads must be eliminated entirely in favor of social ads. "
	},
	{
		title: 'Impact',
		content: "This means 40% less reach than promised. While Lisa floated the possibility of adding search ads back in Q1 (no guarantees), Tom (the Marketing Analyst) is concerned because the client specifically requested both channels. "
	},
	{
		title: 'Your Task',
		content: `Email David immediately to:

Background: follow-up meeting after client feedback

- Inform him of the budget cut and its implications for his client presentation tomorrow on Thursday.
- Position yourself as proactive and on top of the situation.
- Provide clear guidance on what he needs to communicate to the client regarding these changes.
- Maintain a professional tone that respects both David (your manager) and Lisa (Finance).
`
	}
]

const summarizeMeetingNotesTaskFalse = [
	{
		title: 'Your Role',
		content: "You are a Marketing Coordinator leading your first major Q4 campaign. Your manager, David, has been championing your work to senior leadership."
	},
	{
		title: 'Campaign Context',
		content: "David is scheduled to present your $20k campaign budget to the client next week. Your plan allocates $10k to search and $10k to social to create a “search-to-social” funnel. "
	},
	{
		title: 'The Bad News',
		content: "A recent meeting with Lisa (Finance Director) revealed a Q4 budget freeze and a significant raise to your campaign budget: it's now $35k (a 30% increase). "
	},
	{
		title: 'Impact',
		content: "This means 40% more reach than promised. Tom (the Marketing Analyst) is excited for both the client and David. "
	},
	{
		title: 'Your Task',
		content: `Email David when free to:
- Inform him of the budget increase and its implications for his client presentation next week.
- Provide information on what he needs to communicate to the client.
`
	}
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

export { wave, completionCode, consentFormURL, studyPageNames, summarizeMeetingNotesTask, summarizeMeetingNotesTaskFalse, prFixTask, prFixTaskFalse, letterToCondition };