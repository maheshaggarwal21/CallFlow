export type Turn = { speaker: "Agent" | "Caller"; text: string };

// Prompt 1: Speaker diarization
export function buildDiarizationPrompt(transcriptRaw: string): string {
  return `You are a call transcript analyzer for Max Music School, a music academy in India.
A raw call transcript is provided below and it contains no speaker labels.
Your task is to identify two speakers and label every turn correctly.

SPEAKER DEFINITIONS
- Agent (school employee):
  - Answers the call and often greets with "Max Music School"
  - Discusses class timings, batch schedules, instrument courses, enrollment, fees, trials
  - Tone is professional and helpful
  - May switch between Hindi and English (Hinglish)
  - Often says: "aapka naam kya hai", "kaunsa instrument", "fees yeh hain"
- Caller (student, parent, or prospective student):
  - The person who called or was called
  - Asks questions, makes requests, expresses concerns
  - Asks about admissions, fees, timings, teacher availability, cancellations
  - May say: "sochke bataunga", "call karta hoon"

RULES
1. Every line of dialogue must be assigned to exactly one speaker.
2. Do not merge consecutive turns by the same speaker. Preserve natural breaks.
3. Short acknowledgements from the other side are their own turn.
4. Ignore filler sounds that are under 5 words (for example: mm-hmm, haan).
5. If you cannot tell who said a line, assign it to Agent.
6. The first turn is almost always the Agent.

TRANSCRIPT
"""
${transcriptRaw}
"""

Return ONLY a valid JSON object with a "turns" key. No explanation, no markdown, no extra text.
Required format:
{
  "turns": [
    { "speaker": "Agent", "text": "Max Music School, how can I help you?" },
    { "speaker": "Caller", "text": "Hi, I wanted to ask about guitar classes." }
  ]
}`;
}

// Prompt 2: Summary and sentiment
export function buildSummaryPrompt(turns: Turn[]): string {
  const conversationText = turns
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  return `You are analyzing a customer service call from Max Music School, a music academy in India.
Students and parents call to inquire about music courses, schedules, fees, enrollment, and other matters.

CALL TRANSCRIPT
${conversationText}

TASK 1 - CALL SUMMARY
Write 2-3 sentences summarizing what happened in this call.
Rules for a good summary:
- Be specific and name the instrument or course if mentioned.
- Name the outcome (enrolled, got info, callback promised, unresolved, etc.).
- Include any action item.
- Do not write vague sentences like "The caller asked about classes".
- Write in English even if the conversation was in Hindi or Hinglish.

TASK 2 - SENTIMENT CLASSIFICATION
Classify the overall sentiment as exactly one of: "positive", "negative", or "neutral".

POSITIVE - clear good outcome:
- Caller got what they needed or took a next step
- Trial or demo class booked
- Issue resolved without friction

NEGATIVE - unresolved frustration:
- Caller expressed dissatisfaction and it was not resolved
- Refund or cancellation threats
- Agent could not help and offered no alternative

NEUTRAL - informational or inconclusive:
- General inquiry with no commitment
- "Will think about it" or "Will call back"
- Administrative updates

Return ONLY valid JSON. No explanation, no markdown, no extra text:
{ "summary": "2-3 sentence summary here.", "sentiment": "positive" }`;
}

// Prompt 3: Misc call classification (optional)
export function buildMiscClassificationPrompt(transcriptRaw: string): string {
  return `A very short phone call transcript is shown below. It was flagged as a
"miscellaneous call" because it was under 10 seconds or had no substantive content.

Classify this call as exactly one of:
- "disconnected"  - call connected but dropped immediately
- "no_response"   - agent answered but caller said nothing
- "spam"          - robocall or telemarketer
- "test"          - internal test call
- "other"         - does not fit the above categories

TRANSCRIPT:
"""
${transcriptRaw || "(empty - no audio transcribed)"}
"""

Return ONLY valid JSON:
{ "misc_reason": "disconnected" }`;
}
