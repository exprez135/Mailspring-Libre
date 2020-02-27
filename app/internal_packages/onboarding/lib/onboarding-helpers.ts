/* eslint global-require: 0 */

import qs from 'querystring';
import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import { Account, IdentityStore, MailsyncProcess, localized } from 'mailspring-exports';
import MailspringProviderSettings from './mailspring-provider-settings.json';
import MailcoreProviderSettings from './mailcore-provider-settings.json';
import dns from 'dns';
import { replace } from 'node-emoji';

export const LOCAL_SERVER_PORT = 12141;

const GMAIL_CLIENT_ID =
  process.env.MS_GMAIL_CLIENT_ID ||
  '662287800555-0a5h4ii0e9hsbpq0mqtul7fja0jhf9uf.apps.googleusercontent.com';

const O365_CLIENT_ID = process.env.MS_O365_CLIENT_ID || '8787a430-6eee-41e1-b914-681d90d35625';

const GMAIL_SCOPES = [
  'https://mail.google.com/', // email
  'https://www.googleapis.com/auth/userinfo.email', // email address
  'https://www.googleapis.com/auth/userinfo.profile', // G+ profile
  'https://www.googleapis.com/auth/contacts', // contacts
  'https://www.googleapis.com/auth/calendar', // calendar
];

const O365_SCOPES = [
  'user.read', // email address
  'offline_access',
  'Contacts.ReadWrite', // contacts
  'Contacts.ReadWrite.Shared', // contacts
  'Calendars.ReadWrite', // calendar
  'Calendars.ReadWrite.Shared', // calendar

  // Future note: When you exchane the refresh token for an access token, you may
  // request these two OR the above set but NOT BOTH, because Microsoft has mapped
  // two underlying systems with different tokens onto the single flow and you
  // need to get an outlook token and not a Micrsosoft Graph token to use these APIs.
  // https://stackoverflow.com/questions/61597263/
  'https://outlook.office.com/IMAP.AccessAsUser.All', // email
  'https://outlook.office.com/SMTP.Send', // email
];

// Re-created only at onboarding page load / auth session start because storing
// verifier would require additional state refactoring
const CODE_VERIFIER = uuidv4();
const CODE_CHALLENGE = crypto
  .createHash('sha256')
  .update(CODE_VERIFIER, 'utf8')
  .digest('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token: string;
  id_token: string;
}

function idForAccount(emailAddress: string, connectionSettings) {
  // changing your connection security settings / ports shouldn't blow
  // away everything and trash your metadata. Just look at critiical fields.
  // (Me adding more connection settings fields shouldn't break account Ids either!)
  const settingsThatCouldChangeMailContents = {
    imap_username: connectionSettings.imap_username,
    imap_host: connectionSettings.imap_host,
    smtp_username: connectionSettings.smtp_username,
    smtp_host: connectionSettings.smtp_host,
  };

  const idString = `${emailAddress}${JSON.stringify(settingsThatCouldChangeMailContents)}`;
  return crypto
    .createHash('sha256')
    .update(idString, 'utf8')
    .digest('hex')
    .substr(0, 8);
}

async function fetchPostWithFormBody<T>(url: string, body: { [key: string]: string }) {
  const resp = await fetch(url, {
    method: 'POST',
    body: Object.entries(body)
      .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
      .join('&'),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
  });
  const json = ((await resp.json()) || {}) as T;
  if (!resp.ok) {
    throw new Error(
      `OAuth Code exchange returned ${resp.status} ${resp.statusText}: ${JSON.stringify(json)}`
    );
  }
  return json;
}

function mxRecordsForDomain(domain) {
  return new Promise<string[]>((resolve, reject) => {
    // timeout here is annoyingly long - 30s?
    dns.resolveMx(domain, (err, addresses) => {
      if (err) {
        resolve([]);
      } else {
        resolve(addresses.map(a => a.exchange.toLowerCase()));
      }
    });
  });
}

export async function expandAccountWithCommonSettings(account: Account) {
  // see: https://developer.mozilla.org/en-US/docs/Mozilla/Thunderbird/Autoconfiguration

  const domain = account.emailAddress
    .split('@')
    .pop()
    .toLowerCase();
  const mxRecords = await mxRecordsForDomain(domain);
  console.log('MX', domain, ':', mxRecords);

  const populated = account.clone();

  const usernameWithFormat = format => {
    if (format === 'email') return account.emailAddress;
    if (format === 'email-without-domain') return account.emailAddress.split('@').shift();
    return undefined;
  };

  const getConfigForDomain = async (url, emailAddress) => {
    const r = await fetch(url);
    const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const imap = doc.querySelector("incomingServer[type='imap']");
    const smtp = doc.querySelector("outgoingServer[type='smtp']");

    return {
      imap_host: imap.getElementsByTagName('hostname')[0].textContent,
      imap_port: parseInt(imap.getElementsByTagName('port')[0].textContent),
      imap_username: imap
        .getElementsByTagName('username')[0]
        .textContent.replace('%EMAILADDRESS%', usernameWithFormat('email'))
        .replace('%EMAILLOCALPART%', usernameWithFormat('email-without-domain')),
      imap_password: populated.settings.imap_password,
      imap_security:
        imap.getElementsByTagName('socketType')[0].textContent == 'STARTTLS'
          ? 'STARTTLS'
          : 'SSL / TLS',
      imap_allow_insecure_ssl: false,

      smtp_host: smtp.getElementsByTagName('hostname')[0].textContent,
      smtp_port: parseInt(smtp.getElementsByTagName('port')[0].textContent),
      smtp_username: smtp
        .getElementsByTagName('username')[0]
        .textContent.replace('%EMAILADDRESS%', usernameWithFormat('email'))
        .replace('%EMAILLOCALPART%', usernameWithFormat('email-without-domain')),
      smtp_password: populated.settings.smtp_password || populated.settings.imap_password,
      smtp_security:
        smtp.getElementsByTagName('socketType')[0].textContent == 'STARTTLS'
          ? 'STARTTLS'
          : 'SSL / TLS',
      smtp_allow_insecure_ssl: false,
    };
  };

  const mxDomains = mxRecords.map(x =>
    x
      .split('.')
      .slice(-2)
      .join('.')
  );
  const tryUrls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${account.emailAddress}`,
    ...mxDomains.map(
      x => `https://autoconfig.${x}/mail/config-v1.1.xml?emailaddress=${account.emailAddress}`
    ),
    `https://autoconfig.thunderbird.net/v1.1/${domain}`,
    ...mxDomains.map(x => `https://autoconfig.thunderbird.net/v1.1/${x}`),
  ];
  let template;
  for (let url of tryUrls) {
    try {
      console.log('trying', url);
      template = await getConfigForDomain(url, account.emailAddress);
      break;
    } catch (e) {
      continue;
    }
  }
  console.log(template);

  if (template) {
    console.log(`Using template: ${JSON.stringify(template, null, 2)}`);
    populated.settings = Object.assign(template, populated.settings);
    return populated;
  }

  return populated;
}

