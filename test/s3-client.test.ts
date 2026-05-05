import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3CompatibleClient } from '../src/lib/s3-client';

jest.mock('@aws-sdk/client-s3', () => {
    const mockSend = jest.fn();
    return {
        S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
        PutObjectCommand: jest.fn(),
        HeadObjectCommand: jest.fn(),
        GetObjectCommand: jest.fn(),
        DeleteObjectCommand: jest.fn(),
        __mockSend: mockSend
    };
});

const { __mockSend: mockSend } = jest.requireMock('@aws-sdk/client-s3');

describe('S3CompatibleClient', () => {
    let client: S3CompatibleClient;

    beforeEach(() => {
        jest.clearAllMocks();
        client = new S3CompatibleClient({
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
            bucket: 'test-bucket',
            region: 'us-east-1'
        });
    });

    test('constructor creates S3Client with default WHEN_SUPPORTED checksum mode', () => {
        expect(S3Client).toHaveBeenCalledWith({
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'test-key',
                secretAccessKey: 'test-secret'
            },
            requestChecksumCalculation: 'WHEN_SUPPORTED',
            responseChecksumValidation: 'WHEN_SUPPORTED'
        });
    });

    test('constructor sets custom endpoint when provided', () => {
        new S3CompatibleClient({
            endpoint: 'https://account-id.r2.cloudflarestorage.com',
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
            bucket: 'test-bucket'
        });
        expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: 'https://account-id.r2.cloudflarestorage.com'
        }));
    });

    test('constructor sets WHEN_REQUIRED checksum mode for R2/MinIO compatibility', () => {
        new S3CompatibleClient({
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret',
            bucket: 'test-bucket',
            checksumMode: 'when_required'
        });
        expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED'
        }));
    });

    describe('upload', () => {
        test('sends PutObjectCommand with correct params', async () => {
            mockSend.mockResolvedValueOnce({});
            const buf = Buffer.from('test');
            await client.upload('2026/03/photo.jpg', buf, 'image/jpeg');

            expect(PutObjectCommand).toHaveBeenCalledWith({
                Bucket: 'test-bucket',
                Key: '2026/03/photo.jpg',
                Body: buf,
                ContentType: 'image/jpeg',
                CacheControl: 'public, max-age=31536000, immutable'
            });
            expect(mockSend).toHaveBeenCalledTimes(1);
        });
    });

    describe('exists', () => {
        test('returns true when object exists', async () => {
            mockSend.mockResolvedValueOnce({});
            expect(await client.exists('2026/03/photo.jpg')).toBe(true);
        });

        test('returns false when NotFound', async () => {
            const err = new Error('Not Found');
            err.name = 'NotFound';
            mockSend.mockRejectedValueOnce(err);
            expect(await client.exists('2026/03/missing.jpg')).toBe(false);
        });

        test('returns false when 404 status', async () => {
            const err: any = new Error('Not Found');
            err.$metadata = { httpStatusCode: 404 };
            mockSend.mockRejectedValueOnce(err);
            expect(await client.exists('2026/03/missing.jpg')).toBe(false);
        });

        test('throws on other errors', async () => {
            const err = new Error('Access Denied');
            err.name = 'AccessDenied';
            mockSend.mockRejectedValueOnce(err);
            await expect(client.exists('key')).rejects.toThrow('Access Denied');
        });
    });

    describe('delete', () => {
        test('sends DeleteObjectCommand', async () => {
            mockSend.mockResolvedValueOnce({});
            await client.delete('2026/03/photo.jpg');
            expect(DeleteObjectCommand).toHaveBeenCalledWith({
                Bucket: 'test-bucket',
                Key: '2026/03/photo.jpg'
            });
        });

        test('ignores NotFound errors', async () => {
            const err = new Error('Not Found');
            err.name = 'NotFound';
            mockSend.mockRejectedValueOnce(err);
            await expect(client.delete('missing.jpg')).resolves.toBeUndefined();
        });
    });

    describe('read', () => {
        test('returns buffer from GetObjectCommand', async () => {
            const body = { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
            mockSend.mockResolvedValueOnce({ Body: body });
            const result = await client.read('2026/03/photo.jpg');
            expect(Buffer.isBuffer(result)).toBe(true);
            expect(result).toEqual(Buffer.from([1, 2, 3]));
        });
    });
});
