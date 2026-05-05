import sharp from 'sharp';
import path from 'path';

const CONTENT_TYPES: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    gif: 'image/gif',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    bmp: 'image/bmp',
    // Audio
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    // Documents
    pdf: 'application/pdf',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html'
};

export function getContentType(ext: string): string {
    return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

export interface ImageVariant {
    key: string;
    buffer: Buffer;
    contentType: string;
}

export type VariantLayout = 'ghost' | 'top-level';

export interface ImageProcessorConfig {
    maxWidth: number;
    sizes: number[];
    formats: string[];
    quality: Record<string, number>;
    layout: VariantLayout;
}

/**
 * Build the storage key for a resized variant.
 *
 * - 'ghost' layout (default): inserts `size/wN/` after pathPrefix, matching
 *   Ghost's built-in srcset URL convention (`/content/images/size/wN/.../photo.jpg`).
 * - 'top-level' layout: places `size/wN/` at the top of the bucket, useful when
 *   SSGs or custom themes need a stable, predictable key prefix.
 */
export function buildSizeVariantKey(
    prefixedPath: string,
    pathPrefix: string,
    size: number,
    format: string,
    layout: VariantLayout
): string {
    const ext = path.extname(prefixedPath).slice(1).toLowerCase();
    const basePath = prefixedPath.slice(0, prefixedPath.length - ext.length - 1);
    const stem = path.posix.basename(basePath);
    const sizeSegment = `size/w${size}`;

    if (layout === 'ghost') {
        const relativePath = pathPrefix && prefixedPath.startsWith(pathPrefix + '/')
            ? prefixedPath.slice(pathPrefix.length + 1)
            : prefixedPath;
        const relativeDir = path.posix.dirname(relativePath);
        return pathPrefix
            ? path.posix.join(pathPrefix, sizeSegment, relativeDir, `${stem}.${format}`)
            : path.posix.join(sizeSegment, relativeDir, `${stem}.${format}`);
    }
    // top-level
    const dir = path.posix.dirname(prefixedPath);
    return `${sizeSegment}/${dir}/${stem}.${format}`;
}

export async function generateVariants(
    inputBuffer: Buffer,
    prefixedPath: string,
    pathPrefix: string,
    config: ImageProcessorConfig
): Promise<ImageVariant[]> {
    const { maxWidth, sizes, formats, quality, layout } = config;

    const ext = path.extname(prefixedPath).slice(1).toLowerCase();
    const basePath = prefixedPath.slice(0, prefixedPath.length - ext.length - 1);

    const metadata = await sharp(inputBuffer).rotate().metadata();
    const originalWidth = metadata.width ?? maxWidth;

    const variants: ImageVariant[] = [];

    const createVariant = async (
        targetWidth: number,
        format: string,
        variantKey: string
    ): Promise<ImageVariant | null> => {
        try {
            let img = sharp(inputBuffer).rotate();

            const width = Math.min(targetWidth, originalWidth);
            img = img.resize({ width, withoutEnlargement: true });

            if (format === 'webp') {
                img = img.webp({ quality: quality.webp });
            } else if (format === 'avif') {
                img = img.avif({ quality: quality.avif });
            } else if (format === 'jpeg' || format === 'jpg') {
                img = img.jpeg({ quality: quality.jpeg, mozjpeg: true });
            } else if (format === 'png') {
                img = img.png({ quality: quality.png });
            }

            const buffer = await img.toBuffer();
            return { key: variantKey, buffer, contentType: getContentType(format) };
        } catch (err: any) {
            console.warn(`[ghost-storage-s3-sharp] Failed to generate variant ${variantKey}:`, err.message);
            return null;
        }
    };

    const originalFormat = ext === 'jpg' ? 'jpeg' : ext;

    // Base size: original format at max width
    const baseVariant = await createVariant(maxWidth, originalFormat, prefixedPath);
    if (!baseVariant) {
        throw new Error(`Failed to process base image: ${prefixedPath}`);
    }
    variants.push(baseVariant);

    // Additional formats at base size
    const baseFormatPromises = formats.map(format =>
        createVariant(maxWidth, format, `${basePath}.${format}`)
    );

    // Size variants in all formats
    const sizePromises: Promise<ImageVariant | null>[] = [];
    for (const size of sizes) {
        sizePromises.push(
            createVariant(size, originalFormat, buildSizeVariantKey(prefixedPath, pathPrefix, size, ext, layout))
        );
        for (const format of formats) {
            sizePromises.push(
                createVariant(size, format, buildSizeVariantKey(prefixedPath, pathPrefix, size, format, layout))
            );
        }
    }

    const results = await Promise.all([...baseFormatPromises, ...sizePromises]);

    for (const result of results) {
        if (result) {
            variants.push(result);
        }
    }

    return variants;
}
