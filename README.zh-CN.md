# dsh-macos-vision-ocr

[English](README.md) | 简体中文

这是一个基于 Apple macOS Vision 框架的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 离线 OCR 插件。它新增 `ocr_image` 工具，让任何文本模型都能从截图、扫描件和文档图片中提取文字，无需 API Key，也不会由插件发起网络请求。

## 功能

- 使用 `VNRecognizeTextRequest` 的精准识别级别在本机运行。
- 支持 PNG、JPEG、WebP、GIF、TIFF、BMP、HEIC 和 HEIF。
- 每次调用可指定 BCP-47 识别语言。
- 首次使用时编译内嵌的小型 Swift 辅助程序，之后复用内容寻址缓存。
- 对返回文本设置字节上限，并明确返回是否发生截断。
- 子进程始终使用固定参数向量，不把图片路径拼进 shell 命令。

## 运行要求

- macOS 13 或更高版本。
- 已安装 Xcode Command Line Tools，并能从 `PATH` 找到 `swiftc`。
- DeepSeek Harness `0.1.0-rc.5` 或兼容的开发者预览版。

Apple Vision 不存在于 Linux 和 Windows，因此本插件会在这些平台上明确失败。

## 安装

把插件从 GitHub 安装到需要 OCR 的 profile：

```sh
dsh plugin --profile web add github:leozou320-ai/dsh-macos-vision-ocr
```

安装后重启对应 profile。卸载命令：

```sh
dsh plugin --profile web remove dsh-macos-vision-ocr
```

## 使用

可以直接让智能体读取图片，也可以显式调用工具：

```json
{
  "file_path": "./scan.png",
  "languages": ["zh-Hans", "en-US"]
}
```

结果包含图片规范路径、识别文字、实际语言列表和 `truncated` 截断标记。

## 配置

如需修改默认值，可在更后面的 Harness patch 层覆盖本插件行：

```yaml
- id: dsh-macos-vision-ocr
  config:
    cacheDir: /absolute/path/to/cache
    languages: [en-US]
    maxOutputBytes: 2000000
```

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `cacheDir` | `$DSH_HOME/cache/ocr` | Swift 源码和已编译辅助程序的缓存目录。 |
| `languages` | `zh-Hans`、`zh-Hant`、`en-US` | 工具调用未指定语言时使用的默认值。 |
| `maxOutputBytes` | `1000000` | 单次 OCR 捕获的 stdout 最大字节数。 |

## 权限、隐私与安全

- OCR 在本机完成，插件本身不发起网络请求。
- 原生辅助程序运行前，图片路径会先通过 Harness 文件系统服务检查，仍受当前文件访问策略约束。
- 插件首次运行时通过 Harness 子进程服务调用一次 `swiftc`，之后执行缓存的原生辅助程序。
- 识别出的文字会成为工具结果，进入当前会话记录和模型上下文。不要识别你不愿发送给当前模型提供方的材料。
- 敏感环境安装第三方插件前应检查源码，并固定到具体 commit。

## 已知局限

- OCR 只识别文字，不理解对象、人脸或场景。
- 阅读顺序按几何位置近似，多栏和复杂版式可能不准确。
- 首次调用需要编译 Swift 辅助程序，延迟会更高。
- 手写识别效果取决于语言、图片质量和 macOS Vision 版本。

## 开发与验证

```sh
node --check host.mjs
node --test
npm pack --dry-run
```

本地安装测试：

```sh
dsh plugin --profile web add ./path/to/dsh-macos-vision-ocr
```

## 许可证

[MIT](LICENSE)
