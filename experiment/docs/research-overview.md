# Measuring Over-Reliance on AI Writing Assistants Through Information-Seeking Behavior

## Abstract

[TBD - summarize findings]

## 1. Introduction

AI writing assistants increasingly offer real-time suggestions as people compose text. While these tools can improve efficiency, they may also induce "premature closure"—users accept plausible-sounding output without fully thinking through what a situation requires. This is particularly concerning for consequential communications where understanding context, considering the recipient's perspective, and anticipating downstream effects are essential to producing effective text.

We propose a novel experimental method for measuring over-reliance: observing information-seeking behavior during a realistic writing task. Participants compose workplace emails while having access to a colleague (simulated via LLM) who can provide relevant context. By measuring what questions participants ask—and don't ask—we gain a window into their cognitive engagement beyond what the final text reveals.

### 1.1 The Problem of Premature Closure

When an AI suggests text that "sounds right," users face reduced incentive to think through:

- What information they actually need
- How the recipient will perceive the message
- What consequences might follow from different framings

This is distinct from simple automation bias (accepting AI output as correct). Premature closure means the AI short-circuits the *thinking process itself*—users don't realize what they failed to consider.

### 1.2 Research Questions

1. **RQ1**: Do AI writing suggestions reduce information-seeking behavior compared to unassisted writing?
2. **RQ2**: Does reduced information-seeking correlate with lower-quality outcomes (emails that fail to address the situation appropriately)?
3. **RQ3**: Can AI suggestions be designed to support thinking rather than supplant it?

## 2. Related Work

### 2.1 AI Writing Assistants

[Review of existing tools and their effects on writing]

### 2.2 Automation Bias and Over-Reliance

[Literature on over-reliance in AI-assisted decision making]

### 2.3 Cognitive Offloading

[Research on how external tools affect cognitive processes]

### 2.4 Measuring Thought Processes

[Methods for studying cognition during writing: think-aloud, keystroke logging, etc.]

## 3. Method

### 3.1 Experimental Design

Participants complete a workplace email writing task with:

- **Information source**: A colleague available via chat who has relevant context
- **Manipulation**: Presence/type of AI writing suggestions (Study 1: with/without; Study 2: suggestion type variations)

### 3.2 The Colleague Chat as Measurement Instrument

The colleague (simulated via LLM with specific behavioral constraints) serves dual purposes:

1. **Ecological validity**: Real workplace writing often requires gathering information from others
2. **Process measurement**: Questions asked reveal what participants thought to think about

Critical design constraint: The colleague must be *reactive*, not proactive. They answer questions when asked but do not volunteer information. This ensures that information gathered reflects participant initiative.

#### Colleague Behavioral Constraints

- Responds only to direct questions
- Provides factual information but refuses to draft email text
- Maintains realistic persona (busy, texting briefly)
- Does not anticipate user needs or "helpfully" dump relevant context

### 3.3 Scenarios

Two scenarios requiring participants to deliver unwelcome news to an external party:

**Scenario A: Room Double-Booking**

- Context: Panel event scheduling conflict
- Recipient: Client/influencer who must be moved to different room/time
- Key information to gather: new room, new time, reason for conflict, what to offer the client

**Scenario B: Demo Rescheduling**

- Context: Critical bug discovered before important product demo
- Recipient: VP at potential client company
- Key information to gather: reschedule options, nature of issue (how much to disclose), timeline

### 3.4 Measures

**Process measures:**

- Number of questions asked to colleague
- Types of information sought (logistical, relational, strategic)
- Time spent in chat vs. composing

**Outcome measures:**

- Email completeness (does it contain necessary information?)
- Appropriateness (tone, acknowledgment of inconvenience, recipient consideration)
- Problem-solving quality (does it actually address the situation vs. just sound professional?)

Outcome coding via rubric + independent raters (or LLM-assisted with human validation).

### 3.5 Conditions

**Study 1: AI Presence**

- No-AI: No AI suggestions available
- Complete Document: the AI suggests a completed document (including both filling in missing text and correcting text as needed)
- Sentences only: The AI suggests sentence completions (or next sentences, if the current sentence is already complete)

**Study 2: Suggestion Type** (if Study 1 shows effect)

- Sentences only
- Advice / coaching
- Anticipated readers' reactions

Hypothesis: Suggestions that don't "give the answer" may support thinking rather than supplanting it.

## 4. Pilot Findings

[Summarize pilot observations]

Initial pilot revealed low engagement with colleague chat even when participants were explicitly told they'd need to ask questions. This led to redesigning:

- Initial messages now end with a question to the participant (inverting the dynamic)
- Colleague persona emphasizes being busy/reactive rather than helpful
- Instructions reinforced but scenario structure now *requires* questions to get key info

## 5. Results

[TBD]

## 6. Discussion

### 6.1 Implications for AI Writing Tool Design

### 6.2 Information-Seeking as a Measure of Cognitive Engagement

### 6.3 Limitations

### 6.4 Future Work

## 7. Conclusion

## References
