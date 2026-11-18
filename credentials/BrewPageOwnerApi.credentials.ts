import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class BrewPageOwnerApi implements ICredentialType {
  name = "brewPageOwnerApi";
  displayName = "BrewPage Owner API";
  documentationUrl = "https://brewpage.app/api";
  icon: ICredentialType["icon"] = {
    light: "file:../nodes/BrewPage/brewpage.svg",
    dark: "file:../nodes/BrewPage/brewpage.svg",
  };
  supportedNodes = ["n8n-nodes-brewpage.brewPage", "CUSTOM.brewPage"];
  restrictToSupportedNodes = true as const;
  hideDomainRestrictionFields = true;
  properties: INodeProperties[] = [
    {
      displayName: "Owner Token",
      name: "ownerToken",
      type: "string",
      typeOptions: { password: true },
      required: true,
      default: "",
      description:
        "Existing BrewPage owner token. For a custom domain, link it unambiguously to a BrewPage profile first.",
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { "X-Owner-Token": "={{$credentials.ownerToken}}" },
    },
  };
  test: ICredentialTestRequest = {
    request: {
      method: "GET",
      url: "https://brewpage.app/api/limits",
      headers: {
        "User-Agent": "brewpage-n8n/0.2.0 (+https://brewpage.app)",
        Accept: "application/json",
      },
      json: true,
      timeout: 60000,
      maxResponseBodyBytes: 65536,
      disableFollowRedirect: true,
    },
    rules: [
      {
        type: "responseSuccessBody",
        properties: {
          key: "ownerMaxTtlDays",
          value: undefined,
          message:
            "This owner token is not usable. Check the saved credential.",
        },
      },
      {
        type: "responseSuccessBody",
        properties: {
          key: "ownerMaxTtlDays",
          value: null,
          message:
            "This owner token is not usable. Check the saved credential.",
        },
      },
    ],
  };
}
