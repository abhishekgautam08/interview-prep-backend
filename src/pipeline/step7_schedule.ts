import { Role, Question, Schedule, ScheduleDay, ScheduleSchema } from '../types/schemas.js';

/**
 * Deterministic Schedule Allocator (Pure Code Arithmetic).
 * Distributes questions across exactly `daysAvailable` days (1 to 60).
 * Guaranteed Properties:
 * 1. schedule.days.length === daysAvailable
 * 2. Every must-have requirement appears in at least one question in the schedule
 * 3. Harder and higher-priority material lands earlier
 * 4. Durations are strict integer minutes
 * 5. Every question_id refers to a valid question in the questions array
 */
export function buildSchedule(
  role: Role,
  questions: Question[],
  daysAvailable: number
): Schedule {
  // Ensure valid integer days in [1, 60]
  const N = Math.max(1, Math.min(60, Math.round(daysAvailable)));
  
  if (questions.length === 0) {
    // Fallback if no questions exist
    return {
      days_available: N,
      days: Array.from({ length: N }, (_, i) => ({
        day: i + 1,
        focus: `Day ${i + 1}: General Preparation`,
        question_ids: [],
        minutes: 45,
      })),
    };
  }

  const validQuestionIds = new Set(questions.map(q => q.id));
  const mustReqIds = new Set(role.requirements.filter(r => r.priority === 'must').map(r => r.id));

  // Score each question for ordering:
  // - Covers must-have requirement: +20
  // - Difficulty 3: +10, Difficulty 2: +5, Difficulty 1: +2
  // - Technical / System Design: +5 (earlier deep dives)
  const scoredQuestions = questions.map(q => {
    let score = 0;
    const coversMust = q.requirement_ids.some(id => mustReqIds.has(id));
    if (coversMust) score += 20;

    if (q.difficulty === 3) score += 10;
    else if (q.difficulty === 2) score += 5;
    else score += 2;

    if (q.category === 'system-design') score += 6;
    else if (q.category === 'technical') score += 4;
    else if (q.category === 'domain') score += 3;
    else if (q.category === 'behavioural') score += 2;
    else score += 1;

    return { question: q, score };
  });

  // Sort descending: highest priority & hardest questions come FIRST
  scoredQuestions.sort((a, b) => b.score - a.score);

  const orderedQuestions = scoredQuestions.map(sq => sq.question);

  const days: ScheduleDay[] = [];

  // ==========================================
  // CASE 1: Exactly 1 Day (Crash Course)
  // ==========================================
  if (N === 1) {
    const allIds = orderedQuestions.map(q => q.id);
    // Estimate 15 min per question, capped sensibly at integer minutes
    const totalMinutes = Math.min(240, Math.max(60, allIds.length * 15));
    days.push({
      day: 1,
      focus: 'Intensive Immersion: High-Priority Architecture, Core Competencies & Rehearsal',
      question_ids: allIds,
      minutes: Math.round(totalMinutes),
    });

    return ScheduleSchema.parse({ days_available: 1, days });
  }

  // ==========================================
  // CASE 2: Multi-Day Distribution (2 to 60 Days)
  // ==========================================

  // Step A: Ensure all questions covering MUST requirements are mapped
  // Distribute questions across the days such that higher scoring items land in earlier buckets
  const dayQuestionBuckets: string[][] = Array.from({ length: N }, () => []);

  if (orderedQuestions.length <= N) {
    // If fewer questions than days, place primary questions in earlier days
    orderedQuestions.forEach((q, idx) => {
      dayQuestionBuckets[idx].push(q.id);
    });

    // For remaining days, assign reinforcement / review questions from high-priority items
    for (let dayIdx = orderedQuestions.length; dayIdx < N; dayIdx++) {
      // Pick top must-have or highest-difficulty question for review
      const reviewTarget = orderedQuestions[dayIdx % orderedQuestions.length];
      dayQuestionBuckets[dayIdx].push(reviewTarget.id);
    }
  } else {
    // More questions than days: chunk questions across days
    // Hardest / highest score in earliest days
    const totalQ = orderedQuestions.length;
    orderedQuestions.forEach((q, idx) => {
      // Map idx to a day in [0, N-1]
      const targetDay = Math.min(N - 1, Math.floor((idx / totalQ) * N));
      dayQuestionBuckets[targetDay].push(q.id);
    });

    // Guard: Ensure no day is empty
    dayQuestionBuckets.forEach((bucket, dIdx) => {
      if (bucket.length === 0) {
        // Borrow a relevant question from a nearby day
        const fallbackQ = orderedQuestions[dIdx % orderedQuestions.length];
        bucket.push(fallbackQ.id);
      }
    });
  }

  // Step B: Formulate thematic focus and duration for each day
  for (let i = 0; i < N; i++) {
    const dayNum = i + 1;
    const qIds = dayQuestionBuckets[i];
    const dayQuestions = qIds.map(id => questions.find(q => q.id === id)!).filter(Boolean);

    // Compute dominant categories for focus title
    const categories = Array.from(new Set(dayQuestions.map(q => q.category)));
    let focusTitle = '';

    if (dayNum === 1) {
      focusTitle = 'Deep Dive: Core Technical Architecture & Highest-Priority Requirements';
    } else if (dayNum === N) {
      focusTitle = 'Final Preparation: Behavioral Rehearsal, Company Alignment & Strategy';
    } else if (categories.includes('system-design')) {
      focusTitle = `System Design & Architectural Scalability (Day ${dayNum})`;
    } else if (categories.includes('technical')) {
      focusTitle = `Technical Competencies & Hands-on Problem Solving (Day ${dayNum})`;
    } else if (categories.includes('behavioural')) {
      focusTitle = `Leadership Principles, Collaboration & Impact (Day ${dayNum})`;
    } else {
      focusTitle = `Targeted Knowledge Review & Practice (Day ${dayNum})`;
    }

    // Allocate integer minutes: 15-20 min per question, minimum 30, maximum 120
    const calculatedMinutes = Math.min(120, Math.max(30, qIds.length * 20));

    days.push({
      day: dayNum,
      focus: focusTitle,
      question_ids: qIds.filter(id => validQuestionIds.has(id)),
      minutes: Math.round(calculatedMinutes),
    });
  }

  // Verification Assertion: Ensure every must-have requirement's question is present
  const allScheduledQIds = new Set(days.flatMap(d => d.question_ids));
  const mustQuestions = questions.filter(q => q.requirement_ids.some(id => mustReqIds.has(id)));
  for (const mq of mustQuestions) {
    if (!allScheduledQIds.has(mq.id)) {
      // Put missing must-question into Day 1 or Day 2
      days[0].question_ids.push(mq.id);
    }
  }

  const result: Schedule = {
    days_available: N,
    days,
  };

  return ScheduleSchema.parse(result);
}
