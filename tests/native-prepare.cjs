const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const packageRoot = "/home/node/.n8n/nodes/node_modules/n8n-nodes-brewpage";
fs.mkdirSync(packageRoot, { recursive: true });
execFileSync("tar", [
  "-xzf",
  "/package.tgz",
  "-C",
  packageRoot,
  "--strip-components=1",
]);
fs.symlinkSync(
  "/usr/local/lib/node_modules/n8n/node_modules/n8n-workflow",
  "/home/node/.n8n/nodes/node_modules/n8n-workflow",
  "dir",
);
const workflow = JSON.parse(
  fs.readFileSync("/artifact/tests/native-workflow.json", "utf8"),
);
const expressionCases = {
  "invalid-access-array": { access: "={{ ['public'] }}" },
  "invalid-format-object": { format: "={{ ({ value: 'html' }) }}" },
  configured: {
    options: {
      state: { collections: { answers: {} } },
      domain: "www.example.com",
    },
  },
  "configured-401": { options: { domain: "www.example.com" } },
  "configured-unlinked": { options: { domain: "www.example.com" } },
  "invalid-domain-no-credential": { options: { domain: "www.example.com" } },
  "invalid-data-no-credential": { options: { state: {} } },
};
Object.assign(
  workflow.nodes[1].parameters,
  expressionCases[process.env.BREWPAGE_NATIVE_FIXTURE],
);
if (process.env.BREWPAGE_NATIVE_FIXTURE.startsWith("configured")) {
  workflow.nodes[1].credentials = {
    brewPageOwnerApi: {
      id: "brewpage-native-credential",
      name: "BrewPage Native Fixture",
    },
  };
  fs.writeFileSync(
    "/tmp/native-credentials.json",
    JSON.stringify([
      {
        id: "brewpage-native-credential",
        name: "BrewPage Native Fixture",
        type: "brewPageOwnerApi",
        data: { ownerToken: "A".repeat(32) },
      },
    ]),
  );
}
fs.writeFileSync("/tmp/native-workflow.json", JSON.stringify(workflow));
