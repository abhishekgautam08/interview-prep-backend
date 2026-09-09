import { describe, it, expect } from 'vitest';
import { checkCoverage } from '../src/pipeline/step5_coverage.js';
import { runCoveragePassLoop } from '../src/pipeline/step6_second_pass.js';
import { LLMClient } from '../src/llm/client.js';
import { Role, Question, Flashcard } from '../src/types/schemas.js';

describe('Deterministic Coverage Checker & Second-Pass Loop', () => {
  const sampleRole: Role = {
    title: 'Senior Backend Engineer',
    seniority: 'Senior',
    responsibilities: ['Architect microservices'],
    requirements: [
      { id: 'r1', text: 'Node.js and TypeScript', kind: 'technical', priority: 'must' },
      { id: 'r2', text: 'Distributed caching with Redis', kind: 'technical', priority: 'must' },
      { id: 'r3', text: 'Mentoring and technical leadership', kind: 'behavioural', priority: 'must' },
      { id: 'r4', text: 'Kubernetes orchestration', kind: 'technical', priority: 'nice' },
    ],
  };

  it('correctly identifies covered and uncovered requirements without LLM hallucination', () => {
    // Only r1 is covered
    const partialQuestions: Question[] = [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Explain Node.js event loop.',
        answer_outline: 'Phases of libuv event loop.',
        difficulty: 2,
      },
    ];

    const result = checkCoverage(sampleRole, partialQuestions);
    expect(result.coveredRequirementIds).toEqual(['r1']);
    expect(result.uncoveredRequirementIds).toEqual(['r2', 'r3', 'r4']);
    expect(result.uncoveredMustHaves).toEqual(['r2', 'r3']);
    expect(result.coveragePercent).toBe(25);
  });

  it('confirms 100% coverage when all requirements are mapped', () => {
    const fullQuestions: Question[] = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: '', answer_outline: '', difficulty: 2 },
      { id: 'q2', requirement_ids: ['r2', 'r4'], category: 'technical', prompt: '', answer_outline: '', difficulty: 3 },
      { id: 'q3', requirement_ids: ['r3'], category: 'behavioural', prompt: '', answer_outline: '', difficulty: 1 },
    ];

    const result = checkCoverage(sampleRole, fullQuestions);
    expect(result.uncoveredRequirementIds.length).toBe(0);
    expect(result.uncoveredMustHaves.length).toBe(0);
    expect(result.coveragePercent).toBe(100);
  });

  it('runs the second pass loop to close coverage gaps for uncovered must-haves', async () => {
    const mockLlm = new LLMClient();
    const initialQuestions: Question[] = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Node', answer_outline: 'Loop', difficulty: 2 },
    ];
    const initialFlashcards: Flashcard[] = [
      { id: 'f1', front: 'Front', back: 'Back', requirement_ids: ['r1'] },
    ];

    const loopResult = await runCoveragePassLoop(
      sampleRole,
      initialQuestions,
      initialFlashcards,
      mockLlm,
      3
    );

    expect(loopResult.passes).toBeGreaterThan(1);
    expect(loopResult.questions.length).toBeGreaterThan(initialQuestions.length);

    // Deterministic check on resulting questions
    const finalCoverage = checkCoverage(sampleRole, loopResult.questions);
    expect(finalCoverage.uncoveredMustHaves.length).toBe(0);
  });
});
