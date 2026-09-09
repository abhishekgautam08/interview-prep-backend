# The AI Interview Prep Kit — Backend Service & Batch Pipeline

> **Assessment ID:** `FS-AI-INTERVIEW-01` | **Client:** Trao Full-Stack Engineering Assessment  
> **Repository:** `interview-prep-backend` (Standalone Backend Service & Pipeline)

A resilient, multi-step engineering pipeline and Express REST/SSE API that turns an untrusted job description and company URL into a tailored, day-by-day interview preparation kit.

---

## 1. Quick Start & Batch Entry Point (Mandatory)

### Prerequisites
- **Node.js**: v20.x or higher (tested on Node v24)
- **npm**: v10.x or higher

### Installation (Clean Clone)
```bash
git clone <repository-url>
cd interview-prep-backend
npm install
```

### Running the Mandatory Batch Evaluation (Section 9)
```bash
npm run evaluate -- --input test-cases.json --output test-output.json
```
- Reads an array of cases matching the Appendix B format.
- Runs the exact same retrieval, extraction, generation, and validation pipeline used by the web service.
- Handles edge cases (unreachable sites, 2-line stubs, 1-day/60-day schedules) gracefully without aborting the run.
- Writes valid **Appendix B** JSON to the specified `--output` destination.

### Running Automated Tests
```bash
npm test
```
Runs 17 automated tests covering:
- Deterministic Schedule Allocation (1 to 60 days, must-haves early, integer minutes)
- Deterministic Coverage Checking & Second-Pass loop
- Strict Appendix A and B schema validations (Zod)
- SSRF Guard and URL verification
- Batch evaluation end-to-end integration

### Running the Development Server
```bash
npm run dev
```
Starts the Express API server on `http://localhost:5000`.

---

## 2. Tech Stack & Justifications

| Component | Technology | Justification |
| :--- | :--- | :--- |
| **Runtime & Framework** | Node.js + Express + TypeScript | Strict adherence to the preferred stack. Type safety, fast startup, modular routing. |
| **Database** | MongoDB / Mongoose (with In-Memory Fallback) | Preferred stack database. Includes a resilient in-memory fallback allowing clean-clone evaluation even without an active MongoDB daemon. |
| **HTML Parsing & Crawling** | Cheerio + Axios + robots-parser | Lightweight, fast, respects robots.txt, dynamic relative link resolution for local/remote servers. |
| **Schema Validation** | Zod | Runtime guarantee that generated kits match Appendix A and B field-for-field. |
| **LLM Provider** | Multi-Provider Adapter (Gemini, Groq, OpenAI, Mock) | **Primary Free Tier:** Google Gemini (`gemini-3.5-flash-lite` with 500 RPD, 15 RPM, and automatic failover to `gemini-3.1-flash-lite`). Also supports Groq (`llama-3.3-70b-versatile`), OpenAI, or deterministic `mock` mode for instant test runs without external API keys. |

---

## 3. High-Level Architecture & Deliberate Sequencing

```
+-------------------------------------------------------------------------------+
|                           Client Request / Batch Input                        |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 1: Web Crawl & Link Ranker (SafeCrawler + SSRFGuard)                     |
| - SSRF inspection (rejects private IPs in prod; permits localhost in dev/test)|
| - Robots.txt compliance & 2MB max payload limits                              |
| - Discovers & heuristically ranks candidate hiring/about/culture links        |
| - Cleans HTML, extracts what they do & how they hire                          |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 2: Requirement Extraction from Job Description (step1_extract.ts)        |
| - Analyzes untrusted text bounded by <untrusted_jd> delimiters                |
| - Extracts title, seniority, responsibilities, and requirements (r1, r2...)   |
| - Categorizes kind ('technical'|'behavioural'|'domain') & priority ('must'|'nice')|
| - Handles 2-line stubs honestly without fabricating missing requirements      |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 3: Public Discussion & Interview Signals (step3_signals.ts)              |
| - Analyzes hiring process stages (recruiter screen, system design, etc.)     |
| - Records absence of public signals honestly rather than inventing rounds     |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 4: Categorised Question & Flashcard Generation (step4_questions.ts)      |
| - Generates questions for each requirement across distinct categories         |
| - Every question maps to requirement_ids, has difficulty 1-3, and outline     |
| - Generates flashcards for rapid spaced-repetition practice                   |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 5: Deterministic Coverage Checking (step5_coverage.ts - Pure Code)       |
| - Computes set difference: uncovered = { r.id not in any question.req_ids }   |
| - Zero LLM hallucination: decision to re-run is 100% code logic               |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 6: Second-Pass Gap Resolution Loop (step6_second_pass.ts)                |
| - If uncovered requirements exist, dispatches targeted prompt for missing IDs |
| - Re-runs deterministic coverage check (up to max 3 passes)                   |
| - Guarantees all must-have requirements are represented in questions          |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| STEP 7: Deterministic Schedule Allocation (step7_schedule.ts - Pure Code)     |
| - Distributes material across exactly N days requested (N in [1, 60])         |
| - Higher difficulty (3 & 2) and must-have items scheduled earlier             |
| - Strictly integer minutes per day (no floats, no 'about an hour')            |
| - Every must-have requirement represented in the schedule                     |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
| Verified Appendix A Kit Output (Database Saved / JSON Emitted)                |
+-------------------------------------------------------------------------------+
```

