import {
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { addAbortSignal, Readable } from 'node:stream';

export interface StorageConfiguration {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
export interface PrivateObjectIdentity {
  agencyId: string;
  objectId: string;
  kind: 'backup' | 'source';
}
const MAX_OBJECT_BYTES = 32 * 1024 * 1024 + 36;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function objectKey(scope: PrivateObjectIdentity) {
  if (
    !UUID.test(scope.agencyId) ||
    !UUID.test(scope.objectId) ||
    !['backup', 'source'].includes(scope.kind)
  )
    throw new Error('Invalid private storage identity.');
  return `agencies/${scope.agencyId.toLowerCase()}/${scope.kind === 'backup' ? 'backups' : 'sources'}/${scope.objectId.toLowerCase()}`;
}
function sizeLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_OBJECT_BYTES)
    throw new Error('Invalid private storage byte limit.');
}
async function* bounded(
  source: AsyncIterable<Uint8Array>,
  limit: number,
  exact: boolean,
) {
  let count = 0;
  for await (const chunk of source) {
    count += chunk.byteLength;
    if (count > limit)
      throw new Error('Private storage object exceeds byte limit.');
    yield chunk;
  }
  if (exact && count !== limit)
    throw new Error('Private storage object size mismatch.');
}
/** Callers derive agencyId from the verified session; user paths are never accepted. */
export class PrivateObjectStore {
  private readonly client: S3Client;
  constructor(
    private readonly configuration: StorageConfiguration,
    client?: S3Client,
  ) {
    const url = new URL(configuration.endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(configuration.bucket) ||
      configuration.bucket.includes('..') ||
      !configuration.region ||
      !configuration.accessKeyId ||
      !configuration.secretAccessKey
    )
      throw new Error('Private storage configuration is missing or invalid.');
    this.client =
      client ??
      new S3Client({
        endpoint: url.origin,
        region: configuration.region,
        credentials: {
          accessKeyId: configuration.accessKeyId,
          secretAccessKey: configuration.secretAccessKey,
        },
        forcePathStyle: true,
        maxAttempts: 1,
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
  }
  async put(
    scope: PrivateObjectIdentity,
    source: AsyncIterable<Uint8Array>,
    bytes: number,
  ) {
    const Key = objectKey(scope);
    sizeLimit(bytes);
    const signal = AbortSignal.timeout(60000);
    const body = addAbortSignal(
      signal,
      Readable.from(bounded(source, bytes, true)),
    );
    // A source failure must reject the request, rather than become an unhandled stream event.
    body.on('error', () => {});
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.configuration.bucket,
          Key,
          Body: body,
          ContentLength: bytes,
          ContentType: 'application/octet-stream',
          CacheControl: 'no-store',
        }),
        { abortSignal: signal },
      );
      // Servers can reply after Content-Length bytes, before the source proves EOF.
      // Drain the remaining validator before accepting upload success.
      for await (const _ of body) {
        /* byte validation occurs in bounded() */
      }
    } catch {
      throw new Error('Private storage upload failed.');
    } finally {
      body.destroy();
    }
  }
  async *get(
    scope: PrivateObjectIdentity,
    limit: number,
  ): AsyncGenerator<Buffer> {
    const Key = objectKey(scope);
    sizeLimit(limit);
    const signal = AbortSignal.timeout(60000);
    let body: Readable | undefined;
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.configuration.bucket, Key }),
        { abortSignal: signal },
      );
      if (!(response.Body instanceof Readable))
        throw new Error('Missing private object body.');
      body = addAbortSignal(signal, response.Body);
      if (
        !Number.isSafeInteger(response.ContentLength) ||
        response.ContentLength! < 0 ||
        response.ContentLength! > limit
      )
        throw new Error('Private storage object exceeds byte limit.');
      for await (const chunk of bounded(body, response.ContentLength!, true))
        yield Buffer.from(chunk);
    } catch {
      throw new Error(
        'Private storage download failed or exceeded its size limit.',
      );
    } finally {
      body?.destroy();
    }
  }
  /** Only operator backup retention may call this, after selecting verified expiry records. */
  async purge(scope: PrivateObjectIdentity) {
    const Key = objectKey(scope);
    if (scope.kind !== 'backup')
      throw new Error('Backup retention cannot remove source uploads.');
    const host = new URL(this.configuration.endpoint).hostname.toLowerCase();
    const versioned = /^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(host);
    if (
      !versioned &&
      !(host.endsWith('.neon.tech') && host.includes('.storage.'))
    )
      throw new Error('Unsupported backup retention provider.');
    const signal = AbortSignal.timeout(60000),
      Bucket = this.configuration.bucket;
    const versions = async () => {
      let KeyMarker: string | undefined, VersionIdMarker: string | undefined;
      const found: string[] = [],
        seen = new Set<string>();
      for (let page = 0; page < 4; page++) {
        const response = await this.client.send(
          new ListObjectVersionsCommand({
            Bucket,
            Prefix: Key,
            MaxKeys: 100,
            KeyMarker,
            VersionIdMarker,
          }),
          { abortSignal: signal },
        );
        for (const item of [
          ...(response.Versions ?? []),
          ...(response.DeleteMarkers ?? []),
        ])
          if (item.Key === Key) {
            if (!item.VersionId)
              throw new Error('Backup object version is missing.');
            found.push(item.VersionId);
          }
        if (!response.IsTruncated) return [...new Set(found)];
        if (!response.NextKeyMarker || !response.NextVersionIdMarker)
          throw new Error('Backup version listing is incomplete.');
        const cursor = JSON.stringify([
          response.NextKeyMarker,
          response.NextVersionIdMarker,
        ]);
        if (seen.has(cursor))
          throw new Error('Backup version pagination repeated.');
        seen.add(cursor);
        KeyMarker = response.NextKeyMarker;
        VersionIdMarker = response.NextVersionIdMarker;
      }
      throw new Error('Backup versions exceed the bounded retention limit.');
    };
    try {
      if (versioned) {
        for (const VersionId of await versions())
          await this.client.send(
            new DeleteObjectCommand({ Bucket, Key, VersionId }),
            { abortSignal: signal },
          );
        if ((await versions()).length)
          throw new Error('Backup object versions still remain.');
      } else
        await this.client.send(new DeleteObjectCommand({ Bucket, Key }), {
          abortSignal: signal,
        });
      try {
        await this.client.send(new HeadObjectCommand({ Bucket, Key }), {
          abortSignal: signal,
        });
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode === 404
        )
          return;
        throw error;
      }
      throw new Error('Backup object is still present.');
    } catch {
      throw new Error('Private backup retention could not verify removal.');
    }
  }
  close() {
    this.client.destroy();
  }
}
