const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { NodeOperationError } = require("n8n-workflow");
const { BrewPage } = require("../dist/nodes/BrewPage/BrewPage.node.js");
const {
  BrewPageOwnerApi,
} = require("../dist/credentials/BrewPageOwnerApi.credentials.js");

const NOT_CONFIRMED =
  "Publication was not confirmed. Check nonempty content (up to 5 MiB), format, access and lifetime (1–30 days). Check for an existing publication before retrying.";
const DOMAIN_SETUP_UNKNOWN =
  "The BrewPage publication exists. Read this domain's status and next step in your BrewPage account; do not repeat the publication.";

const input = {
  operation: "publish",
  content: "<h1>Fixture</h1>",
  format: "html",
  access: "unlisted",
  options: { ttl: 15 },
};
const reply = {
  id: "AbCdEf1234",
  namespace: "my",
  link: "https://my-abcdefghij.brewpage.app/",
  access: "unlisted",
  expiresAt: "2026-12-01T00:00:00Z",
  ownerToken: "OWNER_SENTINEL",
  managementLink: "MANAGE_SENTINEL",
  content: "PRIVATE_SENTINEL",
};
function context(parameters, response, calls) {
  return {
    getInputData: () => [{ json: { source: "INPUT_SENTINEL" } }],
    getNodeParameter: (name, _index, fallback) => parameters[name] ?? fallback,
    getNode: () => ({
      name: "BrewPage",
      type: "n8n-nodes-brewpage.brewPage",
      typeVersion: 1,
      position: [0, 0],
      parameters: { content: "PRIVATE_SENTINEL" },
    }),
    helpers: {
      httpRequest: async (options) => {
        calls.push(options);
        return typeof response === "function" ? response() : response;
      },
    },
  };
}

const TOKEN = "A".repeat(32);
const DOMAIN = {
  hostname: "www.example.com",
  status: "pending_dns",
  serving: false,
  suspended: false,
  records: [
    {
      type: "CNAME",
      name: "www.example.com",
      host: "www",
      value: "domains.brewpage.app",
      state: "missing",
    },
  ],
  nextStep: "PRIVATE_SENTINEL",
  ownerToken: "OWNER_SENTINEL",
};
function credentialContext(
  parameters,
  response,
  selected,
  token,
  trace,
  failure,
) {
  const base = context(parameters, response, trace.requests);
  const node = base.getNode();
  return {
    ...base,
    getNode: () => ({
      ...node,
      ...(selected
        ? {
            credentials: {
              brewPageOwnerApi: { id: "fixture", name: "Fixture" },
            },
          }
        : {}),
    }),
    getCredentials: async (type, index) => {
      trace.reads.push({ type, index });
      if (failure === "read")
        throw new Error("OWNER_SENTINEL PRIVATE_SENTINEL");
      return { ownerToken: token };
    },
    helpers: {
      ...base.helpers,
      httpRequestWithAuthentication: async (type, options, additional) => {
        trace.auth.push({ type, additional });
        trace.requests.push({
          ...options,
          headers: {
            ...options.headers,
            "X-Owner-Token": additional.credentialsDecrypted.data.ownerToken,
          },
        });
        if (failure === "401")
          throw Object.assign(
            new Error("OWNER_SENTINEL MANAGE_SENTINEL PRIVATE_SENTINEL"),
            { response: { status: 401 } },
          );
        if (failure === "timeout")
          throw new Error("OWNER_SENTINEL MANAGE_SENTINEL PRIVATE_SENTINEL");
        return response;
      },
    },
  };
}

