export type AttachmentChunk = {
  upload_id: string;
  name: string;
  offset: number;
  data: string;
  eof: boolean;
};
export type AttachmentProgress = { upload_id: string; next_offset: number; path: string | null };

const CHUNK_BYTES = 64 * 1024;

/** getRandomValues is also available on the Web client's HTTP LAN origin. */
function uploadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** Transfer one file, including an empty file. The destination publishes a path at EOF. */
export async function uploadAttachment(
  file: Blob, name: string, send: (chunk: AttachmentChunk) => Promise<AttachmentProgress>,
  options: { uploadId?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const id = options.uploadId ?? uploadId();
  let offset = 0;
  do {
    options.signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
    options.signal?.throwIfAborted();
    const end = offset + bytes.length;
    const eof = end === file.size;
    const reply = await send({ upload_id: id, name, offset, data: base64(bytes), eof });
    if (reply.upload_id !== id || reply.next_offset !== end || (!eof && reply.path !== null)) {
      throw new Error("Mismatched attachment receipt");
    }
    if (eof) {
      if (typeof reply.path !== "string" || !reply.path.startsWith("/")) {
        throw new Error("The destination did not publish the attachment");
      }
      return reply.path;
    }
    offset = end;
  } while (offset < file.size);
  throw new Error("Attachment transfer did not finish");
}
