# ghost-storage-s3-sharp

Ghost storage adapter for S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, etc.) with Sharp image optimization.

## Features

- Works with any S3-compatible object storage
- Automatic image optimization via Sharp (resize, WebP/AVIF conversion)
- Responsive image variants generation

## Installation

Copy the module into your Ghost installation:

```
/var/lib/ghost/node_modules/ghost-storage-s3-sharp/
```

Or use the provided Docker image which bundles it with Ghost:

```
ghcr.io/<your-org>/ghost-storage-s3-sharp:latest
```

## Configuration

Add the following to your Ghost `config.production.json`:

```json
{
  "storage": {
    "active": "ghost-storage-s3-sharp",
    "ghost-storage-s3-sharp": {
      "accessKeyId": "your-access-key",
      "secretAccessKey": "your-secret-key",
      "bucket": "your-bucket",
      "cdnUrl": "https://cdn.example.com"
    }
  }
}
```

### All options

All options can be set in the config file or via environment variables. Config file values take precedence.

| Config key | Environment variable | Default | Description |
|------------|----------------------|---------|-------------|
| `accessKeyId` | `GHOST_STORAGE_S3_ACCESS_KEY_ID` | **required** | S3 access key ID |
| `secretAccessKey` | `GHOST_STORAGE_S3_SECRET_ACCESS_KEY` | **required** | S3 secret access key |
| `bucket` | `GHOST_STORAGE_S3_BUCKET` | **required** | Bucket name |
| `cdnUrl` | `GHOST_STORAGE_S3_CDN_URL` | **required** | CDN or public base URL for generated links |
| `endpoint` | `GHOST_STORAGE_S3_ENDPOINT` | — | Custom endpoint URL for S3-compatible services |
| `region` | `GHOST_STORAGE_S3_REGION` | `us-east-1` | AWS region (or `auto` for Cloudflare R2) |
| `checksumMode` | `GHOST_STORAGE_S3_CHECKSUM_MODE` | `when_supported` | `when_supported` (AWS S3) or `when_required` (R2/MinIO) |
| `pathPrefix` | `GHOST_STORAGE_S3_PATH_PREFIX` | — | Key prefix to namespace files within the bucket |
| `enableImageOptimization` | `GHOST_STORAGE_S3_ENABLE_IMAGE_OPTIMIZATION` | `true` | Enable Sharp image processing |
| `maxWidth` | `GHOST_STORAGE_S3_MAX_WIDTH` | `1600` | Maximum width for resized images |
| `sizes` | `GHOST_STORAGE_S3_SIZES` | `600,1200` | Comma-separated responsive image widths |
| `formats` | `GHOST_STORAGE_S3_FORMATS` | `webp,avif` | Comma-separated additional formats to generate. Set empty string to disable. |
| `quality` | `GHOST_STORAGE_S3_QUALITY` | `webp:80,avif:60,jpeg:85,png:85` | Quality per format |

**Example: env var only (no config file needed)**

```sh
GHOST_STORAGE_S3_ACCESS_KEY_ID=your-key
GHOST_STORAGE_S3_SECRET_ACCESS_KEY=your-secret
GHOST_STORAGE_S3_BUCKET=my-ghost-bucket
GHOST_STORAGE_S3_CDN_URL=https://cdn.example.com
GHOST_STORAGE_S3_FORMATS=webp          # webp only
GHOST_STORAGE_S3_SIZES=800,1600
```

## Service-specific examples

### AWS S3

```json
{
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "bucket": "my-ghost-bucket",
  "region": "ap-northeast-1",
  "cdnUrl": "https://my-ghost-bucket.s3.ap-northeast-1.amazonaws.com"
}
```

### Cloudflare R2

R2 does not support CRC32/CRC64-NVME checksums. Set `checksumMode: "when_required"` to work around this.

```json
{
  "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
  "accessKeyId": "your-r2-access-key",
  "secretAccessKey": "your-r2-secret-key",
  "bucket": "my-ghost-bucket",
  "region": "auto",
  "checksumMode": "when_required",
  "cdnUrl": "https://cdn.example.com"
}
```

### MinIO

```json
{
  "endpoint": "https://minio.example.com",
  "accessKeyId": "your-minio-access-key",
  "secretAccessKey": "your-minio-secret-key",
  "bucket": "my-ghost-bucket",
  "region": "us-east-1",
  "cdnUrl": "https://minio.example.com/my-ghost-bucket"
}
```

## Image optimization

When `enableImageOptimization` is enabled (default), uploaded images are processed by Sharp:

- Resized to fit within `maxWidth`
- Converted to additional formats (WebP, AVIF by default)
- Responsive variants generated at each size in `sizes`

Non-image files (video, audio, PDF, SVG, GIF, etc.) are uploaded as-is without processing.
