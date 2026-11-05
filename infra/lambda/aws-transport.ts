import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { Transport } from './types.js';

export class AwsTransport implements Transport {
  private api: ApiGatewayManagementApiClient;
  private sfn = new SFNClient({});
  constructor(endpoint: string, private timerArn?: string) {
    this.api = new ApiGatewayManagementApiClient({ endpoint });
  }

  async send(connId: string, msg: object) {
    try {
      await this.api.send(new PostToConnectionCommand({ ConnectionId: connId, Data: Buffer.from(JSON.stringify(msg)) }));
      return true;
    } catch (err: any) {
      if (err instanceof GoneException || err?.$metadata?.httpStatusCode === 410) return false;
      console.error('postToConnection failed', connId, err?.name);
      return false;
    }
  }

  async scheduleFinalize(code: string, qIndex: number, fireAt: number) {
    if (!this.timerArn) return;
    await this.sfn.send(new StartExecutionCommand({
      stateMachineArn: this.timerArn,
      name: `${code}-q${qIndex}-${fireAt}`,
      input: JSON.stringify({ code, qIndex, fireAt: new Date(fireAt).toISOString() }),
    }));
  }
}
