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

export interface ImageProcessorConfig {
    maxWidth: number;
    sizes: number[];
    formats: string[];
    quality: Record<string, number>;
}

export async function generateVariants(
    inputBuffer: Buffer,
    uniquePath: string,
    config: ImageProcessorConfig
): Promise<ImageVariant[]> {
    const maxWidth = config.maxWidth;
    const sizes = config.sizes;
    const formats = config.formats;
    const quality = config.quality;

    const ext = path.extname(uniquePath).slice(1).toLowerCase();
    const basePath = uniquePath.slice(0, uniquePath.length - ext.length - 1);
    const dir = path.posix.dirname(uniquePath);
    const stem = path.posix.basename(basePath);

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
            console.warn(`[ghost-storage-r2] Failed to generate variant ${variantKey}:`, err.message);
            return null;
        }
    };

    const originalFormat = ext === 'jpg' ? 'jpeg' : ext;

    // Base size: original format at max width
    const baseVariant = await createVariant(maxWidth, originalFormat, uniquePath);
    if (!baseVariant) {
        throw new Error(`Failed to process base image: ${uniquePath}`);
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
            createVariant(size, originalFormat, `size/w${size}/${dir}/${stem}.${ext}`)
        );
        for (const format of formats) {
            sizePromises.push(
                createVariant(size, format, `size/w${size}/${dir}/${stem}.${format}`)
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
