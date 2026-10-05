# Private desktop release administration

The authenticated routes are `/api/desktop/releases/windows-x64/latest` and
`/api/desktop/releases/windows-x64/:version/setup`. They use normal `requireAuth`:
missing/expired/revoked sessions and disabled users cannot read release data.
Responses are private/no-store. The backend never accepts uploads or writes the
release directory. Invalid versions, symlinks escaping the root and incorrect
installer hashes/sizes fail closed.

Deploy the reviewed backend through the existing exact-SHA production runbook.
Keep the host-only server override and its pinned hash unchanged. Enable the
existing compose configuration with these two non-secret host environment values:

```dotenv
GLINTEX_DESKTOP_RELEASE_HOST_DIRECTORY=/var/lib/glintex/desktop-releases
GLINTEX_DESKTOP_RELEASE_DIRECTORY=/app/desktop-releases
```

Create the directory outside all nginx/public roots. Use directories 0750 and
files 0640, with the backend service identity able to read; the bind mount is
read-only. The default local development cache is Git- and Docker-ignored.
Unconfigured hosting returns 503; an empty configured root returns 204.

After a successful private Windows build, verify its source/tree/run identity,
Setup.exe size/SHA-256, package audit and `windows-verification.json`. Publish
only the intended candidate, never the higher-version CI fixture:

```sh
node apps/backend/scripts/publish-desktop-release.mjs /private/delivery /private/windows-verification.json /var/lib/glintex/desktop-releases 'Optional scale driver setup and private user-controlled updates'
```

The operator-only publisher checks successful packaged/installed launch,
authenticated update, 1.0.0 manual bootstrap, settings/queue preservation,
uninstall/reinstall and private repository identity. It verifies the installer,
creates an immutable version directory, then atomically selects `latest.json`.
It does not download files or change credentials. Preserve the prior installer
and workstation profile for manual rollback; clients reject automatic downgrade.

Before delivery, verify anonymous requests reject both API routes, live
authenticated metadata and complete download match the exact intended SHA-256,
and no direct public webroot serves Setup.exe. Do not log session cookies.
Production publication of another version requires a new verified private build
and explicit release approval. Fleet installation is separate.
