import type { AuthConfig } from "convex/server";

const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  // The isolated sales-demo deployment has no Clerk users. Buyer deployments
  // set the issuer and retain the authenticated product configuration.
  providers: issuer ? [{ domain: issuer, applicationID: "convex" }] : [],
} satisfies AuthConfig;
