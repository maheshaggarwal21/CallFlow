export type Turn = { speaker: "Agent" | "Caller"; text: string };

// ─────────────────────────────────────────────────────────────────────────────
// WHISPER initial_prompt — keep under 50 words; longer prompts cause Whisper
// to hallucinate by "completing" the prompt instead of transcribing the audio.
// Purpose: supply proper nouns and Hinglish vocabulary so Whisper spells them
// correctly, NOT to describe the call.
// ─────────────────────────────────────────────────────────────────────────────
export const WHISPER_INITIAL_PROMPT =
  "Max Music School. Shivani, Ajit. Guitar, keyboard, violin, tabla, fees, batch, theory class, special class, haan ji, theek hai, shukriya, aapka, kitna, kab.";

// ─────────────────────────────────────────────────────────────────────────────
// UNANSWERED CALL PATTERNS
// Comprehensive list of Indian telecom automated messages (all operators).
// Used to detect calls where the contact never picked up.
// ─────────────────────────────────────────────────────────────────────────────
export const UNANSWERED_CALL_PATTERNS: string[] = [
  // Generic Hindi operator messages
  "aapka dial kiya hua number",
  "abhi uplabdh nahi",
  "abhi upalabdh nahi",
  "abhi busy hai",
  "switch off hai",
  "switched off",
  "band hai",
  "filhal uplabdh",
  "baad mein try karein",
  "baad mein koshish karein",
  "please try after",
  "try again later",
  "number is currently",
  "not reachable",
  "not available",
  "currently not reachable",
  "currently unavailable",
  "subscriber you are calling",
  "subscriber you have dialled",
  "the number you have dialled",
  "please check the number",
  // Jio
  "jio subscriber",
  // Airtel
  "airtel subscriber",
  "the airtel",
  // Vi / Vodafone
  "vi subscriber",
  "vodafone subscriber",
  // BSNL
  "bsnl subscriber",
  // IVR / voicemail
  "please leave a message",
  "leave a message after",
  "voice message",
  "voicemail",
  // Missed call / ring only
  "koi jawab nahi",
  "no answer",
];

