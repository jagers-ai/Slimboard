# Temporary internal development preview

This is a short-lived invitation for a trusted development tester, using the
same application and the existing local experiment. It is not production
hosting or a public inference API. The ordinary development server on port
3000 must remain **Private** in Codespaces.

Start the existing local lab first, then in a second terminal:

```sh
NODE_ENV=development SLIMBOARD_ENABLE_CODEX_SHARE=1 npm run lab:share
```

The command requires a personal GitHub Codespace and prints one invitation
URL. The invitation token is in its fragment, so it is not sent in request
URLs or ordinary server access logs. Treat the entire invitation as private:
anyone it is forwarded to can use the test session. The invitation grants no
GitHub, source-editing, or Codex credential access.

Only port **3001**, the invitation proxy, may be forwarded for the tester.
Changing its visibility is a separate explicit action; starting the script
does not change Codespaces visibility. Review the intended recipient before
making that change. Never publish port 3000.

After starting the proxy and approving sharing with the intended tester,
run this in another Codespaces terminal:

```sh
gh codespace ports visibility 3001:public --codespace "$CODESPACE_NAME"
```

Send the invitation printed by the running proxy, not the bare forwarding
address. To close external access after testing:

```sh
gh codespace ports visibility 3001:private --codespace "$CODESPACE_NAME"
```

On first use, the proxy exchanges the invitation for a signed, HttpOnly,
Secure, SameSite=Strict cookie and removes the fragment. Every application
route and asset requires that cookie. App session cookies are separate;
the invitation cookie never reaches Next, and forwarded identity headers
are discarded. Only known application routes and static assets are proxied.

Each server start creates a fresh invitation valid for four hours and at
most ten analysis requests total across browsers. Analyses run one at a
time. Stop the script with Ctrl+C to revoke the invitation sooner. Restarting
creates a new invitation and invalidates the previous session. Session
material is stored only in a private directory under
`~/.slimboard/codex-share`, outside the repository, and removed on shutdown.

This proxy preserves the existing app's Supabase session credentials, but
does not configure Supabase or change its callback allowlist. The default
invitation opens `/lab/codex`, which works without Supabase. Cross-site
OAuth callbacks may require returning to the invitation after the provider
redirect because the invitation cookie intentionally uses SameSite=Strict.

Verification:

```sh
node --test scripts/codex-share.test.mjs
```
