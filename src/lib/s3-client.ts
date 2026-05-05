import {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} from '@aws-sdk/client-s3';

export interface S3ClientConfig {
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
    // Some S3-compatible services (e.g. Cloudflare R2) do not support CRC32/CRC64-NVME checksums.
    // Set to 'when_required' for those services; defaults to 'when_supported' (AWS S3 native behavior).
    checksumMode?: 'when_supported' | 'when_required';
}

export class S3CompatibleClient {
    private readonly bucket: string;
    private readonly client: S3Client;

    constructor(config: S3ClientConfig) {
        this.bucket = config.bucket;
        const checksumMode = (config.checksumMode ?? 'when_supported').toUpperCase() as 'WHEN_SUPPORTED' | 'WHEN_REQUIRED';
        this.client = new S3Client({
            region: config.region ?? 'us-east-1',
            ...(config.endpoint ? { endpoint: config.endpoint } : {}),
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            },
            requestChecksumCalculation: checksumMode,
            responseChecksumValidation: checksumMode
        });
    }

    async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable'
        }));
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.client.send(new HeadObjectCommand({
                Bucket: this.bucket,
                Key: key
            }));
            return true;
        } catch (err: any) {
            if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw err;
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.client.send(new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key
            }));
        } catch (err: any) {
            if (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
                return;
            }
            throw err;
        }
    }

    async read(key: string): Promise<Buffer> {
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key
        }));
        return Buffer.from(await response.Body!.transformToByteArray());
    }
}
