import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Store, Room, Player, Conn, Phase } from './types.js';

const TTL_SECONDS = 24 * 60 * 60;
const ttl = () => Math.floor(Date.now() / 1000) + TTL_SECONDS;

export class DynamoStore implements Store {
  private doc: DynamoDBDocumentClient;
  constructor(private table: string, client = new DynamoDBClient({})) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async getRoom(code: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `ROOM#${code}`, SK: 'META' } }));
    return r.Item ? strip<Room>(r.Item) : null;
  }
  async putRoom(room: Room) {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: `ROOM#${room.code}`, SK: 'META', ttl: ttl(), ...room } }));
  }
  async updateRoom(code: string, patch: Partial<Room>, expect?: { phase: Phase; qIndex: number }) {
    const { names, values, sets } = buildSet(patch);
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.table,
        Key: { PK: `ROOM#${code}`, SK: 'META' },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: { ...names, ...(expect ? { '#ePhase': 'phase', '#eQ': 'qIndex' } : {}) },
        ExpressionAttributeValues: { ...values, ...(expect ? { ':ePhase': expect.phase, ':eQ': expect.qIndex } : {}) },
        ConditionExpression: expect ? '#ePhase = :ePhase AND #eQ = :eQ' : 'attribute_exists(PK)',
      }));
      return true;
    } catch (err: any) {
      if (err?.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async listPlayers(code: string) {
    const r = await this.doc.send(new QueryCommand({
      TableName: this.table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `ROOM#${code}`, ':sk': 'PLAYER#' },
    }));
    return (r.Items ?? []).map((i) => strip<Player>(i));
  }
  async getPlayer(code: string, id: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `ROOM#${code}`, SK: `PLAYER#${id}` } }));
    return r.Item ? strip<Player>(r.Item) : null;
  }
  async putPlayer(p: Player) {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: `ROOM#${p.room}`, SK: `PLAYER#${p.id}`, ttl: ttl(), ...p } }));
  }
  async updatePlayer(code: string, id: string, patch: Partial<Player>) {
    const { names, values, sets } = buildSet(patch);
    await this.doc.send(new UpdateCommand({
      TableName: this.table,
      Key: { PK: `ROOM#${code}`, SK: `PLAYER#${id}` },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(PK)',
    })).catch((err) => {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
    });
  }

  async getConn(id: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `CONN#${id}`, SK: 'META' } }));
    return r.Item ? strip<Conn>(r.Item) : null;
  }
  async putConn(c: Conn) {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { PK: `CONN#${c.id}`, SK: 'META', ttl: ttl(), ...c } }));
  }
  async deleteConn(id: string) {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: `CONN#${id}`, SK: 'META' } }));
  }
}

function buildSet(patch: Record<string, unknown>) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  return { names, values, sets };
}

function strip<T>(item: Record<string, unknown>): T {
  const { PK, SK, ttl: _t, ...rest } = item;
  return rest as T;
}