export async function buildGmailAccountFromAuthResponse(code: string) {
  /// Exchange code for an access token
  const { access_token, refresh_token } = await fetchPostWithFormBody<TokenResponse>(
    'https://www.googleapis.com/oauth2/v4/token',
    {
      code: code,
      client_id: GMAIL_CLIENT_ID,
      redirect_uri: `http://127.0.0.1:${LOCAL_SERVER_PORT}`,
      grant_type: 'authorization_code',
    }
  );

  // get the user's email address
  const meResp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const me = await meResp.json();
  if (!meResp.ok) {
    throw new Error(
      `Gmail profile request returned ${meResp.status} ${meResp.statusText}: ${JSON.stringify(me)}`
    );
  }
  const account = await expandAccountWithCommonSettings(
    new Account({
      name: me.name,
      emailAddress: me.email,
      provider: 'gmail',
      settings: {
        refresh_client_id: GMAIL_CLIENT_ID,
        refresh_token: refresh_token,
      },
    })
  );

  account.id = idForAccount(me.email, account.settings);

  // test the account locally to ensure the All Mail folder is enabled
  // and the refresh token can be exchanged for an account token.
  await finalizeAndValidateAccount(account);

  return account;
}

export async function buildO365AccountFromAuthResponse(code: string) {
  /// Exchange code for an access token
  const { access_token, refresh_token } = await fetchPostWithFormBody<TokenResponse>(
    `https://login.microsoftonline.com/common/oauth2/v2.0/token`,
    {
      code: code,
      scope: O365_SCOPES.filter(f => !f.startsWith('https://outlook.office.com')).join(' '),
      client_id: O365_CLIENT_ID,
      code_verifier: CODE_VERIFIER,
      grant_type: `authorization_code`,
      redirect_uri: `http://localhost:${LOCAL_SERVER_PORT}`,
    }
  );

  // get the user's email address
  const meResp = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const me = await meResp.json();
  if (!meResp.ok) {
    throw new Error(
      `O365 profile request returned ${meResp.status} ${meResp.statusText}: ${JSON.stringify(me)}`
    );
  }
  if (!me.mail) {
    throw new Error(localized(`There is no email mailbox associated with this account.`));
  }

  const account = await expandAccountWithCommonSettings(
    new Account({
      name: me.displayName,
      emailAddress: me.mail,
      provider: 'office365',
      settings: {
        refresh_client_id: O365_CLIENT_ID,
        refresh_token: refresh_token,
      },
    })
  );

  account.id = idForAccount(me.email, account.settings);

  // test the account locally to ensure the refresh token can be exchanged for an account token.
  await finalizeAndValidateAccount(account);

  return account;
}

export function buildGmailAuthURL() {
  return `https://accounts.google.com/o/oauth2/auth?${qs.stringify({
    client_id: GMAIL_CLIENT_ID,
    redirect_uri: `http://127.0.0.1:${LOCAL_SERVER_PORT}`,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
  })}`;
}

export function buildO365AuthURL() {
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${qs.stringify({
    client_id: O365_CLIENT_ID,
    redirect_uri: `http://localhost:${LOCAL_SERVER_PORT}`,
    response_type: 'code',
    scope: O365_SCOPES.join(' '),
    response_mode: 'query',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
  })}`;
}

export async function finalizeAndValidateAccount(account: Account) {
  if (account.settings.imap_host) {
    account.settings.imap_host = account.settings.imap_host.trim();
  }
  if (account.settings.smtp_host) {
    account.settings.smtp_host = account.settings.smtp_host.trim();
  }

  account.id = idForAccount(account.emailAddress, account.settings);

  // handle special case for exchange/outlook/hotmail username field
  // TODO BG: I don't think this line is in use but not 100% sure
  (account.settings as any).username =
    (account.settings as any).username || (account.settings as any).email;

  if (account.settings.imap_port) {
    account.settings.imap_port /= 1;
  }
  if (account.settings.smtp_port) {
    account.settings.smtp_port /= 1;
  }
  if (account.label && account.label.includes('@')) {
    account.label = account.emailAddress;
  }

  // Test connections to IMAP and SMTP
  const proc = new MailsyncProcess(AppEnv.getLoadSettings());
  proc.identity = IdentityStore.identity();
  proc.account = account;
  await proc.test();

  // Record the date of successful auth
  account.authedAt = new Date();
  return account;
}
