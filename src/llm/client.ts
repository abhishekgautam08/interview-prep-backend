import axios from 'axios';
import { config } from '../config/index.js';
import { RateLimiter } from './rateLimiter.js';

export interface LLMRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  expectJson?: boolean;
}

export class LLMClient {
  private rateLimiter: RateLimiter;
  private provider: 'gemini' | 'groq' | 'openai' | 'mock';

  constructor() {
    this.rateLimiter = new RateLimiter(config.maxRequestsPerMinute);
    this.provider = config.llmProvider;
  }

  async generate(options: LLMRequestOptions): Promise<string> {
    return this.rateLimiter.execute(async () => {
      switch (this.provider) {
        case 'gemini':
          return this.callGemini(options);
        case 'groq':
          return this.callGroq(options);
        case 'openai':
          return this.callOpenAI(options);
        case 'mock':
        default:
          return this.callMock(options);
      }
    });
  }

  async generateJson<T>(options: LLMRequestOptions): Promise<T> {
    const raw = await this.generate({ ...options, expectJson: true });
    return this.cleanAndParseJson<T>(raw);
  }

  private async callGemini(options: LLMRequestOptions): Promise<string> {
    if (!config.geminiApiKey) {
      console.warn('[LLMClient] No GEMINI_API_KEY provided. Falling back to mock provider.');
      return this.callMock(options);
    }

    const modelsToTry = [
      config.geminiModel || 'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
    ];

    let lastError: any = null;

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

        const payload: any = {
          system_instruction: {
            parts: [{ text: options.systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: options.userPrompt }],
            },
          ],
          generationConfig: {
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxTokens ?? 4096,
            responseMimeType: options.expectJson ? 'application/json' : 'text/plain',
            response_mime_type: options.expectJson ? 'application/json' : 'text/plain',
          },
        };

        const res = await axios.post(url, payload, {
          timeout: config.llmTimeoutMs,
          headers: { 'Content-Type': 'application/json' },
        });

