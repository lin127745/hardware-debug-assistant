import api, { route } from '@forge/api';

const PROPERTY_KEY = 'hw-debug-case';
const CASE_LABEL = 'hw-debug';
const CASE_FIELDS = ['board', 'revision', 'symptomType', 'unitsAffected', 'recentChanges', 'instruments', 'currentStep', 'suspectedCause'];

// Rovo passes action inputs at the top level of the payload; when the agent is opened
// from a work item, payload.context.jira carries that work item's key. The on-screen
// work item wins so the model can never redirect writes to a key it made up.
function resolveIssueKey(payload) {
  const key = payload.context?.jira?.issueKey || payload.issueKey;
  if (!key) throw new Error('NO_WORK_ITEM: No Jira work item is open. Ask the user to open the work item, or to type its key.');
  return key;
}

async function jira(path, options = {}) {
  const res = await api.asUser().requestJira(path, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${body}`);
  // Property PUTs and issue edits succeed with an empty body.
  return body ? JSON.parse(body) : null;
}

async function loadCase(issueKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return { measurements: [] };
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
  return (await res.json()).value;
}

async function saveCase(issueKey, debugCase) {
  debugCase.updatedAt = new Date().toISOString();
  await jira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, {
    method: 'PUT',
    body: JSON.stringify(debugCase),
  });
}

// Jira descriptions are Atlassian Document Format trees; the agent only needs the text.
function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  const inner = (node.content || []).map(adfToText).join('');
  return ['paragraph', 'heading', 'listItem'].includes(node.type) ? `${inner}\n` : inner;
}

export async function getDebugCase(payload) {
  const issueKey = resolveIssueKey(payload);
  const [issue, debugCase] = await Promise.all([
    jira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,status,labels`),
    loadCase(issueKey),
  ]);
  return {
    issueKey,
    summary: issue.fields.summary,
    status: issue.fields.status?.name,
    description: adfToText(issue.fields.description).trim(),
    debugCase,
    isNewCase: !debugCase.updatedAt,
  };
}

export async function updateCase(payload) {
  const issueKey = resolveIssueKey(payload);
  const debugCase = await loadCase(issueKey);
  for (const field of CASE_FIELDS) {
    if (payload[field]) debugCase[field] = payload[field];
  }
  const isNew = !debugCase.updatedAt;
  await saveCase(issueKey, debugCase);
  if (isNew) {
    await jira(route`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify({ update: { labels: [{ add: CASE_LABEL }] } }),
    });
  }
  return { issueKey, saved: true, debugCase };
}

export async function logMeasurement(payload) {
  const issueKey = resolveIssueKey(payload);
  const verdict = String(payload.verdict).toUpperCase();
  const measurement = {
    step: payload.step,
    signal: payload.signal,
    expected: payload.expected || '',
    measured: payload.measured,
    instrument: payload.instrument || '',
    verdict,
    at: new Date().toISOString(),
  };

  const debugCase = await loadCase(issueKey);
  debugCase.measurements = [...(debugCase.measurements || []), measurement];
  await saveCase(issueKey, debugCase);

  const verdictColor = { PASS: 'green', FAIL: 'red' }[verdict] || 'yellow';
  const text = (t) => (t ? { type: 'text', text: t } : null);
  const row = (cells, header = false) => ({
    type: 'tableRow',
    content: cells.map((cell) => ({
      type: header ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: cell ? [cell] : [] }],
    })),
  });
  await jira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `Measurement #${debugCase.measurements.length}`, marks: [{ type: 'strong' }] }] },
          {
            type: 'table',
            content: [
              row(['Step', 'Signal / test point', 'Expected', 'Measured', 'Instrument', 'Verdict'].map(text), true),
              row([
                text(measurement.step),
                text(measurement.signal),
                text(measurement.expected),
                text(measurement.measured),
                text(measurement.instrument),
                { type: 'status', attrs: { text: verdict, color: verdictColor } },
              ]),
            ],
          },
        ],
      },
    }),
  });

  return { issueKey, logged: measurement, totalMeasurements: debugCase.measurements.length };
}