test("optional native credentials and page settings preserve old outputs and project bounded domain instructions", async () => {
  // GIVEN an encrypted password-field credential and unchanged saved workflow identity/defaults.
  const credential = new BrewPageOwnerApi();
  const description = new BrewPage().description;
  assert.deepEqual(
    {
      name: description.name,
      version: description.version,
      credential: description.credentials,
      secret: credential.properties.map(({ name, type, typeOptions }) => ({
        name,
        type,
        typeOptions,
      })),
      authenticate: credential.authenticate,
      restricted: credential.restrictToSupportedNodes,
      test: credential.test.request.url,
    },
    {
      name: "brewPage",
      version: 1,
      credential: [{ name: "brewPageOwnerApi", required: false }],
      secret: [
        { name: "ownerToken", type: "string", typeOptions: { password: true } },
      ],
      authenticate: {
        type: "generic",
        properties: {
          headers: { "X-Owner-Token": "={{$credentials.ownerToken}}" },
        },
      },
      restricted: true,
      test: "https://brewpage.app/api/limits",
    },
    "Native password storage and authentication belong to n8n; saved node type/version remain compatible",
  );
  const cases = [
    { name: "selected owner", options: {}, expectedBody: {}, details: {} },
    {
      name: "null data",
      options: { state: null },
      expectedBody: {},
      details: {},
    },
    {
      name: "default data",
      options: { state: "{}" },
      expectedBody: { state: {} },
      details: {},
    },
    {
      name: "declared data",
      options: { state: { collections: { answers: {} } } },
      expectedBody: { state: { collections: { answers: {} } } },
      details: {},
    },
    {
      name: "data and domain",
      options: { state: "{}", domain: "www.example.com" },
      expectedBody: { state: {} },
      response: {
        customDomain: DOMAIN,
        notices: [{ code: "state-limit-clamped", message: "PRIVATE_SENTINEL" }],
      },
      details: {
        notices: ["state-limit-clamped"],
        customDomain: {
          hostname: DOMAIN.hostname,
          status: "pending_dns",
          serving: false,
          suspended: false,
          records: DOMAIN.records,
          nextStep: DOMAIN_SETUP_UNKNOWN,
        },
      },
    },
    {
      name: "linked publish token",
      token: "P".repeat(32),
      options: { domain: "www.example.com" },
      expectedBody: {},
      response: { customDomain: DOMAIN },
      details: {
        customDomain: {
          hostname: DOMAIN.hostname,
          status: "pending_dns",
          serving: false,
          suspended: false,
          records: DOMAIN.records,
          nextStep: DOMAIN_SETUP_UNKNOWN,
        },
      },
    },
    {
      name: "domain not attached",
      options: { domain: "www.example.com" },
      expectedBody: {},
      response: {
        notices: [
          { code: "domain-needs-account", message: "PRIVATE_SENTINEL" },
        ],
      },
      details: {
        notices: ["domain-needs-account"],
        nextStep:
          "Link this credential's owner token unambiguously to one BrewPage profile, then attach the domain from that account.",
      },
    },
    {
      name: "unsafe domain metadata",
      options: { domain: "www.example.com" },
      expectedBody: {},
      response: {
        customDomain: {
          ...DOMAIN,
          records: [{ ...DOMAIN.records[0], value: TOKEN }],
        },
      },
      details: {
        nextStep: DOMAIN_SETUP_UNKNOWN,
      },
    },
  ];
  assert.equal(
    cases.length,
    8,
    "Table includes old, configured and partial domain outcomes",
  );
  for (const row of cases) {
    const trace = { requests: [], reads: [], auth: [] };
    // WHEN one configured publication completes through n8n's authenticated request helper.
    const result = await new BrewPage().execute.call(
      credentialContext(
        { ...input, options: row.options },
        { ...reply, ...row.response },
        true,
        row.token ?? TOKEN,
        trace,
      ),
    );
    // THEN the exact request/result survives without raw ownership, service text or automatic retry.
    assert.deepEqual(
      { trace, result },
      {
        trace: {
          reads: [{ type: "brewPageOwnerApi", index: 0 }],
          auth: [
            {
              type: "brewPageOwnerApi",
              additional: {
                preAuthenticationRetryStatusCode: [],
                credentialsDecrypted: {
                  id: "fixture",
                  name: "Fixture",
                  type: "brewPageOwnerApi",
                  data: { ownerToken: row.token ?? TOKEN },
                },
              },
            },
          ],
          requests: [
            {
              method: "POST",
              url: "https://brewpage.app/api/html",
              qs: {
                ttl: 15,
                format: "html",
                verbatim: true,
                ...(row.options.domain ? { domain: row.options.domain } : {}),
              },
              headers: {
                "User-Agent": "brewpage-n8n/0.2.0 (+https://brewpage.app)",
                Accept: "application/json",
                "X-Owner-Token": row.token ?? TOKEN,
              },
              body: {
                content: input.content,
                format: "html",
                ...row.expectedBody,
              },
              json: true,
              timeout: 60000,
              maxResponseBodyBytes: 65536,
              disableFollowRedirect: true,
            },
          ],
        },
        result: [
          [
            {
              json: {
                link: reply.link,
                access: "unlisted",
                format: "html",
                expiresAt: reply.expiresAt,
                requestedTtlDays: 15,
                reusedExisting: false,
                ...row.details,
              },
              pairedItem: { item: 0 },
            },
          ],
        ],
      },
      `${row.name}: one fixed-origin request and an allowlisted receipt`,
    );
    assert.deepEqual(
      JSON.stringify(result).match(
        /OWNER_SENTINEL|MANAGE_SENTINEL|PRIVATE_SENTINEL|A{32}|P{32}/g,
      ),
      null,
      `${row.name}: no raw credential or service secret in output`,
    );
  }
});

