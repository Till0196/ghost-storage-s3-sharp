import fs from 'fs';
import path from 'path';
import StorageBase from 'ghost-storage-base';
import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { R2Client } from './lib/r2-client';
import { generateVariants, getContentType, type ImageProcessorConfig } from './lib/image-processor';

// Formats that Sharp can process for resize + format conversion
const PROCESSABLE_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp'];

interface StorageFile {
    name: string;
    path: string;
    type?: string;
}

interface R2StorageConfig {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    cdnUrl: string;
    region?: string;
    // R2 key prefix to segregate images/media/files within the same bucket
    pathPrefix?: string;
    // Image optimization (only applies to processable image formats)
    enableImageOptimization?: boolean;
    maxWidth?: number;
    sizes?: number[];
    formats?: string[];
    quality?: Record<string, number>;
}

class R2Storage extends StorageBase {
    private readonly cdnUrl: string;
    private readonly pathPrefix: string;
    private readonly enableImageOptimization: boolean;
    private readonly imageConfig: ImageProcessorConfig;
    private readonly r2: R2Client;

    constructor(config: R2StorageConfig) {
        super();

        if (!config.bucket) {
            throw new Error('ghost-storage-r2 requires a bucket name');
        }
        if (!config.accountId) {
            throw new Error('ghost-storage-r2 requires an accountId');
        }
        if (!config.cdnUrl) {
            throw new Error('ghost-storage-r2 requires a cdnUrl');
        }

        this.cdnUrl = config.cdnUrl.replace(/\/+$/, '');
        this.pathPrefix = (config.pathPrefix ?? '').replace(/^\/+|\/+$/g, '');
        this.enableImageOptimization = config.enableImageOptimization ?? true;
        this.imageConfig = {
            maxWidth: config.maxWidth ?? 1600,
            sizes: config.sizes ?? [600, 1200],
            formats: config.formats ?? ['webp', 'avif'],
            quality: config.quality ?? { webp: 80, avif: 60, jpeg: 85, png: 85 }
        };

        this.r2 = new R2Client({
            accountId: config.accountId,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            bucket: config.bucket,
            region: config.region ?? 'auto'
        });
    }

    private shouldProcessImage(ext: string): boolean {
        return this.enableImageOptimization && PROCESSABLE_FORMATS.includes(ext);
    }

    private prefixKey(relativePath: string): string {
        return this.pathPrefix
            ? path.posix.join(this.pathPrefix, relativePath)
            : relativePath;
    }

    private buildUrl(prefixedKey: string): string {
        return `${this.cdnUrl}/${prefixedKey}`;
    }

    async save(file: StorageFile, targetDir?: string): Promise<string> {
        const dir = targetDir ?? this.getTargetDir();
        const uniquePath: string = await this.getUniqueFileName(file, dir);
        const prefixedPath = this.prefixKey(uniquePath);

        const buffer = await fs.promises.readFile(file.path);
        const ext = path.extname(file.name).slice(1).toLowerCase();

        if (!this.shouldProcessImage(ext)) {
            const contentType = getContentType(ext);
            await this.r2.upload(prefixedPath, buffer, contentType);
            return this.buildUrl(prefixedPath);
        }

        const variants = await generateVariants(buffer, prefixedPath, this.imageConfig);

        const baseKey = prefixedPath;
        const results = await Promise.allSettled(
            variants.map(v => this.r2.upload(v.key, v.buffer, v.contentType))
        );

        const baseIndex = variants.findIndex(v => v.key === baseKey);
        if (baseIndex !== -1 && results[baseIndex].status === 'rejected') {
            throw new Error(`Failed to upload base image: ${(results[baseIndex] as PromiseRejectedResult).reason.message}`);
        }

        results.forEach((result, i) => {
            if (result.status === 'rejected' && i !== baseIndex) {
                console.warn(
                    `[ghost-storage-r2] Failed to upload variant ${variants[i].key}:`,
                    (result as PromiseRejectedResult).reason.message
                );
            }
        });

        return this.buildUrl(prefixedPath);
    }

    async saveRaw(buffer: Buffer, targetPath: string): Promise<string> {
        const prefixedPath = this.prefixKey(targetPath);
        const ext = path.extname(targetPath).slice(1).toLowerCase();
        const contentType = getContentType(ext);
        await this.r2.upload(prefixedPath, buffer, contentType);
        return this.buildUrl(prefixedPath);
    }

    async exists(fileName: string, targetDir?: string): Promise<boolean> {
        const relativePath = targetDir ? path.posix.join(targetDir, fileName) : fileName;
        return this.r2.exists(this.prefixKey(relativePath));
    }

    async delete(fileName: string, targetDir?: string): Promise<void> {
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

        await Promise.allSettled(keys.map(k => this.r2.delete(k)));
    }

    async read(options: { path: string } | string): Promise<Buffer> {
        const filePath = typeof options === 'string' ? options : options.path;
        const key = this.urlToPath(filePath);
        return this.r2.read(key);
    }

    serve(): RequestHandler {
        return (req: Request, res: Response, _next: NextFunction) => {
            const relativePath = req.path.replace(/^\//, '');
            const prefixedPath = this.prefixKey(relativePath);
            res.redirect(301, this.buildUrl(prefixedPath));
        };
    }

    urlToPath(url: string): string {
        // Strip CDN URL prefix
        if (url.startsWith(this.cdnUrl)) {
            return url.slice(this.cdnUrl.length).replace(/^\//, '');
        }
        // Strip any Ghost content path prefix (/content/images/, /content/media/, /content/files/)
        const contentMatch = url.match(/\/content\/(?:images|media|files)\/(.*)/);
        if (contentMatch) {
            return this.prefixKey(contentMatch[1]);
        }
        return url.replace(/^\//, '');
    }
}

export = R2Storage;