const DEFAULT_SPACE_KEY = 'HWKB';

// Knowledge base pages are written as the app so users and judges don't hit a separate
// Confluence OAuth consent; only the user's Jira access (asUser) gates closing a case.
async function confluence(path, options = {}) {
  const res = await api.asApp().requestConfluence(path, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Confluence API ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Confluence labels: lowercase, no spaces.
const toLabel = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function reportPage({ issueKey, issueUrl, summary, description, debugCase }) {
  const statusColor = { PASS: 'Green', FAIL: 'Red' };
  const rows = (debugCase.measurements || [])
    .map(
      (m) => `<tr><td>${esc(m.step)}</td><td>${esc(m.signal)}</td><td>${esc(m.expected)}</td><td>${esc(m.measured)}</td><td>${esc(m.instrument)}</td>` +
        `<td><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${statusColor[m.verdict] || 'Yellow'}</ac:parameter>` +
        `<ac:parameter ac:name="title">${esc(m.verdict)}</ac:parameter></ac:structured-macro></td></tr>`
    )
    .join('');
  const facts = [
    ['Work item', `<a href="${esc(issueUrl)}">${esc(issueKey)}</a>`],
    ['Board', esc(`${debugCase.board || ''} ${debugCase.revision ? `rev ${debugCase.revision}` : ''}`.trim())],
    ['Symptom type', esc(debugCase.symptomType)],
    ['Units affected', esc(debugCase.unitsAffected)],
    ['Recent changes', esc(debugCase.recentChanges)],
    ['Subsystem', esc(debugCase.subsystem)],
    ['Root cause type', esc(debugCase.rootCauseType)],
  ]
    .map(([k, v]) => `<tr><th>${k}</th><td>${v || '-'}</td></tr>`)
    .join('');
  return `
<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Generated by Hardware Debug Assistant from ${esc(issueKey)}.</p></ac:rich-text-body></ac:structured-macro>
<h2>Summary</h2><table><tbody>${facts}</tbody></table>
<h2>Symptom</h2><p>${esc(summary)}</p><p>${esc(description).replace(/\n/g, '<br/>')}</p>
<h2>Root cause</h2><p>${esc(debugCase.rootCause)}</p>
<h2>Fix</h2><p>${esc(debugCase.fix)}</p>
<h2>Verification</h2><p>${esc(debugCase.verification)}</p>
<h2>Measurement log</h2>
<table><tbody><tr><th>Step</th><th>Signal / test point</th><th>Expected</th><th>Measured</th><th>Instrument</th><th>Verdict</th></tr>${rows}</tbody></table>`;
}

// First close on a new site: create the knowledge base space so admins have no setup step.
async function createKnowledgeBaseSpace(spaceKey) {
  const created = await confluence(route`/wiki/rest/api/space`, {
    method: 'POST',
    body: JSON.stringify({
      key: spaceKey,
      name: spaceKey === DEFAULT_SPACE_KEY ? 'Hardware Debug Knowledge Base' : `Hardware Debug Knowledge Base (${spaceKey})`,
      description: { plain: { value: 'Closed hardware debug cases published by Hardware Debug Assistant.', representation: 'plain' } },
    }),
  });
  return { id: String(created.id), key: created.key };
}

export async function closeCase(payload) {
  const issueKey = resolveIssueKey(payload);
  const spaceKey = (payload.spaceKey || DEFAULT_SPACE_KEY).toUpperCase();

  const [issue, debugCase, serverInfo, spaces] = await Promise.all([
    jira(route`/rest/api/3/issue/${issueKey}?fields=summary,description`),
    loadCase(issueKey),
    jira(route`/rest/api/3/serverInfo`),
    confluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`),
  ]);
  const space = spaces.results?.[0] || (await createKnowledgeBaseSpace(spaceKey));

  Object.assign(debugCase, {
    rootCause: payload.rootCause,
    fix: payload.fix,
    verification: payload.verification,
    subsystem: toLabel(payload.subsystem),
    rootCauseType: toLabel(payload.rootCauseType),
    closedAt: new Date().toISOString(),
  });

  const page = await confluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    body: JSON.stringify({
      spaceId: space.id,
      status: 'current',
      title: `${issueKey}: ${issue.fields.summary}`,
      body: {
        representation: 'storage',
        value: reportPage({
          issueKey,
          issueUrl: `${serverInfo.baseUrl}/browse/${issueKey}`,
          summary: issue.fields.summary,
          description: adfToText(issue.fields.description).trim(),
          debugCase,
        }),
      },
    }),
  });
  const pageUrl = `${page._links.base}${page._links.webui}`;
  debugCase.knowledgeBasePage = pageUrl;
  await saveCase(issueKey, debugCase);

  const labels = ['hw-debug-kb', toLabel(debugCase.board), debugCase.subsystem, debugCase.rootCauseType].filter(Boolean);
  await Promise.all([
    confluence(route`/wiki/rest/api/content/${page.id}/label`, {
      method: 'POST',
      body: JSON.stringify(labels.map((name) => ({ prefix: 'global', name }))),
    }),
    jira(route`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      body: JSON.stringify({
        update: { labels: [CASE_LABEL, `subsystem-${debugCase.subsystem}`, `cause-${debugCase.rootCauseType}`].map((add) => ({ add })) },
      }),
    }),
    jira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Debug case closed', marks: [{ type: 'strong' }] }] },
            { type: 'paragraph', content: [{ type: 'text', text: `Root cause: ${debugCase.rootCause}` }] },
            { type: 'paragraph', content: [{ type: 'text', text: `Fix: ${debugCase.fix}` }] },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Knowledge base: ' },
                { type: 'inlineCard', attrs: { url: pageUrl } },
              ],
            },
          ],
        },
      }),
    }),
  ]);

  return { issueKey, closed: true, knowledgeBasePage: pageUrl, labels };
}

