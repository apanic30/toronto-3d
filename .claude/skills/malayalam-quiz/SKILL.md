---
name: malayalam-quiz
description: Quiz the user on Malayalam. Ask a question or phrase in English, the user answers in Malayalam (script or transliteration), then rate the answer out of 10 with short corrections. Use when the user asks for a Malayalam quiz, practice, or invokes /malayalam-quiz.
---

# Malayalam Quiz

Run a short, friendly translation quiz: English in, Malayalam out.

## How to run it

1. **Start** with one line: "Malayalam quiz! Answer in Malayalam script or English letters (Manglish). Say 'stop' anytime." If the user passed a topic or level as an argument (e.g. "food", "beginner"), use it; otherwise start at beginner and mix topics (greetings, family, food, numbers, directions, daily life, feelings, time).

2. **Ask one question at a time.** Give a short English word, phrase, or sentence to translate, e.g.:
   - "How are you?"
   - "I am hungry."
   - "Where is the bus stop?"
   Number each question (Q1, Q2, …). Don't give hints unless asked.

3. **Wait for the answer**, then reply in this format:

   ```
   Score: X/10
   ✓ Correct answer: <Malayalam script> (<transliteration>)
   Corrections: <1–3 short bullet points, or "None — perfect!">
   ```

   Then immediately ask the next question.

## Scoring guide

- **10** — Correct and natural.
- **8–9** — Correct meaning, small slip (one wrong vowel/ending, slightly unnatural word order, minor spelling).
- **5–7** — Meaning mostly there but a wrong word, tense, or grammar ending (e.g. wrong case suffix, wrong verb form).
- **2–4** — Only partly right; key word(s) missing or wrong.
- **0–1** — Wrong or no attempt.

Be fair to valid alternatives: accept colloquial/spoken forms and regional variants, and accept transliteration (don't deduct for Manglish spelling, only for the Malayalam itself being wrong). If the answer is acceptable but there's a more common way to say it, give full or near-full marks and mention the common form.

## Corrections

Keep them small and specific — point at the exact mistake and the fix, e.g.:
- "ഞാൻ വിശക്കുന്നു" → say "എനിക്ക് വിശക്കുന്നു" (enikku vishakkunnu); hunger uses എനിക്ക് (to me), not ഞാൻ.

No long grammar lectures. One short "why" at most.

## Difficulty

- After 3 scores of 8+ in a row, make questions a bit harder (longer sentences, past/future tense, questions, polite forms).
- After 2 scores of 4 or below, ease off.

## Ending

When the user says stop (or after 10 questions if they asked for a set), give a one-line summary: average score, and the 1–2 things to practice most.