async function domainOutcome(hostname, customDomain) {
  const trace = { requests: [], reads: [], auth: [] };
  const result = await new BrewPage().execute.call(
    credentialContext(
      { ...input, options: { domain: hostname } },
      { ...reply, customDomain },
      true,
      TOKEN,
      trace,
    ),
  );
  return {
    reads: trace.reads,
    authentication: trace.auth.map(({ type }) => type),
    requests: trace.requests.map(({ method, url, qs, headers }) => ({
      method,
      url,
      qs,
      headerNames: Object.keys(headers).sort(),
    })),
    result,
  };
}

function expectedDomainOutcome(hostname, details) {
  return {
    reads: [{ type: "brewPageOwnerApi", index: 0 }],
    authentication: ["brewPageOwnerApi"],
    requests: [
      {
        method: "POST",
        url: "https://brewpage.app/api/html",
        qs: { ttl: 15, format: "html", verbatim: true, domain: hostname },
        headerNames: ["Accept", "User-Agent", "X-Owner-Token"],
      },
    ],
    result: [
      [
        {
          json: {
            link: reply.link,
            access: "unlisted",
            format: "html",
            expiresAt: reply.expiresAt,
            requestedTtlDays: 15,
            reusedExisting: false,
            ...details,
          },
          pairedItem: { item: 0 },
        },
      ],
    ],
  };
}

const DNS_NEXT_STEP =
  "Create these DNS records at your provider, check once, then read domain status until active.";
const CONFIRMED_DOMAIN = {
  hostname: DOMAIN.hostname,
  status: "pending_dns",
  serving: false,
  suspended: false,
  records: DOMAIN.records,
  nextStep: DNS_NEXT_STEP,
};

test("domain DNS record variants retain actionable API records without accepting unsafe values", async () => {
  // GIVEN a normal confirmed CNAME response uses one authenticated publication.
  assert.deepEqual(
    await domainOutcome(DOMAIN.hostname, CONFIRMED_DOMAIN),
    expectedDomainOutcome(DOMAIN.hostname, {
      customDomain: CONFIRMED_DOMAIN,
    }),
    "The ordinary domain contract is the positive control before variant checks",
  );
  const alias = {
    type: "ALIAS",
    name: "example.com",
    host: "@",
    value: "domains.brewpage.app",
    state: "unknown",
    optional: true,
  };
  const apexAddress = {
    type: "A",
    name: "example.com",
    host: "@",
    state: "unknown",
  };
  const cases = [
    {
      name: "CAA blocked",
      records: [
        ...DOMAIN.records,
        {
          type: "CAA",
          name: "example.com",
          host: "@",
          value: '0 issue "letsencrypt.org"',
          state: "blocked",
        },
      ],
    },
    {
      name: "foreign AAAA",
      records: [
        ...DOMAIN.records,
        {
          type: "AAAA",
          name: DOMAIN.hostname,
          host: "www",
          value: "2001:db8::1",
          state: "foreign",
        },
      ],
    },
    {
      name: "apex A value omitted",
      hostname: "example.com",
      records: [apexAddress, alias],
    },
    {
      name: "apex A value null",
      hostname: "example.com",
      records: [{ ...apexAddress, value: null }, alias],
    },
    {
      name: "CNAME value omitted",
      records: [{ ...DOMAIN.records[0], value: undefined }],
      expected: { nextStep: DOMAIN_SETUP_UNKNOWN },
    },
    {
      name: "apex A empty value",
      hostname: "example.com",
      records: [{ ...apexAddress, value: "" }, alias],
      expected: { nextStep: DOMAIN_SETUP_UNKNOWN },
    },
    {
      name: "known A without value",
      hostname: "example.com",
      records: [{ ...apexAddress, state: "ok" }, alias],
      expected: { nextStep: DOMAIN_SETUP_UNKNOWN },
    },
    {
      name: "structured DNS value",
      records: [{ ...DOMAIN.records[0], value: { token: TOKEN } }],
      expected: { nextStep: DOMAIN_SETUP_UNKNOWN },
    },
  ];
  // WHEN the real node projects each documented or malformed domain response.
  const observed = await Promise.all(
    cases.map(async ({ name, hostname = DOMAIN.hostname, records }) => ({
      name,
      outcome: await domainOutcome(hostname, {
        ...CONFIRMED_DOMAIN,
        hostname,
        records,
      }),
    })),
  );
  // THEN every supported record survives exactly, and invalid values retain only recovery guidance.
  assert.deepEqual(
    observed,
    cases.map(({ name, hostname = DOMAIN.hostname, records, expected }) => ({
      name,
      outcome: expectedDomainOutcome(
        hostname,
        expected ?? {
          customDomain: { ...CONFIRMED_DOMAIN, hostname, records },
        },
      ),
    })),
    "CAA, foreign AAAA and unresolved apex A preserve the complete safe DNS projection",
  );
});

