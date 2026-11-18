const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

test("native n8n 2.44.7 executes installed node with stubbed transport and sanitized logs", (t) => {
  // GIVEN the digest-pinned engine, read-only package and synthetic response secrets.
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(root, ".native-package-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const pack = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
    { cwd: root, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(
    pack.status,
    0,
    "Native fixtures must use a real npm package archive",
  );
  const archive = path.join(temporary, JSON.parse(pack.stdout)[0].filename);
  const cases = [
    { name: "success", status: 0 },
    { name: "error", status: 1 },
    { name: "invalid-access-array", status: 1 },
    { name: "invalid-format-object", status: 1 },
    { name: "configured", status: 0 },
    { name: "configured-401", status: 1 },
    { name: "configured-unlinked", status: 0 },
    { name: "invalid-domain-no-credential", status: 1 },
    { name: "invalid-data-no-credential", status: 1 },
  ];
  assert.equal(
    cases.length,
    9,
    "Native fixtures cover old workflows, encrypted credential use, page options, domain notice and rejected grants",
  );
  for (const row of cases) {
    // WHEN the actual engine executes the fixture without any external network.
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--memory",
        "1536m",
        "--cpus",
        "1",
        "--pids-limit",
        "256",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--entrypoint",
        "sh",
        "--tmpfs",
        "/home/node/.n8n:uid=1000,gid=1000,mode=700",
        "--tmpfs",
        "/tmp:uid=1000,gid=1000,mode=1777",
        "-v",
        `${root}:/artifact:ro`,
        "-v",
        `${archive}:/package.tgz:ro`,
        "-e",
        "N8N_COMMUNITY_PACKAGES_ENABLED=true",
        "-e",
        "N8N_DIAGNOSTICS_ENABLED=false",
        "-e",
        "N8N_VERSION_NOTIFICATIONS_ENABLED=false",
        "-e",
        "N8N_TEMPLATES_ENABLED=false",
        "-e",
        "N8N_RUNNERS_ENABLED=false",
        "-e",
        "N8N_LOG_LEVEL=debug",
        "-e",
        "EXECUTIONS_DATA_SAVE_ON_ERROR=none",
        "-e",
        "EXECUTIONS_DATA_SAVE_ON_SUCCESS=none",
        "-e",
        "EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=false",
        "-e",
        "EXECUTIONS_DATA_SAVE_ON_PROGRESS=false",
        "-e",
        `BREWPAGE_NATIVE_FIXTURE=${row.name}`,
        "-e",
        "NODE_OPTIONS=--require=/artifact/tests/native-preload.cjs",
        "docker.n8n.io/n8nio/n8n@sha256:942bc274709f27f99f7c6024a785d8e8f75ac06838cabcba448abb8d9127ec7b",
        "-c",
        "node /artifact/tests/native-prepare.cjs && (test ! -f /tmp/native-credentials.json || n8n import:credentials --input=/tmp/native-credentials.json) && n8n import:workflow --input=/tmp/native-workflow.json && n8n execute --id=brewpage-local-fixture",
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
    );
    const logs = `${result.stdout}${result.stderr}`;
    // THEN debug logs and execution output contain no raw secrets or service body.
    assert.equal(
      result.status,
      row.status,
      `${row.name}: native status; ${logs.slice(-5000)}`,
    );
    assert.deepEqual(
      logs.match(/OWNER_SENTINEL|MANAGE_SENTINEL|PRIVATE_SENTINEL|A{32}/g),
      null,
      `${row.name}: no synthetic secrets in native trace`,
    );
    assert.equal(
      (row.status === 0
        ? /https:\/\/my-abcdefghij\.brewpage\.app\//
        : /Publication was not confirmed/
      ).test(logs),
      true,
      `${row.name}: actual node outcome; ${logs.slice(-5000)}`,
    );
  }
});
