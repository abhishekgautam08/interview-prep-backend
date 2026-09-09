import { SafeCrawler } from '../crawler/crawler.js';
import { LLMClient } from '../llm/client.js';
import { Kit, KitSchema, sanitizeKitToAppendixA } from '../types/schemas.js';
import { extractRequirements } from './step1_extract.js';
import { crawlAndSummarizeCompany } from './step2_crawl.js';
import { retrieveInterviewSignals } from './step3_signals.js';
import { generateQuestionsAndFlashcards } from './step4_questions.js';
import { checkCoverage } from './step5_coverage.js';
import { runCoveragePassLoop } from './step6_second_pass.js';
import { buildSchedule } from './step7_schedule.js';

export interface PipelineInput {
  jd: string;
  company_url: string;
  days: number;
}

export type PipelineStage =
  | 'crawling'
  | 'extracting'
  | 'signals'
  | 'generating_questions'
  | 'checking_coverage'
  | 'second_pass'
  | 'scheduling'
  | 'completed'
  | 'error';

export interface PipelineProgressEvent {
  stage: PipelineStage;
  message: string;
  progressPercent: number;
}

export class PipelineOrchestrator {
  private crawler: SafeCrawler;
  private llm: LLMClient;

  constructor(crawler?: SafeCrawler, llm?: LLMClient) {
    this.crawler = crawler || new SafeCrawler();
    this.llm = llm || new LLMClient();
  }

  /**
   * Executes the full retrieval, generation, and validation pipeline.
   * Shared identically between the Express API server and the batch evaluate CLI.
   */
  async run(
    input: PipelineInput,
    onProgress?: (event: PipelineProgressEvent) => void
  ): Promise<Kit> {
    const notify = (stage: PipelineStage, message: string, progressPercent: number) => {
      if (onProgress) {
        onProgress({ stage, message, progressPercent });
      }
    };

    const researchedAt = new Date().toISOString();
    const daysAvailable = Math.max(1, Math.min(60, Math.round(input.days || 5)));
    const cleanJd = input.jd.trim();

    // -------------------------------------------------------------
    // STEP 1: Crawl company website (safe, relative links, link ranking)
    // -------------------------------------------------------------
    notify('crawling', 'Crawling company website and discovering hiring signals...', 15);
    const { companyBrief, pagesUsed, hiringProcessNotes } = await crawlAndSummarizeCompany(
      input.company_url,
      this.crawler,
      this.llm
    );

    // -------------------------------------------------------------
    // STEP 2: Extract requirements from Job Description
    // -------------------------------------------------------------
    notify('extracting', 'Extracting technical and behavioural requirements from JD...', 30);
    const role = await extractRequirements(cleanJd, this.llm);

    // -------------------------------------------------------------
    // STEP 3: Retrieve public interview discussion signals
    // -------------------------------------------------------------
    notify('signals', 'Analyzing public interview discussions and evaluation criteria...', 45);
    const signals = await retrieveInterviewSignals(
      role.title || 'Target Company',
      hiringProcessNotes,
      this.llm
    );

    // -------------------------------------------------------------
    // STEP 4: Generate initial categorized questions and flashcards
    // -------------------------------------------------------------
    notify('generating_questions', 'Generating tailored interview question bank and flashcards...', 60);
    const { questions: initialQuestions, flashcards: initialFlashcards } =
      await generateQuestionsAndFlashcards(role, signals, this.llm);

    // -------------------------------------------------------------
    // STEP 5 & 6: Deterministic Coverage Check & Second Pass Loop
    // -------------------------------------------------------------
    notify('checking_coverage', 'Deterministically checking requirement coverage gaps...', 75);
    const initialCoverage = checkCoverage(role, initialQuestions);

    let finalQuestions = initialQuestions;
    let finalFlashcards = initialFlashcards;
    let passes = 1;
    let uncoveredIds = initialCoverage.uncoveredRequirementIds;

    if (initialCoverage.uncoveredRequirementIds.length > 0) {
      notify('second_pass', 'Executing second-pass generation loop for uncovered requirements...', 85);
      const secondPassResult = await runCoveragePassLoop(
        role,
        initialQuestions,
        initialFlashcards,
        this.llm,
        3 // Max 3 passes
      );
      finalQuestions = secondPassResult.questions;
      finalFlashcards = secondPassResult.flashcards;
      passes = secondPassResult.passes;
      uncoveredIds = secondPassResult.uncoveredIds;
    }

    // -------------------------------------------------------------
    // STEP 7: Deterministic Arithmetic Schedule Allocation
    // -------------------------------------------------------------
    notify('scheduling', `Building deterministic day-by-day study schedule (${daysAvailable} days)...`, 95);
    const schedule = buildSchedule(role, finalQuestions, daysAvailable);

    // Extract company name heuristically from url if not explicitly set
    let inferredCompany = 'Target Company';
    try {
      const u = new URL(input.company_url);
      const parts = u.hostname.replace(/^www\./, '').split('.');
      if (parts[0]) inferredCompany = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    } catch {
      // ignore
    }

    const kit: Kit = {
      source: {
        company: inferredCompany,
        company_url: input.company_url,
        role: role.title || 'Software Engineer',
        location: 'Remote / Hybrid',
        jd_chars: cleanJd.length,
        researched_at: researchedAt,
        pages_used: pagesUsed,
      },
      company_brief: companyBrief,
      role: role,
      questions: finalQuestions,
      flashcards: finalFlashcards,
      schedule: schedule,
      coverage: {
        uncovered_requirement_ids: uncoveredIds,
        passes: passes,
      },
    };

    // Strict validation against Appendix A schema
    const validated = KitSchema.parse(kit);
    notify('completed', 'Interview prep kit generation complete!', 100);

    return sanitizeKitToAppendixA(validated);
  }
}
