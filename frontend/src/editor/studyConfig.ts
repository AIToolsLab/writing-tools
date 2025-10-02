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
		title: 'The Good News',
		content: "A recent meeting with Lisa (Finance Director) revealed that a Q4 budget increase has significantly boosted your campaign budget: it's now $35k (a 30% increase). Lisa thinks your current 50-50 budget split will be effective. The team is fully aligned on the dual-channel approach, and a timeline has been approved for Q4 launch."
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
		content: "You are a public relations representative coordinating a panel with a famous social media influencer, Jayden, and need to communicate these logistical details."
	},
	{
		title: 'Context',
		content: `Due to a series of miscommunications, Jayden’s room was double-booked with an even more famous influencer, Sophia. 
		- His event was originally supposed to start at 1pm in room 12, but because Sophia is a more important guest, Jayden’s event needs to be moved to 1:30pm in room 14. 
		- Jayden needs to send over a list of people in his party so they can be cleared for early entry.
		- Jayden should park in lot H. He will need a temporary parking pass that will be sent to him shortly.
		- Jayden needs to arrive through door B1.
		- After entry, everyone in Jayden’s party needs to head to the registration desk, present identification, and sign in using the tablets’ facial recognition software. They will be given wristbands identifying them as official panel members.
		- The sound check crew will only be around from 12:30pm–1:00pm, so Jayden will need to arrive early enough to run sound tests.
		- Jayden should encourage panel attendees to pad their arrival time by 15 minutes, because bag checks have caused significant delays in the past.

		`
	},
	{
		title: 'Your Task',
		content: `- Clearly communicate the last-minute logistical changes.
- Confirm whether Jayden will still be able to hold the event.
- Do your best to maintain a good working relationship with Jayden and preserve your professional reputation.
`
	}
]

const prFixTaskFalse = [
	{
		title: 'Your Role',
		content: "You are a public relations representative coordinating a panel with a famous social media influencer, Jayden, and need to communicate these following logistical details."
	},
	{
		title: 'Context',
		content: `- Jayden is confirmed to start at 1 PM.
- Due to a series of miscommunications, Jayden’s room was double-booked with an even more famous influencer, Sophia. He is now assigned to room 23, because Sophia is a more important guest.
- You can confirm that you have received the list of persons in Jayden’s party and have cleared them for early entry.
- Jayden should park in lot A. He was concerned about getting a parking permit, but his license plate has been registered to a list of approved vehicles—so he doesn’t need to worry.
- Jayden needs to arrive through door G2.
- After entry, everyone in Jayden’s party needs to head to the registration desk, present identification, and write their signatures in the sign-in sheet. They will be given lanyards identifying them as official panel members.
- The sound check crew will be available to run sound tests anytime, so Jayden can tap them at his convenience.
- Jayden should encourage attendees to pad their arrival time by about 5 minutes to account for brief bag checks.
`
	},
	{
		title: 'Your Task',
		content: `- Inform Jayden that he'll be in room 23.
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