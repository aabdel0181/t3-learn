import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import { T3_LEARN_DESKTOP_SCHEME } from "@t3tools/shared/t3LearnIdentity";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = [
  `${T3_LEARN_DESKTOP_SCHEME}://app`,
  "t3code-dev://app",
] as const;
