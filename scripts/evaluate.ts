import fs from 'fs/promises';
import path from 'path';
import { PipelineOrchestrator } from '../src/pipeline/orchestrator.js';
import { BatchInput, BatchInputSchema, BatchOutput, BatchKitEntry, BatchOutputSchema } from '../src/types/schemas.js';

interface CliArgs {
  input: string;
  output: string;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let input = '';
  let output = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      input = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }

  if (!input || !output) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(1);
  }

  return { input, output };
}

async function main() {
  const { input, output } = parseCliArgs();

  console.log(`[Evaluate] Reading test cases from: ${input}`);
  const inputPath = path.resolve(process.cwd(), input);
  const outputPath = path.resolve(process.cwd(), output);

  let rawData: string;
  try {
    rawData = await fs.readFile(inputPath, 'utf-8');
  } catch (err: any) {
    console.error(`[Evaluate] Failed to read input file ${inputPath}:`, err.message);
    process.exit(1);
  }

  let cases: BatchInput;
  try {
    const parsed = JSON.parse(rawData);
    cases = BatchInputSchema.parse(parsed);
  } catch (err: any) {
    console.error(`[Evaluate] Input file does not match expected Appendix B schema:`, err.message);
    process.exit(1);
  }

  console.log(`[Evaluate] Starting evaluation of ${cases.length} cases...`);
  const orchestrator = new PipelineOrchestrator();
  const kitEntries: BatchKitEntry[] = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    console.log(`\n-----------------------------------------------------------`);
    console.log(`[Evaluate] Processing case ${i + 1}/${cases.length}: ID="${testCase.id}"`);
    console.log(`[Evaluate] Target URL: ${testCase.company_url} | Days: ${testCase.days}`);

    try {
      const kit = await orchestrator.run(
        {
          jd: testCase.jd,
          company_url: testCase.company_url,
          days: testCase.days,
        },
        progress => {
          console.log(`   [${testCase.id}] [${progress.stage}] ${progress.message} (${progress.progressPercent}%)`);
        }
      );

      kitEntries.push({
        id: testCase.id,
        status: 'ok',
        kit: kit,
        error: null,
      });

      console.log(`[Evaluate] Case "${testCase.id}" completed successfully!`);
    } catch (err: any) {
      console.error(`[Evaluate] Case "${testCase.id}" failed:`, err.message);

      // Distinguish unreachable vs extraction fatal failures
      const isUnreachable =
        err.name === 'SSRFError' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND' ||
        err.message.includes('unreachable') ||
        err.message.includes('timeout');

      kitEntries.push({
        id: testCase.id,
        status: 'failed',
        kit: null,
        error: {
          code: isUnreachable ? 'COMPANY_UNREACHABLE' : 'GENERATION_FAILED',
          message: err.message || 'An unexpected error occurred during processing.',
        },
      });
    }
  }

  const batchOutput: BatchOutput = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    kits: kitEntries,
  };

  // Validate output adheres strictly to Appendix B schema
  const validatedOutput = BatchOutputSchema.parse(batchOutput);

  // Ensure output parent directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(validatedOutput, null, 2), 'utf-8');

  console.log(`\n===========================================================`);
  console.log(`[Evaluate] Evaluation completed!`);
  console.log(`[Evaluate] Results written to: ${outputPath}`);
  console.log(`[Evaluate] Summary: ${kitEntries.filter(k => k.status === 'ok').length} OK, ${kitEntries.filter(k => k.status === 'failed').length} Failed`);
}

main().catch(err => {
  console.error('[Evaluate] Fatal error in batch evaluation:', err);
  process.exit(1);
});