        const candidate = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) {
          return candidate;
        }
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status;
        const errMsg = err.response?.data?.error?.message || err.message;
        console.warn(`[LLMClient] Model ${model} request failed (status: ${status}): ${errMsg}. Trying fallback model...`);
        // If not a rate limit / not found error, still try the next high-quota model in list
      }
    }

    throw lastError || new Error('All Gemini model candidates failed to respond.');
  }

  private async callGroq(options: LLMRequestOptions): Promise<string> {
    if (!config.groqApiKey) {
      console.warn('[LLMClient] No GROQ_API_KEY provided. Falling back to mock provider.');
      return this.callMock(options);
    }

    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const model = 'llama-3.3-70b-versatile';

    const payload: any = {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.expectJson) {
      payload.response_format = { type: 'json_object' };
    }

    const res = await axios.post(url, payload, {
      timeout: config.llmTimeoutMs,
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return res.data?.choices?.[0]?.message?.content || '';
  }

  private async callOpenAI(options: LLMRequestOptions): Promise<string> {
    if (!config.openaiApiKey) {
      console.warn('[LLMClient] No OPENAI_API_KEY provided. Falling back to mock provider.');
      return this.callMock(options);
    }

    const url = 'https://api.openai.com/v1/chat/completions';
    const payload: any = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      temperature: options.temperature ?? 0.2,
    };

    if (options.expectJson) {
      payload.response_format = { type: 'json_object' };
    }

    const res = await axios.post(url, payload, {
      timeout: config.llmTimeoutMs,
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return res.data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Deterministic mock generator used for offline development and instant testing.
   * Accurately parses the input context to deliver valid Appendix A compliant objects.
   */
  private async callMock(options: LLMRequestOptions): Promise<string> {
    const prompt = options.userPrompt;
    
    // Simulate brief processing time
    await new Promise(r => setTimeout(r, 50));

    // 1. STEP 1: EXTRACTION MOCK
    if (options.systemPrompt.includes('EXTRACT_REQUIREMENTS')) {
      const cleanPrompt = prompt.replace(/<\/?untrusted_jd>/gi, '').trim();
      const lines = cleanPrompt.split('\n').map(l => l.trim()).filter(Boolean);
      const firstLine = lines[0] || 'Software Engineer';
      
      // Look for keywords in prompt
      const isReact = prompt.toLowerCase().includes('react');
      const isPython = prompt.toLowerCase().includes('python');
      const isNode = prompt.toLowerCase().includes('node') || prompt.toLowerCase().includes('backend');
      const isAws = prompt.toLowerCase().includes('aws') || prompt.toLowerCase().includes('cloud');
      const isMentor = prompt.toLowerCase().includes('mentor') || prompt.toLowerCase().includes('lead');

      const requirements: any[] = [];
      let reqCount = 1;

      if (isReact) {
        requirements.push({
          id: `r${reqCount++}`,
          text: 'Proficiency with React and modern frontend architecture',
          kind: 'technical',
          priority: 'must',
        });
      }
      if (isNode || (!isReact && !isPython)) {
        requirements.push({
          id: `r${reqCount++}`,
          text: 'Experience building scalable Node.js and distributed backend services',
          kind: 'technical',
          priority: 'must',
        });
      }
      if (isPython) {
        requirements.push({
          id: `r${reqCount++}`,
          text: 'Strong Python programming and data modeling skills',
          kind: 'technical',
          priority: 'must',
        });
      }
      if (isAws) {
        requirements.push({
          id: `r${reqCount++}`,
          text: 'Experience with cloud infrastructure (AWS/GCP, Docker, Kubernetes)',
          kind: 'technical',
          priority: 'nice',
        });
      }
      if (isMentor) {
        requirements.push({
          id: `r${reqCount++}`,
          text: 'Mentoring junior engineers and cross-functional team leadership',
          kind: 'behavioural',
          priority: 'must',
        });
      }

      // If very thin stub (less than 2 requirements extracted)
      if (requirements.length === 0) {
        requirements.push({
          id: 'r1',
          text: lines[1] || 'Core engineering skills as stated in the posting',
          kind: 'technical',
          priority: 'must',
        });
      }

      return JSON.stringify({
        title: firstLine.slice(0, 50),
        seniority: firstLine.toLowerCase().includes('senior') ? 'Senior' : 'Mid-Level',
        responsibilities: [
          'Design and implement high-throughput distributed systems',
          'Collaborate closely with product managers and cross-functional stakeholders',
          'Ensure code quality through rigorous automated testing and peer code reviews',
        ],
        requirements,
      });
    }

    // 2. STEP 2: COMPANY BRIEF MOCK
    if (options.systemPrompt.includes('GENERATE_BRIEF')) {
      const isLocalhost = prompt.includes('localhost') || prompt.includes('127.0.0.1');
      return JSON.stringify({
        summary: isLocalhost
          ? 'An internal test organization with engineering focus on distributed services.'
          : 'A modern technology company building high-impact software solutions.',
        what_they_do:
          'They develop mission-critical developer tools, cloud infrastructure, and enterprise workflows.',
      });
    }

    // 3. STEP 3: QUESTIONS & FLASHCARDS MOCK
    if (options.systemPrompt.includes('GENERATE_QUESTIONS')) {
      // Parse requirements from prompt
      let reqIds = ['r1'];
      const matches = prompt.match(/r\d+/g);
      if (matches && matches.length > 0) {
        reqIds = Array.from(new Set(matches));
      }

      const questions = reqIds.map((rid, idx) => ({
        id: `q${idx + 1}`,
        requirement_ids: [rid],
        category: idx % 2 === 0 ? 'technical' : 'behavioural',
        prompt: `Can you discuss your real-world experience and trade-offs regarding requirement ${rid}?`,
        answer_outline: `Demonstrate deep conceptual mastery, explain architecture trade-offs, and reference a concrete production scenario where you solved this problem.`,
        difficulty: (idx % 3 + 1) as 1 | 2 | 3,
      }));

      const flashcards = reqIds.map((rid, idx) => ({
        id: `f${idx + 1}`,
        front: `Key concepts and core principles for ${rid}`,
        back: `Core architectural patterns, common pitfalls to avoid, and performance benchmarks.`,
        requirement_ids: [rid],
      }));

      return JSON.stringify({ questions, flashcards });
    }

    // 4. STEP 4: SECOND PASS GAP GENERATION
    if (options.systemPrompt.includes('GENERATE_GAP_QUESTIONS')) {
      const matches = prompt.match(/r\d+/g) || ['r1'];
      const gapIds = Array.from(new Set(matches));

      const questions = gapIds.map((rid, idx) => ({
        id: `q_gap_${idx + 1}`,
        requirement_ids: [rid],
        category: 'technical',
        prompt: `Deep dive: How do you address the specific requirements of ${rid} in high-stakes environments?`,
        answer_outline: `Highlight key patterns, edge case handling, and automated testing strategies.`,
        difficulty: 3 as 1 | 2 | 3,
      }));

      const flashcards = gapIds.map((rid, idx) => ({
        id: `f_gap_${idx + 1}`,
        front: `Essential check for ${rid}`,
        back: `Critical considerations and implementation checklist.`,
        requirement_ids: [rid],
      }));

      return JSON.stringify({ questions, flashcards });
    }

    // Default generic json
    return JSON.stringify({});
  }

  private cleanAndParseJson<T>(raw: string): T {
    let text = raw.trim();
    // Strip markdown fences
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // If text has JSON surrounded by comments or extra text, find outer braces
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      text = text.slice(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(text) as T;
    } catch (err: any) {
      console.error('[LLMClient] Failed to parse JSON from response:\n', raw);
      throw new Error(`LLM returned invalid JSON: ${err.message}`);
    }
  }
}
