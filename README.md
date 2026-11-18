# BrewPage for n8n

<a href="https://www.npmjs.com/package/n8n-nodes-brewpage"><img height="18" alt="npm n8n-nodes-brewpage" src="https://img.shields.io/npm/v/n8n-nodes-brewpage?label=n8n-nodes-brewpage"></a>
<a href="https://github.com/kochetkov-ma/n8n-nodes-brewpage/actions/workflows/ci.yml"><img height="18" alt="CI" src="https://github.com/kochetkov-ma/n8n-nodes-brewpage/actions/workflows/ci.yml/badge.svg"></a>
<a href="https://github.com/kochetkov-ma/n8n-nodes-brewpage/blob/main/LICENSE"><img height="18" alt="license MIT" src="https://img.shields.io/badge/license-MIT-green"></a>

n8n community node for [BrewPage](https://brewpage.app). Other BrewPage integrations:
[BrewPage publishing plugins](https://github.com/kochetkov-ma/brewpage-publish-plugins#readme).

Publish HTML and Markdown reports as temporary HTTPS reader links. Ordinary
reports need no signup or credentials. An optional existing owner credential
keeps new publications under that owner and enables Page data or a requested
custom domain. The node installs no runtime dependency; its only peer is
`n8n-workflow`, which the n8n host provides.

## Install

BrewPage is a verified community node, available on n8n Cloud and self-hosted
n8n. An instance owner or admin installs it once from the nodes panel; then every
member can use it:

1. On the canvas, open the nodes panel with **+** or by pressing **N**.
2. Search for **BrewPage**; it appears under **More from the community**.
3. Select it and choose **Install**.

See n8n's guide to
[installing verified community nodes](https://docs.n8n.io/integrations/community-nodes/installation-and-management/install-verified-community-nodes/).
Self-hosted instances that hide verified nodes can still install the npm package
`n8n-nodes-brewpage@0.2.0` through **Settings → Community nodes**
([GUI installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/)).

## Use

Add **BrewPage**, choose **Publish Report**, select HTML or Markdown,
and map Content from a previous node, for example `={{ $json.report }}`.
Choose Access explicitly. Lifetime is under **Options → Lifetime (Days)**:
1 to 30 days, default 15 when the option is not added.
Content must be nonempty and at most 5 MiB in UTF-8.
Content, Format and Access expressions must return strings; structured values
are rejected before any request.

- **Unlisted**: anyone with the link can read it. It is not private.
- **Public**: discoverable in the gallery; anyone can read it.
- Content expires permanently. Identical existing content may retain its original
  expiry; check the returned `expiresAt` and `reusedExisting`.
- Ordinary output contains only `link`, `access`, `format`, `expiresAt`,
  `requestedTtlDays`, and `reusedExisting`. Owner tokens, management links,
  response bodies and input content are discarded from node output.
- `link` is the reader address BrewPage returned: `https://brewpage.app/<namespace>/<id>`
  or the page's own host `https://<label>.brewpage.app/` (HTML in the unlisted
  namespace). A successful create is never reported as a failure.
- Newly issued ownership tokens are discarded. For later management, select an
  existing owner credential before publishing and keep that credential. This
  node does not update or delete publications; content expires automatically.
  Disable workflow execution saving and avoid pinned data for sensitive inputs.
- Publish only reports intended for sharing. Do not include secrets or personal
  data. This node has no password option.

Before using report inputs, disable workflow execution saving for success,
errors, progress and manual runs, and do not pin data. n8n itself can persist
workflow parameters, input data, execution snapshots and logs. This package
cannot override instance administration, upstream nodes, telemetry or logging;
keep report content out of literal node parameters and persistent upstream data.
Credential/response redaction in this node does not guarantee platform-wide
secrecy.

Publishing sends one request to `https://brewpage.app/api/html`. Requests send
`User-Agent: brewpage-n8n/0.2.0 (+https://brewpage.app)`. Redirects are disabled.
Every failure throws an n8n `NodeOperationError` with one fixed message and no
original error or response; there is no automatic retry, because a timed-out
publication may already exist.
Requests time out after 60 seconds and decoded responses are capped at 64 KiB.

## Owner credential, Page data and your domain

Select or create a **BrewPage Owner API** credential and paste an existing owner
token into its masked **Owner Token** field. n8n stores credentials encrypted
([credential storage](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/credentials-files/)).
The node sends it only as `X-Owner-Token` to the fixed BrewPage API origin.
The explicit credential **Test** makes a read-only `GET /api/limits` request;
publishing does not run that check or start sign-in. A refused credential never
switches to anonymous publishing, and the authenticated helper's automatic
refresh-and-resend is disabled. Existing workflows without credentials retain
their ordinary anonymous behavior and exact output fields.

For an HTML page that saves visitor answers, load the classic
[visitor SDK](https://brewpage.app/llms-page-data.txt) in Content and add
**Options → Page Data**. For an owned hostname, add **Options → Custom Domain**.
The options can be combined:

```json
{
  "state": { "collections": { "answers": {} } },
  "domain": "www.example.com"
}
```

Every non-null Page data declaration, including `{}` or shared lists, requires
a selected existing owner credential so the author retains access to entries.
`state: null` leaves settings unchanged. Page data alone needs no account.
A custom domain requires that credential's token to be linked unambiguously to
a BrewPage profile; both eligible publish and admin token scopes follow the
existing create API policy. Without the selected credential, either option
stops before any HTTP request. HTML is required for these options.

Configured results may add `notices` (bounded service notice codes), a
`customDomain` projection containing hostname, status, serving state and DNS
records, and a nonsecret `nextStep`. Pending DNS is not reported as active.
Create the returned DNS records, check once after the change, then read domain
status until active. The node does not edit DNS or poll. A confirmed publication
with an unsuccessful domain attachment still returns its reader link and the
notice/next step; never repeat that publication to finish domain setup.
Raw service messages, owner tokens and management links stay out of output.
Manage entries or attach a domain later through the same owner in BrewPage.

## Development

The repository follows the layout of n8n's
[starter template](https://github.com/n8n-io/n8n-nodes-starter): `package.json`,
`nodes/`, optional `credentials/` and the build config live at the root.
Use Node.js 24 and npm 11:

```sh
npm ci --ignore-scripts
npm run format
npm run lint
npm run build
npm test
npm run test:native   # Docker: runs the built node inside n8n 2.44.7
```

Development pins: `@n8n/node-cli` 0.55.5, `n8n-workflow` 2.44.2 (the host
supplies it at runtime), TypeScript 5.9.3, Prettier 3.9.10.

Native credential checks install actual `npm pack` bytes under the published
node type: the CUSTOM extension loader can omit supported-node metadata and
reject a restricted credential before decryption. Stub the transport resolved
from n8n-core while keeping credential decryption and header injection real.
Pass the once-resolved credential to the authenticated helper, with
`preAuthenticationRetryStatusCode: []`, so a create keeps its selected owner
and cannot be resent after a 401.

## Host dependency advisory

The tested n8n 2.44.7 host's SDK includes Zod 3.25.76, affected by
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
(memory exhaustion from oversized constrained collections). The published fix is
Zod 4.6.6; replacing the host's 3.x API with that major version has not been
qualified. The compiled node loads `n8n-workflow` from the host as a peer, for
`NodeOperationError` and `NodeConnectionTypes`, and installs no dependency of its
own. It adds no dependency graph; it does not repair an existing host. The
node's input limits do not establish host-wide immunity.

## Publication and provenance

Releases are published only by GitHub Actions. Pushing a `vX.Y.Z` tag that
matches `package.json` runs [`publish.yml`](.github/workflows/publish.yml):
format, unit and native checks, then `npm run release`, which lints, builds and
publishes with an npm provenance statement through npm trusted publishing
(GitHub OIDC). No registry token is stored in the repository. Verify a release
with `npm audit signatures` or on the package's npm page.

Versions up to 0.1.3 were published from
[brewpage-publish-plugins](https://github.com/kochetkov-ma/brewpage-publish-plugins);
this repository carries their history.

Official guidance:
[node CLI](https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool/),
[verification](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/),
[submission](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes/),
[self-hosted installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/),
[BrewPage API](https://brewpage.app/api).

## Related

[All BrewPage integrations](https://github.com/kochetkov-ma/brewpage-publish-plugins#integrations) ·
[BrewPage](https://brewpage.app) ·
[MCP server](https://github.com/kochetkov-ma/brewpage-openapi) ·
[Cookbook](https://github.com/kochetkov-ma/brewpage-cookbook)