test("domain next steps preserve service problems and never infer verified DNS from status alone", async () => {
  // GIVEN an ordinary safe service next step is relayed unchanged.
  assert.deepEqual(
    await domainOutcome(DOMAIN.hostname, CONFIRMED_DOMAIN),
    expectedDomainOutcome(DOMAIN.hostname, {
      customDomain: CONFIRMED_DOMAIN,
    }),
    "The normal service guidance is the positive control",
  );
  const cases = [
    {
      name: "DNS error during verification",
      changes: {
        status: "verifying",
        problem: "TXT_WRONG",
        nextStep:
          "Verification is not finished: repair the TXT record, then check this domain once.",
      },
    },
    {
      name: "unregistered domain",
      changes: {
        problem: "DOMAIN_NOT_REGISTERED",
        nextStep: "Register the domain first, then create the listed records.",
      },
    },
    {
      name: "certificate pending",
      changes: {
        status: "verifying",
        problem: "CERT_PENDING",
        nextStep:
          "The HTTPS certificate is being issued; read this domain until active.",
      },
    },
    {
      name: "serving domain with DNS repair",
      changes: {
        status: "active",
        serving: true,
        problem: "ROUTING_WRONG",
        nextStep:
          "Live, but repair the routing record and check this domain once.",
      },
      expectedExtra: { url: `https://${DOMAIN.hostname}/` },
    },
    {
      name: "lost domain during grace",
      changes: {
        status: "lost",
        serving: true,
        problem: "ROUTING_WRONG",
        nextStep: "Restore the routing record before its grace period ends.",
      },
      expectedExtra: { url: `https://${DOMAIN.hostname}/` },
    },
    {
      name: "eligibility reason",
      changes: {
        problem: "NOT_ELIGIBLE_old",
        nextStep: "Attach an eligible publication from your BrewPage account.",
      },
    },
    {
      name: "missing guidance during verification",
      changes: {
        status: "verifying",
        problem: "TXT_WRONG",
        nextStep: undefined,
      },
      expectedExtra: { nextStep: DOMAIN_SETUP_UNKNOWN },
    },
    {
      name: "secret-bearing guidance",
      changes: {
        status: "verifying",
        problem: "TXT_WRONG",
        nextStep: `PRIVATE_SENTINEL ${TOKEN}`,
      },
      expectedExtra: { nextStep: DOMAIN_SETUP_UNKNOWN },
    },
    {
      name: "secret-bearing problem",
      changes: { problem: TOKEN },
      expectedExtra: { problem: undefined },
    },
  ];
  // WHEN the service's status, problem and safe next step are projected together.
  const observed = await Promise.all(
    cases.map(async ({ name, changes }) => ({
      name,
      outcome: await domainOutcome(DOMAIN.hostname, {
        ...CONFIRMED_DOMAIN,
        ...changes,
      }),
    })),
  );
  // THEN authoritative guidance survives, unsafe text does not, and serving alone controls the public URL.
  assert.deepEqual(
    observed,
    cases.map(({ name, changes, expectedExtra }) => {
      const expected = { ...CONFIRMED_DOMAIN, ...changes, ...expectedExtra };
      const { problem, ...rest } = expected;
      return {
        name,
        outcome: expectedDomainOutcome(DOMAIN.hostname, {
          customDomain: {
            ...rest,
            ...(problem === undefined ? {} : { problem }),
          },
        }),
      };
    }),
    "Domain setup uses safe service instructions and actual problems without false DNS success",
  );
  assert.deepEqual(
    JSON.stringify(observed).match(
      /OWNER_SENTINEL|MANAGE_SENTINEL|PRIVATE_SENTINEL|A{32}/g,
    ),
    null,
    "The guidance projection never exposes raw owner credentials or private service fields",
  );
});

