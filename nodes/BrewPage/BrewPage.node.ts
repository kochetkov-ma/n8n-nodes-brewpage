import {
  NodeConnectionTypes,
  NodeOperationError,
  type ICredentialsDecrypted,
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestOptions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from "n8n-workflow";

const USER_AGENT = "brewpage-n8n/0.2.0 (+https://brewpage.app)";
const DEFAULT_TTL = 15;
const NOT_CONFIRMED =
  "Publication was not confirmed. Check nonempty content (up to 5 MiB), format, access and lifetime (1–30 days). Check for an existing publication before retrying.";
const DOMAIN_SETUP_UNKNOWN =
  "The BrewPage publication exists. Read this domain's status and next step in your BrewPage account; do not repeat the publication.";
const MAX_BYTES = 5 * 1024 * 1024;
const CREDENTIAL_TYPE = "brewPageOwnerApi";
const RESERVED_HOST_LABELS = [
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
];

export class BrewPage implements INodeType {
  description: INodeTypeDescription = {
    displayName: "BrewPage",
    name: "brewPage",
    icon: { light: "file:brewpage.svg", dark: "file:brewpage.svg" },
    subtitle: '={{$parameter["operation"]}}',
    group: ["output"],
    version: 1,
    description:
      "Publish temporary HTML and Markdown reports without credentials",
    defaults: { name: "BrewPage" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "brewPageOwnerApi", required: false }],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Publish Report",
            value: "publish",
            action: "Publish a report",
            description: "Create a temporary reader link",
          },
        ],
        default: "publish",
      },
      {
        displayName: "Access",
        name: "access",
        type: "options",
        default: "unlisted",
        options: [
          {
            name: "Unlisted",
            value: "unlisted",
            description: "Anyone with the link can read it",
          },
          {
            name: "Public",
            value: "public",
            description: "Discoverable in the gallery; anyone can read it",
          },
        ],
        description:
          "Unlisted is not private. Publish only content intended for sharing.",
      },
      {
        displayName: "Format",
        name: "format",
        type: "options",
        default: "html",
        options: [
          { name: "HTML", value: "html" },
          { name: "Markdown", value: "markdown" },
        ],
      },
      {
        displayName: "Content",
        name: "content",
        type: "string",
        typeOptions: { rows: 8 },
        required: true,
        default: "",
        description:
          "HTML or Markdown report, up to 5 MiB in UTF-8. Do not include secrets or personal data. Ownership tokens are discarded: this node cannot update or delete publications, and content expires automatically. Disable workflow execution saving and avoid pinned data for sensitive inputs.",
      },
      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add option",
        default: {},
        options: [
          {
            displayName: "Lifetime (Days)",
            name: "ttl",
            type: "number",
            default: DEFAULT_TTL,
            typeOptions: { minValue: 1, maxValue: 30, numberPrecision: 0 },
            description:
              "Requested retention, 1–30 days (default 15). Existing identical content may keep its earlier expiry.",
          },
          {
            displayName: "Page Data",
            name: "state",
            type: "json",
            default: "{}",
            description:
              'Settings for visitor answers on an HTML page, e.g. {"collections":{"answers":{}}}. Select an existing owner credential to retain author access, and include the visitor SDK in Content. Null leaves settings unchanged.',
          },
          {
            displayName: "Custom Domain",
            name: "domain",
            type: "string",
            default: "",
            description:
              "Owned hostname for this HTML page. Requires a selected owner credential linked to one BrewPage profile. Follow the returned DNS records and next step.",
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    for (let index = 0; index < items.length; index++) {
      let item: INodeExecutionData | undefined;
      try {
        item = await publishItem(this, index);
      } catch {
        item = undefined;
      }
      // Fixed message only: transport errors may carry tokens or content.
      if (!item)
        throw new NodeOperationError(this.getNode(), NOT_CONFIRMED, {
          itemIndex: index,
        });
      output.push(item);
    }
    return [output];
  }
}

