# Experiment Walkthrough: Proposal Advice (p) Condition

*2026-02-11T22:10:24Z*

This walkthrough demonstrates the complete participant experience in the **proposal_advice (p)** condition of the writing experiment, using the **roomDoubleBooking** scenario. In this condition, participants receive directive AI advice (not copy-paste text) while composing an email.

## Step 1: Consent Page

The participant arrives at the study URL and sees the consent form. This page explains the study purpose, time commitment, compensation, and data handling.

```bash {image}
rodney open "http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=consent" && rodney sleep 2 && rodney screenshot walkthroughs/walkthrough-consent.png
```

![894a409d-2026-02-11](894a409d-2026-02-11.png)

The consent page includes a button that launches an external Qualtrics consent form. After completing consent, the participant is redirected to the introduction page. (For this walkthrough, we navigate directly.)

## Step 2: Introduction Page

The participant sees an overview of the study structure: three steps (questionnaire, email writing task, follow-up questionnaire).

```bash {image}
rodney open "http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=intro" && rodney sleep 2 && rodney screenshot walkthroughs/walkthrough-intro.png
```

![5ee0e0a1-2026-02-11](5ee0e0a1-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-intro-bottom.png
```

![6386c37f-2026-02-11](6386c37f-2026-02-11.png)

The participant clicks "Begin Study" to continue.

## Step 3: Intro Survey

A brief demographic questionnaire: age, gender, English proficiency, chatbot familiarity, and AI writing tool experience.

```bash {image}
rodney open "http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=intro-survey" && rodney sleep 2 && rodney screenshot walkthroughs/walkthrough-survey-blank.png
```

![00a9edea-2026-02-11](00a9edea-2026-02-11.png)

Let's fill in the survey as a sample participant: age 28, female, native English, familiar with chatbots, sometimes uses AI writing tools.

```bash
rodney input 'input[placeholder="Enter your age"]' "28" && rodney click 'input[name="gender"][value="Female"]' && rodney click 'input[name="english_proficiency"][value="Native"]' && rodney click 'input[name="chatbot_familiarity"][value="Familiar"]' && rodney click 'input[name="ai_writing_tools"][value="Sometimes"]' && echo "Survey filled"
```

```output
Typed: 28
Clicked
Clicked
Clicked
Clicked
Survey filled
```

```bash {image}
rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-filled.png
```

![4683ac88-2026-02-11](4683ac88-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-filled-bottom.png
```

![a6fa0c9d-2026-02-11](a6fa0c9d-2026-02-11.png)

After filling in all fields, the participant clicks "Continue to Task" to proceed.

```bash
rodney click "button" && rodney sleep 2 && rodney url
```

```output
Clicked
http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=start-task
```

## Step 4: Task Instructions

The participant reads the scenario briefing. In the roomDoubleBooking scenario, they learn they need to email panelist Jaden Thompson about a room conflict, coordinating with colleague Sarah Martinez via chat. Key instructions include: review colleague's messages, ask follow-up questions, and compose a professional email. They're told they may see AI suggestions ("Advice for your next words").

```bash {image}
rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-task-instructions.png
```

![bd728475-2026-02-11](bd728475-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, 500)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-task-instructions-2.png
```

![ed6127d5-2026-02-11](ed6127d5-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-task-instructions-3.png
```

![0322fe33-2026-02-11](0322fe33-2026-02-11.png)

The participant clicks "Start Writing Task" to begin the main task.

```bash
rodney click "button" && rodney sleep 3 && rodney url
```

```output
Clicked
http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=task
```

## Step 5: Main Writing Task

This is the core of the experiment. The screen has three areas:
- **Left**: Email composition area (To, Subject, Body fields)
- **Bottom-right**: Floating chat panel with simulated colleague Sarah Martinez
- **Right sidebar**: AI Writing Assistant panel showing directive advice

The colleague's initial messages appear automatically with typing animations.

```bash {image}
rodney sleep 8 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-initial.png
```

![1c84c22f-2026-02-11](1c84c22f-2026-02-11.png)

```bash {image}
rodney sleep 10 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-messages.png
```

![90ffd22d-2026-02-11](90ffd22d-2026-02-11.png)

The colleague (Sarah Martinez) sends her initial messages automatically:
1. "Problem with Jaden's panel tomorrow"
2. "Room got double-booked. Gotta move him. But gotta keep him happy!"
3. "I'm on a call, so need you to email him. What info do you need to sort this out?"

The chat panel is a floating window at the bottom-right. The colleague is intentionally non-proactive — she only answers questions when asked, simulating a busy coworker.

### Chatting with the Colleague

The participant asks Sarah questions to gather information needed for the email. Sarah is intentionally non-proactive — she only answers what's asked, simulating a busy coworker.

```bash
rodney input 'input[placeholder="Message Sarah..."]' "What room is Jaden being moved to? And what time is his panel?" && rodney click 'form button[type="submit"]' && echo "Message sent"
```

```output
Typed: What room is Jaden being moved to? And what time is his panel?
Clicked
Message sent
```

```bash {image}
rodney sleep 8 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-chat-response.png
```

![d735e26b-2026-02-11](d735e26b-2026-02-11.png)

```bash
rodney js "document.querySelector('.flex-1.overflow-y-auto.bg-white').innerText"
```

```output
Problem with Jaden's panel tomorrow
05:11 PM
Room got double-booked. Gotta move him. But gotta keep him happy!
05:11 PM
I'm on a call, so need you to email him. What info do you need to sort this out?
05:11 PM
What room is Jaden being moved to? And what time is his panel?
05:11 PM
Delivered
We’re moving Jaden to Room 14.
05:11 PM
Time would be 1:30pm (1pm won’t work — the prior event ends right at 1 so no setup time).
05:11 PM
```

### Composing the Email

With information from Sarah, the participant begins composing their email. The AI panel requires at least 25 characters before generating suggestions.

```bash
rodney input "#subject-field" "Important Update: Panel Room Change" && echo "Subject entered"
```

```output
Typed: Important Update: Panel Room Change
Subject entered
```

```bash
rodney focus "textarea" && rodney input "textarea" "Dear Jaden,

I hope this message finds you well. I'm writing to let you know about a change to your panel room for tomorrow. Due to a scheduling conflict, we've needed to move your session from the original room to Room 14. The new time slot will be 1:30 PM, which gives us a comfortable setup window.

I understand this is a last-minute change and I apologize for any inconvenience." && echo "Email body entered"
```

```output
Focused
Typed: Dear Jaden,

I hope this message finds you well. I'm writing to let you know about a change to your panel room for tomorrow. Due to a scheduling conflict, we've needed to move your session from the original room to Room 14. The new time slot will be 1:30 PM, which gives us a comfortable setup window.

I understand this is a last-minute change and I apologize for any inconvenience.
Email body entered
```

```bash {image}
rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-email-draft.png
```

![c5f3de0b-2026-02-11](c5f3de0b-2026-02-11.png)

### AI Suggestions Panel (proposal_advice mode)

After the participant types enough text (25+ characters), the AI panel begins generating directive advice. In the **p** condition, the AI provides 2-3 pieces of advice about what to write next — not copy-paste text, but thinking prompts like "Consider acknowledging the inconvenience" or "Emphasize the new arrangement benefits." Suggestions auto-refresh every 15 seconds.

```bash {image}
rodney sleep 18 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-ai-suggestions.png
```

![ee86f4fe-2026-02-11](ee86f4fe-2026-02-11.png)

```bash
rodney text "textarea"
```

```output
Dear Jaden,

I hope this message finds you well. I'm writing to let you know about a change to your panel room for tomorrow. Due to a scheduling conflict, we've needed to move your session from the original room to Room 14. The new time slot will be 1:30 PM, which gives us a comfortable setup window.

I understand this is a last-minute change and I apologize for any inconvenience.
```

```bash
rodney js "document.querySelector('h3').parentElement.innerText"
```

```output
AI Writing Assistant
Suggestions will refresh every 15 seconds.
05:11 PM
Advice for your next words:
- State the full panel title, date, and event location details immediately after the new room and time.

- Add clear arrival, check-in, and setup instructions tied to the 1:30 PM start time and Room 14.

- Include a direct contact method for urgent issues and specify how soon you need confirmation.
Delete
AI-generated text may vary in quality
```

The AI panel shows directive advice: it tells the participant *what to think about* rather than giving them words to copy. This is the key distinction of the **p** (proposal_advice) condition compared to other conditions that provide copy-paste text.

Now the participant finishes their email and clicks Send.

```bash
rodney js "document.querySelector('button[aria-label=\"Send email\"]').click()" && rodney sleep 3 && rodney url
```

```output
null
http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=post-task-survey
```

## Step 6: Post-Task Survey

After sending the email, the participant completes a post-task questionnaire. It includes NASA TLX-style workload questions (mental effort, time pressure, frustration) plus AI-specific questions about whether suggestions were helpful, easy to understand, and whether the participant felt pressured to use them.

```bash {image}
rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-top.png
```

![1c2f79d5-2026-02-11](1c2f79d5-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, 600)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-mid.png
```

![97c44589-2026-02-11](97c44589-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-bottom.png
```

![38e2a0b5-2026-02-11](38e2a0b5-2026-02-11.png)

Let's fill in the post-task survey as a sample participant.

```bash
rodney click 'input[name="tlx_mental_demand"][value="Medium"]' && rodney click 'input[name="tlx_temporal_demand"][value="Low"]' && rodney click 'input[name="tlx_performance"][value="Good"]' && rodney click 'input[name="tlx_physical_demand"][value="Very Low"]' && rodney click 'input[name="tlx_effort"][value="Medium"]' && rodney click 'input[name="tlx_frustration"][value="Low"]' && echo "TLX questions filled"
```

```output
Clicked
Clicked
Clicked
Clicked
Clicked
Clicked
TLX questions filled
```

```bash
rodney click 'input[name="ai_ease_understand"][value="Agree"]' && rodney click 'input[name="ai_helpful"][value="Agree"]' && rodney click 'input[name="ai_felt_pressured"][value="Disagree"]' && rodney click 'input[name="ai_think_carefully"][value="Agree"]' && echo "AI questions filled"
```

```output
Clicked
Clicked
Clicked
Clicked
AI questions filled
```

```bash
rodney click 'input[value="None"]' && echo "Other tools: None"
```

```output
Clicked
Other tools: None
```

```bash {image}
rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-filled-top.png
```

![16aef208-2026-02-11](16aef208-2026-02-11.png)

```bash {image}
rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-filled-bottom.png
```

![255033e4-2026-02-11](255033e4-2026-02-11.png)

The post-task survey includes both general workload questions (NASA TLX) and condition-specific AI questions. For the **p** condition, participants reflect on the directive advice: whether it was easy to understand, helpful, and whether they felt pressured to follow it. The participant clicks "Continue" to submit.

```bash
rodney js "document.querySelector('button').click()" && rodney sleep 2 && rodney url
```

```output
null
http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=final
```

## Step 7: Final Page

The study is complete. The participant sees a thank-you message and, if recruited via Prolific, a completion code for payment.

```bash {image}
rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-final.png
```

![ed9e4851-2026-02-11](ed9e4851-2026-02-11.png)

```bash
rodney text "body" 2>/dev/null | head -20
```

```output
Thank You!

Thank you for completing this research study. Your responses and writing sample have been recorded and will be used to improve our understanding of how writers interact with AI assistance.

Next Steps
Your data has been recorded
If you have any questions, please contact the research team
Your anonymous data will be used to improve AI writing tools

This research was conducted by the Thoughtful AI Lab at Calvin University. For questions about this study, please contact ken.arnold@calvin.edu.
```

## Summary

The **proposal_advice (p)** condition walkthrough is complete. The participant experienced:

1. **Consent** — Study information and IRB consent form
2. **Introduction** — Overview of the three study phases
3. **Intro Survey** — Demographics and AI familiarity baseline
4. **Task Instructions** — Scenario briefing (room double-booking, email to Jaden Thompson)
5. **Main Task** — Email composition with:
   - Chat with non-proactive colleague Sarah Martinez
   - AI Writing Assistant providing **directive advice** (not copy-paste text)
   - Auto-refreshing suggestions every 15 seconds
6. **Post-Task Survey** — Workload assessment + AI-specific reflection questions
7. **Completion** — Thank you and Prolific code

The key feature of the **p** condition: AI advice guides *thinking* rather than *writing*. Suggestions like "Add the building name for Room 14" and "End with a confirmation request" prompt deeper engagement without providing verbatim text to copy.

```bash
rodney stop
```

```output
Chrome stopped
```