test("page configuration and selected credential failures stop without fallback or request replay", async () => {
  // GIVEN missing or failed selected credentials and malformed optional settings.
  const cases = [
    {
      name: "domain without credential",
      options: { domain: "www.example.com" },
      selected: false,
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "invalid data JSON",
      options: { state: "{" },
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "data without credential",
      options: { state: {} },
      selected: false,
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "array data",
      options: { state: "[]" },
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "scalar data",
      options: { state: "false" },
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "oversize data",
      options: { state: { key: "x".repeat(16384) } },
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "structured domain",
      options: { domain: ["www.example.com"] },
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "Markdown data",
      options: { state: {} },
      format: "markdown",
      requests: 0,
      reads: 0,
      auth: 0,
    },
    {
      name: "missing token",
      token: "",
      options: {},
      requests: 0,
      reads: 1,
      auth: 0,
    },
    {
      name: "malformed token",
      token: "OWNER_SENTINEL",
      options: {},
      requests: 0,
      reads: 1,
      auth: 0,
    },
    {
      name: "credential refusal",
      failure: "read",
      options: {},
      requests: 0,
      reads: 1,
      auth: 0,
    },
    {
      name: "credential 401",
      failure: "401",
      options: {},
      requests: 1,
      reads: 1,
      auth: 1,
    },
    {
      name: "ambiguous timeout",
      failure: "timeout",
      options: {},
      requests: 1,
      reads: 1,
      auth: 1,
    },
  ];
  assert.equal(
    cases.length,
    13,
    "Every rejection has a fixed expected read/auth/request count",
  );
  for (const row of cases) {
    const trace = { requests: [], reads: [], auth: [] };
    // WHEN validation, credential access or the selected write fails.
    await assert.rejects(
      new BrewPage().execute.call(
        credentialContext(
          { ...input, format: row.format ?? "html", options: row.options },
          reply,
          row.selected ?? true,
          row.token ?? TOKEN,
          trace,
          row.failure,
        ),
      ),
      (error) => {
        // THEN only the fixed sanitized n8n error is returned.
        assert.deepEqual(
          {
            native: error instanceof NodeOperationError,
            message: error.message,
            context: error.context,
          },
          {
            native: true,
            message: NOT_CONFIRMED,
            context: { itemIndex: 0, runIndex: undefined, metadata: undefined },
          },
          `${row.name}: sanitized failure`,
        );
        assert.deepEqual(
          (JSON.stringify(error) + error.stack).match(
            /OWNER_SENTINEL|MANAGE_SENTINEL|PRIVATE_SENTINEL|A{32}/g,
          ),
          null,
          `${row.name}: no credential in errors`,
        );
        return true;
      },
      `${row.name}: rejects`,
    );
    assert.deepEqual(
      {
        requests: trace.requests.length,
        reads: trace.reads.length,
        auth: trace.auth.length,
      },
      { requests: row.requests, reads: row.reads, auth: row.auth },
      `${row.name}: no anonymous substitution or retry`,
    );
  }
});

