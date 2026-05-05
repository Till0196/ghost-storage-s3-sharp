# ghost-storage-s3-sharp

Ghost storage adapter for S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, etc.) with Sharp image optimization.

## Features

- **All three Ghost storage types supported**: images, media (audio/video), and files (documents)
- Works with any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, etc.)
- Automatic image optimization via Sharp (resize, WebP/AVIF conversion)
- Responsive image variants generation
- Configurable per-type behavior (e.g. images optimized, media/files uploaded as-is)

## How files are stored

This adapter handles all three Ghost upload types. By default each is namespaced with a different `pathPrefix`:

| Ghost type | What's uploaded | Example key in bucket |
|------------|-----------------|------------------------|
| Images | jpg, png, webp, gif, svg, etc. | `content/images/2026/03/photo.jpg` |
| Media | mp4, mp3, wav, webm, etc. | `content/media/2026/03/clip.mp4` |
| Files | pdf, zip, csv, txt, etc. | `content/files/2026/03/doc.pdf` |

For images with optimization enabled (default), additional variants are generated. The bucket layout for an upload of `2026/03/photo.jpg` (with default `sizes: [600, 1200]`, `formats: ["webp", "avif"]`) plus a media and a file upload looks like:

```
my-bucket/
├── content/
│   ├── images/
│   │   └── 2026/03/
│   │       ├── photo.jpg          ← original format, max width  (URL returned to Ghost)
│   │       ├── photo.webp         ← additional format
│   │       └── photo.avif         ← additional format
│   ├── media/
│   │   └── 2026/03/
│   │       └── clip.mp4           ← uploaded as-is
│   └── files/
│       └── 2026/03/
│           └── doc.pdf            ← uploaded as-is
└── size/
    ├── w600/
    │   └── content/images/2026/03/
    │       ├── photo.jpg          ← resized 600w, original format
    │       ├── photo.webp
    │       └── photo.avif
    └── w1200/
        └── content/images/2026/03/
            ├── photo.jpg
            ├── photo.webp
            └── photo.avif
```

Resized variants are placed under a top-level `size/w{width}/` prefix, **outside** the configured `pathPrefix`. This makes it easy for a CDN/worker to rewrite responsive image requests to the appropriate variant.

Media, files, and images with optimization disabled are uploaded as a single key without variants.

## Installation

Copy the module into your Ghost installation:

```
/var/lib/ghost/node_modules/ghost-storage-s3-sharp/
```

Or use the provided Docker image which bundles it with Ghost:

```
ghcr.io/till0196/ghost-storage-s3-sharp:latest
```

## Configuration

Minimal `config.production.json`:

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

Full configuration with all options and per-type setup (images / media / files):

```json
{
  "storage": {
    "active": "ghost-storage-s3-sharp",
    "ghost-storage-s3-sharp": {
      "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
      "accessKeyId": "your-access-key",
      "secretAccessKey": "your-secret-key",
      "bucket": "your-bucket",
      "region": "auto",
      "checksumMode": "when_required",
      "cdnUrl": "https://cdn.example.com",
      "pathPrefix": "content/images",
      "enableImageOptimization": true,
      "maxWidth": 1600,
      "sizes": [600, 1200],
      "formats": ["webp", "avif"],
      "quality": { "webp": 80, "avif": 60, "jpeg": 85, "png": 85 }
    },
    "media": {
      "adapter": "ghost-storage-s3-sharp",
      "enableImageOptimization": false,
      "pathPrefix": "content/media"
    },
    "files": {
      "adapter": "ghost-storage-s3-sharp",
      "enableImageOptimization": false,
      "pathPrefix": "content/files"
    }
  },
  "imageOptimization": {
    "resize": false,
    "srcsets": false
  }
}
```

Connection settings (`endpoint`, `accessKeyId`, etc.) defined under the adapter name (`ghost-storage-s3-sharp`) are shared by all three types — only per-type overrides like `pathPrefix` and `enableImageOptimization` need to be repeated. Setting `imageOptimization.resize/srcsets` to `false` disables Ghost's built-in image processing in favor of this adapter's Sharp pipeline.

### All options

| Config key | Default | Description |
|------------|---------|-------------|
| `accessKeyId` | **required** | S3 access key ID |
| `secretAccessKey` | **required** | S3 secret access key |
| `bucket` | **required** | Bucket name |
| `cdnUrl` | **required** | CDN or public base URL for generated links |
| `endpoint` | — | Custom endpoint URL for S3-compatible services |
| `region` | `us-east-1` | AWS region (or `auto` for Cloudflare R2) |
| `checksumMode` | `when_supported` | `when_supported` (AWS S3) or `when_required` (R2/MinIO) |
| `pathPrefix` | — | Key prefix to namespace files within the bucket |
| `enableImageOptimization` | `true` | Enable Sharp image processing |
| `maxWidth` | `1600` | Maximum width for resized images |
| `sizes` | `[600, 1200]` | Responsive image widths (or `"600,1200"` from env vars) |
| `formats` | `["webp", "avif"]` | Additional formats to generate (or `"webp,avif"` / `""` from env vars) |
| `quality` | `{webp:80, avif:60, jpeg:85, png:85}` | Quality per format (or `"webp:80,avif:60,..."` from env vars) |

### Configuration via environment variables

Ghost natively maps environment variables to config using the `storage__<adapter>__<key>` convention — no custom env var prefix is needed. Values arrive as strings and are coerced (`"false"` → `false`, `"800,1600"` → `[800, 1600]`, etc.).

```sh
storage__active=ghost-storage-s3-sharp
storage__ghost-storage-s3-sharp__bucket=my-bucket
storage__ghost-storage-s3-sharp__cdnUrl=https://cdn.example.com
storage__ghost-storage-s3-sharp__formats=webp        # webp only
storage__ghost-storage-s3-sharp__enableImageOptimization=false
```

