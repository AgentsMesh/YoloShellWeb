# Yolo Web Client (trusted-plugin canary)

This is the first trusted plugin canary. It is a user-level Bun process; it has
no sandbox, owns its daemon and serves its own HTTP UI. The canary currently binds
`0.0.0.0` so a trusted LAN can reach it; this is a temporary mode.

For a released version, run `yolo plugin install web.client`. The
commands below link a local checkout for development.

```sh
# from this repository root, with YoloShell installed
yolo plugin link "$PWD" --trust
export YOLO_PLUGIN_PORT=4199
# optional: only for a non-default Hub
export YOLO_HUB_SOCKET=/path/to/hub.sock YOLO_HUB_ID=<hub-id>
yolo plugin startup
yolo plugin log web.client
cat "$(yolo plugin data-dir web.client)/token"
# open the printed local/LAN URL and paste the token
yolo plugin action web.client status
yolo plugin action web.client stop
```

The token persists across restarts; delete the token file before starting the
plugin to rotate it.

The server acquires a private `broker.lock` in the plugin data directory before
listening. A second process pointed at the same data directory exits before it
opens the Hub, because the creation journal and local controller projection are
single-writer state. A stale lock from a dead PID is recovered on the next start. See [ADR 0029](https://github.com/AgentsMesh/YoloShell/blob/main/docs/adr/0029-single-broker-data-directory.md).

The browser UI is a workbench organized around two work concepts:
**Agents** (an agent session with Chat and Terminal views) and **Shells**
(terminal-only sessions). An agent's terminal is not repeated as a separate
shell row. **Needs you** is an inbox for answerable interactions. TUI layout
tabs and empty panes are not exposed; shared layouts remain internal to the TUI. Browser state has one immutable `AppState` owner in `browser/store.ts`: pure domain reducers under `browser/appReducer.ts`, controllers that dispatch intents and own effects, and the single event composition root in `browser/events.ts`; renderers read selectors and never mutate state. A per-observation `CatalogueIndex` backs agent, terminal and provider lookups, and selection stores an identity rather than a snapshot. The store boundary and selection identity are covered by the plugin unit suite.

The inventory endpoint is an authenticated diagnostic that returns the current
aggregate catalogue with an opaque machine handle for every Hub. The browser
receives a catalogue snapshot followed by per-machine epoch/revision patches; a revision gap triggers a private snapshot resync. The browser keeps live
phases visible (starting,
running, output-blocked, finalizing) and keeps a degraded observation from
erasing a row; exited or lost sessions are not shown. Selecting an agent opens
Chat when its native transcript is readable and otherwise falls back to its
live Terminal; selecting a shell opens Terminal. Chat renders agent text as
safe Markdown (headings, lists, code, tables, emphasis and http(s) links) without
interpreting source HTML. The current `submit_prompt` capability enables Chat input.
An unconfirmed submission keeps the draft for comparison with the transcript.
Interrupt sends the displayed observation’s stream ID and sequence. A changed
observation returns HTTP 409 so the user can review the current turn.

**+** beside Agents and Shells opens a creation dialog. Shell creation uses the
public Hub `create`/`finalize` flow; agent creation uses the Hub's closed
`agent_start` launch plan. Each request becomes a durable server-side intent:
`POST /api/shells` or `/api/agents` journals the complete original request
before dispatch, then returns `202` with a job id. The tab observes the project
until it is `done`, rejected, or `unknown`. Retries with the same idempotency
key return the same job; a plugin restart reconciles a shell through
`query_creation` and an agent through the same `start_token`, never by replaying
a new Create. An older Hub that cannot confirm an uncertain shell leaves the job
`unknown`, and the UI tells the user to check Agents and Shells instead of
resubmitting. A starting agent appears under Agents as a pending row
immediately, even before its terminal reaches the catalogue page, and is
replaced when its native binding is observed. Pending identities are persisted
with a bounded grace window so a delayed catalogue cannot erase them. The
creation capability stays server-side and is never sent to the browser.
Journal locations, state transitions and limits are in
[ADR 0027](https://github.com/AgentsMesh/YoloShell/blob/main/docs/adr/0027-durable-web-creation.md).

The agent picker uses each machine's Host-owned provider facts from the public
`list_providers` method. Unavailable providers are disabled, a machine with no
available provider cannot start an agent, and a new Hub rejects an unavailable
`agent_start` before creating a terminal. An older Hub without the method keeps
the static fallback. Provisioning, security and the wire shape are in
[ADR 0031](https://github.com/AgentsMesh/YoloShell/blob/main/docs/adr/0031-host-owned-provider-discovery.md).

An agent with a pending typed interaction appears under **Needs you** and shows
its prompt and choices above the pane. Answering re-reads the live snapshot,
takes the writer lease, sends the exact `AgentControl` response for that
interaction and releases the lease. Stale, replaced or unsupported interactions
are rejected without a terminal effect.

The terminal is a live xterm.js surface fed by one shared `TerminalActor` per
terminal runtime epoch. The actor owns the only Hub attachment and
`TerminalSession`; every tab attaches as an output/control subscriber. The actor
retains the seed and a bounded post-seed ring, so a late tab receives the same
history/snapshot and recent output without opening another Hub attachment. A
`resync_required` event or ring exhaustion reseeds the shared actor and resets
all subscribers. Slow subscribers are disconnected and resync on reconnect;
they never block the PTY. The initial seed asks for the raw retained history
stream, so scrollback, alternate-screen state and input modes survive reload and
reconnect; when the Worker journal is compacted the Hub falls back to the
`state_formatted()` snapshot. A Hub that fails the history seed without
returning that fallback is retried with the snapshot seed, and a Hub predating
the seed field is retried with the legacy seedless attach.

Control is projected from the actor: one local controller, every other tab
observing. Selecting a row is read-only. Typing or pasting takes control when the terminal
is free and preserves the whole gesture, including text pastes over 64 KiB. When another
tab controls, typing leaves it in control. **Take control** demotes the previous tab.
Hidden tabs retain control until release, disconnect or takeover. Closing the last
controller releases the actor's Hub lease. An external
TUI or broker remains the Hub authority and demotes all tabs if it takes over.
On binding, a pending agent's terminal selection becomes the Agent selection
while keeping the Terminal lens. Both sockets carry a 15 s heartbeat; a silent
half-open flow, frozen tab or Hub restart reconnects and rebuilds the actor's
private Hub session without a page reload.

Inventory and conversations are pushed over `/ws/session`. All tabs and machines share one catalogue watch
on the entry Hub. After the initial snapshots, only machines with changed catalogue cursors
need another resource read. Active sessions keep their live checks.
Older entry Hubs use snapshot polling. Each machine has an observation epoch and revision.
The first frame is a snapshot with those revisions; later frames are patches
containing only changed rows or removals, with a full snapshot for discovery,
epoch changes, unkeyed rows or a client revision gap. Mutations, long-poll
watches, query reads and administrative
operations use a bounded Hub channel pool keyed by destination and latency
class, so a slow AgentStart, prompt, peer or conversation watch cannot starve
the catalogue or another class. Machine handles are HMAC-derived from a
plugin-private key and stay stable across plugin restarts; a stale machine keeps
its last rows with a `stale`/`unreachable` status and cannot be used for
creation until it recovers.
The sidebar links to **Settings** (`/settings`) for agent alerts, quiet mode and
locking the tab. Hub and machines shows reachability and available providers.
The default machine applies to new shells and agents opened from All machines.
Selecting a machine in the sidebar takes precedence.

The terminal header's **Session options** menu contains **View terminal log**
and, on capable machines, **End session…** with confirmation. A normal shell
also accepts `exit`. The Web client releases its terminal view, output buffers
and connections when the Hub confirms exit. A temporary output failure shows
a reconnect action. Selecting text in a live terminal or its archived output copies
it on release. Paste images or files into the terminal (or use **Session options → Paste file…**)
to insert references on the terminal’s machine. Later keystrokes, pastes and Enter wait for the file
references. A failed transfer, a change of controller or a disconnect clears queued input and shows
a retry notice. In Chat, paste or use **Attach files** to add attachments to a draft.
**Send** transfers the bytes and submits the prompt.
The [SDK](../sdk/README.md) exposes the same Hub APIs to other plugins.

**History** in the sidebar footer fetches finished and
archived sessions from their owning machines on demand. A finished session can
be archived there. Archived history replays the retained output in a read-only
terminal. The list displays up to 500 rows.
See [archived terminal history](https://github.com/AgentsMesh/YoloShell/blob/main/docs/adr/0032-archived-terminal-history.md) and
[ADR 0030](https://github.com/AgentsMesh/YoloShell/blob/main/docs/adr/0030-web-terminal-lifecycle.md).

Notifications require a secure context; the button explains the HTTPS or
localhost requirement instead of silently doing nothing. Browser tabs never
poll the catalogue and never receive the Hub socket, raw Hub id, lease grant or
token. It receives only opaque machine handles for scoping and routing. The
user reads the token from the plugin data file and pastes it into the page.
Fixed routes are `/`, `/app.css`, `/app/*.js`, `/vendor/xterm.js`,
`/vendor/xterm.css`, `/vendor/addon-fit.js`, `/health`, `/api/inventory`
(authenticated diagnostics), `/api/cancel`, `/api/respond`, `/api/conversation` (older-page
pagination), `/api/prompt`, `/api/shells`, `/api/agents`,
`/api/jobs/<uuid>`, `/api/lifecycle`, `/api/archive` (on-demand archived rows),
`/api/archive/history` (bounded raw history), `/api/terminal/log` (bounded live
log), `/ws/session` (catalogue/conversation push),
`/ws/terminal` (output) and `/ws/control` (lease, input, resize,
take/release). All sockets require the exact Host and Origin, the
`yolo.web.terminal.v1` subprotocol, and a first-message token. There is no
generic Hub RPC proxy. `/api/layout` remains a server-side shared-layout read
for future workspace work; the browser currently exposes no layout or tab
surface.

## Vendored terminal emulator

The browser terminal uses a pinned, self-hosted xterm.js 6.0.0 and addon-fit
0.11.0, both MIT. The exact files, sources and SHA-256 hashes are recorded in
`vendor/manifest.json`; the licenses are beside them. The server verifies every
manifest hash at load and fails closed on a mismatch. The files are served from
the fixed `/vendor/` routes and are never loaded from a CDN or installed with a
package manager.

The vendored files are the only third-party JavaScript in this repository and
are exempt from the handwritten-line check. Dependency directories remain
forbidden; the emulator files are committed assets. The page keeps
`script-src 'self'`; because the emulator injects style elements, its CSP allows
`style-src 'self' 'unsafe-inline'` without accepting inline scripts or
user-authored styles. The core-repository decision is recorded in
[ADR 0024](https://github.com/AgentsMesh/YoloShell/blob/main/docs/adr/0024-web-terminal-streaming.md).

## Temporary LAN access

The server binds `0.0.0.0` for trusted LAN access. See
[temporary LAN access](docs/lan-access.md) for accepted hosts, origins and
OrbStack forwarding.

## Validation
```sh
bun test
bun build browser/main.ts browser/settings.ts --target=browser --outdir "${TMPDIR:-/tmp}/yolo-web-browser"
bun build scripts/plugin.ts server/index.ts --target=bun --outdir "${TMPDIR:-/tmp}/yolo-web-build"
```

The browser modules are TypeScript; the server discovers `browser/*.ts` and
transpiles each `/app/<name>.js` asset with `Bun.Transpiler`, so a new module is
served without a second allowlist. There are no npm dependencies or dependency
directories; the emulator files under `vendor/` are committed assets.
