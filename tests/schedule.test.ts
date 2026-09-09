import { describe, it, expect } from 'vitest';
import { buildSchedule } from '../src/pipeline/step7_schedule.js';
import { Role, Question, ScheduleSchema } from '../src/types/schemas.js';

describe('Deterministic Schedule Allocator (Arithmetic in Code)', () => {
  const sampleRole: Role = {
    title: 'Senior Full Stack Engineer',
    seniority: 'Senior',
    responsibilities: ['Build scalable web applications', 'Lead code reviews'],
    requirements: [
      { id: 'r1', text: 'Proficiency in React and TypeScript', kind: 'technical', priority: 'must' },
      { id: 'r2', text: '5+ years Node.js backend architecture', kind: 'technical', priority: 'must' },
      { id: 'r3', text: 'Mentoring junior developers', kind: 'behavioural', priority: 'must' },
      { id: 'r4', text: 'Experience with Kubernetes', kind: 'technical', priority: 'nice' },
    ],
  };

  const sampleQuestions: Question[] = [
    {
      id: 'q1',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Explain React Concurrent Mode and hydration.',
      answer_outline: 'Discuss fiber tree, priority levels, and selective hydration.',
      difficulty: 3,
    },
    {
      id: 'q2',
      requirement_ids: ['r2'],
      category: 'system-design',
      prompt: 'Design a distributed rate-limiter in Node.js.',
      answer_outline: 'Token bucket, Redis cluster, sliding window counters.',
      difficulty: 3,
    },
    {
      id: 'q3',
      requirement_ids: ['r3'],
      category: 'behavioural',
      prompt: 'Tell me about a time you resolved conflict in a team.',
      answer_outline: 'STAR method: active listening, consensus, retrospective.',
      difficulty: 1,
    },
    {
      id: 'q4',
      requirement_ids: ['r4'],
      category: 'technical',
      prompt: 'How do Kubernetes readiness probes differ from liveness probes?',
      answer_outline: 'Traffic routing vs pod restart semantics.',
      difficulty: 2,
    },
  ];

  it('allocates exactly N days for standard durations (e.g. 5 days)', () => {
    const schedule = buildSchedule(sampleRole, sampleQuestions, 5);
    expect(schedule.days_available).toBe(5);
    expect(schedule.days.length).toBe(5);
    expect(ScheduleSchema.safeParse(schedule).success).toBe(true);
  });

  it('handles the 1-day crash course edge case with integer minutes', () => {
    const schedule = buildSchedule(sampleRole, sampleQuestions, 1);
    expect(schedule.days_available).toBe(1);
    expect(schedule.days.length).toBe(1);
    expect(Number.isInteger(schedule.days[0].minutes)).toBe(true);
    expect(schedule.days[0].minutes).toBeGreaterThan(0);
    expect(schedule.days[0].question_ids.length).toBeGreaterThanOrEqual(4);
  });

  it('handles the 60-day long prep timeline edge case', () => {
    const schedule = buildSchedule(sampleRole, sampleQuestions, 60);
    expect(schedule.days_available).toBe(60);
    expect(schedule.days.length).toBe(60);
    // Every single day has valid integer minutes and focus
    schedule.days.forEach(day => {
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes).toBeGreaterThanOrEqual(30);
      expect(day.focus.length).toBeGreaterThan(0);
      expect(day.question_ids.length).toBeGreaterThan(0);
    });
  });

  it('ensures every must-have requirement appears somewhere in the schedule', () => {
    const schedule = buildSchedule(sampleRole, sampleQuestions, 3);
    const scheduledQIds = new Set(schedule.days.flatMap(d => d.question_ids));

    const mustReqIds = sampleRole.requirements.filter(r => r.priority === 'must').map(r => r.id);
    for (const mustId of mustReqIds) {
      const coversMust = sampleQuestions.some(
        q => scheduledQIds.has(q.id) && q.requirement_ids.includes(mustId)
      );
      expect(coversMust).toBe(true);
    }
  });

  it('schedules harder and higher-priority material on earlier days', () => {
    const schedule = buildSchedule(sampleRole, sampleQuestions, 3);
    const day1QIds = schedule.days[0].question_ids;
    
    // Day 1 must contain difficulty 3 questions
    const day1Difficulties = day1QIds.map(id => sampleQuestions.find(q => q.id === id)?.difficulty);
    expect(day1Difficulties).toContain(3);
  });

  it('strictly uses integer minutes without floating decimals', () => {
    const schedule = buildSchedule(sampleRole, sampleQuestions, 4);
    schedule.days.forEach(day => {
      expect(Number.isInteger(day.minutes)).toBe(true);
      expect(day.minutes.toString()).not.toContain('.');
    });
  });
});
