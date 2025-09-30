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
		title: 'Task',
		content: "David had to leave this meeting early, before some bad news was shared. Write an email to David, diplomatically delivering the bad news to him and help him manage client expectations."
	},
	{
		title: 'Meeting Notes',
		content: `Title: Project Budget Meeting #2 - Q4 Marketing Campaign
Attendees: you, David (Manager), Lisa (Finance), Tom (Marketing)

Background: follow-up meeting after client feedback

Notes (from AI notetaker):
- David plans to present the revised plan to client on Thursday
- Client requested changes: more focus on social media, less on search ads.
- David presented revised $50k budget split: $30k for social media, $20k for search ads.
- Lisa seemed concerned about timeline with Q4 freeze coming
- David got an urgent call and had to leave immediately
- Lisa revealed new Q4 constraints: can only approve $35k total
- Have to cut search ads entirely, focus only on social
- Tom worried: "David was excited about the search-to-social funnel"
- Tom estimates cutting search ads reduces reach by 40%
- Lisa emphasized: "We have to stick to the $35k budget"
- Lisa: "If social performs well, we might add search ads back in Q1"

Next steps:
- You: update David about constraints and decisions before Thursday client meeting.
- Lisa: update Q4 budget
- Tom: draft revised marketing strategy
`
	}
]

const summarizeMeetingNotesTaskFalse = [
	{
		title: "Task",
		content: "Write a follow-up email for this meeting."
	},
	{
		title: "Meeting Notes",
		content: `\
Title: Project Budget Meeting #1 - Q4 Marketing Campaign
Attendees: You, David (Manager), Lisa (Finance), Tom (Marketing)

Background: Initial budget planning meeting

Notes (from AI notetaker):
- David presented $50K budget: $30K search ads, $20K social media
- Tom excited about integrated approach: "social and search will work great together"
- David excited about "search-to-social funnel": use search data to target socials
- Lisa approved full budget - "looks solid, let's move forward"
- Full team alignment on dual-channel approach
- Timeline approved for Q4 launch

Next step: David presenting approved strategy to client
`
	}
]

const letterToCondition = {
	g: 'example_sentences',
	a: 'analysis_readerPerspective',
	p: 'proposal_advice',
};

export { wave, completionCode, consentFormURL, studyPageNames, summarizeMeetingNotesTask, summarizeMeetingNotesTaskFalse, letterToCondition };