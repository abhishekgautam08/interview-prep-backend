import { describe, it, expect } from 'vitest';
import { KitSchema, sanitizeKitToAppendixA, Kit } from '../src/types/schemas.js';

describe('Appendix A Strict Schema Conformance', () => {
  it('validates a complete, compliant kit object', () => {
    const validKit: Kit = {
      source: {
        company: 'Acme Corp',
        company_url: 'https://example.com',
        role: 'Senior Engineer',
        location: 'Remote',
        jd_chars: 450,
        researched_at: '2026-09-08T12:00:00Z',
        pages_used: ['https://example.com/about'],
      },
      company_brief: {
        summary: 'A fast-growing fintech company.',
        what_they_do: 'Payment processing APIs.',
        sources: ['https://example.com/about'],
      },
      role: {
        title: 'Senior Engineer',
        seniority: 'Senior',
        responsibilities: ['Scale payment ledger'],
        requirements: [
          { id: 'r1', text: '5+ years Node.js', kind: 'technical', priority: 'must' },
        ],
      },
      questions: [
        {
          id: 'q1',
          requirement_ids: ['r1'],
          category: 'technical',
          prompt: 'How do you handle idempotency keys in payment APIs?',
          answer_outline: 'Redis atomic lock + database transaction.',
          difficulty: 3,
        },
      ],
      flashcards: [
        {
          id: 'f1',
          front: 'What is an idempotency key?',
          back: 'A unique identifier passed by the client to prevent duplicate operations.',
          requirement_ids: ['r1'],
        },
      ],
      schedule: {
        days_available: 1,
        days: [
          {
            day: 1,
            focus: 'Payment systems and idempotency',
            question_ids: ['q1'],
            minutes: 60,
          },
        ],
      },
      coverage: {
        uncovered_requirement_ids: [],
        passes: 1,
      },
    };

    expect(KitSchema.safeParse(validKit).success).toBe(true);
    const sanitized = sanitizeKitToAppendixA(validKit);
    expect(KitSchema.safeParse(sanitized).success).toBe(true);
  });

  it('rejects floating minutes in schedule (Section 5 rule)', () => {
    const invalidSchedule: any = {
      source: {
        company: '', company_url: '', role: '', location: '', jd_chars: 0, researched_at: '', pages_used: [],
      },
      company_brief: { summary: '', what_they_do: '', sources: [] },
      role: { title: '', seniority: '', responsibilities: [], requirements: [] },
      questions: [],
      flashcards: [],
      schedule: {
        days_available: 1,
        days: [{ day: 1, focus: '', question_ids: [], minutes: 45.5 }], // float not allowed!
      },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    };

    expect(KitSchema.safeParse(invalidSchedule).success).toBe(false);
  });

  it('rejects invalid difficulty outside 1 to 3', () => {
    const invalidDifficulty: any = {
      source: { company: '', company_url: '', role: '', location: '', jd_chars: 0, researched_at: '', pages_used: [] },
      company_brief: { summary: '', what_they_do: '', sources: [] },
      role: { title: '', seniority: '', responsibilities: [], requirements: [] },
      questions: [{ id: 'q1', requirement_ids: [], category: 'technical', prompt: '', answer_outline: '', difficulty: 5 }],
      flashcards: [],
      schedule: { days_available: 1, days: [] },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
    };

    expect(KitSchema.safeParse(invalidDifficulty).success).toBe(false);
  });
});
