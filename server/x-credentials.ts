import { xBearerTokenHint } from "./secrets.js";

export interface XCredentialStatus {
  configured: boolean;
  hint?: string;
}

export const readXCredentialStatus = async (dependencies: {
  getBearerToken: () => Promise<string>;
}): Promise<XCredentialStatus> => {
  try {
    const token = (await dependencies.getBearerToken()).trim();
    return token ? { configured: true, hint: xBearerTokenHint(token) } : { configured: false };
  } catch {
    return { configured: false };
  }
};
