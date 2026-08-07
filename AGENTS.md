# VideoFlow Development Rules

- Before changing an existing installation, read `docs/CUSTOMIZATION_UPGRADES.md` and `CUSTOMIZATIONS.local.md` when that local manifest exists.
- Treat the installation as customer-owned. Never replace the repository, reset customized files, copy a release tree over it, or resolve an update conflict by automatically taking the upstream version.
- Apply upgrades as reviewable Git patches. Preserve unrelated edits, assets, environment keys, provider settings, and customer data. New optional behavior must default safely and use a feature switch when an installation may reasonably want the prior behavior.
- Update `CUSTOMIZATIONS.local.md` when a change adds, removes, or relocates an installation-specific customization. Never create or rewrite that file unless the installation owner asks for it.
- Keep all private Convex reads and writes scoped to `identity.tokenIdentifier`; never accept an owner ID from a client.
- Public media and engagement for a password-protected video must validate a non-expired share session.
- Never commit `.env*`, provider credentials, deployment metadata, recordings, build artifacts, or customer data.
- Keep OpenAI and Resend optional. Their absence must not break recording, playback, sharing, or comments.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before delivery.