export async function findSimilarCases(payload) {
  const currentKey = payload.context?.jira?.issueKey || payload.issueKey;
  // Split into words so any keyword can match; only letters/digits survive, which also
  // keeps the JQL string literals safe.
  const words = [...new Set(String(payload.keywords).toLowerCase().split(/[^a-z0-9]+/))]
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  if (words.length === 0) return { query: payload.keywords, cases: [] };

  const clauses = [`labels = ${CASE_LABEL}`, `(${words.map((w) => `text ~ "${w}"`).join(' OR ')})`];
  if (currentKey) clauses.push(`key != ${currentKey}`);
  const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`;

  const result = await jira(
    route`/rest/api/3/search/jql?jql=${jql}&fields=summary,status&properties=${PROPERTY_KEY}&maxResults=20`
  );
  const cases = (result.issues || []).map((issue) => {
    const debugCase = issue.properties?.[PROPERTY_KEY] || {};
    const rootCause = debugCase.rootCause || debugCase.suspectedCause;
    const haystack = [issue.fields.summary, debugCase.board, debugCase.symptomType, rootCause, ...(debugCase.measurements || []).map((m) => m.signal)]
      .join(' ')
      .toLowerCase();
    return {
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      resolved: issue.fields.status?.statusCategory?.key === 'done',
      board: debugCase.board,
      symptomType: debugCase.symptomType,
      rootCause,
      fix: debugCase.fix,
      failedMeasurements: (debugCase.measurements || []).filter((m) => m.verdict === 'FAIL'),
      matchedKeywords: words.filter((w) => haystack.includes(w)),
    };
  });
  cases.sort((a, b) => b.resolved - a.resolved || b.matchedKeywords.length - a.matchedKeywords.length);
  return { query: words.join(' '), cases: cases.slice(0, 5) };
}
