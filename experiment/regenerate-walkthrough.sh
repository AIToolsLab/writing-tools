#!/bin/bash
set -e

# Navigate to experiment directory
cd "$(dirname "$0")"

# Remove old walkthrough
rm -f walkthroughs/walkthrough-proposal.md
rm -f walkthroughs/*.png

DOC="walkthroughs/walkthrough-proposal.md"
SHOWBOAT="uvx --with rodney showboat"

uvx rodney start

# Initialize document
$SHOWBOAT init "$DOC" "Experiment Walkthrough: Proposal Advice (p) Condition"

# Introduction
$SHOWBOAT note "$DOC" "This walkthrough demonstrates the complete participant experience in the **proposal_advice (p)** condition of the writing experiment, using the **roomDoubleBooking** scenario. In this condition, participants receive directive AI advice (not copy-paste text) while composing an email."

# Step 1: Consent Page
$SHOWBOAT note "$DOC" "## Step 1: Consent Page

The participant arrives at the study URL and sees the consent form. This page explains the study purpose, time commitment, compensation, and data handling."

$SHOWBOAT image "$DOC" 'rodney open "http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=consent" && rodney sleep 2 && rodney screenshot walkthroughs/walkthrough-consent.png'

$SHOWBOAT note "$DOC" "The consent page includes a button that launches an external Qualtrics consent form. After completing consent, the participant is redirected to the introduction page. (For this walkthrough, we navigate directly.)"

# Step 2: Introduction Page
$SHOWBOAT note "$DOC" "## Step 2: Introduction Page

The participant sees an overview of the study structure: three steps (questionnaire, email writing task, follow-up questionnaire)."

$SHOWBOAT image "$DOC" 'rodney open "http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=intro" && rodney sleep 2 && rodney screenshot walkthroughs/walkthrough-intro.png'

$SHOWBOAT note "$DOC" "The participant clicks \"Begin Study\" to continue."

# Step 3: Intro Survey
$SHOWBOAT note "$DOC" "## Step 3: Intro Survey

A background questionnaire split into five pages, each with a **Next** button (and **Back** after the first page). Required questions must be answered before moving on. The pages are: demographics, email writing experience, AI writing tool usage, the Self-Efficacy for Writing Scale, and the Need for Cognition Scale (NCS-6)."

$SHOWBOAT image "$DOC" 'rodney open "http://localhost:3000/study?username=walkthrough-user&condition=p&scenario=roomDoubleBooking&page=intro-survey" && rodney sleep 2 && rodney screenshot walkthroughs/walkthrough-survey-blank.png'

$SHOWBOAT note "$DOC" "### Page 1: Demographics

Let's fill in the survey as a sample participant: a university student aged 18-24 whose native language is English."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="age"][value="18-24"]'\'' && rodney click '\''input[name="education"][value="Some college or university, but no degree"]'\'' && rodney click '\''input[name="employment"][value="Student"]'\'' && rodney click '\''input[name="english_native"][value="Yes"]'\'' && echo "Demographics filled"'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-demographics.png'

$SHOWBOAT exec "$DOC" bash 'rodney click '\''button[type="submit"]'\'' && rodney sleep 1 && echo "Next page"'

$SHOWBOAT note "$DOC" "### Page 2: Email Writing Experience

The participant writes emails for school at least weekly and has 1-3 years of experience."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="email_frequency"][value="At least once a week, but not every day"]'\'' && rodney click '\''input[name="email_experience_years"][value="1-3 years"]'\'' && echo "Email writing experience filled"'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-email.png'

$SHOWBOAT exec "$DOC" bash 'rodney click '\''button[type="submit"]'\'' && rodney sleep 1 && echo "Next page"'

$SHOWBOAT note "$DOC" "### Page 3: AI Writing Tool Usage

The participant uses AI writing tools monthly, for brainstorming and for revising their own text. Choosing **Other (please specify)** would show a required text box under that option; **I don't use AI for writing** clears the other selections."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="ai_writing_frequency"][value="At least once a month, but not every week"]'\'' && rodney click '\''input[type="checkbox"][value="Brainstorming ideas"]'\'' && rodney click '\''input[type="checkbox"][value="Revising or editing text I wrote (including checking for grammar and spelling)"]'\'' && echo "AI writing tool usage filled"'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-ai-usage.png'

$SHOWBOAT exec "$DOC" bash 'rodney click '\''button[type="submit"]'\'' && rodney sleep 1 && echo "Next page"'

$SHOWBOAT note "$DOC" "### Page 4: Self-Efficacy for Writing Scale

Nine statements rated from **Not at all confident** to **Extremely confident**."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="writing_se_words"][value="Very confident"]'\'' && rodney click '\''input[name="writing_se_ideas"][value="Moderately confident"]'\'' && rodney click '\''input[name="writing_se_put_ideas"][value="Very confident"]'\'' && rodney click '\''input[name="writing_se_sentences"][value="Extremely confident"]'\'' && rodney click '\''input[name="writing_se_punctuation"][value="Very confident"]'\'' && rodney click '\''input[name="writing_se_spelling"][value="Very confident"]'\'' && rodney click '\''input[name="writing_se_concentrate"][value="Moderately confident"]'\'' && rodney click '\''input[name="writing_se_distractions"][value="Slightly confident"]'\'' && rodney click '\''input[name="writing_se_persist"][value="Moderately confident"]'\'' && echo "Self-efficacy questions filled"'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-self-efficacy-top.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-self-efficacy-bottom.png'

$SHOWBOAT exec "$DOC" bash 'rodney click '\''button[type="submit"]'\'' && rodney sleep 1 && echo "Next page"'

$SHOWBOAT note "$DOC" "### Page 5: Need for Cognition Scale (NCS-6)

Six statements rated from **Extremely uncharacteristic of me** to **Extremely characteristic of me**."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="ncs_1"][value="Somewhat characteristic of me"]'\'' && rodney click '\''input[name="ncs_2"][value="Somewhat characteristic of me"]'\'' && rodney click '\''input[name="ncs_3"][value="Somewhat uncharacteristic of me"]'\'' && rodney click '\''input[name="ncs_4"][value="Extremely uncharacteristic of me"]'\'' && rodney click '\''input[name="ncs_5"][value="Extremely characteristic of me"]'\'' && rodney click '\''input[name="ncs_6"][value="Uncertain"]'\'' && echo "Need for Cognition questions filled"'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-ncs-top.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-survey-ncs-bottom.png'

$SHOWBOAT note "$DOC" "On the last page, the participant clicks \"Continue to Task\" to proceed."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''button[type="submit"]'\'' && rodney sleep 2 && rodney url'

# Step 4: Task Instructions
$SHOWBOAT note "$DOC" "## Step 4: Task Instructions

The participant reads the scenario briefing. In the roomDoubleBooking scenario, they learn they need to email panelist Jaden Thompson about a room conflict, coordinating with colleague Sarah Martinez via chat. Key instructions include: review colleague's messages, ask follow-up questions, and compose a professional email. They're told they may see AI suggestions (\"Advice for your next words\")."

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-task-instructions.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 500)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-task-instructions-2.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot walkthroughs/walkthrough-task-instructions-3.png'

$SHOWBOAT note "$DOC" "The participant clicks \"Start Writing Task\" to begin the main task."

$SHOWBOAT exec "$DOC" bash 'rodney click "button" && rodney sleep 3 && rodney url'

# Step 5: Main Writing Task
$SHOWBOAT note "$DOC" "## Step 5: Main Writing Task

This is the core of the experiment. The screen has three areas:
- **Left**: Email composition area (To, Subject, Body fields)
- **Bottom-right**: Floating chat panel with simulated colleague Sarah Martinez
- **Right sidebar**: AI Writing Assistant panel showing directive advice

The colleague's initial messages appear automatically with typing animations."

$SHOWBOAT image "$DOC" 'rodney sleep 8 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-initial.png'

$SHOWBOAT image "$DOC" 'rodney sleep 10 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-messages.png'

$SHOWBOAT note "$DOC" "The colleague (Sarah Martinez) sends her initial messages automatically:
1. \"Problem with Jaden's panel tomorrow\"
2. \"Room got double-booked. Gotta move him. But gotta keep him happy!\"
3. \"I'm on a call, so need you to email him. What info do you need to sort this out?\"

The chat panel is a floating window at the bottom-right. The colleague is intentionally non-proactive — she only answers questions when asked, simulating a busy coworker.

### Chatting with the Colleague

The participant asks Sarah questions to gather information needed for the email. Sarah is intentionally non-proactive — she only answers what's asked, simulating a busy coworker."

$SHOWBOAT exec "$DOC" bash 'rodney input '\''input[placeholder="Message Sarah..."]'\'' "What room is Jaden being moved to? And what time is his panel?" && rodney click '\''form button[type="submit"]'\'' && echo "Message sent"'

$SHOWBOAT image "$DOC" 'rodney sleep 8 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-chat-response.png'

$SHOWBOAT exec "$DOC" bash 'rodney js "document.querySelector('\''.flex-1.overflow-y-auto.bg-white'\'').innerText"'

$SHOWBOAT note "$DOC" "### Composing the Email

With information from Sarah, the participant begins composing their email. The AI panel requires at least 25 characters before generating suggestions."

$SHOWBOAT exec "$DOC" bash 'rodney input "#subject-field" "Important Update: Panel Room Change" && echo "Subject entered"'

$SHOWBOAT exec "$DOC" bash 'rodney focus "textarea" && rodney input "textarea" "Dear Jaden,

I hope this message finds you well. I'\''m writing to let you know about a change to your panel room for tomorrow. Due to a scheduling conflict, we'\''ve needed to move your session from the original room to Room 14. The new time slot will be 1:30 PM, which gives us a comfortable setup window.

I understand this is a last-minute change and I apologize for any inconvenience." && echo "Email body entered"'

$SHOWBOAT image "$DOC" 'rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-email-draft.png'

$SHOWBOAT note "$DOC" "### AI Suggestions Panel (proposal_advice mode)

After the participant types enough text (25+ characters), the AI panel begins generating directive advice. In the **p** condition, the AI provides 2-3 pieces of advice about what to write next — not copy-paste text, but thinking prompts like \"Consider acknowledging the inconvenience\" or \"Emphasize the new arrangement benefits.\" Suggestions auto-refresh every 15 seconds."

$SHOWBOAT image "$DOC" 'rodney sleep 18 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-task-ai-suggestions.png'

$SHOWBOAT exec "$DOC" bash 'rodney text "textarea"'

$SHOWBOAT exec "$DOC" bash 'rodney js "document.querySelector('\''h3'\'').parentElement.innerText"'

$SHOWBOAT note "$DOC" "The AI panel shows directive advice: it tells the participant *what to think about* rather than giving them words to copy. This is the key distinction of the **p** (proposal_advice) condition compared to other conditions that provide copy-paste text.

Now the participant finishes their email and clicks Send."

$SHOWBOAT exec "$DOC" bash 'rodney js "document.querySelector('\''button[aria-label=\"Send email\"]'\'').click()" && rodney sleep 3 && rodney url'

# Step 6: Post-Task Survey
$SHOWBOAT note "$DOC" "## Step 6: Post-Task Survey

After sending the email, the participant completes a post-task questionnaire. It includes NASA TLX-style workload questions (mental effort, time pressure, frustration) plus AI-specific questions about whether suggestions were helpful, easy to understand, and whether the participant felt pressured to use them."

$SHOWBOAT image "$DOC" 'rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-top.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 600)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-mid.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-bottom.png'

$SHOWBOAT note "$DOC" "Let's fill in the post-task survey as a sample participant."

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="tlx_mental_demand"][value="Medium"]'\'' && rodney click '\''input[name="tlx_temporal_demand"][value="Low"]'\'' && rodney click '\''input[name="tlx_performance"][value="Good"]'\'' && rodney click '\''input[name="tlx_physical_demand"][value="Very Low"]'\'' && rodney click '\''input[name="tlx_effort"][value="Medium"]'\'' && rodney click '\''input[name="tlx_frustration"][value="Low"]'\'' && echo "TLX questions filled"'

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[name="ai_ease_understand"][value="Agree"]'\'' && rodney click '\''input[name="ai_helpful"][value="Agree"]'\'' && rodney click '\''input[name="ai_felt_pressured"][value="Disagree"]'\'' && rodney click '\''input[name="ai_think_carefully"][value="Agree"]'\'' && echo "AI questions filled"'

$SHOWBOAT exec "$DOC" bash 'rodney click '\''input[value="None"]'\'' && echo "Other tools: None"'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, 0)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-filled-top.png'

$SHOWBOAT image "$DOC" 'rodney js "window.scrollTo(0, document.body.scrollHeight)" && rodney sleep 1 && rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-post-survey-filled-bottom.png'

$SHOWBOAT note "$DOC" "The post-task survey includes both general workload questions (NASA TLX) and condition-specific AI questions. For the **p** condition, participants reflect on the directive advice: whether it was easy to understand, helpful, and whether they felt pressured to follow it. The participant clicks \"Continue\" to submit."

$SHOWBOAT exec "$DOC" bash 'rodney js "document.querySelector('\''button'\'').click()" && rodney sleep 2 && rodney url'

# Step 7: Final Page
$SHOWBOAT note "$DOC" "## Step 7: Final Page

The study is complete. The participant sees a thank-you message and, if recruited via Prolific, a completion code for payment."

$SHOWBOAT image "$DOC" 'rodney screenshot -w 1440 -h 900 walkthroughs/walkthrough-final.png'

$SHOWBOAT exec "$DOC" bash 'rodney text "body" 2>/dev/null | head -20'

# Summary
$SHOWBOAT note "$DOC" "## Summary

The **proposal_advice (p)** condition walkthrough is complete. The participant experienced:

1. **Consent** — Study information and IRB consent form
2. **Introduction** — Overview of the three study phases
3. **Intro Survey** — Five pages: demographics, email writing experience, AI writing tool usage, writing self-efficacy, and Need for Cognition
4. **Task Instructions** — Scenario briefing (room double-booking, email to Jaden Thompson)
5. **Main Task** — Email composition with:
   - Chat with non-proactive colleague Sarah Martinez
   - AI Writing Assistant providing **directive advice** (not copy-paste text)
   - Auto-refreshing suggestions every 15 seconds
6. **Post-Task Survey** — Workload assessment + AI-specific reflection questions
7. **Completion** — Thank you and Prolific code

The key feature of the **p** condition: AI advice guides *thinking* rather than *writing*. Suggestions like \"Add the building name for Room 14\" and \"End with a confirmation request\" prompt deeper engagement without providing verbatim text to copy."

$SHOWBOAT exec "$DOC" bash 'rodney stop'

echo ""
echo "✅ Walkthrough regenerated successfully!"
echo "📄 File: $DOC"
echo "🖼️  Images: walkthroughs/*.png"