async function publishItem(
  context: IExecuteFunctions,
  index: number,
): Promise<INodeExecutionData | undefined> {
  const operation = context.getNodeParameter("operation", index);
  const content = context.getNodeParameter("content", index);
  const format = context.getNodeParameter("format", index);
  const access = context.getNodeParameter("access", index);
  const options = context.getNodeParameter("options", index, {});
  const settings =
    options && typeof options === "object" && !Array.isArray(options)
      ? (options as Record<string, unknown>)
      : {};
  const ttl =
    options && typeof options === "object" && "ttl" in options
      ? (options as { ttl: unknown }).ttl
      : DEFAULT_TTL;
  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    Buffer.byteLength(content, "utf8") > MAX_BYTES ||
    operation !== "publish" ||
    typeof format !== "string" ||
    !["html", "markdown"].includes(format) ||
    typeof access !== "string" ||
    !["unlisted", "public"].includes(access) ||
    typeof ttl !== "number" ||
    !Number.isInteger(ttl) ||
    ttl < 1 ||
    ttl > 30
  ) {
    return undefined;
  }
  let parsedState: unknown = settings.state;
  if (typeof parsedState === "string") parsedState = JSON.parse(parsedState);
  if (parsedState === null) parsedState = undefined;
  if (
    parsedState !== undefined &&
    (typeof parsedState !== "object" ||
      Array.isArray(parsedState) ||
      Buffer.byteLength(JSON.stringify(parsedState), "utf8") > 16384)
  )
    return undefined;
  const state = parsedState as IDataObject | undefined;
  if (settings.domain !== undefined && typeof settings.domain !== "string")
    return undefined;
  const domain =
    typeof settings.domain === "string" ? settings.domain.trim() : "";
  if ((state !== undefined || domain) && format !== "html") return undefined;
  const selectedCredential = context.getNode().credentials?.[CREDENTIAL_TYPE];
  if ((state !== undefined || domain) && !selectedCredential) return undefined;
  let ownerToken: unknown;
  let credentialsDecrypted: ICredentialsDecrypted | undefined;
  if (selectedCredential) {
    if (
      typeof selectedCredential.id !== "string" ||
      selectedCredential.id.length === 0
    )
      return undefined;
    const data = await context.getCredentials(CREDENTIAL_TYPE, index);
    ownerToken = data.ownerToken;
    if (typeof ownerToken !== "string" || !/^[A-Za-z0-9]{32}$/.test(ownerToken))
      return undefined;
    credentialsDecrypted = {
      id: selectedCredential.id,
      name: selectedCredential.name,
      type: CREDENTIAL_TYPE,
      data,
    };
  }
  const requestOptions: IHttpRequestOptions = {
    method: "POST",
    url: "https://brewpage.app/api/html",
    qs: {
      ttl,
      format,
      verbatim: true,
      ...(access === "public" ? { ns: "public" } : {}),
      ...(domain ? { domain } : {}),
    },
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    body: { content, format, ...(state !== undefined ? { state } : {}) },
    json: true,
    timeout: 60000,
    maxResponseBodyBytes: 65536,
    disableFollowRedirect: true,
  };
  const response: unknown = await (selectedCredential
    ? context.helpers.httpRequestWithAuthentication.call(
        context,
        CREDENTIAL_TYPE,
        requestOptions,
        { preAuthenticationRetryStatusCode: [], credentialsDecrypted },
      )
    : context.helpers.httpRequest(requestOptions));
  if (!response || typeof response !== "object") return undefined;
  const result = response as Record<string, unknown>;
  const link = confirmedLink(result, access);
  if (
    !link ||
    result.access !== access ||
    typeof result.expiresAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(
      result.expiresAt,
    ) ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    new Date(result.expiresAt).toISOString().slice(0, 19) !==
      result.expiresAt.slice(0, 19)
  ) {
    return undefined;
  }
  const action = (result.result as { action?: unknown } | undefined)?.action;
  return {
    json: {
      link: link.href,
      access,
      format,
      expiresAt: result.expiresAt,
      requestedTtlDays: ttl,
      reusedExisting: action === "merged",
      ...(state !== undefined || domain
        ? featureDetails(result, domain, ownerToken)
        : {}),
    },
    pairedItem: { item: index },
  };
}

