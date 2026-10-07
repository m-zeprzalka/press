/**
 * Worker entry: plays the runs it is sent and appends one JSON line per run to its file.
 */
import { appendFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { playRun, runKey, type RunConfig } from './play';

interface JobsMsg {
  type: 'jobs';
  jobs: RunConfig[];
}
interface StopMsg {
  type: 'stop';
}

const port = parentPort;
if (!port) throw new Error('worker.ts must run in a worker thread');
const { file } = workerData as { file: string };

port.on('message', (m: JobsMsg | StopMsg) => {
  if (m.type === 'stop') {
    port.close();
    return;
  }
  for (const job of m.jobs) {
    try {
      const rec = playRun(job);
      appendFileSync(file, `${JSON.stringify(rec)}\n`);
      port.postMessage({
        type: 'done',
        key: rec.key,
        contractsWon: rec.contractsWon,
        won: rec.won,
        ms: rec.timing.totalMs,
      });
    } catch (e) {
      port.postMessage({
        type: 'error',
        key: runKey(job),
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      });
    }
  }
  port.postMessage({ type: 'idle' });
});