test("HTML and Markdown publish exact bounded requests and only safe reader metadata", async () => {
  // GIVEN supported formats, access choices and TTL boundaries.
  const compiled = fs.readFileSync(
    require.resolve("../dist/nodes/BrewPage/BrewPage.node.js"),
    "utf8",
  );
  assert.deepEqual(
    compiled.match(/\brequire\s*\([^)]*\)|\bimport\s*(?:\(|["'{*])/g),
    ['require("n8n-workflow")'],
    "Compiled node loads only the host-provided n8n-workflow peer",
  );
  const cases = [
    ["html", "unlisted", 1, "my", "https://my-abcdefghij.brewpage.app/", false],
    [
      "markdown",
      "unlisted",
      15,
      "my",
      "https://brewpage.app/my/AbCdEf1234",
      false,
    ],
    [
      "html",
      "public",
      30,
      "public",
      "https://brewpage.app/public/AbCdEf1234",
      false,
    ],
    [
      "markdown",
      "public",
      7,
      "public",
      "https://brewpage.app/public/AbCdEf1234",
      true,
    ],
    ["html", "public", 2, "public", "https://abcdefghij.brewpage.app/", true],
    [
      "markdown",
      "unlisted",
      3,
      "team",
      "https://brewpage.app/team/AbCdEf1234",
      true,
    ],
    [
      "html",
      "unlisted",
      4,
      "-team",
      "https://n-team-abcdefghij.brewpage.app/",
      true,
    ],
    [
      "html",
      "unlisted",
      undefined,
      "my",
      "https://my-abcdefghij.brewpage.app/",
      false,
    ],
  ].map(([format, access, ttl, namespace, link, merged]) => ({
    format,
    access,
    options: ttl === undefined ? {} : { ttl },
    ttl: ttl ?? 15,
    namespace,
    link,
    merged,
  }));
  assert.equal(
    cases.length,
    8,
    "Fixture covers every format x access, each create link shape and the default lifetime",
  );
  for (const row of cases) {
    const parameters = {
      ...input,
      format: row.format,
      access: row.access,
      options: row.options,
    };
    const calls = [];
    // WHEN native execute receives a service response containing ownership fields.
    const result = await new BrewPage().execute.call(
      context(
        parameters,
        {
          ...reply,
          access: row.access,
          namespace: row.namespace,
          link: row.link,
          result: { action: row.merged ? "merged" : "created" },
        },
        calls,
      ),
    );
    // THEN request and full output match their allowlists exactly.
    assert.deepEqual(
      calls,
      [
        {
          method: "POST",
          url: "https://brewpage.app/api/html",
          qs: {
            ttl: row.ttl,
            format: row.format,
            verbatim: true,
            ...(row.access === "public" ? { ns: "public" } : {}),
          },
          headers: {
            "User-Agent": "brewpage-n8n/0.2.0 (+https://brewpage.app)",
            Accept: "application/json",
          },
          body: { content: input.content, format: row.format },
          json: true,
          timeout: 60000,
          maxResponseBodyBytes: 65536,
          disableFollowRedirect: true,
        },
      ],
      "Only fixed endpoint, explicit access, TTL, format and User-Agent are sent",
    );
    assert.deepEqual(
      result,
      [
        [
          {
            json: {
              link: row.link,
              access: row.access,
              format: row.format,
              expiresAt: reply.expiresAt,
              requestedTtlDays: row.ttl,
              reusedExisting: row.merged,
            },
            pairedItem: { item: 0 },
          },
        ],
      ],
      "Safe metadata is returned without ownership, source, content or raw response",
    );
  }
});

test("invalid inputs and unsafe or failed responses throw one sanitized NodeOperationError without retries", async () => {
  // GIVEN invalid expressions and hostile responses carrying synthetic secrets.
  const cases = [
    { name: "empty", patch: { content: "" }, calls: 0 },
    {
      name: "oversize unicode",
      patch: { content: "😀".repeat(1310721) },
      calls: 0,
    },
    { name: "fractional ttl", patch: { options: { ttl: 1.5 } }, calls: 0 },
    { name: "high ttl", patch: { options: { ttl: 31 } }, calls: 0 },
    { name: "low ttl", patch: { options: { ttl: 0 } }, calls: 0 },
    { name: "string ttl", patch: { options: { ttl: "15" } }, calls: 0 },
    { name: "format", patch: { format: "txt" }, calls: 0 },
    { name: "access", patch: { access: "protected" }, calls: 0 },
    { name: "format array expression", patch: { format: ["html"] }, calls: 0 },
    {
      name: "access array expression",
      patch: { access: ["public"] },
      calls: 0,
    },
    {
      name: "format object expression",
      patch: { format: { value: "html" } },
      calls: 0,
    },
    {
      name: "access object expression",
      patch: { access: { value: "public" } },
      calls: 0,
    },
    { name: "operation", patch: { operation: "delete" }, calls: 0 },
    ...[
      "https://evil.test/",
      "https://brewpage.app/manage/OWNER_SENTINEL",
      "https://my-abcdefghij.brewpage.app/?ownerToken=OWNER_SENTINEL",
      "https://brewpage.app/api/abcdefghij",
      "https://brewpage.app/api/AbCdEf1234",
      "https://brewpage.app/my/AbCdEf1234/extra",
      "https://brewpage.app/my/ZzZzZz9999",
      "https://brewpage.app/public/AbCdEf1234",
      "https://abcdefghij.brewpage.app/",
      "https://team-abcdefghij.brewpage.app/",
      "https://my-abcdefghij.brewpage.app/index.html",
      "https://my-abcdefghij.evil.test/",
      ...[
        "unlock",
        "www",
        "api",
        "admin",
        "assets",
        "static",
        "cdn",
        "status",
        "health",
        "metrics",
        "grafana",
        "prometheus",
        "monitoring",
        "autoconfig",
        "autodiscover",
        "fe-bounces",
        "account",
      ].map((label) => `https://${label}.brewpage.app/`),
      "http://my-abcdefghij.brewpage.app/",
      "https://user:pass@my-abcdefghij.brewpage.app/",
    ].map((link) => ({ name: link, response: { ...reply, link }, calls: 1 })),
    {
      name: "impossible date",
      response: { ...reply, expiresAt: "2026-02-30T00:00:00Z" },
      calls: 1,
    },
    {
      name: "missing expiry",
      response: { ...reply, expiresAt: undefined },
      calls: 1,
    },
    {
      name: "access mismatch",
      response: { ...reply, access: "public" },
      calls: 1,
    },
    {
      name: "public namespace for unlisted",
      response: {
        ...reply,
        namespace: "public",
        link: "https://brewpage.app/public/AbCdEf1234",
      },
      calls: 1,
    },
    {
      name: "missing id",
      response: {
        ...reply,
        id: undefined,
        link: "https://brewpage.app/my/AbCdEf1234",
      },
      calls: 1,
    },
    {
      name: "transport",
      response: () => {
        throw new Error("OWNER_SENTINEL MANAGE_SENTINEL PRIVATE_SENTINEL");
      },
      calls: 1,
    },
  ];
  assert.equal(
    cases.length,
    50,
    "Fixture matrix covers every reserved backend label and required rejection",
  );
  for (const row of cases) {
    const calls = [];
    // WHEN execution fails validation or receives an unsafe service result.
    await assert.rejects(
      new BrewPage().execute.call(
        context({ ...input, ...row.patch }, row.response ?? reply, calls),
      ),
      (error) => {
        // THEN one n8n error with a fixed message and no original cause is thrown.
        const serialized = JSON.parse(JSON.stringify(error));
        assert.deepEqual(
          {
            type: error instanceof NodeOperationError,
            node: error.node.name,
            level: error.level,
            serialized: {
              ...serialized,
              timestamp: typeof serialized.timestamp,
            },
          },
          {
            type: true,
            node: "BrewPage",
            level: "warning",
            serialized: {
              message: NOT_CONFIRMED,
              timestamp: "number",
              name: "NodeOperationError",
              context: { itemIndex: 0 },
              cause: { name: "Error", message: NOT_CONFIRMED },
            },
          },
          `${row.name}: fixed n8n error`,
        );
        assert.deepEqual(
          (JSON.stringify(error) + error.stack).match(
            /OWNER_SENTINEL|MANAGE_SENTINEL|PRIVATE_SENTINEL/g,
          ),
          null,
          `${row.name}: ownership and content redacted`,
        );
        return true;
      },
      `${row.name}: rejects`,
    );
    assert.equal(
      calls.length,
      row.calls,
      `${row.name}: no invalid call or automatic retry`,
    );
  }
});