---

## 4. The Hardest State Problem: Builder State & Regeneration Isolation

When a user edits an answer outline, reorders categories, or writes a custom question, a subsequent click on **"Regenerate Technical Questions"** must not destroy their work.

### Solution: Provenance Metadata & Partitioned Merging
1. **Provenance Tracking**:
   Each question and flashcard maintains internal metadata:
   ```typescript
   _provenance: {
     origin: 'generated' | 'user_created' | 'user_edited',
     isPinned: boolean,
     modifiedAt?: string
   }
   ```
2. **Category Regeneration Endpoint (`POST /api/kits/:id/regenerate-category`)**:
   - Isolates the target category (e.g. `technical`). Leaves all other categories untouched.
   - Preserves all items where `origin === 'user_edited'`, `origin === 'user_created'`, or `isPinned === true`.
   - Replaces only unpinned, unedited `generated` questions.
   - Deterministically re-syncs the schedule so references remain valid.
3. **Appendix A Conformance**:
   - Internal `_provenance` keys are used by the frontend and database, but cleanly stripped by `sanitizeKitToAppendixA()` when exporting or validating against Appendix A.

---

## 5. Free-Tier Rate Limiting & Resilience

Free-tier providers enforce strict limits on both Requests Per Minute (RPM) and Tokens Per Minute (TPM). We safeguard against 429 failures using:
1. **Token Bucket & Request Queue (`RateLimiter`)**:
   - Caps outgoing requests to an interval (default 15 req/min).
2. **Exponential Backoff with Random Jitter**:
   - On encountering HTTP 429, quota exhaustion, or temporary network resets, waits $(2^{\text{attempt}} \times 1500\text{ms}) + \text{jitter}$ before retrying (up to 5 retries).
3. **Payload Truncation**:
   - Scraped pages are cleaned of CSS/JS/nav clutter and bounded to 8,000 characters to prevent TPM spikes.

---

## 6. Security & SSRF Protection (Section 11)

- **Safe Fetcher (`ssrfGuard.ts`)**:
  - Resolves target hostnames via DNS and parses IP ranges using `ipaddr.js`.
  - In `production`, rejects all private, loopback, link-local, carrier-grade NAT, and broadcast ranges.
  - In `development` / `test`, explicitly permits `localhost` and `127.0.0.1` so test cases like `http://localhost:8099/acme/` function properly.
  - Enforces a 2MB maximum payload size and 5–8 second network timeouts.
- **Prompt Injection Defense**:
  - Raw scraped HTML text and user-pasted job descriptions are wrapped inside `<untrusted_document>` and `<untrusted_jd>` tags.
  - System prompts instruct the model to treat the content strictly as data to process, never instructions to execute.

---

## 7. Creative Feature: AI Mock Interviewer & Diagnostic Feedback

In addition to flashcard practice, the backend includes an **AI Mock Interview Simulator**:
- **Endpoint**: `POST /api/kits/:id/practice/mock-evaluate`
- Evaluates a candidate's answer against the question's `prompt` and `answer_outline`.
- Returns a structured rubric: Score (1-5), Strengths, Missed Architectural Considerations, and an Actionable Improvement Tip.
- Automatically updates the candidate's confidence level on the corresponding flashcard.

---

## 8. Environment Variables (`.env.example`)

```ini
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000

MONGODB_URI=mongodb://localhost:27017/interview_prep
JWT_SECRET=super_secret_jwt_key_interview_prep_kit_2026

# LLM Provider: 'gemini' | 'groq' | 'openai' | 'mock'
LLM_PROVIDER=mock
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
GROQ_API_KEY=
OPENAI_API_KEY=

MAX_REQUESTS_PER_MINUTE=15
LLM_TIMEOUT_MS=45000
CRAWLER_TIMEOUT_MS=8000
```
