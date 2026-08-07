import { randomBytes } from 'node:crypto';

/**
 * multipart/form-data, built by hand.
 *
 * Node's own FormData + fetch would do this — but its stream handling varies
 * by runtime version and its boundary is not inspectable, and the mocks need
 * to parse what we send. Sixty lines that produce exactly one wire format we
 * can read back beats a dependency on runtime behaviour.
 */
export interface MultipartFile {
  field: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export function buildMultipart(
  fields: Record<string, string>,
  files: MultipartFile[]
): { body: Uint8Array; contentType: string } {
  const boundary = `perception${randomBytes(12).toString('hex')}`;
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(enc.encode(`--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    chunks.push(
      enc.encode(
        `--${boundary}\r\ncontent-disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\ncontent-type: ${f.mime}\r\n\r\n`
      )
    );
    chunks.push(f.bytes);
    chunks.push(enc.encode(`\r\n`));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
