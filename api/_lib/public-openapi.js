const string = { type: 'string' };
const integer = { type: 'integer' };
const number = { type: 'number' };
const uri = { type: 'string', format: 'uri' };
const date = { type: 'string', format: 'date-time' };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (items) => ({ type: 'array', items });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const content = (schema) => ({ 'application/json': { schema } });
const failure = (description, headers) => ({ description, content: content(ref('Error')), ...(headers && { headers }) });
const errors = {
  405: failure('Method not allowed'),
  429: failure('Origin rate limit exceeded', { 'Retry-After': { schema: integer, description: 'Seconds until the next quota window.' } }),
  503: failure('Requested data is temporarily unavailable'),
};
const operation = (operationId, summary, data, parameter) => ({
  get: {
    operationId, summary,
    ...(parameter && { parameters: [{ name: parameter, in: 'path', required: true, schema: string }] }),
    responses: {
      200: { description: 'Public data', content: content(object({ data })) },
      ...(parameter && { 404: failure('Resource not found') }),
      ...errors,
    },
  },
});
const identity = { handle: string, name: string, avatar: string };

export const openApi = {
  openapi: '3.1.0',
  info: {
    title: 'UNTERGRUND Public API',
    version: '1.0.0',
    description: 'Read-only release, creator and live-room metadata. No credentials are needed.',
  },
  servers: [{ url: '/api/v1' }],
  security: [],
  paths: {
    '/tracks': operation('listTracks', 'List up to 60 recently published tracks, newest first', object({ tracks: array(ref('Track')) })),
    '/tracks/{id}': operation('getTrack', 'Get a published track', object({ track: ref('Track'), creator: { anyOf: [ref('Creator'), { type: 'null' }] } }), 'id'),
    '/artists/{handle}': operation('getArtist', 'Get a public artist profile and its releases', object({ artist: ref('Artist'), tracks: array(ref('Track')) }), 'handle'),
    '/rooms': operation('listRooms', 'List public Club Rooms currently on air', object({ rooms: array(ref('Room')) })),
    '/openapi.json': { get: { operationId: 'getOpenApi', summary: 'Get this OpenAPI document', responses: {
      200: { description: 'OpenAPI 3.1 document (not wrapped in a data envelope)', content: content({ type: 'object' }) },
      405: errors[405],
    } } },
  },
  components: {
    schemas: {
      Track: object({ id: string, title: string, artist: string, style: string, bpm: number, key: integer, scale: string, created: date, url: uri, embedUrl: uri }),
      Creator: object(identity),
      Artist: object({
        ...identity, bio: string, dna: { type: ['object', 'null'] }, followers: integer, following: integer,
        created: date, soundcloud: string, url: uri,
      }),
      Room: object({
        id: string, title: string, artist: string, style: string, bpm: number, key: string, listeners: integer,
        dj: object({ name: string, shape: string, color: string, gear: string }, ['name']),
        startsAt: { type: 'number', description: 'Unix time in milliseconds.' }, replay: { type: 'boolean' }, url: uri,
      }),
      Error: object({ error: object({ code: string, message: string }) }),
    },
  },
};
