import { LLMClient } from '../llm/client.js';
import { Role, Question, Flashcard, QuestionSchema, FlashcardSchema } from '../types/schemas.js';
import { InterviewSignals } from './step3_signals.js';

export async function generateQuestionsAndFlashcards(
  role: Role,
  signals: InterviewSignals,
  llm: LLMClient
): Promise<{ questions: Question[]; flashcards: Flashcard[] }> {
  const systemPrompt = `SYSTEM: GENERATE_QUESTIONS
You are an engineering bar-raiser preparing tailored interview questions.
You are given structured requirements for a role and company interview process signals.

Rules:
1. Generate specific, challenging questions covering the requirements.
2. Technical requirements lead to 'technical' or 'system-design' questions.
3. Leadership/mentoring/collaboration requirements lead to 'behavioural' questions.
4. Company culture / process leads to 'company-fit' questions.
5. Every question MUST reference at least one valid requirement id in requirement_ids (e.g. ["r1"]).
6. Assign difficulty from 1 (fundamental), 2 (intermediate/applied), to 3 (complex/senior architecture).
7. Generate flashcards for key definitions, architectural trade-offs, and behavioral checklists, each referencing requirement_ids.
8. Output JSON:
{
  "questions": [
    {
      "id": "q1",
      "requirement_ids": ["r1"],
      "category": "technical" | "behavioural" | "system-design" | "company-fit",
      "prompt": string,
      "answer_outline": string,
      "difficulty": 1 | 2 | 3
    }
  ],
  "flashcards": [
    {
      "id": "f1",
      "front": string,
      "back": string,
      "requirement_ids": ["r1"]
    }
  ]
}`;

  const userPrompt = `Role: ${role.title} (${role.seniority})
Requirements:
${JSON.stringify(role.requirements, null, 2)}

Interview Stages:
${signals.interviewStages.join(' -> ')}
Focus: ${signals.roundsFocus}`;

  const raw = await llm.generateJson<any>({
    systemPrompt,
    userPrompt,
    expectJson: true,
  });

  const validReqIds = new Set(role.requirements.map(r => r.id));

  // Sanitize questions
  let questions: Question[] = [];
  if (Array.isArray(raw.questions)) {
    questions = raw.questions.map((q: any, idx: number) => {
      const assignedReqs = Array.isArray(q.requirement_ids)
        ? q.requirement_ids.filter((id: string) => validReqIds.has(id))
        : [];
      
      // Fallback to first requirement if none mapped
      const safeReqIds = assignedReqs.length > 0 ? assignedReqs : [role.requirements[0]?.id || 'r1'];

      const validCategory = ['technical', 'behavioural', 'system-design', 'company-fit'].includes(q.category)
        ? q.category
        : 'technical';

      const diff = [1, 2, 3].includes(Number(q.difficulty)) ? (Number(q.difficulty) as 1 | 2 | 3) : 2;

      return QuestionSchema.parse({
        id: `q${idx + 1}`,
        requirement_ids: safeReqIds,
        category: validCategory,
        prompt: String(q.prompt || `Explain key architectural trade-offs for ${safeReqIds.join(', ')}`).trim(),
        answer_outline: String(q.answer_outline || 'Provide real-world scenarios, trade-offs, and metrics.').trim(),
        difficulty: diff,
        _provenance: {
          origin: 'generated',
          isPinned: false,
        },
      });
    });
  }

  // Sanitize flashcards
  let flashcards: Flashcard[] = [];
  if (Array.isArray(raw.flashcards)) {
    flashcards = raw.flashcards.map((f: any, idx: number) => {
      const assignedReqs = Array.isArray(f.requirement_ids)
        ? f.requirement_ids.filter((id: string) => validReqIds.has(id))
        : [];
      const safeReqIds = assignedReqs.length > 0 ? assignedReqs : [role.requirements[0]?.id || 'r1'];

      return FlashcardSchema.parse({
        id: `f${idx + 1}`,
        front: String(f.front || 'Key Concept').trim(),
        back: String(f.back || 'Core explanation and best practices').trim(),
        requirement_ids: safeReqIds,
        _provenance: {
          origin: 'generated',
          confidence: 0,
        },
      });
    });
  }

  return { questions, flashcards };
}