See the [Docker Compose example](#docker-compose-example) below for a full setup.

## Service-specific examples

### AWS S3

```json
{
  "storage": {
    "active": "ghost-storage-s3-sharp",
    "ghost-storage-s3-sharp": {
      "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
      "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "bucket": "my-ghost-bucket",
      "region": "ap-northeast-1",
      "cdnUrl": "https://my-ghost-bucket.s3.ap-northeast-1.amazonaws.com"
    }
  }
}
```

### Cloudflare R2

R2 does not support CRC32/CRC64-NVME checksums. Set `checksumMode: "when_required"` to work around this.

```json
{
  "storage": {
    "active": "ghost-storage-s3-sharp",
    "ghost-storage-s3-sharp": {
      "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
      "accessKeyId": "your-r2-access-key",
      "secretAccessKey": "your-r2-secret-key",
      "bucket": "my-ghost-bucket",
      "region": "auto",
      "checksumMode": "when_required",
      "cdnUrl": "https://cdn.example.com"
    }
  }
}
```

### MinIO

```json
{
  "storage": {
    "active": "ghost-storage-s3-sharp",
    "ghost-storage-s3-sharp": {
      "endpoint": "https://minio.example.com",
      "accessKeyId": "your-minio-access-key",
      "secretAccessKey": "your-minio-secret-key",
      "bucket": "my-ghost-bucket",
      "region": "us-east-1",
      "cdnUrl": "https://minio.example.com/my-ghost-bucket"
    }
  }
}
```

## Docker Compose example

Ghost natively maps `storage__<adapter>__<key>` environment variables to config, so no custom env var prefix is needed.

`.env` (sibling to your compose file):

```sh
# Cloudflare R2 credentials
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET=my-ghost-bucket
R2_CDN_URL=https://cdn.example.com

# Ghost / DB
GHOST_URL=https://example.com
MYSQL_ROOT_PASSWORD=change-me
```

`compose.yml`:

```yaml
services:
  ghost:
    image: ghcr.io/till0196/ghost-storage-s3-sharp:latest
    # or build from source:
    # build:
    #   context: https://github.com/Till0196/ghost-storage-s3-sharp.git
    restart: unless-stopped
    ports:
      - "2368:2368"
    environment:
      # ─── Ghost core ──────────────────────────────────────────────
      url: ${GHOST_URL}
      NODE_ENV: production
      server__host: 0.0.0.0
      server__port: 2368
      database__client: mysql
      database__connection__host: db
      database__connection__user: root
      database__connection__password: ${MYSQL_ROOT_PASSWORD}
      database__connection__database: ghost

      # ─── Disable Ghost's built-in image optimization ─────────────
      # (replaced by this adapter's Sharp pipeline)
      imageOptimization__resize: "false"
      imageOptimization__srcsets: "false"

      # ─── S3-compatible connection (shared by all three types) ────
      storage__ghost-storage-s3-sharp__endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
      storage__ghost-storage-s3-sharp__accessKeyId: ${R2_ACCESS_KEY_ID}
      storage__ghost-storage-s3-sharp__secretAccessKey: ${R2_SECRET_ACCESS_KEY}
      storage__ghost-storage-s3-sharp__bucket: ${R2_BUCKET}
      storage__ghost-storage-s3-sharp__region: auto
      storage__ghost-storage-s3-sharp__checksumMode: when_required  # R2/MinIO need this
      storage__ghost-storage-s3-sharp__cdnUrl: ${R2_CDN_URL}

      # ─── Images: optimized with Sharp ────────────────────────────
      storage__active: ghost-storage-s3-sharp
      storage__ghost-storage-s3-sharp__pathPrefix: content/images
      # Optional image tuning:
      # storage__ghost-storage-s3-sharp__maxWidth: "1600"
      # storage__ghost-storage-s3-sharp__sizes: "600,1200"
      # storage__ghost-storage-s3-sharp__formats: "webp,avif"  # set "" to disable extras

      # ─── Media (audio/video): passthrough ────────────────────────
      storage__media__adapter: ghost-storage-s3-sharp
      storage__media__enableImageOptimization: "false"
      storage__media__pathPrefix: content/media

      # ─── Files (documents): passthrough ──────────────────────────
      storage__files__adapter: ghost-storage-s3-sharp
      storage__files__enableImageOptimization: "false"
      storage__files__pathPrefix: content/files
    volumes:
      - ghost-content:/var/lib/ghost/content
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ghost
    volumes:
      - db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 5s
      retries: 20

volumes:
  ghost-content:
  db:
```

To switch backends, only the `storage__ghost-storage-s3-sharp__*` block changes:

| Backend | Required overrides |
|---------|-------------------|
| **Cloudflare R2** | `endpoint=https://<account-id>.r2.cloudflarestorage.com`, `region=auto`, `checksumMode=when_required` |
| **AWS S3** | `region=<region>` (e.g. `ap-northeast-1`); omit `endpoint` and `checksumMode` |
| **MinIO** | `endpoint=https://<minio-host>`, `checksumMode=when_required` |

## Image optimization details

When `enableImageOptimization` is enabled (default), uploaded images are processed by Sharp:

- Resized to fit within `maxWidth`
- Converted to additional formats (WebP, AVIF by default)
- Responsive variants generated at each size in `sizes`

Disable per-type via `storage__media__enableImageOptimization: "false"` (recommended for media/files since they aren't images).

Processable formats: `jpg`, `jpeg`, `png`, `webp`, `tiff`, `bmp`. Other types (`svg`, `gif`, `mp4`, `mp3`, `pdf`, etc.) are always uploaded as-is regardless of this setting.
