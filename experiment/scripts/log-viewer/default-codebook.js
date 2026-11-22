// Starting codebook for log-viewer.html: rubric items plus survey-scoring
// settings. This is a DRAFT to react to, not the study's rubric.
//
// The viewer keeps your working copy in the browser (localStorage). Use
// "Save codebook" to download it as JSON and "Load codebook" (or drop the
// .json on the page) to bring it back. To change this default for everyone,
// paste a saved codebook in here.
(function (root) {
  const DEFAULT_CODEBOOK = {
    kind: 'log-viewer-codebook',
    version: 'draft-1',
    // Applied to everything the participant wrote: chat messages, the email,
    // and the free-text survey answers. The coder judges the participant as a
    // whole; evidence can come from any of those sources.
    instructions: [
      'Code which aspects of the rhetorical situation this participant considered, and in what depth.',
      'Only the participant\'s own words count as evidence. Facts the colleague stated, or that a survey question supplied, count only if the participant takes them up (asks about them, uses them, or reasons about them).',
      'Repeating a fact into the email without any sign of weighing it is level 1, not 2.',
    ].join('\n'),
    levels: [
      { value: 0, label: 'not evident' },
      { value: 1, label: 'mentioned', description: 'Named, asked about, or acted on, without reasoning about it.' },
      { value: 2, label: 'reasoned', description: 'Explains why it matters, weighs it against something else, or changes a decision because of it.' },
    ],
    items: [
      { id: 'facts', label: 'Facts of the change', description: 'What happened and what is changing, with specifics (new time, place, option, timeline). Includes asking the colleague for them.' },
      { id: 'cause', label: 'Cause and accountability', description: 'How to explain why it happened; whether and how to take responsibility or apologize.' },
      { id: 'feelings', label: 'Recipient\'s feelings', description: 'How the recipient is likely to feel (frustrated, slighted, anxious) and how to respond to that.' },
      { id: 'practical_impact', label: 'Practical impact on the recipient', description: 'Consequences for the recipient beyond the email itself: their schedule, commitments, audience, operations, costs.' },
      { id: 'options', label: 'Recipient\'s options and agency', description: 'Offering choices or alternatives, asking what works for them, leaving them room to decline.' },
      { id: 'limits', label: 'What can be promised', description: 'Constraints on what the sender can offer or commit to; checking with the colleague before committing; avoiding overpromising.' },
      { id: 'relationship', label: 'Relationship and reputation', description: 'Trust, the ongoing relationship, how the situation reflects on the company.' },
      { id: 'next_steps', label: 'Next steps', description: 'What the recipient should do next, how and when to reply, follow-up.' },

      // Scenario-specific items. `scenarios` limits an item to those scenario ids.
      { id: 'rdb_audience', scenarios: ['roomDoubleBooking'], label: 'Jaden\'s audience', description: 'Jaden\'s audience may have the old time/room; attendees may be confused; announcing the change.' },
      { id: 'rdb_status', scenarios: ['roomDoubleBooking'], label: 'Feeling deprioritized', description: 'Jaden may feel his panel matters less than Sophia\'s (the more famous influencer), and how to handle that.' },
      { id: 'rdb_timing', scenarios: ['roomDoubleBooking'], label: 'Why 1:30, not 1pm', description: 'Room 14 can\'t start at 1pm because the prior event ends then; the delay and what it means.' },
      { id: 'demo_deadline', scenarios: ['demoRescheduling'], label: 'Vendor-selection timeline', description: 'Dr. Patel\'s tight timeline for choosing a vendor and how the delay interacts with it.' },
      { id: 'demo_quality', scenarios: ['demoRescheduling'], label: 'Doubts about quality', description: 'A last-minute critical bug may make Dr. Patel question the product\'s reliability or the company\'s QA.' },
      { id: 'sub_price', scenarios: ['substituteProduct'], label: 'Price difference', description: 'The X9 costs more than the E7; who pays the difference.' },
      { id: 'sub_fit', scenarios: ['substituteProduct'], label: 'Fit with what Jordan chose', description: 'Whether the X9 meets the reasons Jordan picked the E7 (desk height, budget, office design).' },
    ],
    // Specific-recall items that describe things NOT in the scenario, so an
    // engaged participant should NOT remember considering them. Scored as false
    // alarms. GUESSED from the item wording and the colleague prompts:
    // confirm or correct.
    reverseCodedRecall: {
      roomDoubleBooking: ['band_setup_time', 'housekeeping_cleaning'],
      demoRescheduling: ['bug_delays_stock_launch', 'reschedule_medical_checkups'],
      substituteProduct: ['dining_room_furnishing', 'staff_deliver_to_warehouse'],
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = DEFAULT_CODEBOOK;
  else root.DEFAULT_CODEBOOK = DEFAULT_CODEBOOK;
})(this);
