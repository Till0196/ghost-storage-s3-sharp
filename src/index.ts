import fs from 'fs';
import path from 'path';
import StorageBase from 'ghost-storage-base';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { S3CompatibleClient } from './lib/s3-client';
import { generateVariants, getContentType, type ImageProcessorConfig } from './lib/image-processor';

// Formats that Sharp can process for resize + format conversion
const PROCESSABLE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp'];

const env = process.env;

function resolveStr(configVal: string | undefined, envKey: string): string | undefined {
    return configVal ?? (env[envKey] || undefined);
}

function resolveBool(configVal: boolean | string | undefined, envKey: string, defaultVal: boolean): boolean {
    if (configVal !== undefined) {
        if (typeof configVal === 'boolean') return configVal;
        return configVal.toLowerCase() !== 'false' && configVal !== '0';
    }
    const v = env[envKey];
    if (v === undefined) return defaultVal;
    return v.toLowerCase() !== 'false' && v !== '0';
}

function resolveInt(configVal: number | undefined, envKey: string, defaultVal: number): number {
    if (configVal !== undefined) return configVal;
    const v = env[envKey];
    return v ? parseInt(v, 10) : defaultVal;
}

function resolveIntArray(configVal: number[] | undefined, envKey: string, defaultVal: number[]): number[] {
    if (configVal !== undefined) return configVal;
    const v = env[envKey];
    if (!v) return defaultVal;
    return v.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

function resolveStrArray(configVal: string[] | undefined, envKey: string, defaultVal: string[]): string[] {
    if (configVal !== undefined) return configVal;
    const v = env[envKey];
    if (v === undefined) return defaultVal;
    if (v === '') return [];
    return v.split(',').map(s => s.trim()).filter(Boolean);
}

// Parses "webp:80,avif:60,jpeg:85,png:85"
function resolveQuality(
    configVal: Record<string, number> | undefined,
    envKey: string,
    defaultVal: Record<string, number>
): Record<string, number> {
    if (configVal !== undefined) return configVal;
    const v = env[envKey];
    if (!v) return defaultVal;
    return Object.fromEntries(
        v.split(',').map(pair => {
            const [fmt, q] = pair.split(':');
            return [fmt.trim(), parseInt(q.trim(), 10)];
        }).filter(([, q]) => !isNaN(q as number))
    );
}

interface StorageFile {
    name: string;
    path: string;
}

interface S3StorageConfig {
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
    cdnUrl?: string;
    region?: string;
    // Some S3-compatible services (e.g. Cloudflare R2) do not support CRC32/CRC64-NVME checksums.
    // Set to 'when_required' for those services; defaults to 'when_supported' (AWS S3 native behavior).
    checksumMode?: 'when_supported' | 'when_required';
    // S3 key prefix to segregate images/media/files within the same bucket
    pathPrefix?: string;
    // Image optimization (only applies to processable image formats)
    enableImageOptimization?: boolean | string;
    maxWidth?: number;
    sizes?: number[];
    // Additional formats to generate (e.g. ['webp', 'avif']). Set [] to disable.
    formats?: string[];
    quality?: Record<string, number>;
}

class S3Storage extends StorageBase {
    private readonly cdnUrl: string;
    private readonly pathPrefix: string;
    private readonly enableImageOptimization: boolean;
    private readonly imageConfig: ImageProcessorConfig;
    private readonly client: S3CompatibleClient;

    constructor(config: S3StorageConfig = {}) {
        super();

        const bucket = resolveStr(config.bucket, 'GHOST_STORAGE_S3_BUCKET');
        const cdnUrl = resolveStr(config.cdnUrl, 'GHOST_STORAGE_S3_CDN_URL');
        const accessKeyId = resolveStr(config.accessKeyId, 'GHOST_STORAGE_S3_ACCESS_KEY_ID') ?? '';
        const secretAccessKey = resolveStr(config.secretAccessKey, 'GHOST_STORAGE_S3_SECRET_ACCESS_KEY') ?? '';

        if (!bucket) throw new Error('ghost-storage-s3-sharp requires a bucket name');
        if (!cdnUrl) throw new Error('ghost-storage-s3-sharp requires a cdnUrl');

        this.cdnUrl = cdnUrl.replace(/\/+$/, '');
        this.pathPrefix = (resolveStr(config.pathPrefix, 'GHOST_STORAGE_S3_PATH_PREFIX') ?? '').replace(/^\/+|\/+$/g, '');
        this.enableImageOptimization = resolveBool(config.enableImageOptimization, 'GHOST_STORAGE_S3_ENABLE_IMAGE_OPTIMIZATION', true);
        this.imageConfig = {
            maxWidth: resolveInt(config.maxWidth, 'GHOST_STORAGE_S3_MAX_WIDTH', 1600),
            sizes: resolveIntArray(config.sizes, 'GHOST_STORAGE_S3_SIZES', [600, 1200]),
            formats: resolveStrArray(config.formats, 'GHOST_STORAGE_S3_FORMATS', ['webp', 'avif']),
            quality: resolveQuality(config.quality, 'GHOST_STORAGE_S3_QUALITY', { webp: 80, avif: 60, jpeg: 85, png: 85 })
        };

        const checksumMode = (resolveStr(config.checksumMode, 'GHOST_STORAGE_S3_CHECKSUM_MODE') ?? 'when_supported') as 'when_supported' | 'when_required';

        this.client = new S3CompatibleClient({
            endpoint: resolveStr(config.endpoint, 'GHOST_STORAGE_S3_ENDPOINT'),
            accessKeyId,
            secretAccessKey,
            bucket,
            region: resolveStr(config.region, 'GHOST_STORAGE_S3_REGION'),
            checksumMode
        });
    }

    private shouldProcessImage(ext: string): boolean {
        return this.enableImageOptimization && PROCESSABLE_FORMATS.includes(ext);
    }

    private assertSafeRelativePath(relativePath: string): void {
        if (relativePath.split('/').includes('..')) {
            throw new Error(`Invalid path (path traversal attempt): ${relativePath}`);
        }
    }

    private prefixKey(relativePath: string): string {
        this.assertSafeRelativePath(relativePath);
        return this.pathPrefix
            ? path.posix.join(this.pathPrefix, relativePath)
            : relativePath;
    }

    private buildUrl(prefixedKey: string): string {
        return `${this.cdnUrl}/${prefixedKey}`;
    }

    async save(file: StorageFile, targetDir?: string): Promise<string> {
        this.assertSafeRelativePath(file.name);
        if (targetDir) this.assertSafeRelativePath(targetDir);
        const dir = targetDir ?? this.getTargetDir();
        const uniquePath: string = await this.getUniqueFileName(file, dir);
        const prefixedPath = this.prefixKey(uniquePath);

        const buffer = await fs.promises.readFile(file.path);
        const ext = path.extname(file.name).slice(1).toLowerCase();

        if (!this.shouldProcessImage(ext)) {
            const contentType = getContentType(ext);
            await this.client.upload(prefixedPath, buffer, contentType);
            return this.buildUrl(prefixedPath);
        }

        const variants = await generateVariants(buffer, prefixedPath, this.imageConfig);

        const results = await Promise.allSettled(
            variants.map(v => this.client.upload(v.key, v.buffer, v.contentType))
        );

        const baseIndex = variants.findIndex(v => v.key === prefixedPath);
        if (baseIndex !== -1 && results[baseIndex].status === 'rejected') {
            throw new Error(`Failed to upload base image: ${(results[baseIndex] as PromiseRejectedResult).reason.message}`);
        }

        results.forEach((result, i) => {
            if (result.status === 'rejected' && i !== baseIndex) {
                console.warn(
                    `[ghost-storage-s3-sharp] Failed to upload variant ${variants[i].key}:`,
                    (result as PromiseRejectedResult).reason.message
                );
            }
        });

        return this.buildUrl(prefixedPath);
    }

    async saveRaw(buffer: Buffer, targetPath: string): Promise<string> {
        this.assertSafeRelativePath(targetPath);
        const prefixedPath = this.prefixKey(targetPath);
        const ext = path.extname(targetPath).slice(1).toLowerCase();
        const contentType = getContentType(ext);
        await this.client.upload(prefixedPath, buffer, contentType);
        return this.buildUrl(prefixedPath);
    }

    async exists(fileName: string, targetDir?: string): Promise<boolean> {
        this.assertSafeRelativePath(fileName);
        if (targetDir) this.assertSafeRelativePath(targetDir);
        const relativePath = targetDir ? path.posix.join(targetDir, fileName) : fileName;
        return this.client.exists(this.prefixKey(relativePath));
    }

    async delete(fileName: string, targetDir?: string): Promise<void> {
        this.assertSafeRelativePath(fileName);
        if (targetDir) this.assertSafeRelativePath(targetDir);
        const relativePath = targetDir ? path.posix.join(targetDir, fileName) : fileName;
        const prefixedPath = this.prefixKey(relativePath);
        const ext = path.extname(prefixedPath).slice(1).toLowerCase();

        const keys = [prefixedPath];

        if (this.shouldProcessImage(ext)) {
            const basePath = prefixedPath.slice(0, prefixedPath.length - ext.length - 1);
            const dir = path.posix.dirname(prefixedPath);
            const stem = path.posix.basename(basePath);

            for (const format of this.imageConfig.formats) {
                keys.push(`${basePath}.${format}`);
            }
            for (const size of this.imageConfig.sizes) {
                keys.push(`size/w${size}/${dir}/${stem}.${ext}`);
                for (const format of this.imageConfig.formats) {
                    keys.push(`size/w${size}/${dir}/${stem}.${format}`);
                }
            }
        }

        await Promise.allSettled(keys.map(k => this.client.delete(k)));
    }

    async read(options: { path: string } | string): Promise<Buffer> {
        const filePath = typeof options === 'string' ? options : options.path;
        const key = this.urlToPath(filePath);
        return this.client.read(key);
    }

    serve(): RequestHandler {
        return (req: Request, res: Response, _next: NextFunction) => {
            const relativePath = req.path.replace(/^\//, '');
            try {
                const prefixedPath = this.prefixKey(relativePath);
                res.redirect(301, this.buildUrl(prefixedPath));
            } catch {
                res.status(400).end();
            }
        };
    }

    urlToPath(url: string): string {
        let key: string;
        // Strip CDN URL prefix
        if (url.startsWith(this.cdnUrl)) {
            key = url.slice(this.cdnUrl.length).replace(/^\//, '');
        } else {
            // Strip any Ghost content path prefix (/content/images/, /content/media/, /content/files/)
            const contentMatch = url.match(/\/content\/(?:images|media|files)\/(.*)/);
            if (contentMatch) {
                return this.prefixKey(contentMatch[1]);
            }
            key = url.replace(/^\//, '');
        }
        this.assertSafeRelativePath(key);
        return key;
    }
}

export = S3Storage;
