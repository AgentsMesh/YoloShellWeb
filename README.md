# YoloShellWeb

Trusted web client plugin for [YoloShell](https://github.com/AgentsMesh/YoloShell).
It is a user-level Bun process that links into Yolo's local plugin registry and
serves an authenticated browser UI.

- `yolo-plugin.json`: trusted plugin manifest.
- `client/`: Bun server, browser UI, unit tests and e2e scripts.
- `sdk/`: public Hub JSON-RPC client used by the plugin.

This is the supported web client path for YoloShell. The plugin runs as a
trusted user-level process and uses the same-UID local management socket through
Yolo's plugin runtime. There is no separate `yolo web` browser gateway; the
management socket and Hub token never reach the browser.

## Install

```sh
yolo plugin install web.client --trust
yolo plugin startup
cat "$(yolo plugin data-dir web.client)/token"
# open the printed URL and paste the token
yolo plugin action web.client status
```

`plugin install` resolves the version from `AgentsMesh/YoloShellPlugins`,
verifies the pinned source commit and manifest, and links only after the
explicit `--trust` preview. For local development, clone this repository and
use:

```sh
yolo plugin link "$PWD/YoloShellWeb" --trust
```

See [client/README.md](client/README.md) for the plugin behavior, routes,
security model and temporary LAN access.

## Development

```sh
cd client
bun test
bun build browser/main.ts --target=browser --outdir "${TMPDIR:-/tmp}/yolo-web-browser"
bun build scripts/plugin.ts server/index.ts --target=bun --outdir "${TMPDIR:-/tmp}/yolo-web-server"
```

The browser and server are TypeScript and have no npm dependencies. The
terminal emulator is a pinned, self-hosted asset under `client/vendor/`; its
hashes are verified at load.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
