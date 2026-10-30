import {
  createScopedProviderProvisioningCommands, createScopedProviderRevocationCommands,
  createScopedProviderPolicyCommands, createScopedProviderActivation,
  createScopedProviderReplyCommands, createScopedProviderApprovalCommands,
} from './provider-operator.mjs';

const actions = ['provision', 'revoke', 'configurePolicy', 'activate', 'queueReply', 'approveReply'];
const object = value => value && Object.getPrototypeOf(value) === Object.prototype;

export function createScopedProviderOperatorHandler(options) {
  const commands = Object.freeze({
    provision: createScopedProviderProvisioningCommands(options).provision,
    revoke: createScopedProviderRevocationCommands(options).revoke,
    configurePolicy: createScopedProviderPolicyCommands(options).configurePolicy,
    activate: createScopedProviderActivation(options),
    queueReply: createScopedProviderReplyCommands(options),
    approveReply: createScopedProviderApprovalCommands(options),
  });
  return createProviderOperatorHandler({ authenticate: options.authenticate, commands });
}

// authenticate must enforce the host's session, origin and CSRF policy before returning its opaque scope.
export function createProviderOperatorHandler({ authenticate, commands }) {
  if (typeof authenticate !== 'function' || !object(commands)
    || !actions.every(action => Object.hasOwn(commands, action) && typeof commands[action] === 'function')) {
    throw new Error('INVALID_PROVIDER_OPERATOR_HTTP_CONFIGURATION');
  }
  const dispatch = Object.freeze(Object.fromEntries(actions.map(action => [action, commands[action]])));
  return async (req, res) => {
    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
        ...(status === 405 ? { allow: 'POST' } : {}) });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return respond(405, { error: 'METHOD_NOT_ALLOWED' });
    if (req.headers['content-type'] !== 'application/json'
      || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
      return respond(415, { error: 'UNSUPPORTED_OPERATOR_FORMAT' });
    }
    try {
      const actor = await authenticate(req);
      if (!actor) return respond(401, { error: 'OPERATOR_AUTHENTICATION_REQUIRED' });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 8192) return respond(413, { error: 'OPERATOR_REQUEST_TOO_LARGE' });
        chunks.push(bytes);
      }
      let input;
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return respond(400, { error: 'INVALID_OPERATOR_REQUEST' }); }
      if (!object(input) || Object.keys(input).length !== 2
        || !Object.hasOwn(input, 'action') || !Object.hasOwn(input, 'payload')
        || !actions.includes(input.action) || !object(input.payload)) {
        return respond(400, { error: 'INVALID_OPERATOR_REQUEST' });
      }
      return respond(200, { schema: 'PROVIDER_OPERATOR_RESULT_V1', data: await dispatch[input.action](actor, input.payload) });
    } catch (error) {
      const status = [400, 401, 403, 404, 409].includes(error?.status) ? error.status : 503;
      const codes = { 400: 'INVALID_OPERATOR_REQUEST', 401: 'OPERATOR_AUTHENTICATION_REQUIRED',
        403: 'PROVIDER_OPERATOR_DENIED', 404: 'PROVIDER_RESOURCE_NOT_FOUND', 409: 'PROVIDER_COMMAND_CONFLICT',
        503: 'PROVIDER_COMMAND_OUTCOME_UNKNOWN' };
      return respond(status, { error: codes[status], ...(status === 503 ? { nextAction: 'RECONCILE_SAME_COMMAND_ID' } : {}) });
    }
  };
}
