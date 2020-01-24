/* eslint global-require: 0 */
import { APIError } from './errors';

// A 0 code is when an error returns without a status code, like "ESOCKETTIMEDOUT"
export const TimeoutErrorCodes = [
  0,
  408,
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'ENETDOWN',
  'ENETUNREACH',
];
export const PermanentErrorCodes = [
  400,
  401,
  402,
  403,
  404,
  405,
  429,
  500,
  'ENOTFOUND',
  'ECONNREFUSED',
  'EHOSTDOWN',
  'EHOSTUNREACH',
];
export const CanceledErrorCodes = [-123, 'ECONNABORTED'];
export const SampleTemporaryErrorCode = 504;

let IdentityStore = null;

// server option

export function rootURLForServer(server) {
  const env = AppEnv.config.get('env');

  if (!['development', 'staging', 'production'].includes(env)) {
    throw new Error(`rootURLForServer: ${env} is not a valid environment.`);
  }

  if (server === 'identity') {
    return 'http://localhost:5101';
    return {
      development: 'http://localhost:5101',
      staging: 'https://id-staging.getmailspring.com',
      production: 'https://id.getmailspring.com',
    }[env];
  }
  throw new Error('rootURLForServer: You must provide a valid `server` value');
}

export async function postStaticAsset({ filename, blob }) {
  const body = new FormData();
  body.set('filename', filename);
  if (typeof blob === 'string') {
    body.set('file', new Blob([blob], { type: 'text/plain' }), filename);
  } else {
    body.set('file', blob, filename);
  }
  const resp = await makeRequest({
    server: 'identity',
    method: 'POST',
    path: `/api/save-public-asset`,
    body: body,
  });
  return resp.link;
}

export async function postStaticPage({ html, key }) {
  throw new Error('not supported');
}

export async function makeRequest(options) {
  throw new Error('not supported');
}

export default {
  TimeoutErrorCodes,
  PermanentErrorCodes,
  CanceledErrorCodes,
  SampleTemporaryErrorCode,
  rootURLForServer,
  makeRequest,
  postStaticPage,
  postStaticAsset,
};
