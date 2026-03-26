import fs from 'fs';
import path from 'path';

jest.mock('../src/lib/r2-client');
jest.mock('../src/lib/image-processor');

import { R2Client } from '../src/lib/r2-client';
import { generateVariants, getContentType } from '../src/lib/image-processor';
import R2Storage from '../src/index';

const MockR2Client = R2Client as jest.MockedClass<typeof R2Client>;
const mockGenerateVariants = generateVariants as jest.MockedFunction<typeof generateVariants>;
const mockGetContentType = getContentType as jest.MockedFunction<typeof getContentType>;

const baseConfig = {
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
    cdnUrl: 'https://images.example.com'
};

describe('R2Storage', () => {
    let adapter: InstanceType<typeof R2Storage>;
    let mockR2: {
        upload: jest.Mock;
        exists: jest.Mock;
        delete: jest.Mock;
        read: jest.Mock;
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockR2 = {
            upload: jest.fn().mockResolvedValue(undefined),
            exists: jest.fn().mockResolvedValue(false),
            delete: jest.fn().mockResolvedValue(undefined),
            read: jest.fn().mockResolvedValue(Buffer.from('test'))
        };
        MockR2Client.mockImplementation(() => mockR2 as any);

        mockGetContentType.mockImplementation((ext: string) => {
            const types: Record<string, string> = {
                jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml',
                mp4: 'video/mp4', mp3: 'audio/mpeg', pdf: 'application/pdf',
                json: 'application/json'
            };
            return types[ext] ?? 'application/octet-stream';
        });

        adapter = new R2Storage(baseConfig);
    });

    describe('constructor', () => {
        test('throws without bucket', () => {
            expect(() => new R2Storage({ accountId: 'x', cdnUrl: 'x' } as any))
                .toThrow('bucket');
        });

        test('throws without accountId', () => {
            expect(() => new R2Storage({ bucket: 'x', cdnUrl: 'x' } as any))
                .toThrow('accountId');
        });

        test('throws without cdnUrl', () => {
            expect(() => new R2Storage({ bucket: 'x', accountId: 'x' } as any))
                .toThrow('cdnUrl');
        });

        test('strips trailing slash from cdnUrl', () => {
            const a = new R2Storage({ ...baseConfig, cdnUrl: 'https://cdn.test.com/' });
            expect((a as any).cdnUrl).toBe('https://cdn.test.com');
        });

        test('defaults enableImageOptimization to true', () => {
            expect((adapter as any).enableImageOptimization).toBe(true);
        });

        test('defaults pathPrefix to empty string', () => {
            expect((adapter as any).pathPrefix).toBe('');
        });
    });

    describe('save — image optimization', () => {
        const mockFile = { name: 'photo.jpg', path: '/tmp/upload_123.jpg' };

        beforeEach(() => {
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('fake-image'));
            mockGenerateVariants.mockResolvedValue([
                { key: '2026/03/photo.jpg', buffer: Buffer.from('base'), contentType: 'image/jpeg' },
                { key: '2026/03/photo.webp', buffer: Buffer.from('webp'), contentType: 'image/webp' },
                { key: '2026/03/photo.avif', buffer: Buffer.from('avif'), contentType: 'image/avif' }
            ]);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('returns CDN URL', async () => {
            const url = await adapter.save(mockFile, '2026/03');
            expect(url).toBe('https://images.example.com/2026/03/photo.jpg');
        });

        test('uploads all variants for processable image', async () => {
            await adapter.save(mockFile, '2026/03');
            expect(mockGenerateVariants).toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(3);
        });

        test('skips image processing for SVG', async () => {
            const svgFile = { name: 'icon.svg', path: '/tmp/upload_svg.svg' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('<svg></svg>'));

            const url = await adapter.save(svgFile, '2026/03');

            expect(mockGenerateVariants).not.toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(1);
            expect(url).toMatch(/icon\.svg$/);
        });

        test('throws if base image upload fails', async () => {
            mockR2.upload.mockRejectedValueOnce(new Error('upload failed'));

            await expect(adapter.save(mockFile, '2026/03'))
                .rejects.toThrow('Failed to upload base image');
        });
    });

    describe('save — media and files (no optimization)', () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('uploads MP4 video without processing', async () => {
            const videoFile = { name: 'clip.mp4', path: '/tmp/upload_video.mp4' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('video-data'));

            const url = await adapter.save(videoFile, '2026/03');

            expect(mockGenerateVariants).not.toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(1);
            expect(mockR2.upload).toHaveBeenCalledWith(
                '2026/03/clip.mp4', Buffer.from('video-data'), 'video/mp4'
            );
            expect(url).toBe('https://images.example.com/2026/03/clip.mp4');
        });

        test('uploads MP3 audio without processing', async () => {
            const audioFile = { name: 'podcast.mp3', path: '/tmp/upload_audio.mp3' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('audio-data'));

            const url = await adapter.save(audioFile, '2026/03');

            expect(mockGenerateVariants).not.toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(1);
            expect(url).toBe('https://images.example.com/2026/03/podcast.mp3');
        });

        test('uploads PDF without processing', async () => {
            const pdfFile = { name: 'doc.pdf', path: '/tmp/upload_pdf.pdf' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('pdf-data'));

            const url = await adapter.save(pdfFile, '2026/03');

            expect(mockGenerateVariants).not.toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(1);
            expect(url).toBe('https://images.example.com/2026/03/doc.pdf');
        });

        test('uploads GIF without processing', async () => {
            const gifFile = { name: 'anim.gif', path: '/tmp/upload_gif.gif' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('gif-data'));

            const url = await adapter.save(gifFile, '2026/03');

            expect(mockGenerateVariants).not.toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(1);
        });
    });

    describe('save — with pathPrefix', () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('prepends pathPrefix to R2 key for media', async () => {
            const mediaAdapter = new R2Storage({ ...baseConfig, pathPrefix: 'content/media', enableImageOptimization: false });
            const videoFile = { name: 'clip.mp4', path: '/tmp/upload.mp4' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('video'));

            const url = await mediaAdapter.save(videoFile, '2026/03');

            expect(mockR2.upload).toHaveBeenCalledWith(
                'content/media/2026/03/clip.mp4', expect.any(Buffer), 'video/mp4'
            );
            expect(url).toBe('https://images.example.com/content/media/2026/03/clip.mp4');
        });

        test('prepends pathPrefix to R2 key for images with variants', async () => {
            const imgAdapter = new R2Storage({ ...baseConfig, pathPrefix: 'content/images' });
            const imgFile = { name: 'photo.jpg', path: '/tmp/upload.jpg' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('img'));
            mockGenerateVariants.mockResolvedValue([
                { key: 'content/images/2026/03/photo.jpg', buffer: Buffer.from('base'), contentType: 'image/jpeg' }
            ]);

            const url = await imgAdapter.save(imgFile, '2026/03');

            expect(mockGenerateVariants).toHaveBeenCalledWith(
                expect.any(Buffer),
                'content/images/2026/03/photo.jpg',
                expect.any(Object)
            );
            expect(url).toBe('https://images.example.com/content/images/2026/03/photo.jpg');
        });
    });

    describe('save — enableImageOptimization=false', () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        test('skips processing even for JPEG when optimization disabled', async () => {
            const noOptAdapter = new R2Storage({ ...baseConfig, enableImageOptimization: false });
            const jpgFile = { name: 'photo.jpg', path: '/tmp/upload.jpg' };
            jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('jpg'));

            await noOptAdapter.save(jpgFile, '2026/03');

            expect(mockGenerateVariants).not.toHaveBeenCalled();
            expect(mockR2.upload).toHaveBeenCalledTimes(1);
        });
    });

    describe('saveRaw', () => {
        test('uploads buffer and returns CDN URL', async () => {
            const buf = Buffer.from('raw data');
            const url = await adapter.saveRaw(buf, '2026/03/data.json');
            expect(mockR2.upload).toHaveBeenCalledWith('2026/03/data.json', buf, 'application/json');
            expect(url).toBe('https://images.example.com/2026/03/data.json');
        });

        test('applies pathPrefix to saveRaw', async () => {
            const prefixAdapter = new R2Storage({ ...baseConfig, pathPrefix: 'content/files' });
            const buf = Buffer.from('data');
            const url = await prefixAdapter.saveRaw(buf, '2026/03/data.json');
            expect(mockR2.upload).toHaveBeenCalledWith('content/files/2026/03/data.json', buf, 'application/json');
            expect(url).toBe('https://images.example.com/content/files/2026/03/data.json');
        });
    });

    describe('exists', () => {
        test('delegates to R2 client with joined path', async () => {
            mockR2.exists.mockResolvedValue(true);
            const result = await adapter.exists('photo.jpg', '2026/03');
            expect(mockR2.exists).toHaveBeenCalledWith('2026/03/photo.jpg');
            expect(result).toBe(true);
        });

        test('works without targetDir', async () => {
            mockR2.exists.mockResolvedValue(false);
            const result = await adapter.exists('photo.jpg');
            expect(mockR2.exists).toHaveBeenCalledWith('photo.jpg');
            expect(result).toBe(false);
        });

        test('applies pathPrefix', async () => {
            const prefixAdapter = new R2Storage({ ...baseConfig, pathPrefix: 'content/media' });
            await prefixAdapter.exists('clip.mp4', '2026/03');
            expect(mockR2.exists).toHaveBeenCalledWith('content/media/2026/03/clip.mp4');
        });
    });

    describe('delete', () => {
        test('deletes all variant keys for processable image', async () => {
            await adapter.delete('photo.jpg', '2026/03');
            // base + 2 formats + 2 sizes × 3 formats = 9
            expect(mockR2.delete).toHaveBeenCalledTimes(9);
        });

        test('deletes only one key for non-processable format', async () => {
            await adapter.delete('icon.svg', '2026/03');
            expect(mockR2.delete).toHaveBeenCalledTimes(1);
        });

        test('deletes only one key for media file', async () => {
            await adapter.delete('clip.mp4', '2026/03');
            expect(mockR2.delete).toHaveBeenCalledTimes(1);
        });

        test('deletes only one key when optimization disabled', async () => {
            const noOptAdapter = new R2Storage({ ...baseConfig, enableImageOptimization: false });
            await noOptAdapter.delete('photo.jpg', '2026/03');
            expect(mockR2.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe('read', () => {
        test('reads from R2 using path from options object', async () => {
            const buf = await adapter.read({ path: 'https://images.example.com/2026/03/photo.jpg' });
            expect(mockR2.read).toHaveBeenCalledWith('2026/03/photo.jpg');
            expect(Buffer.isBuffer(buf)).toBe(true);
        });

        test('reads from R2 using string path', async () => {
            await adapter.read('https://images.example.com/2026/03/photo.jpg');
            expect(mockR2.read).toHaveBeenCalledWith('2026/03/photo.jpg');
        });
    });

    describe('serve', () => {
        test('returns middleware that redirects to CDN', () => {
            const middleware = adapter.serve();
            const req = { path: '/2026/03/photo.jpg' } as any;
            const res = { redirect: jest.fn() } as any;
            const next = jest.fn();

            middleware(req, res, next);

            expect(res.redirect).toHaveBeenCalledWith(301, 'https://images.example.com/2026/03/photo.jpg');
        });

        test('applies pathPrefix in redirect', () => {
            const prefixAdapter = new R2Storage({ ...baseConfig, pathPrefix: 'content/media' });
            const middleware = prefixAdapter.serve();
            const req = { path: '/2026/03/clip.mp4' } as any;
            const res = { redirect: jest.fn() } as any;
            const next = jest.fn();

            middleware(req, res, next);

            expect(res.redirect).toHaveBeenCalledWith(301, 'https://images.example.com/content/media/2026/03/clip.mp4');
        });
    });

    describe('urlToPath', () => {
        test('strips CDN URL prefix', () => {
            expect(adapter.urlToPath('https://images.example.com/2026/03/photo.jpg'))
                .toBe('2026/03/photo.jpg');
        });

        test('strips Ghost content images path', () => {
            expect(adapter.urlToPath('/content/images/2026/03/photo.jpg'))
                .toBe('2026/03/photo.jpg');
        });

        test('strips Ghost content media path', () => {
            expect(adapter.urlToPath('/content/media/2026/03/clip.mp4'))
                .toBe('2026/03/clip.mp4');
        });

        test('strips Ghost content files path', () => {
            expect(adapter.urlToPath('/content/files/2026/03/doc.pdf'))
                .toBe('2026/03/doc.pdf');
        });

        test('applies pathPrefix when stripping content path', () => {
            const prefixAdapter = new R2Storage({ ...baseConfig, pathPrefix: 'content/media' });
            expect(prefixAdapter.urlToPath('/content/media/2026/03/clip.mp4'))
                .toBe('content/media/2026/03/clip.mp4');
        });

        test('handles relative paths', () => {
            expect(adapter.urlToPath('2026/03/photo.jpg'))
                .toBe('2026/03/photo.jpg');
        });
    });
});
