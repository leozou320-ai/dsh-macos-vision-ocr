/**
 * DeepSeek Harness tool plugin that extracts image text with macOS Vision.
 * The embedded Swift helper is compiled lazily into the Harness cache.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'

export const name = 'dsh-macos-vision-ocr'
export const inject = ['tools', 'subprocess', 'fs']

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.tiff', '.tif', '.bmp', '.heic', '.heif',
])
const DEFAULT_LANGUAGES = ['zh-Hans', 'zh-Hant', 'en-US']
const STDERR_MAX_BYTES = 8192
const COMPILE_LOCKS = new Map()

const OCR_SWIFT_SOURCE = `import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(Data("usage: dsh-ocr <image> [lang1,lang2,...]".utf8))
    exit(2)
}
let imagePath = args[1]
let languages: [String] = args.count >= 3 && !args[2].isEmpty
    ? args[2].split(separator: ",").map(String.init)
    : ["zh-Hans", "zh-Hant", "en-US"]

guard let image = NSImage(contentsOfFile: imagePath),
      let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cgImage = rep.cgImage else {
    FileHandle.standardError.write(Data("cannot load image".utf8))
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = languages

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write(Data("ocr failed".utf8))
    exit(1)
}

let observations = (request.results ?? []) as [VNRecognizedTextObservation]
let ordered = observations.sorted { a, b in
    let ay = a.boundingBox.midY
    let by = b.boundingBox.midY
    if abs(ay - by) > 0.01 { return ay > by }
    return a.boundingBox.minX < b.boundingBox.minX
}
for observation in ordered {
    if let top = observation.topCandidates(1).first {
        print(top.string)
    }
}
`

function resolveCacheDir(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured)
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'cache', 'ocr')
}

function resolveLanguages(value) {
  if (value === undefined) return [...DEFAULT_LANGUAGES]
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error('languages must be a non-empty array of BCP-47 strings')
  }
  return value.map(item => item.trim())
}

function resolveMaxOutputBytes(value) {
  if (value === undefined) return 1_000_000
  if (!Number.isSafeInteger(value) || value < 1024) {
    throw new Error('maxOutputBytes must be a safe integer of at least 1024')
  }
  return value
}

function engineBinaryPath(cacheDir) {
  const digest = createHash('sha256').update(OCR_SWIFT_SOURCE).digest('hex').slice(0, 16)
  return join(cacheDir, `dsh-ocr-vision-${digest}`)
}

async function compileEngine(subprocess, cacheDir, signal) {
  const binaryPath = engineBinaryPath(cacheDir)
  if (existsSync(binaryPath)) return binaryPath
  const inFlight = COMPILE_LOCKS.get(binaryPath)
  if (inFlight !== undefined) return await inFlight

  const compiling = (async () => {
    await mkdir(cacheDir, { recursive: true })
    const sourcePath = join(cacheDir, 'dsh-ocr-vision.swift')
    await writeFile(sourcePath, OCR_SWIFT_SOURCE, 'utf8')
    const swiftcPath = await subprocess.resolveExecutable('swiftc', undefined, signal)
    const handle = subprocess.spawn({
      argv: [swiftcPath, '-O', sourcePath, '-o', binaryPath],
      cwd: cacheDir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: STDERR_MAX_BYTES },
        stderr: { maxBytes: STDERR_MAX_BYTES },
      },
      graceMs: 5000,
      signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const stderr = handle.collected.stderr?.readFrom(0).text || ''
      throw new Error(`failed to compile the OCR engine (swiftc exited ${outcome.exitCode}): ${stderr.trim()}`)
    }
    return binaryPath
  })().finally(() => COMPILE_LOCKS.delete(binaryPath))

  COMPILE_LOCKS.set(binaryPath, compiling)
  return await compiling
}

async function resolveImage(fs, filePath, cwd, signal) {
  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath)
  const extension = extname(resolvedPath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`cannot OCR "${filePath}": unsupported extension "${extension || '(none)'}"`)
  }
  const target = await fs.resolve(resolvedPath)
  const info = await fs.stat(target, signal)
  if (info.type !== 'file') throw new Error(`cannot OCR "${resolvedPath}": not a regular file`)
  return { path: target.displayPath || resolvedPath, cwd: cwd || dirname(resolvedPath) }
}

async function runOcr(subprocess, binaryPath, imagePath, languages, maxOutputBytes, cwd, signal) {
  const handle = subprocess.spawn({
    argv: [binaryPath, imagePath, languages.join(',')],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: maxOutputBytes },
      stderr: { maxBytes: STDERR_MAX_BYTES },
    },
    graceMs: 5000,
    signal,
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0)
  if (outcome.exitCode !== 0) {
    const stderr = handle.collected.stderr?.readFrom(0).text || ''
    throw new Error(`OCR engine failed (exit ${outcome.exitCode}): ${stderr.trim()}`)
  }
  return { text: stdout?.text || '', truncated: stdout?.lossy === true }
}

export function apply(ctx, config = {}) {
  const tools = ctx.get('tools')
  const subprocess = ctx.get('subprocess')
  const fs = ctx.get('fs')
  const cacheDir = resolveCacheDir(config.cacheDir)
  const defaultLanguages = resolveLanguages(config.languages)
  const maxOutputBytes = resolveMaxOutputBytes(config.maxOutputBytes)

  ctx.effect(() => tools.register({
    name: 'ocr_image',
    description: 'Extract text from an image with the local macOS Vision OCR engine. Accurate, offline, and API-key free. Best for screenshots and scanned documents. Reads text only; it does not identify objects, faces, or scenes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        file_path: {
          type: 'string',
          description: 'PNG, JPEG, WebP, GIF, TIFF, BMP, HEIC, or HEIF image path. Absolute, or relative to the session workspace.',
        },
        languages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional BCP-47 recognition languages, for example ["zh-Hans", "en-US"].',
        },
      },
      required: ['file_path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          text: { type: 'string' },
          truncated: { type: 'boolean' },
          languages: { type: 'array', items: { type: 'string' } },
        },
        required: ['path', 'text', 'truncated', 'languages'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<languages>${value.languages.join(', ')}</languages>\n<text>\n${value.text}\n</text>`,
      }],
    },
    async execute(args, exec) {
      const filePath = typeof args?.file_path === 'string' ? args.file_path.trim() : ''
      if (filePath === '') throw new Error('file_path must be a non-empty string')
      const languages = args.languages === undefined ? defaultLanguages : resolveLanguages(args.languages)
      const sessionCwd = exec?.agent?.session?.header?.cwd || exec?.cwd
      const image = await resolveImage(fs, filePath, sessionCwd, exec?.signal)
      const binaryPath = await compileEngine(subprocess, cacheDir, exec?.signal)
      const result = await runOcr(
        subprocess,
        binaryPath,
        image.path,
        languages,
        maxOutputBytes,
        image.cwd,
        exec?.signal,
      )
      return { path: image.path, text: result.text, truncated: result.truncated, languages }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `OCR ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }), 'dsh-macos-vision-ocr: tool')
}
