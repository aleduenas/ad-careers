import { createApp } from '../../src/server/app.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from '../../src/server/readiness.mjs';

const host = '127.0.0.1:4310';
const origin = `http://${host}`;
const mode = process.env.CAREER_OPS_FIXTURE_MODE;
if (!['ready', 'db-down', 'schema-not-ready', 'delayed'].includes(mode)) {
  throw new Error('Set CAREER_OPS_FIXTURE_MODE to an explicit synthetic mode.');
}
const readiness = async () => {
  if (mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 1800));
  if (mode === 'db-down') throw new DatabaseUnavailableError();
  if (mode === 'schema-not-ready') throw new SchemaNotReadyError();
};
const app = createApp({
  host,
  origin,
  development: true,
  readiness,
  nonce: 'synthetic-session-nonce',
});
try {
  await app.listen({ host: '127.0.0.1', port: 4310 });
  process.stdout.write(`Synthetic API fixture listening at ${origin} (${mode}).\n`);
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write('Port 4310 is occupied; no existing process was stopped.\n');
    process.exitCode = 2;
  } else throw error;
}
const stop = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
