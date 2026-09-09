import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { MemoryStore } from '../db/models.js';
import { PipelineOrchestrator, PipelineProgressEvent } from '../pipeline/orchestrator.js';
import { Kit, KitSchema, Question, QuestionSchema } from '../types/schemas.js';
import { LLMClient } from '../llm/client.js';
import { buildSchedule } from '../pipeline/step7_schedule.js';

export class KitController {
  private static orchestrator = new PipelineOrchestrator();
  private static llm = new LLMClient();

  static async generate(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid user session required. Please log in again.' });
        return;
      }

      const { jd, company_url, days } = req.body;
      if (!jd || !company_url) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Job description (jd) and company_url are required.' });
        return;
      }

      const kit = await KitController.orchestrator.run({
        jd,
        company_url,
        days: days || 5,
      });

      const saved = await MemoryStore.createKit(req.userId, kit);
      res.status(201).json(saved);
    } catch (err: any) {
      res.status(500).json({ error: 'GENERATION_FAILED', message: err.message });
    }
  }

  /**
   * Server-Sent Events (SSE) streaming endpoint for live progress updates.
   */
  static async streamGenerate(req: AuthRequest, res: Response): Promise<void> {
    const jd = req.query.jd as string;
    const company_url = req.query.company_url as string;
    const days = parseInt((req.query.days as string) || '5', 10);

    if (!jd || !company_url) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Missing jd or company_url query parameter.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      sendEvent('progress', { stage: 'starting', message: 'Initializing research pipeline...', progressPercent: 5 });

      const kit = await KitController.orchestrator.run(
        { jd, company_url, days },
        (progress: PipelineProgressEvent) => {
          sendEvent('progress', progress);
        }
      );

      const saved = await MemoryStore.createKit(req.userId!, kit);
      sendEvent('completed', { kitId: saved.id, kit: saved.kit });
      res.end();
    } catch (err: any) {
      sendEvent('error', { error: 'GENERATION_FAILED', message: err.message });
      res.end();
    }
  }

  static async list(req: AuthRequest, res: Response): Promise<void> {
    try {
      const kits = await MemoryStore.getKitsForUser(req.userId!);
      res.status(200).json(kits);
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }

  static async get(req: AuthRequest, res: Response): Promise<void> {
    try {
      const kit = await MemoryStore.getKitById(req.params.id, req.userId!);
      if (!kit) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Interview prep kit not found.' });
        return;
      }
      res.status(200).json(kit);
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }

  static async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { kit } = req.body;
      if (!kit) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Kit payload is required.' });
        return;
      }

      const validated = KitSchema.parse(kit);
      const updated = await MemoryStore.updateKit(req.params.id, req.userId!, validated);
      if (!updated) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }

      res.status(200).json(updated);
    } catch (err: any) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: err.message });
    }
  }

  static async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const deleted = await MemoryStore.deleteKit(req.params.id, req.userId!);
      if (!deleted) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }
      res.status(200).json({ success: true, message: 'Kit deleted.' });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  }

  /**
   * SECTION 6: The Builder - Single Category Regeneration with Provenance Preservation.
   * User-edited, user-created, or pinned questions survive category regeneration.
   */
  static async regenerateCategory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { category } = req.body;
      if (!['technical', 'behavioural', 'system-design', 'company-fit'].includes(category)) {
        res.status(400).json({ error: 'INVALID_CATEGORY', message: 'Invalid category specified.' });
        return;
      }

      const record = await MemoryStore.getKitById(req.params.id, req.userId!);
      if (!record) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }

      const currentKit: Kit = record.kit;

      // 1. Separate questions: keep all other categories untouched
      const otherCategoryQuestions = currentKit.questions.filter(q => q.category !== category);
      const currentCategoryQuestions = currentKit.questions.filter(q => q.category === category);

      // 2. Identify questions to PRESERVE: user_edited, user_created, or isPinned
      const preservedQuestions = currentCategoryQuestions.filter(q => {
        const prov = q._provenance;
        if (!prov) return false;
        return prov.origin === 'user_edited' || prov.origin === 'user_created' || prov.isPinned === true;
      });

      // 3. Find relevant requirements for this category
      const targetReqs = currentKit.role.requirements.filter(r => {
        if (category === 'behavioural') return r.kind === 'behavioural';
        return r.kind === 'technical' || r.kind === 'domain';
      });

      // 4. Generate replacement questions via LLM
      const systemPrompt = `SYSTEM: REGENERATE_CATEGORY
Generate fresh, distinct ${category} interview questions for the following requirements.
Requirements:
${JSON.stringify(targetReqs, null, 2)}
Output JSON:
{
  "questions": [
    {
      "id": "q_new_1",
      "requirement_ids": ["${targetReqs[0]?.id || 'r1'}"],
      "category": "${category}",
      "prompt": string,
      "answer_outline": string,
      "difficulty": 1 | 2 | 3
    }
  ]
}`;

      const raw = await KitController.llm.generateJson<any>({
        systemPrompt,
        userPrompt: `Generate 2-3 fresh ${category} questions.`,
        expectJson: true,
      });

      const newGeneratedQuestions: Question[] = [];
      if (Array.isArray(raw.questions)) {
        let maxExistingId = 0;
        currentKit.questions.forEach(q => {
          const num = parseInt(q.id.replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > maxExistingId) maxExistingId = num;
        });

        raw.questions.forEach((q: any, idx: number) => {
          const qId = `q${maxExistingId + idx + 1}`;
          const safeReqs = Array.isArray(q.requirement_ids) && q.requirement_ids.length > 0
            ? q.requirement_ids
            : [targetReqs[0]?.id || 'r1'];

          newGeneratedQuestions.push(
            QuestionSchema.parse({
              id: qId,
              requirement_ids: safeReqs,
              category,
              prompt: String(q.prompt || 'Generated question').trim(),
              answer_outline: String(q.answer_outline || 'Generated answer outline').trim(),
              difficulty: [1, 2, 3].includes(Number(q.difficulty)) ? (Number(q.difficulty) as 1 | 2 | 3) : 2,
              _provenance: {
                origin: 'generated',
                isPinned: false,
              },
            })
          );
        });
      }

      // Combine preserved + newly generated questions
      const finalCategoryQuestions = [...preservedQuestions, ...newGeneratedQuestions];
      const allUpdatedQuestions = [...otherCategoryQuestions, ...finalCategoryQuestions];

      // Update kit questions
      currentKit.questions = allUpdatedQuestions;

      // Re-allocate schedule deterministically to keep question IDs aligned
      currentKit.schedule = buildSchedule(currentKit.role, allUpdatedQuestions, currentKit.schedule.days_available);

      const updatedRecord = await MemoryStore.updateKit(req.params.id, req.userId!, currentKit);
      res.status(200).json(updatedRecord);
    } catch (err: any) {
      res.status(500).json({ error: 'REGENERATION_FAILED', message: err.message });
    }
  }

  /**
   * SECTION 6: Regenerate Company Brief isolated from questions
   */
  static async regenerateBrief(req: AuthRequest, res: Response): Promise<void> {
    try {
      const record = await MemoryStore.getKitById(req.params.id, req.userId!);
      if (!record) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }

      const currentKit: Kit = record.kit;
      const systemPrompt = `SYSTEM: REGENERATE_BRIEF
Provide a refreshed, comprehensive company brief and business model breakdown for:
Company: ${currentKit.source.company}
URL: ${currentKit.source.company_url}
Output JSON:
{
  "summary": string,
  "what_they_do": string
}`;

      const raw = await KitController.llm.generateJson<any>({
        systemPrompt,
        userPrompt: 'Refine company brief with executive focus.',
        expectJson: true,
      });

      currentKit.company_brief.summary = String(raw.summary || currentKit.company_brief.summary);
      currentKit.company_brief.what_they_do = String(raw.what_they_do || currentKit.company_brief.what_they_do);

      const updated = await MemoryStore.updateKit(req.params.id, req.userId!, currentKit);
      res.status(200).json(updated);
    } catch (err: any) {
      res.status(500).json({ error: 'BRIEF_REGENERATION_FAILED', message: err.message });
    }
  }

  /**
   * SECTION 6 & 8: Regenerate Schedule with updated days count
   */
  static async regenerateSchedule(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { days } = req.body;
      const daysCount = parseInt(days, 10);
      if (isNaN(daysCount) || daysCount < 1 || daysCount > 60) {
        res.status(400).json({ error: 'INVALID_DAYS', message: 'Days must be an integer between 1 and 60.' });
        return;
      }

      const record = await MemoryStore.getKitById(req.params.id, req.userId!);
      if (!record) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Kit not found.' });
        return;
      }

      const currentKit: Kit = record.kit;
      currentKit.schedule = buildSchedule(currentKit.role, currentKit.questions, daysCount);

      const updated = await MemoryStore.updateKit(req.params.id, req.userId!, currentKit);
      res.status(200).json(updated);
    } catch (err: any) {
      res.status(500).json({ error: 'SCHEDULE_REGENERATION_FAILED', message: err.message });
    }
  }
}
