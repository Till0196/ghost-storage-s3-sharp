import {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} from '@aws-sdk/client-s3';

export interface R2ClientConfig {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region?: string;
}

export class R2Client {
    private readonly bucket: string;
    private readonly client: S3Client;

    constructor(config: R2ClientConfig) {
        this.bucket = config.bucket;
        this.client = new S3Client({
            region: config.region ?? 'auto',
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            },
            // R2 compatibility: R2 does not support the CRC32/CRC64-NVME checksum
            // headers that @aws-sdk/client-s3 v3.729+ sends by default.
            // Without these settings, PutObject fails with 501 NotImplemented.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED'
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
