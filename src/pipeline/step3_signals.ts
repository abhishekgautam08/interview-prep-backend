import { LLMClient } from '../llm/client.js';

export interface InterviewSignals {
  processOverview: string;
  interviewStages: string[];
  roundsFocus: string;
  sourcesFound: string[];
}

export async function retrieveInterviewSignals(
  companyName: string,
  hiringProcessNotes: string,
  llm: LLMClient
): Promise<InterviewSignals> {
  const systemPrompt = `SYSTEM: RETRIEVE_INTERVIEW_SIGNALS
You analyze public interview intelligence for companies.
Based on the company name and any crawled hiring notes, outline the expected interview stages and rounds focus (e.g. screening, take-home challenge, live coding, system design, leadership principles).
If public discussion turns up nothing or company is generic/local, report standard industry-aligned patterns honestly.
Output JSON:
{
  "processOverview": string,
  "interviewStages": string[],
  "roundsFocus": string,
  "sourcesFound": string[]
}`;

  const userPrompt = `Company: ${companyName}
Internal Crawl Hiring Notes: ${hiringProcessNotes}`;

  try {
    const raw = await llm.generateJson<any>({
      systemPrompt,
      userPrompt,
      expectJson: true,
    });

    return {
      processOverview: String(raw.processOverview || 'Recruiter Screen, Technical Assessment, and Onsite Rounds'),
      interviewStages: Array.isArray(raw.interviewStages)
        ? raw.interviewStages.map(String)
        : ['Initial Recruiter Call', 'Technical Deep-Dive', 'System Architecture', 'Cultural Alignment'],
      roundsFocus: String(raw.roundsFocus || 'Practical problem-solving, architectural scalability, and team collaboration.'),
      sourcesFound: Array.isArray(raw.sourcesFound) ? raw.sourcesFound.map(String) : [],
    };
  } catch {
    return {
      processOverview: 'Standard technical interview process',
      interviewStages: ['Recruiter Screen', 'Technical Interview', 'Behavioral / Final'],
      roundsFocus: 'Core engineering competencies and behavioral fit',
      sourcesFound: [],
    };
  }
}
