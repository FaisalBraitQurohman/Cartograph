export {};

declare global {
  /**
   * Custom claims added to the Clerk session token.
   *
   * `org_name` is configured on the instance (Sessions -> Customize session
   * token) as `{"org_name": "{{org.name}}"}`. Without this declaration
   * `sessionClaims.org_name` is not typed, because Clerk only ships types for
   * its own default claims.
   */
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
