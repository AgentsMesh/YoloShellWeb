# YoloShellWeb

Trusted web client plugin for [YoloShell](https://github.com/AgentsMesh/YoloShell).
It is a user-level Bun process that links into Yolo's local plugin registry and
serves an authenticated browser UI.

- `client/`: plugin manifest, Bun server, browser UI, unit tests and e2e scripts.
- `sdk/`: public Hub JSON-RPC client used by the plugin.

The Rust `yolo web` gateway remains in the core repository. It is a separate
scoped browser transport over `public-client.sock`, not part of this plugin.

## Install

```sh
git clone https://github.com/AgentsMesh/YoloShellWeb.git
cd YoloShellWeb
yolo plugin link "$PWD/client" --trust
yolo plugin startup
cat "$(yolo plugin data-dir web.client)/token"
# open the printed URL and paste the token
yolo plugin action web.client status
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
