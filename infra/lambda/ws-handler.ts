// API Gateway WebSocket entry point: $connect, $disconnect and $default.
import type { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Core } from './core.js';
import { DynamoStore } from './dynamo-store.js';
import { AwsTransport } from './aws-transport.js';

const core = new Core(
  new DynamoStore(process.env.TABLE_NAME!),
  new AwsTransport(process.env.WS_ENDPOINT!, process.env.TIMER_ARN),
  { hostPin: process.env.HOST_PIN || undefined },
);

export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
  const { routeKey, connectionId } = event.requestContext;
  switch (routeKey) {
    case '$connect':
      return { statusCode: 200 };
    case '$disconnect':
      await core.onDisconnect(connectionId);
      return { statusCode: 200 };
    default:
      await core.onMessage(connectionId, event.body ?? '');
      return { statusCode: 200 };
  }
};
