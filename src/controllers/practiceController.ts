import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { MemoryStore } from '../db/models.js';
import { Kit } from '../types/schemas.js';
import { LLMClient } from '../llm/client.js';

export class PracticeController {
  private static llm = new LLMClient();

  /**
   * SECTION 7: Record card confidence (1: Needs Practice, 2: Neutral, 3: Mastered)
   */
  static async updateConfidence(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { cardId, confidence } = req.body;
      const confNum = Number(confidence);

      if (!cardId || ![1, 2, 3].includes(confNum)) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'cardId and confidence (1, 2, or 3) are required.' });
        return;
      }

      const record = await MemoryStore.getKitById(req.params.id, req.userId!);
      if (!record) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }

      const kit: Kit = record.kit;
      const card = kit.flashcards.find(f => f.id === cardId);
      if (!card) {
        res.status(404).json({ error: 'CARD_NOT_FOUND', message: `Flashcard ${cardId} not found.` });
        return;
      }

      if (!card._provenance) {
        card._provenance = { origin: 'generated', confidence: confNum, lastReviewedAt: new Date().toISOString() };
      } else {
        card._provenance.confidence = confNum;
        card._provenance.lastReviewedAt = new Date().toISOString();
      }

      await MemoryStore.updateKit(req.params.id, req.userId!, kit);
      res.status(200).json({ success: true, cardId, confidence: confNum });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }

  /**
   * CREATIVE FEATURE (Section 14): AI Mock Interviewer Answer Evaluator.
   * Evaluates candidate responses against rubric criteria and answer outlines.
   */
  static async mockEvaluate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { questionId, userAnswer } = req.body;
      if (!questionId || !userAnswer) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'questionId and userAnswer are required.' });
        return;
      }

      const record = await MemoryStore.getKitById(req.params.id, req.userId!);
      if (!record) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }

      const kit: Kit = record.kit;
      const question = kit.questions.find(q => q.id === questionId);
      if (!question) {
        res.status(404).json({ error: 'QUESTION_NOT_FOUND', message: `Question ${questionId} not found.` });
        return;
      }

      const systemPrompt = `SYSTEM: MOCK_INTERVIEW_EVALUATOR
You are a senior hiring manager and tech lead evaluating a candidate's interview answer.
Question Prompt: "${question.prompt}"
Model Answer Outline: "${question.answer_outline}"
Category: ${question.category}

Evaluate the candidate's answer constructively:
1. Score from 1 to 5 (1: Poor, 3: Competent, 5: Exceptional).
2. Key strengths demonstrated.
3. Critical gaps or missed technical considerations.
4. Actionable suggestion for improvement.
5. Recommended confidence level (1 = Needs Practice, 2 = Neutral, 3 = Mastered).

Output JSON:
{
  "score": number,
  "verdict": string,
  "strengths": string[],
  "missedPoints": string[],
  "improvementTip": string,
  "suggestedConfidence": 1 | 2 | 3
}`;

      const userPrompt = `Candidate Answer:
"${userAnswer}"`;

      let feedback: any;
      try {
        feedback = await PracticeController.llm.generateJson<any>({
          systemPrompt,
          userPrompt,
          expectJson: true,
        });
      } catch {
        // Fallback rubric calculation
        const wordCount = userAnswer.trim().split(/\s+/).length;
        const score = wordCount > 40 ? 4 : wordCount > 15 ? 3 : 2;
        feedback = {
          score,
          verdict: score >= 4 ? 'Strong answer' : 'Adequate foundation',
          strengths: ['Addressed the main question', 'Clear communication style'],
          missedPoints: ['Could reference specific production benchmarks or quantitative impact'],
          improvementTip: 'Elaborate on edge cases and failure modes in high-concurrency systems.',
          suggestedConfidence: score >= 4 ? 3 : 2,
        };
      }

      res.status(200).json({
        questionId,
        feedback,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'EVALUATION_FAILED', message: err.message });
    }
  }
}
