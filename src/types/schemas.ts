import { z } from 'zod';

// ==========================================
// APPENDIX A: KIT STRUCTURE SCHEMA
// ==========================================

export const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice']),
});

export const QuestionSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  // Optional internal provenance metadata for builder state preservation (stripped during validation)
  _provenance: z
    .object({
      origin: z.enum(['generated', 'user_created', 'user_edited']),
      isPinned: z.boolean().default(false),
      modifiedAt: z.string().optional(),
    })
    .optional(),
});

export const FlashcardSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  // Optional internal provenance / practice metadata
  _provenance: z
    .object({
      origin: z.enum(['generated', 'user_created', 'user_edited']),
      confidence: z.number().min(0).max(5).default(0),
      lastReviewedAt: z.string().optional(),
    })
    .optional(),
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().positive(),
});

export const ScheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(ScheduleDaySchema),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().nonnegative(),
});

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
});

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
});

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});

export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
});

// Strips internal _provenance keys before exporting / validating against exact Appendix A specification
export function sanitizeKitToAppendixA(kit: z.infer<typeof KitSchema>): z.infer<typeof KitSchema> {
  return {
    source: { ...kit.source },
    company_brief: { ...kit.company_brief },
    role: {
      title: kit.role.title,
      seniority: kit.role.seniority,
      responsibilities: [...kit.role.responsibilities],
      requirements: kit.role.requirements.map(r => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        priority: r.priority,
      })),
    },
    questions: kit.questions.map(q => ({
      id: q.id,
      requirement_ids: [...q.requirement_ids],
      category: q.category,
      prompt: q.prompt,
      answer_outline: q.answer_outline,
      difficulty: q.difficulty,
    })),
    flashcards: kit.flashcards.map(f => ({
      id: f.id,
      front: f.front,
      back: f.back,
      requirement_ids: [...f.requirement_ids],
    })),
    schedule: {
      days_available: kit.schedule.days_available,
      days: kit.schedule.days.map(d => ({
        day: d.day,
        focus: d.focus,
        question_ids: [...d.question_ids],
        minutes: Math.round(d.minutes),
      })),
    },
    coverage: {
      uncovered_requirement_ids: [...kit.coverage.uncovered_requirement_ids],
      passes: kit.coverage.passes,
    },
  };
}

// ==========================================
// APPENDIX B: BATCH INPUT AND OUTPUT SCHEMAS
// ==========================================

export const BatchInputCaseSchema = z.object({
  id: z.string(),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().positive(),
});

export const BatchInputSchema = z.array(BatchInputCaseSchema);

export const BatchKitEntryErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const BatchKitEntrySchema = z.object({
  id: z.string(),
  status: z.enum(['ok', 'failed']),
  kit: KitSchema.nullable(),
  error: BatchKitEntryErrorSchema.nullable(),
});

export const BatchOutputSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  kits: z.array(BatchKitEntrySchema),
});

export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Kit = z.infer<typeof KitSchema>;

export type BatchInputCase = z.infer<typeof BatchInputCaseSchema>;
export type BatchInput = z.infer<typeof BatchInputSchema>;
export type BatchKitEntry = z.infer<typeof BatchKitEntrySchema>;
export type BatchOutput = z.infer<typeof BatchOutputSchema>;
