import sharp from 'sharp';
import { generateVariants, getContentType, buildSizeVariantKey } from '../src/lib/image-processor';

describe('getContentType', () => {
    test('returns correct image MIME types', () => {
        expect(getContentType('jpg')).toBe('image/jpeg');
        expect(getContentType('jpeg')).toBe('image/jpeg');
        expect(getContentType('png')).toBe('image/png');
        expect(getContentType('webp')).toBe('image/webp');
        expect(getContentType('avif')).toBe('image/avif');
        expect(getContentType('svg')).toBe('image/svg+xml');
    });

    test('returns correct media MIME types', () => {
        expect(getContentType('mp4')).toBe('video/mp4');
        expect(getContentType('webm')).toBe('video/webm');
        expect(getContentType('mp3')).toBe('audio/mpeg');
        expect(getContentType('ogg')).toBe('audio/ogg');
        expect(getContentType('wav')).toBe('audio/wav');
    });

    test('returns correct document MIME types', () => {
        expect(getContentType('pdf')).toBe('application/pdf');
        expect(getContentType('json')).toBe('application/json');
        expect(getContentType('zip')).toBe('application/zip');
    });

    test('returns octet-stream for unknown types', () => {
        expect(getContentType('unknown')).toBe('application/octet-stream');
    });
});

describe('generateVariants', () => {
    let testBuffer: Buffer;

    beforeAll(async () => {
        testBuffer = await sharp({
            create: {
                width: 2000,
                height: 1000,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).jpeg().toBuffer();
    });

    const defaultConfig = {
        maxWidth: 1600,
        sizes: [600, 1200],
        formats: ['webp', 'avif'],
        quality: { webp: 80, avif: 60, jpeg: 85, png: 85 },
        layout: 'top-level' as const
    };

    test('generates 9 variants for a JPEG (top-level layout)', async () => {
        const variants = await generateVariants(testBuffer, '2026/03/photo.jpg', '', defaultConfig);

        expect(variants).toHaveLength(9);

        const keys = variants.map(v => v.key);
        expect(keys).toContain('2026/03/photo.jpg');
        expect(keys).toContain('2026/03/photo.webp');
        expect(keys).toContain('2026/03/photo.avif');
        expect(keys).toContain('size/w600/2026/03/photo.jpg');
        expect(keys).toContain('size/w600/2026/03/photo.webp');
        expect(keys).toContain('size/w600/2026/03/photo.avif');
        expect(keys).toContain('size/w1200/2026/03/photo.jpg');
        expect(keys).toContain('size/w1200/2026/03/photo.webp');
        expect(keys).toContain('size/w1200/2026/03/photo.avif');
    });

    test('sets correct content types', async () => {
        const variants = await generateVariants(testBuffer, '2026/03/photo.jpg', '', defaultConfig);

        const byKey = Object.fromEntries(variants.map(v => [v.key, v]));
        expect(byKey['2026/03/photo.jpg'].contentType).toBe('image/jpeg');
        expect(byKey['2026/03/photo.webp'].contentType).toBe('image/webp');
        expect(byKey['2026/03/photo.avif'].contentType).toBe('image/avif');
    });

    test('base image is resized to maxWidth', async () => {
        const variants = await generateVariants(testBuffer, '2026/03/photo.jpg', '', defaultConfig);
        const base = variants.find(v => v.key === '2026/03/photo.jpg')!;
        const meta = await sharp(base.buffer).metadata();
        expect(meta.width).toBe(1600);
    });

    test('does not upscale small images', async () => {
        const smallBuffer = await sharp({
            create: { width: 400, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 } }
        }).jpeg().toBuffer();

        const variants = await generateVariants(smallBuffer, '2026/03/small.jpg', '', defaultConfig);

        for (const v of variants) {
            const meta = await sharp(v.buffer).metadata();
            expect(meta.width).toBeLessThanOrEqual(400);
        }
    });

    test('generates 9 variants for PNG', async () => {
        const pngBuffer = await sharp({
            create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } }
        }).png().toBuffer();

        const variants = await generateVariants(pngBuffer, '2026/03/diagram.png', '', defaultConfig);
        expect(variants).toHaveLength(9);

        const keys = variants.map(v => v.key);
        expect(keys).toContain('2026/03/diagram.png');
        expect(keys).toContain('2026/03/diagram.webp');
        expect(keys).toContain('size/w600/2026/03/diagram.png');
    });

    test('all variant buffers are valid images', async () => {
        const variants = await generateVariants(testBuffer, '2026/03/photo.jpg', '', defaultConfig);

        for (const v of variants) {
            const meta = await sharp(v.buffer).metadata();
            expect(meta.width).toBeGreaterThan(0);
            expect(meta.height).toBeGreaterThan(0);
        }
    });

    test('ghost layout inserts size/wN after pathPrefix', async () => {
        const ghostConfig = { ...defaultConfig, layout: 'ghost' as const };
        const variants = await generateVariants(
            testBuffer,
            'content/images/2026/03/photo.jpg',
            'content/images',
            ghostConfig
        );

        const keys = variants.map(v => v.key);
        // Base/format variants stay at the original path
        expect(keys).toContain('content/images/2026/03/photo.jpg');
        expect(keys).toContain('content/images/2026/03/photo.webp');
        // Size variants have size/wN inserted after pathPrefix
        expect(keys).toContain('content/images/size/w600/2026/03/photo.jpg');
        expect(keys).toContain('content/images/size/w1200/2026/03/photo.avif');
        expect(keys).not.toContain('size/w600/content/images/2026/03/photo.jpg');
    });
});

describe('buildSizeVariantKey', () => {
    test('top-level layout puts size/wN at the start', () => {
        expect(buildSizeVariantKey('content/images/2026/03/photo.jpg', 'content/images', 600, 'webp', 'top-level'))
            .toBe('size/w600/content/images/2026/03/photo.webp');
    });

    test('ghost layout inserts size/wN after pathPrefix', () => {
        expect(buildSizeVariantKey('content/images/2026/03/photo.jpg', 'content/images', 600, 'webp', 'ghost'))
            .toBe('content/images/size/w600/2026/03/photo.webp');
    });

    test('ghost layout without pathPrefix puts size/wN at the start', () => {
        expect(buildSizeVariantKey('2026/03/photo.jpg', '', 600, 'webp', 'ghost'))
            .toBe('size/w600/2026/03/photo.webp');
    });
});
