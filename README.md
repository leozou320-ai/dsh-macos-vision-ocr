# dsh-macos-vision-ocr

English | [简体中文](README.zh-CN.md)

Offline OCR for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), powered by Apple's macOS Vision framework. The plugin adds an `ocr_image` tool that lets any text model extract text from screenshots, scans, and document images without an API key or network request.

## Features

- Runs locally with `VNRecognizeTextRequest` at accurate recognition level.
- Supports PNG, JPEG, WebP, GIF, TIFF, BMP, HEIC, and HEIF.
- Accepts BCP-47 recognition languages per call.
- Compiles its small embedded Swift helper on first use, then reuses a content-addressed cache.
- Returns bounded output and reports whether text was truncated.
- Uses fixed subprocess argument vectors; image paths are never interpolated into a shell command.

## Requirements

- macOS 13 or later.
- Xcode Command Line Tools with `swiftc` available on `PATH`.
- DeepSeek Harness `0.1.0-rc.5` or a compatible developer-preview build.

This plugin intentionally fails on Linux and Windows because Apple Vision is not available there.

## Install

Install directly from GitHub into any profile that should expose OCR:

```sh
dsh plugin --profile web add github:leozou320-ai/dsh-macos-vision-ocr
```

Restart the profile after installation. To remove it:

```sh
dsh plugin --profile web remove dsh-macos-vision-ocr
```

## Usage

Ask the agent to read an image, or call the tool explicitly:

```json
{
  "file_path": "./scan.png",
  "languages": ["zh-Hans", "en-US"]
}
```

The result contains the canonical image path, recognized text, selected languages, and a `truncated` flag.

## Configuration

Edit this package's row in a later Harness patch layer when you need different defaults:

```yaml
- id: dsh-macos-vision-ocr
  config:
    cacheDir: /absolute/path/to/cache
    languages: [en-US]
    maxOutputBytes: 2000000
```

| Key | Default | Description |
|---|---:|---|
| `cacheDir` | `$DSH_HOME/cache/ocr` | Swift source and compiled helper cache. |
| `languages` | `zh-Hans`, `zh-Hant`, `en-US` | Languages used when a tool call omits them. |
| `maxOutputBytes` | `1000000` | Maximum captured OCR stdout per call. |

## Permissions, privacy, and security

- OCR is local and the plugin makes no network requests.
- Image paths are checked through Harness's filesystem service before the native helper runs, so the active filesystem policy still controls access.
- The plugin runs `swiftc` once and then executes the cached native helper through Harness's subprocess service.
- Recognized text becomes tool output and therefore enters the current session transcript and model context. Do not OCR material you would not send to the configured model provider.
- Review third-party plugin source before installation and pin a commit for sensitive deployments.

## Known limitations

- Text recognition is not general visual understanding; it does not identify objects, faces, or scenes.
- Reading order is a geometric approximation and can be imperfect for multi-column or highly stylized layouts.
- The first call is slower because the Swift helper must compile.
- Handwriting quality depends on language, image quality, and the macOS Vision version.

## Development

```sh
node --check host.mjs
node --test
npm pack --dry-run
```

For a local install test:

```sh
dsh plugin --profile web add ./path/to/dsh-macos-vision-ocr
```

## License

[MIT](LICENSE)
