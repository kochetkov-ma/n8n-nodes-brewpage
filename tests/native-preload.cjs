"use strict";
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const coreRequire = createRequire(
  require.resolve("/usr/local/lib/node_modules/n8n/node_modules/n8n-core/dist/execution-engine/node-execution-context/utils/request-helpers/factory.js"),
);
const { OutboundHttp } = coreRequire("@n8n/backend-network");
const fixture = process.env.BREWPAGE_NATIVE_FIXTURE;
const configuredDomain = {
  hostname: "www.example.com",
  status: "verifying",
  serving: false,
  problem: "TXT_WRONG",
  records: [
    {
      type: "TXT",
      name: "_brewpage.www.example.com",
      host: "_brewpage.www",
      value: "bp-verify=fixture",
      state: "wrong",
    },
    {
      type: "CNAME",
      name: "www.example.com",
      host: "www",
      value: "domains.brewpage.app",
      state: "missing",
    },
    {
      type: "AAAA",
      name: "www.example.com",
      host: "www",
      value: "2001:db8::1",
      state: "foreign",
    },
    {
      type: "CAA",
      name: "example.com",
      host: "@",
      value: '0 issue "letsencrypt.org"',
      state: "blocked",
    },
  ],
  nextStep:
    "Verification is not finished: repair the listed DNS records, then check this domain once.",
};
let transportCalls = 0;
let domainProjectionVerified = false;
process.on("exit", () => {
  const expected = fixture.startsWith("invalid-") ? 0 : 1;
  if (process.argv.includes("execute") && transportCalls !== expected)
    process.exitCode = 42;
  if (process.argv.includes("execute") && fixture.startsWith("configured")) {
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync("/home/node/.n8n/database.sqlite", {
      readOnly: true,
    });
    const stored = database
      .prepare("SELECT data FROM credentials_entity WHERE id = ?")
      .get("brewpage-native-credential");
    if (
      typeof stored?.data !== "string" ||
      stored.data.includes("A".repeat(32))
    )
      process.exitCode = 43;
    database.close();
  }
  if (
    process.argv.includes("execute") &&
    fixture === "configured" &&
    !domainProjectionVerified
  )
    process.exitCode = 44;
});
if (process.argv.includes("execute") && fixture === "configured") {
  const {
    BrewPage,
  } = require("/home/node/.n8n/nodes/node_modules/n8n-nodes-brewpage/dist/nodes/BrewPage/BrewPage.node.js");
  const execute = BrewPage.prototype.execute;
  BrewPage.prototype.execute = async function (...args) {
    const result = await execute.apply(this, args);
    try {
      assert.deepEqual(
        result,
        [
          [
            {
              json: {
                link: "https://my-abcdefghij.brewpage.app/",
                access: "unlisted",
                format: "html",
                expiresAt: "2026-12-01T00:00:00Z",
                requestedTtlDays: 15,
                reusedExisting: false,
                customDomain: configuredDomain,
              },
              pairedItem: { item: 0 },
            },
          ],
        ],
        "The installed node must preserve corrective DNS records and service guidance",
      );
    } catch {
      throw new Error("Unexpected native domain projection");
    }
    domainProjectionVerified = true;
    return result;
  };
}
OutboundHttp.prototype.requests = () => ({
  request: async (options) => {
    transportCalls++;
    if (
      options.url !== "https://brewpage.app/api/html" ||
      options.headers["User-Agent"] !==
        "brewpage-n8n/0.2.0 (+https://brewpage.app)"
    ) {
      throw new Error("Unexpected native request");
    }
    const configured = fixture.startsWith("configured");
    if (
      (options.headers["X-Owner-Token"] === "A".repeat(32)) !== configured ||
      (options.qs?.domain === "www.example.com") !== configured ||
      (JSON.stringify(options.body?.state) ===
        '{"collections":{"answers":{}}}') !==
        (fixture === "configured")
    ) {
      throw new Error("Unexpected native credential or feature request");
    }
    if (fixture === "error") {
      throw new Error("OWNER_SENTINEL MANAGE_SENTINEL PRIVATE_SENTINEL");
    }
    if (fixture === "configured-401")
      throw Object.assign(
        new Error("OWNER_SENTINEL MANAGE_SENTINEL PRIVATE_SENTINEL"),
        { response: { status: 401 } },
      );
    return {
      id: "AbCdEf1234",
      namespace: "my",
      link: "https://my-abcdefghij.brewpage.app/",
      access: "unlisted",
      expiresAt: "2026-12-01T00:00:00Z",
      ownerToken: "OWNER_SENTINEL",
      managementLink: "MANAGE_SENTINEL",
      content: "PRIVATE_SENTINEL",
      ...(fixture === "configured-unlinked"
        ? {
            notices: [
              { code: "domain-needs-account", message: "PRIVATE_SENTINEL" },
            ],
          }
        : {}),
      ...(fixture === "configured"
        ? {
            customDomain: {
              ...configuredDomain,
              ownerToken: "OWNER_SENTINEL",
            },
          }
        : {}),
    };
  },
});
