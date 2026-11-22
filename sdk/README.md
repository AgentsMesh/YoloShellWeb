# Managed Chat and file attachments

A trusted plugin connects to its local Yolo entry Hub through `HubClient.connect(endpoint)`.
The entry routes requests to the machine named in the terminal or agent address.
A browser application keeps this connection and writer leases in its plugin server.

## Paste a file

`stageFile` streams a `Blob` to a particular terminal runtime. The returned
absolute path belongs to the destination machine. The original filename and
extension are preserved. A plugin can paste that reference into the terminal
or attach it to a Chat prompt. Staging a file does not press Enter.

```ts
import { stageFile } from "./src/index";

const target = binding.runtime;
const supported = await hub.extensions(target.address.hub_id);
if (supported.includes("stage_attachment")) {
  const path = await stageFile(hub, target, Bun.file(localPath), originalName);
  const uri = "file://" + path.split("/").map(encodeURIComponent).join("/");
  const prompt = [
    { type: "text", text: "Describe the diagram." },
    { type: "resource_link", name: originalName, uri, mimeType: "image/png" },
  ];
  await hub.chat.send(binding, prompt);
}
```

Use the same `uploadId` in the optional final argument to retry an interrupted
transfer of the same file. Each acknowledgement is checked. Empty files and
multi-chunk files use the same API. Archiving the terminal clears its staged files.

## Read and control an existing agent

```ts
const destination = binding.agent.address.hub_id;
const session = await hub.chat.open(binding, destination);
const { reading } = await hub.chat.read({
  address: session.address,
  binding,
  cursor: null,
  limits: { entries: 64, bytes: 262144 },
  since_generation: null,
  since_revision: null,
}, destination, 1000);

if (reading.status === "page") {
  for (const entry of reading.page.entries) {
    for (const update of entry.updates) render(update);
  }
}
```

`hub.chat` exposes the versioned `chat_v1` protocol. A read returns a page
of stable entries or an unchanged revision. Pass the page’s `next_cursor`
to read older history. For a watch, pass its generation and revision and a
wait time. Replace the latest page on a change and reconcile entries by ID.

The update discriminator is `sessionUpdate`. It identifies user and agent
messages, thoughts, tool calls and results, compactions and notices. Tool
results carry their original `toolCallId` across page boundaries. The SDK
adapts legacy Hub transcripts to the same update shapes.

`hub.chat.state(target, destination)` returns the agent’s current capabilities,
cursor, lifecycle and pending interaction. Use `hub.chat.send(binding, content)`
to submit a text or rich prompt. The same Chat client handles writer ownership
when answering a question or cancelling work:

```ts
const { agent } = await hub.chat.state(binding.agent, destination);
await hub.chat.answer(binding, agent.cursor, agent.interaction.reference.id,
  { kind: "choice", choice: chosenOption });
// On a separate interrupt gesture, use the latest observed cursor.
await hub.chat.cancel(binding, currentCursor);
```

A text interaction accepts `{kind: "text", text: answer}`. Receipts report
whether delivery was confirmed, rejected or uncertain. Integrations that
already own a writer lease can use the lower-level `hub.chat.control` method.

Resource links are supplied to the managed CLI as destination-local file
references. Its native file or image tools determine how the model reads
that content. Old entry Hubs accept text-only prompts. Older terminal origins
need the file-transfer extension before a client can stage bytes.
