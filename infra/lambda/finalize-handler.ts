// Invoked by the Step Functions timer when a question's clock runs out.
import { Core } from './core.js';
import { DynamoStore } from './dynamo-store.js';
import { AwsTransport } from './aws-transport.js';

const core = new Core(new DynamoStore(process.env.TABLE_NAME!), new AwsTransport(process.env.WS_ENDPOINT!));

export const handler = async (event: { code: string; qIndex: number }) => {
  await core.finalize(event.code, Number(event.qIndex));
  return { ok: true };
};
