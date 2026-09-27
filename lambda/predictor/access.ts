import { createHash, randomUUID } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

export class AccessError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export type Identity = { kind: 'member'; id: string } | { kind: 'guest'; id: string; ip: string };
export type Setup = { driver: string; circuit: string; tyres: string; weather: string; downforce: string; strategy: string };
export type Request = Setup | { type: 'overview' };
export interface ApiResponse { statusCode: number; headers: Record<string, string>; body: string }
export interface PredictionStore {
  getCache(key: string): Promise<ApiResponse | null>;
  lock(key: string, owner: string): Promise<boolean>;
  unlock(key: string, owner: string): Promise<void>;
  reserve(identity: Identity, generation: boolean): Promise<void>;
  saveCache(key: string, value: ApiResponse): Promise<void>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const drivers = new Set(['Max Verstappen', 'Lando Norris', 'Charles Leclerc', 'George Russell', 'Carlos Sainz', 'Oscar Piastri', 'Lewis Hamilton', 'Fernando Alonso', 'Lance Stroll', 'Kimi Antonelli', 'Pierre Gasly', 'Esteban Ocon', 'Alexander Albon', 'Nico Hulkenberg', 'Valtteri Bottas', 'Sergio Perez', 'Oliver Bearman', 'Franco Colapinto', 'Liam Lawson', 'Isack Hadjar', 'Gabriel Bortoleto', 'Arvid Lindblad']);
const circuits = new Set(['Bahrain', 'Saudi Arabia', 'Australia', 'Japan', 'China', 'Miami', 'Emilia Romagna', 'Monaco', 'Canada', 'Barcelona', 'Austria', 'Great Britain', 'Hungary', 'Belgium', 'Netherlands', 'Italy', 'Azerbaijan', 'Singapore', 'United States', 'Mexico', 'Brazil', 'Las Vegas', 'Qatar', 'Abu Dhabi']);
export function parseRequest(event: any): { request: Request; guestId: unknown } {
  if (typeof event.body !== 'string' || event.body.length > 4096 || event.isBase64Encoded) {
    throw new AccessError(400, 'INVALID_REQUEST', 'Send a JSON race setup.');
  }
  let body: any;
  try { body = JSON.parse(event.body); } catch { throw new AccessError(400, 'INVALID_REQUEST', 'Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccessError(400, 'INVALID_REQUEST', 'Invalid race setup.');
  if (body.type === 'overview') return { request: { type: 'overview' }, guestId: body.guestId };
  if (body.type !== undefined || !drivers.has(body.driver) || !circuits.has(body.circuit) ||
      !['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].includes(body.tyres) ||
      !['DRY', 'DAMP', 'WET'].includes(body.weather) || !['LOW', 'MEDIUM', 'HIGH'].includes(body.downforce) ||
      !['1-STOP', '2-STOP', '3-STOP'].includes(body.strategy)) {
    throw new AccessError(400, 'INVALID_REQUEST', 'Choose a valid driver, circuit, and strategy.');
  }
  const { driver, circuit, tyres, weather, downforce, strategy } = body;
  return { request: { driver, circuit, tyres, weather, downforce, strategy }, guestId: body.guestId };
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
export async function identify(event: any, guestId: unknown): Promise<Identity> {
  const headers = Object.entries(event.headers || {}).filter(([key]) => key.toLowerCase() === 'authorization');
  if (headers.length) {
    const authorization = headers[0][1];
    if (headers.length !== 1 || typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) {
      throw new AccessError(401, 'SIGN_IN_REQUIRED', 'Sign in again to continue.');
    }
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) throw new AccessError(503, 'UNAVAILABLE', 'Predictions are temporarily unavailable.');
    verifier ??= CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
    try {
      const payload = await verifier.verify(authorization.slice(7));
      // The former shared demo login must never receive member privileges.
      if (typeof payload.email !== 'string' || payload.email.toLowerCase() === 'guest@f1racelab.com' || payload.email_verified !== true) {
        throw new Error('A verified personal account is required');
      }
      return { kind: 'member', id: payload.sub };
    } catch {
      // An invalid bearer token cannot silently become an anonymous request.
      throw new AccessError(401, 'SIGN_IN_REQUIRED', 'Sign in with your own verified account to continue.');
    }
  }
  if (typeof guestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guestId)) {
    throw new AccessError(400, 'INVALID_REQUEST', 'A valid guest trial identifier is required.');
  }
  const ip = event.requestContext?.identity?.sourceIp;
  if (typeof ip !== 'string' || !ip) throw new AccessError(503, 'UNAVAILABLE', 'Unable to verify guest access.');
  return { kind: 'guest', id: guestId.toLowerCase(), ip };
}

export function apiResponse(statusCode: number, body: unknown): ApiResponse {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
export function createHandler(deps: { store: PredictionStore; identify: typeof identify; generate: (request: Request) => Promise<ApiResponse> }) {
  return async (event: any): Promise<ApiResponse> => {
    let locked: { key: string; owner: string } | undefined;
    try {
      const { request, guestId } = parseRequest(event);
      const identity = await deps.identify(event, guestId);
      if ('type' in request && identity.kind === 'guest') throw new AccessError(401, 'SIGN_IN_REQUIRED', 'Sign in to generate a race overview.');
      // Version bump invalidates old output after model/prompt changes. UTC day prevents stale race rollover.
      const key = hash(`v1:${process.env.BEDROCK_MODEL_ID}:${new Date().toISOString().slice(0, 10)}:${JSON.stringify(request)}`);
      let cached = await deps.store.getCache(key);
      if (!cached) {
        const owner = randomUUID();
        if (!await deps.store.lock(key, owner)) throw new AccessError(429, 'RATE_LIMITED', 'This prediction is being generated. Please try again shortly.');
        locked = { key, owner };
        // Another generator may have completed between the first read and lock acquisition.
        cached = await deps.store.getCache(key);
      }
      // Transaction reserves every applicable allowance together, before any model call.
      await deps.store.reserve(identity, !cached);
      if (cached) return cached;
      const result = await deps.generate(request);
      if (result.statusCode === 200) {
        try { await deps.store.saveCache(key, result); } catch { console.error('Prediction cache write failed'); }
      }
      return result;
    } catch (error) {
      if (error instanceof AccessError) return apiResponse(error.status, { code: error.code, error: error.message });
      console.error('Prediction request failed', error instanceof Error ? error.name : 'UnknownError');
      return apiResponse(503, { code: 'UNAVAILABLE', error: 'Predictions are temporarily unavailable. Please try again later.' });
    } finally {
      if (locked) {
        try { await deps.store.unlock(locked.key, locked.owner); } catch { console.error('Prediction lock cleanup failed'); }
      }
    }
  };
}

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export class DynamoPredictionStore implements PredictionStore {
  constructor(private readonly db = documentClient, private readonly table = process.env.PREDICTION_TABLE) {}
  private tableName(): string {
    if (!this.table) throw new Error('Prediction quota table is not configured');
    return this.table;
  }
  async getCache(key: string): Promise<ApiResponse | null> {
    const { Item } = await this.db.send(new GetCommand({ TableName: this.tableName(), Key: { pk: `CACHE#${key}` }, ConsistentRead: true }));
    return Item && Item.expiresAt > Math.floor(Date.now() / 1000) ? Item.value as ApiResponse : null;
  }
  async lock(key: string, owner: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.db.send(new PutCommand({ TableName: this.tableName(), Item: { pk: `LOCK#${key}`, owner, expiresAt: now + 60 }, ConditionExpression: 'attribute_not_exists(pk) OR expiresAt < :now', ExpressionAttributeValues: { ':now': now } }));
      return true;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }
  async unlock(key: string, owner: string): Promise<void> {
    await this.db.send(new DeleteCommand({ TableName: this.tableName(), Key: { pk: `LOCK#${key}` }, ConditionExpression: '#owner = :owner', ExpressionAttributeNames: { '#owner': 'owner' }, ExpressionAttributeValues: { ':owner': owner } }));
  }
  async saveCache(key: string, value: ApiResponse): Promise<void> {
    await this.db.send(new PutCommand({ TableName: this.tableName(), Item: { pk: `CACHE#${key}`, value, expiresAt: Math.floor(Date.now() / 1000) + 900 } }));
  }
  async reserve(identity: Identity, generation: boolean): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const expiry = Math.floor(Date.now() / 1000) + 2 * 86400;
    const limits = identity.kind === 'member'
      ? [{ pk: `MEMBER#${hash(identity.id)}#${day}`, limit: this.limit('MEMBER_DAILY_LIMIT', 5), code: 'DAILY_LIMIT_REACHED', expires: true }]
      : [
          { pk: `GUEST#${hash(identity.id)}`, limit: 1, code: 'GUEST_LIMIT_REACHED', expires: false },
          { pk: `IP#${hash(identity.ip)}#${day}`, limit: this.limit('GUEST_IP_DAILY_LIMIT', 3), code: 'GUEST_LIMIT_REACHED', expires: true }
        ];
    if (generation) limits.push({ pk: `GLOBAL#${day}`, limit: this.limit('GLOBAL_DAILY_LIMIT', 100), code: 'GLOBAL_LIMIT_REACHED', expires: true });
    const disabled = limits.find(item => item.limit === 0);
    if (disabled) throw new AccessError(429, disabled.code, 'Predictions are temporarily paused.');
    try {
      await this.db.send(new TransactWriteCommand({
        ClientRequestToken: randomUUID(),
        TransactItems: limits.map(item => ({ Update: {
          TableName: this.tableName(), Key: { pk: item.pk },
          UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one' + (item.expires ? ', expiresAt = :expiry' : ''),
          ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':limit': item.limit, ...(item.expires ? { ':expiry': expiry } : {}) }
        } }))
      }));
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') {
        const index = error.CancellationReasons?.findIndex((reason: any) => reason.Code === 'ConditionalCheckFailed') ?? -1;
        if (index >= 0 && limits[index]) {
          const code = limits[index].code;
          const message = code === 'GUEST_LIMIT_REACHED' ? 'Your guest trial is unavailable. Sign in to continue.' : code === 'DAILY_LIMIT_REACHED' ? 'You have reached today’s prediction limit.' : 'Predictions are paused until the next UTC day.';
          throw new AccessError(code === 'GUEST_LIMIT_REACHED' ? 403 : 429, code, message);
        }
      }
      // Conflict, throttling, and outages all fail closed; never fall through to Bedrock.
      throw error;
    }
  }
  private limit(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
    return value;
  }
}