/** Returns true if the transcript appears to be an unanswered/automated call */
export function isUnansweredCall(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return UNANSWERED_CALL_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** Returns true if transcript looks like nothing but dial tones were recorded. */
export function isDialToneOnly(transcript: string): boolean {
  const t = transcript.trim();
  if (t.length === 0) return true;
  // Pure DTMF / noise: very short or all digits/symbols after stripping whitespace
  const cleaned = t.replace(/[\d\s\-\+\.\,★#*♪♫]/g, "");
  return t.length < 15 || cleaned.length < 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 1 — Speaker Diarization
// ─────────────────────────────────────────────────────────────────────────────
export function buildDiarizationPrompt(transcriptRaw: string): string {
  return `You are an expert call-transcript analyzer for Max Music School, a guitar and music
academy based in India. A raw transcript with NO speaker labels is provided below.
Your job: split it into turns and label every turn as either "Agent" or "Caller".

━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 0 — IDENTIFY THE AGENT FIRST
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before assigning any turn, scan the entire transcript for the agent's name and gender.
Use the table below. If the name appears, the gender is FIXED — do not guess.

  Name      Gender    Addresses caller as    Caller addresses them as
  ───────   ──────    ──────────────────     ────────────────────────
  Shivani   Female    Sir / Ma'am            Ma'am / Maam ji
  Ajit      Male      Ma'am / Sir            Sir / Bhaiya
  [Slot 3]  Female    Sir / Ma'am            Ma'am
  [Slot 4]  Male      Ma'am / Sir            Sir
  [Slot 5]  Female    Sir / Ma'am            Ma'am
  [Slot 6]  Male      Ma'am / Sir            Sir

KEY RULE on "Sir" and "Ma'am":
  Both speakers use these words — so the WORD ALONE does not identify the speaker.
  Instead, use the CONTENT TYPE and SENTENCE LENGTH rules below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT-TYPE RULE (most reliable signal)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AGENT  → DELIVERS information, instructions, updates, schedules, reminders
            ("aapki fees baaki hai", "aaj reporting time 5 baje hai",
             "batch Monday-Wednesday-Friday hai", "class cancel ho gayi hai")

  CALLER → ASKS questions OR gives short acknowledgements
            ("fees kitni hai?", "kab se start hoga?", "Okay.", "Haan ji.",
             "Theek hai ma'am.", "Shukriya.", "Ok sir.")

If "Sir" or "Ma'am" is used, look at what follows:
  → "Sir, aapki fees 2000 hai" = delivering info → AGENT (addressing caller as Sir)
  → "Okay, ma'am." = short acknowledgement → CALLER (addressing agent as Ma'am)
  → "Ma'am, aapka batch change ho gaya" = delivering info → AGENT (addressing caller as Ma'am)
  → "Theek hai sir." = short acknowledgement → CALLER (addressing agent as Sir)

━━━━━━━━━━━━━━━━━━━━━━━━━━━
SENTENCE LENGTH RULE (secondary signal)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • ≤ 6 words ending in sir / ma'am / maam / haan ji / okay = CALLER acknowledging
  • ≥ 7 words with factual content = AGENT delivering information

━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO IS THE AGENT?
━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Agent is a Max Music School staff member who received or made the call.

• Opens the call: "Max Music School", "haan ji", "namaste", "hello Max Music School"
• Self-identifies: "main Shivani bol rahi hoon", "Ajit here from Max Music School",
  "[name] baat kar raha/rahi hoon Max Music School se"
  → The turn containing an agent's name is ALWAYS the Agent's turn.
• Speaks in Hinglish (natural Hindi-English mix)
• Topics: fees, class schedule, batch change, theory class, special class,
  enrollment, reporting time, rehearsal timing, instrument assignment
• GIVES information — rarely asks about courses from scratch
• Uses "Sir" to address a male caller or "Ma'am" to address a female caller
  BUT this does NOT mean the Caller is female — it is just a polite address
• WELFARE / CONCERN QUESTIONS are ALWAYS the Agent checking on the student.
  Any sentence expressing concern for the caller's wellbeing = AGENT turn:
    "aapki tabiyaat theek hai kya?", "aapki tabiyaat theek nahi hai kya?",
    "sab theek hai?", "kya hua?", "ghabrao mat", "theek ho jayega",
    "koi takleef toh nahi?", "aap theek hain na?", "are you okay?", "koi baat nahi"
  CRITICAL: "aapki tabiyaat theek nahi hai kya?" is ALWAYS the Agent asking —
  it does NOT mean the Caller is speaking just because it contains "aapki".
  "aapki / aapka / aap" in these sentences refers to the CALLER's property or
  health; the Agent uses these words TO the Caller, not about themselves.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO IS THE CALLER?
━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Caller is a student, parent, or prospective customer.

• Asks questions or makes short acknowledgements
• Uses "Ma'am" or "Sir" to address the agent — but as established above,
  this alone does not determine who is speaking; use content-type first
• Topics: fees inquiry, course info, scheduling, complaints, cancellations
• Acknowledgements: "haan ji", "okay", "theek hai", "shukriya", "bilkul"
• Can be a parent calling for a child

━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPECIAL CASES — READ CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. DIAL TONES / DTMF SOUNDS & WHISPER ARTIFACTS
   If the transcript starts with sequences of digits, star/hash symbols (★ # *),
   garbled Unicode, Arabic/non-Latin text mid-Hinglish call, musical notes (♪ ♫),
   or "beep" / "tone" — these are landline DTMF dialing sounds or Whisper noise.
   SKIP these tokens entirely. Do not assign them to any speaker.
   Example of artifact to skip: "★★★★★ ★★★وت ★★★★★★"

2. UNANSWERED / AUTOMATED OPERATOR MESSAGE
   If you see phrases like: "aapka dial kiya hua number", "not reachable",
   "switch off hai", "subscriber you are calling", "please try after",
   "Jio/Airtel/Vi subscriber" — the call was NOT answered by a human.
   In this case return a single Agent turn with text:
   "[Automated] Call not answered — operator message detected."
   and a single Caller turn with text: "[System] No response from contact."

3. SHORT / EMPTY TRANSCRIPT
   If the transcript has fewer than 10 meaningful words, return a single Agent turn:
   "[System] No audible speech detected."

━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIARIZATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. The FIRST real turn is almost always the Agent (they answer).
2. Assign EVERY line to exactly one of "Agent" or "Caller".
3. Do NOT merge consecutive turns by the same speaker — keep them as separate turns.
4. Short acknowledgements ("haan", "okay", "hmm") that interrupt the other speaker
   are their own turn.
5. If two speakers overlap or a line is truly ambiguous, assign it to Agent.
6. Never invent or add text that is not in the transcript.
7. Preserve the original language (Hindi, English, Hinglish) exactly as transcribed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRANSCRIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
${transcriptRaw}
"""

Return ONLY a valid JSON object with a "turns" array. No explanation, no markdown:
{
  "turns": [
    { "speaker": "Agent", "text": "Max Music School, haan ji boliye." },
    { "speaker": "Caller", "text": "Hi, guitar classes ke baare mein poochna tha." }
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 2 — Summary + Sentiment
// ─────────────────────────────────────────────────────────────────────────────
export function buildSummaryPrompt(turns: Turn[]): string {
  const conversationText = turns
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  return `You are analyzing a customer service call from Max Music School, a guitar and music
academy in India. Calls are typically in Hinglish (Hindi + English). Read the transcript
below and complete BOTH tasks.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
TRANSCRIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${conversationText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 1 — SUMMARY (2–3 sentences, in English)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Rules:
• Name the instrument or course if mentioned (guitar, keyboard, theory class, etc.).
• State what the caller wanted and what the outcome was.
• Include any action item (callback promised, enrollment started, fees to be paid, etc.).
• If the call was automated/unanswered, write: "Call was not answered. Operator message played."
• If there was no real conversation, write: "Call connected but no meaningful conversation took place."
• Never write vague sentences like "The caller asked about classes."
• Write in English even if the conversation was in Hindi or Hinglish.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 2 — SENTIMENT (classify the CALLER's emotional tone)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXT: Max Music School calls are mostly short informational calls — the agent
gives a schedule update, fee reminder, or answers a quick question, and the caller
politely acknowledges and ends the call. A calm, cooperative "Okay" or "Thank you"
at the end IS a positive outcome — it means the caller received the information and
was satisfied enough to end gracefully. Do NOT default these to neutral. But some calls can 
be longer and more complex, and in those cases you may see a wider range of emotions.
And a full conversation going on with multiple back-and-forth turns there breaks the usual pattern and may require more careful reading.

Focus ONLY on how the CALLER sounded — especially in their LAST 2–3 turns.
Ignore the Agent's tone entirely.

── POSITIVE ────────────────
Assign "positive" when the caller ended the call cooperatively and politely.
This is the MOST COMMON outcome for informational calls at Max Music School.

  Closing words that count as POSITIVE (any one of these is enough):
  English:       "okay", "ok", "okay okay", "thank you", "thanks", "thank you ma'am",
                 "thank you sir", "sounds good", "got it", "sure", "alright",
                 "perfect", "great", "wonderful", "excellent", "I'll join",
                 "I'll come", "let's do it", "this is exactly what I needed"
  Hindi/Hinglish: "theek hai", "theek hai maam", "theek hai sir", "haan ji theek hai",
                  "shukriya", "shukriya maam", "shukriya sir", "dhanyawad",
                  "bahut accha", "bahut badhiya", "bilkul theek hai", "haan bilkul",
                  "accha", "accha ji", "ji haan", "zaroor", "main aaunga",
                  "main join kar leta/leti hoon", "achha laga", "bahut helpful the aap",
                  "zabardast", "mast hai", "perfect hai", "bahut khushi hui"

  Behavior cues (any one counts):
  • Caller said "okay" or "thank you" (in any language) near the END of the call
  • Caller received information and ended the call without complaint
  • Caller agreed to enroll / pay fees / attend a class / visit the school
  • Caller expressed relief, gratitude, or satisfaction after getting information
  • Caller ended the call warmly even after a short exchange

── NEGATIVE ────────────────
Assign "negative" ONLY when there is clear frustration or dissatisfaction.

  English:       "not happy", "disappointed", "frustrated", "waste of time",
                 "no one picks up", "I want a refund", "terrible", "very bad",
                 "I'll complain", "pathetic", "useless", "this is wrong"
  Hindi/Hinglish: "bahut bura laga", "main naraaz hoon", "gussa aa raha hai",
                  "ye sahi nahi hai", "complaint karunga", "paise wapas chahiye",
                  "bilkul galat hai", "main nahi aaunga", "teacher hi nahi aate",
                  "class nahi milti", "fees bhari thi phir bhi"

  Behavior cues:
  • Caller expressed dissatisfaction that was NOT addressed or resolved
  • Caller threatened to leave, cancel, or complain
  • Caller ended the call abruptly or in frustration (no polite closing)
  • Caller repeated the same complaint multiple times with no resolution

── NEUTRAL ─────────────────
Assign "neutral" ONLY when:
  • Caller gave NO closing cue — ended mid-conversation or just "haan"
  • Pure enquiry call — caller asked for information, got it, said nothing at the end
  • Caller said "will think about it" / "sochke bataunga" / "mummy se poochh ke batata hoon"
    with NO other positive/negative signals
  • Call was unanswered, automated, or too short for any emotional read

DECISION GUIDE:
  Caller ended with "okay" / "thank you" / "shukriya" → POSITIVE
  Caller ended with complaint / frustration / no-show anger → NEGATIVE
  Caller ended with "will think" / "will call back" / silence → NEUTRAL
  Unanswered / automated call → NEUTRAL (always)

IMPORTANT: Do NOT default all short calls to neutral. A 30-second call where the
caller says "okay ma'am" at the end is POSITIVE — that is the normal polite close
for informational reminder calls at Max Music School.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY valid JSON. No markdown, no explanation:
{ "summary": "2–3 sentence summary here.", "sentiment": "positive" }`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT 3 — Misc call classification
// ─────────────────────────────────────────────────────────────────────────────
export function buildMiscClassificationPrompt(transcriptRaw: string): string {
  return `A very short phone call transcript is shown below. It was flagged as
"miscellaneous" because it was under 10 seconds or had no substantive content.

Classify as exactly one of:
  "disconnected"  — call connected but dropped immediately with no speech
  "unanswered"    — rang out or hit an automated operator message (not picked up)
  "dial_tone"     — recording contains only DTMF tones / dial sounds, no speech
  "no_response"   — agent or caller answered but said nothing meaningful
  "spam"          — robocall, telemarketer, or irrelevant automated call
  "test"          — internal test call
  "other"         — does not fit any of the above

Common automated unanswered-call phrases to look for (in any language):
  "not reachable", "switch off", "busy hai", "aapka number", "subscriber you are calling",
  "Jio", "Airtel", "Vi subscriber", "please try after", "baad mein try karein"

TRANSCRIPT:
"""
${transcriptRaw || "(empty — no audio transcribed)"}
"""

Return ONLY valid JSON:
{ "misc_reason": "unanswered" }`;
}
