import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { PipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { BatchInput, BatchOutputSchema } from '../src/types/schemas.js';

describe('Batch Evaluation Path (Section 9 & Appendix B)', () => {
  it('runs the full pipeline on a batch case and produces valid Appendix B output', async () => {
    const orchestrator = new PipelineOrchestrator();
    const testCase = {
      id: 'test-case-batch-1',
      jd: 'Senior TypeScript Engineer. Must have 4+ years of React and Node.js. Experience mentoring junior devs.',
      company_url: 'https://example.com',
      days: 4,
    };

    const kit = await orchestrator.run({
      jd: testCase.jd,
      company_url: testCase.company_url,
      days: testCase.days,
    });

    expect(kit).toBeDefined();
    expect(kit.schedule.days_available).toBe(4);
    expect(kit.schedule.days.length).toBe(4);
    expect(kit.role.requirements.length).toBeGreaterThan(0);
    expect(kit.questions.length).toBeGreaterThan(0);

    const batchEntry = {
      id: testCase.id,
      status: 'ok' as const,
      kit,
      error: null,
    };

    const batchOutput = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      kits: [batchEntry],
    };

    const parsed = BatchOutputSchema.safeParse(batchOutput);
    expect(parsed.success).toBe(true);
  }, 30000);
});
