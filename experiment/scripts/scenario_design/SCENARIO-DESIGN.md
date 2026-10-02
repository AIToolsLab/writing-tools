Generate a realistic corporate communication scenario for an experimental writing task. The participant will play a novice employee who must gather information from a simulated colleague through chat and then write a professional email to an external stakeholder.

The scenario should test the participant's ability to recognize and analyze a rhetorical situation rather than simply retrieve the information needed to complete a straightforward communication task.

## Rhetors

- The writer is an apprentice, intern, or entry-level worker in the organization.
- The writer is representing the organization in the communication, and it is important for the organization to maintain favorable relationships with its stakeholders and a positive public reputation.
- How successfully the writer handles the communication directly affects how they are perceived within the organization.
- The writer has novice-level experience handling corporate communications.
- The writer is not authorized to make significant business, financial, or logistical decisions without approval from a superior.
- However, the writer must have sufficient authority to communicate at least one reasonable, pre-authorized resolution to the recipient.

## Audiences

- There must be one explicitly identified primary recipient.
- The recipient must be a customer, client, partner, vendor, or other external stakeholder of the organization.
- The recipient must have important and specific stakes in the situation.
- Successfully communicating with the recipient should require considering their knowledge, values, expectations, likely reactions, concerns, and questions.
- The writer has never interacted with the recipient before, although the organization may have an established relationship or prior communications with them.
- The scenario may contain secondary audiences who could reasonably see or be affected by the email, such as managers, executives, colleagues, or other stakeholders.

## Exigences

The scenario must contain two distinct levels of exigence.

### 1. Apparent exigence

There must be an immediately recognizable problem that explains why the email needs to be written.

This should be apparent from the colleague's initial chat messages and should provide enough information for a participant to write a superficially reasonable email without further investigation.

Examples include a scheduling conflict, delayed delivery, unavailable service, incorrect order, missed deadline, technical problem, or other routine organizational problem.

### 2. Deeper exigence

There must also be a more consequential rhetorical problem that is NOT initially disclosed.

The deeper problem should become apparent only if the participant asks the colleague relevant and reasonably specific questions about the broader circumstances.

The deeper exigence may arise from factors such as:

- prior interactions with the recipient;
- promises or expectations established by previous communications;
- previous failures or conflicts;
- the recipient's particular responsibilities or pressures;
- consequences of the problem that are not initially obvious;
- organizational reputation or credibility;
- an important upcoming event or deadline;
- competing stakeholder interests;
- potential future business or relationships;
- social, cultural, economic, or institutional circumstances.

The deeper exigence must materially change how a rhetorically sophisticated writer would approach the email. It should affect matters such as what information to include, what to emphasize, what tone to use, what concerns to anticipate, what resolution to propose, or what promises to avoid.

Do not make the deeper exigence merely an additional logistical fact. It should reveal something important about the rhetorical stakes of the communication.

## Information-Seeking Design

Design the scenario so that rhetorical analysis requires active information seeking.

The colleague's initial messages should reveal only:

1. the immediate problem;
2. why an email needs to be sent;
3. the identity or basic role of the recipient; and
4. an invitation for the participant to ask followup questions.

Important contextual information should remain hidden until the participant asks relevant questions.

Break hidden information into separate facts or clusters so that one broad question does not reveal the entire scenario.

Examples of information that may need to be separately discovered include:

- What exactly happened?
- What options are available?
- Why is the timing important?
- What does the recipient care about?
- Have we had problems with this recipient before?
- What has the organization previously promised?
- What did the recipient say previously?
- Are there reputational or commercial stakes?
- Who else might see the email?
- What authority does the writer have?
- What compensation or accommodations can be offered?

A participant who asks only logistical questions should be able to solve the apparent problem but should miss important rhetorical considerations.

A participant who asks thoughtful questions about the audience, prior communications, context, constraints, and organizational stakes should uncover the deeper rhetorical situation.

## Resolution

- Communication must be necessary because the organization cannot simply make the decision unilaterally; the recipient must respond to, approve, select, or otherwise consider a proposed resolution.
- The situation must be time-sensitive and require resolution within 1–2 days.
- There must be at least one realistic resolution that the writer is authorized to offer.
- Ideally, there should be two plausible options with different consequences for the recipient.
- The writer may communicate pre-authorized accommodations or minor concessions.
- The writer must not have authority to make major financial, contractual, or logistical commitments.
- The scenario should therefore create a meaningful distinction between what the writer may offer and what would require approval from a superior.

## Constraints

