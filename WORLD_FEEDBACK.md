# Feedback for the World team

From building a payment agent that uses World ID as a step-up approval (OIDC authorization code with PKCE, `acr` requests, fresh `auth_time`). Written **before any real login**: we had no client credentials, so everything below comes from the public discovery document at `https://auth.world.org/.well-known/openid-configuration`, from searching for documentation, and from building against it. Items we could not confirm are marked *(unverified)*.

## What worked well

- **The discovery document is standard and complete.** An off-the-shelf OIDC library (`openid-client`) accepted it unchanged and built a correct authorization URL, with no World-specific code. S256 PKCE only, `claims_parameter_supported`, RS256, and `authorization_response_iss_parameter_supported` (RFC 9207) are exactly what a payments integration wants.
- **`auth_time` and `acr` in `claims_supported`** make step-up approval implementable without anything custom.
- **Pairwise subjects** are the right default for privacy.

## Friction and suggestions

1. **It is hard to learn which `acr` means what.** `acr_values_supported` lists only `https://world.org/oidc/acr/orb` and `.../orb-face`. We designed for more tiers (third-party notes mention a selfie or "Face Auth" level) and could not tell from anything official whether a lower tier exists, which credential produces which value, or what the test environment can issue. Suggestion: a short table in the docs mapping each `acr` to the credential behind it, and list every value an issuer can actually return in discovery.
2. **The `claims` request shape is ambiguous.** The OIDC spec uses `{"id_token":{"acr":{"essential":true,"values":[...]}}}` (what we send) and also allows `value`. Examples we found used both. *(unverified: which one the issuer honours, and what it returns when the requested `acr` is unavailable to the user: an error, or a token with a lower `acr`.)* A worked step-up example in the docs, including the failure behaviour, would remove the guesswork. For us the failure behaviour matters: we reject any `acr` outside the accepted set, but a clear `access_denied`-style response would give a better user experience than a rejection after the fact.
3. **Documentation was hard to find and mixed old with new.** Search surfaced a deprecated "Sign in with World ID v1" repository (marked as being sunset) alongside current material, and the page we expected for Agent Pass was not reachable from our tooling (this may be our environment, not your site). A banner or redirect from the legacy pages to the current guide would help.
4. **A sandbox issuer would unblock development.** Without an Orb-verified account it is impossible to exercise `orb` versus `orb-face` behaviour. We built a local simulator that implements the issuer side (discovery, JWKS, a consent page where you pick the outcome, PKCE-checked token exchange, signed RS256 tokens) so the whole flow could be tested: `src/adapters/world/simulator.ts`. An official test mode that lets a developer choose the `acr` returned would make integrations more correct before they meet real users, and the simulator is a reasonable reference for what that needs.
5. ***(unverified)* `max_age`.** We send `max_age=0` and `prompt=login` to force a fresh login and then require `auth_time` to be after the attempt began. Discovery lists `prompt=login`; it does not list `max_age`. Please confirm that `auth_time` is always present in the ID token when `max_age` is sent (the OIDC spec requires it), because a missing `auth_time` makes us reject the approval.
6. ***(unverified)* Linking an account to a person.** Because `sub` is pairwise per client, the first approval should store `(iss, sub)` for later comparison. We designed for this but have not exercised it. It would help to state explicitly that `sub` is stable for a person across logins for one client.
7. **Agent Pass specifically.** We used the human-approval pattern (an agent asks a verified human before spending). If Agent Pass has its own flow, such as device authorization (the issuer advertises the device grant), a doc comparing it with the code flow for "agent asks a human to approve one action" would help.

## What we would build on top of better answers

Account linking by `(iss, sub)`, a policy that maps risk to the exact credential level World can issue, and an approval record that shows the human what they approved. The approval is already bound to a hash of the exact payment; the missing piece is an issuer-side way to show that payment on the approval screen.
