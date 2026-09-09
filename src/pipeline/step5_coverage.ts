import { Role, Question, Coverage } from '../types/schemas.js';

export interface CoverageResult {
  coveredRequirementIds: string[];
  uncoveredRequirementIds: string[];
  uncoveredMustHaves: string[];
  coveragePercent: number;
}

/**
 * Deterministic coverage checking module in pure code logic.
 * Computes set difference between role requirements and question coverage.
 * NEVER delegates to LLM.
 */
export function checkCoverage(role: Role, questions: Question[]): CoverageResult {
  const allReqs = role.requirements;
  const allReqIds = allReqs.map(r => r.id);

  // Set of all requirements covered by at least one question
  const coveredSet = new Set<string>();
  for (const q of questions) {
    for (const reqId of q.requirement_ids) {
      coveredSet.add(reqId);
    }
  }

  const coveredRequirementIds = allReqIds.filter(id => coveredSet.has(id));
  const uncoveredRequirementIds = allReqIds.filter(id => !coveredSet.has(id));

  // Find specifically any uncovered MUST-HAVE requirements
  const mustReqMap = new Map(allReqs.filter(r => r.priority === 'must').map(r => [r.id, r]));
  const uncoveredMustHaves = uncoveredRequirementIds.filter(id => mustReqMap.has(id));

  const total = allReqIds.length;
  const coveragePercent = total === 0 ? 100 : Math.round((coveredRequirementIds.length / total) * 100);

  return {
    coveredRequirementIds,
    uncoveredRequirementIds,
    uncoveredMustHaves,
    coveragePercent,
  };
}