function featureDetails(
  result: Record<string, unknown>,
  domain: string,
  ownerToken: unknown,
): IDataObject {
  const privateValues = [
    ownerToken,
    result.ownerToken,
    result.manageUrl,
    result.managementLink,
    result.content,
  ].filter(
    (value): value is string => typeof value === "string" && value.length >= 8,
  );
  const safeText = (value: unknown, max: number): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !privateValues.some((secret) => value.includes(secret)) &&
    !value.includes("\0") &&
    !/#k=bpm_|[\r\n]/.test(value);
  const codes = Array.isArray(result.notices)
    ? result.notices
        .slice(0, 32)
        .map((notice: unknown) =>
          notice && typeof notice === "object" && "code" in notice
            ? notice.code
            : undefined,
        )
        .filter(
          (code): code is string =>
            safeText(code, 80) &&
            /^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,8}$/.test(code),
        )
    : [];
  const output: IDataObject = codes.length ? { notices: codes } : {};
  if (!domain) return output;
  output.nextStep = DOMAIN_SETUP_UNKNOWN;
  if (
    codes.includes("domain-needs-account") ||
    codes.includes("domain-profile-ambiguous")
  ) {
    output.nextStep =
      "Link this credential's owner token unambiguously to one BrewPage profile, then attach the domain from that account.";
  }
  const item = result.customDomain;
  if (!item || typeof item !== "object") return output;
  const custom = item as Record<string, unknown>;
  let requested: URL;
  try {
    requested = new URL(`https://${domain}`);
  } catch {
    return output;
  }
  if (
    requested.pathname !== "/" ||
    requested.search ||
    requested.hash ||
    requested.username ||
    requested.password ||
    requested.port ||
    custom.hostname !== requested.hostname ||
    !safeText(custom.hostname, 253) ||
    typeof custom.status !== "string" ||
    !["pending_dns", "verifying", "active", "lost"].includes(custom.status) ||
    typeof custom.serving !== "boolean" ||
    !Array.isArray(custom.records) ||
    custom.records.length > 8
  )
    return output;
  const records: IDataObject[] = [];
  for (const record of custom.records) {
    if (!record || typeof record !== "object") return output;
    const row = record as Record<string, unknown>;
    const pendingAddress =
      row.type === "A" &&
      row.name === custom.hostname &&
      row.host === "@" &&
      row.state === "unknown" &&
      (row.value === undefined || row.value === null);
    if (
      !safeText(row.type, 8) ||
      !["TXT", "CNAME", "A", "AAAA", "ALIAS", "CAA"].includes(row.type) ||
      !safeText(row.name, 253) ||
      !safeText(row.host, 253) ||
      (!pendingAddress && !safeText(row.value, 512)) ||
      !safeText(row.state, 16) ||
      !["missing", "wrong", "ok", "foreign", "blocked", "unknown"].includes(
        row.state,
      )
    )
      return output;
    records.push({
      type: row.type,
      name: row.name,
      host: row.host,
      ...(row.value === undefined ? {} : { value: row.value as string | null }),
      state: row.state,
      ...(typeof row.optional === "boolean" ? { optional: row.optional } : {}),
    });
  }
  output.customDomain = {
    hostname: custom.hostname,
    status: custom.status,
    serving: custom.serving,
    ...(typeof custom.suspended === "boolean"
      ? { suspended: custom.suspended }
      : {}),
    records,
    ...(safeText(custom.problem, 128) &&
    /^[A-Z][A-Z0-9]*(?:_[A-Za-z0-9-]+)*$/.test(custom.problem)
      ? { problem: custom.problem }
      : {}),
    ...(custom.serving ? { url: `https://${custom.hostname}/` } : {}),
    nextStep: safeText(custom.nextStep, 2048)
      ? custom.nextStep
      : DOMAIN_SETUP_UNKNOWN,
  };
  delete output.nextStep;
  return output;
}

// Every reader link a create returns: path `/<ns>/<id>` or own host `<label>.brewpage.app/`.
function confirmedLink(
  result: Record<string, unknown>,
  access: string,
): URL | undefined {
  const { link: raw, namespace, id } = result;
  if (
    typeof raw !== "string" ||
    typeof namespace !== "string" ||
    typeof id !== "string" ||
    !/^[a-z0-9-]{1,32}$/.test(namespace) ||
    !/^[A-Za-z0-9]{10}$/.test(id) ||
    (namespace === "public") !== (access === "public")
  )
    return undefined;
  const link = new URL(raw);
  const prefix =
    namespace === "public"
      ? ""
      : `${namespace.startsWith("-") ? "n" : ""}${namespace}-`;
  const label = link.hostname.slice(0, -".brewpage.app".length);
  const valid =
    link.hostname === "brewpage.app"
      ? link.pathname === `/${namespace}/${id}`
      : link.hostname.endsWith(".brewpage.app") &&
        label.startsWith(prefix) &&
        /^[a-z0-9]{10}$/.test(label.slice(prefix.length)) &&
        !RESERVED_HOST_LABELS.includes(label) &&
        link.pathname === "/";
  return link.protocol === "https:" &&
    !link.username &&
    !link.password &&
    !link.port &&
    !link.search &&
    !link.hash &&
    valid
    ? link
    : undefined;
}