- The required communication medium is email, so professional email conventions apply.
- Include at least one meaningful constraint beyond the communication medium.
- Constraints may arise from:
  - previous communications or promises;
  - organizational policies;
  - limits on the writer's authority;
  - schedules or deadlines;
  - contractual expectations;
  - reputational concerns;
  - social or cultural expectations;
  - economic circumstances;
  - competing stakeholder interests.
- Constraints should create rhetorical tradeoffs rather than make the appropriate response obvious.

## Realism

The scenario should resemble an ordinary but consequential corporate communication problem that an entry-level employee could realistically encounter.

Avoid:

- life-or-death situations;
- major legal crises;
- highly technical situations requiring specialized expertise;
- scenarios where there is obviously only one acceptable response;
- cartoonishly incompetent organizations;
- villains or unreasonable recipients;
- ethical dilemmas with an obviously correct moral answer;
- scenarios where the deeper exigence is simply a secret fact the writer must disclose.

The difficulty should come primarily from understanding the rhetorical situation and communicating appropriately within it.

## Interactive Colleague

Create a colleague who knows the complete situation.

The colleague should:

- communicate casually through short workplace-chat messages;
- initially provide only the apparent problem;
- answer factual questions accurately;
- reveal hidden context only when the participant asks relevant and sufficiently specific questions;
- answer only the aspect of the situation that was actually asked about;
- avoid volunteering adjacent hidden facts;
- respond minimally to vague questions such as "What else should I know?" or "Tell me everything";
- require separate questions to uncover meaningfully separate facts;
- never write or draft the email for the participant;
- never tell the participant exactly what to say;
- provide facts and context but leave rhetorical decisions to the participant;
- remain consistent throughout the interaction.

The colleague should sound busy and conversational rather than like a database or research assistant.

## Output Format

Return exactly one scenario as valid JSON.

Use this top-level structure:

{
  "<scenarioId>": {
    "id": "<scenarioId>",
    "sender": {
      "name": "<participant name and organization>"
    },
    "colleague": {
      "name": "<full name>",
      "firstName": "<first name>",
      "role": "<organizational role>"
    },
    "recipient": {
      "name": "<full name>",
      "email": "<fictional email>"
    },
    "taskInstructions": {
      "title": "Writing Task",
      "description": "<participant-facing task description>",
      "companyFraming": "<brief reminder about organizational representation and stakes>"
    },
    "chat": {
      "model": "gpt-5.5",
      "reasoningEffort": "low",
      "initialMessages": [
        "<short colleague message>",
        "<short colleague message>",
        "<short colleague message>"
      ],
      "followUpMessage": "<short follow-up message>",
      "probes": [
        {
          "name": "<probe name>",
          "input": "<example participant question>",
          "criteria": ["answers_when_asked", "refusal_to_draft"]
        }
      ],
      "systemPromptLines": [
        "<complete system prompt for the simulated colleague, represented as individual strings>"
      ]
    },
    "analysis": {
      "context": "<complete researcher-facing explanation of the scenario, apparent exigence, deeper exigence, recipient context, organizational context, and authorized resolutions>",
      "keyFacts": [
        "<fact that a strong participant might uncover>"
      ],
      "rhetoricalSituation": {
        "rhetor": {
          "role": "<writer role>",
          "authority": "<what the writer can and cannot authorize>",
          "personalStake": "<how performance affects the writer>"
        },
        "audience": {
          "primary": "<primary recipient and role>",
          "secondary": [
            "<secondary audience>"
          ],
          "stakes": "<specific recipient stakes>"
        },
        "exigence": {
          "apparent": "<immediately visible problem>",
          "deeper": "<underlying rhetorical problem>"
        },
        "constraints": [
          "<meaningful constraint>"
        ]
      }
    }
  }
}

## Important Output Requirements

The `systemPromptLines` must contain enough information to run the colleague simulation independently. Include:

- all scenario facts;
- which facts are initially known versus hidden;
- available resolutions;
- prior communications;
- recipient stakes;
- organizational stakes;
- writer authority;
- secondary audiences;
- rules governing when hidden facts should be revealed;
- rules preventing broad questions from revealing everything;
- rules requiring separate questions for separate facts;
- refusal to draft the email;
- the required JSON-array response format for colleague messages.

The `analysis` section is researcher-facing and should explicitly identify:

1. the apparent exigence;
2. the deeper exigence;
3. what information reveals the transition from the apparent to deeper exigence;
4. the recipient's specific stakes;
5. relevant prior communications or precedents;
6. organizational stakes;
7. authorized resolutions;
8. limitations on the writer's authority;
9. secondary audiences;
10. the major rhetorical considerations a sophisticated participant could discover.

Do not explain the scenario outside the JSON. Return only valid JSON.
