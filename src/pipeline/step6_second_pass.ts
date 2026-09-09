import { LLMClient } from '../llm/client.js';
import { Role, Question, Flashcard, QuestionSchema, FlashcardSchema } from '../types/schemas.js';
import { checkCoverage, CoverageResult } from './step5_coverage.js';

export async function runCoveragePassLoop(
  role: Role,
  initialQuestions: Question[],
  initialFlashcards: Flashcard[],
  llm: LLMClient,
  maxPasses = 3
): Promise<{ questions: Question[]; flashcards: Flashcard[]; passes: number; uncoveredIds: string[] }> {
  let questions = [...initialQuestions];
  let flashcards = [...initialFlashcards];
  let passes = 1;

  let coverage: CoverageResult = checkCoverage(role, questions);

  while (coverage.uncoveredRequirementIds.length > 0 && passes < maxPasses) {
    passes++;

    // Find the requirements that need coverage
    const missingReqs = role.requirements.filter(r => coverage.uncoveredRequirementIds.includes(r.id));

    const systemPrompt = `SYSTEM: GENERATE_GAP_QUESTIONS
You are addressing specific uncovered requirements for an interview kit.
The following requirements currently have ZERO questions covering them:
${JSON.stringify(missingReqs, null, 2)}

Generate targeted interview questions and flashcards covering these exact requirement IDs.
Rules:
1. Every generated question MUST reference at least one of these missing requirement IDs in 'requirement_ids'.
2. Assign difficulty (1 to 3).
3. Output JSON:
{
  "questions": [
    {
      "id": "q_gap_1",
      "requirement_ids": ["${missingReqs[0]?.id || 'r1'}"],
      "category": "technical" | "behavioural" | "system-design" | "company-fit",
      "prompt": string,
      "answer_outline": string,
      "difficulty": 1 | 2 | 3
    }
  ],
  "flashcards": [
    {
      "id": "f_gap_1",
      "front": string,
      "back": string,
      "requirement_ids": ["${missingReqs[0]?.id || 'r1'}"]
    }
  ]
}`;

    const userPrompt = `Missing requirements to cover:
${missingReqs.map(r => `[${r.id}] (${r.kind}, ${r.priority}): ${r.text}`).join('\n')}`;

    try {
      const raw = await llm.generateJson<any>({
        systemPrompt,
        userPrompt,
        expectJson: true,
      });

      if (Array.isArray(raw.questions)) {
        for (const q of raw.questions) {
          const nextIdx = questions.length + 1;
          const assigned = Array.isArray(q.requirement_ids)
            ? q.requirement_ids.filter((id: string) => missingReqs.some(mr => mr.id === id))
            : [];
          const safeIds = assigned.length > 0 ? assigned : [missingReqs[0]?.id || 'r1'];

          questions.push(
            QuestionSchema.parse({
              id: `q${nextIdx}`,
              requirement_ids: safeIds,
              category: ['technical', 'behavioural', 'system-design', 'company-fit'].includes(q.category)
                ? q.category
                : 'technical',
              prompt: String(q.prompt || `Deep dive into requirement ${safeIds.join(', ')}`).trim(),
              answer_outline: String(q.answer_outline || 'Detailed response covering key metrics and edge cases.').trim(),
              difficulty: [1, 2, 3].includes(Number(q.difficulty)) ? (Number(q.difficulty) as 1 | 2 | 3) : 2,
              _provenance: {
                origin: 'generated',
                isPinned: false,
              },
            })
          );
        }
      }

      if (Array.isArray(raw.flashcards)) {
        for (const f of raw.flashcards) {
          const nextFIdx = flashcards.length + 1;
          const assigned = Array.isArray(f.requirement_ids)
            ? f.requirement_ids.filter((id: string) => missingReqs.some(mr => mr.id === id))
            : [];
          const safeIds = assigned.length > 0 ? assigned : [missingReqs[0]?.id || 'r1'];

          flashcards.push(
            FlashcardSchema.parse({
              id: `f${nextFIdx}`,
              front: String(f.front || 'Key Rule').trim(),
              back: String(f.back || 'Key Explanation').trim(),
              requirement_ids: safeIds,
              _provenance: {
                origin: 'generated',
                confidence: 0,
              },
            })
          );
        }
      }
    } catch (err) {
      console.warn(`[CoverageLoop] Gap generation pass ${passes} encountered an issue:`, err);
    }

    // Recompute coverage deterministically
    coverage = checkCoverage(role, questions);
  }

  return {
    questions,
    flashcards,
    passes,
    uncoveredIds: coverage.uncoveredRequirementIds,
  };
}
