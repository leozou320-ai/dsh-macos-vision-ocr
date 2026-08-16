import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../host.mjs'

test('registers ocr_image and uses fixed subprocess argv', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-ocr-plugin-'))
  const calls = []
  let registered

  const subprocess = {
    async resolveExecutable(command) {
      assert.equal(command, 'swiftc')
      return '/usr/bin/swiftc'
    },
    spawn(spec) {
      calls.push(spec)
      const isCompile = spec.argv[0] === '/usr/bin/swiftc'
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: {
          stdout: { readFrom: () => ({ text: isCompile ? '' : '示例文字\n', lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
      }
    },
  }
  const tools = {
    register(tool) {
      registered = tool
      return () => {}
    },
  }
  const fs = {
    async resolve(path) { return { displayPath: path } },
    async stat() { return { type: 'file' } },
  }
  const services = { tools, subprocess, fs }
  const ctx = {
    get(key) { return services[key] },
    effect(install) { return install() },
  }

  try {
    apply(ctx, { cacheDir, languages: ['zh-Hans'], maxOutputBytes: 4096 })
    assert.equal(registered.name, 'ocr_image')

    const result = await registered.execute(
      { file_path: '/tmp/example image.png' },
      { signal: new AbortController().signal, agent: { session: { header: { cwd: '/tmp' } } } },
    )

    assert.deepEqual(result, {
      path: '/tmp/example image.png',
      text: '示例文字\n',
      truncated: false,
      languages: ['zh-Hans'],
    })
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].argv.slice(0, 2), ['/usr/bin/swiftc', '-O'])
    assert.deepEqual(calls[1].argv.slice(1), ['/tmp/example image.png', 'zh-Hans'])
    assert.equal('shell' in calls[0], false)
    assert.equal('shell' in calls[1], false)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('rejects unsupported paths before spawning a subprocess', async () => {
  let spawnCount = 0
  let registered
  const services = {
    tools: { register(tool) { registered = tool; return () => {} } },
    subprocess: {
      async resolveExecutable() { return '/usr/bin/swiftc' },
      spawn() { spawnCount += 1; throw new Error('must not spawn') },
    },
    fs: {
      async resolve(path) { return { displayPath: path } },
      async stat() { return { type: 'file' } },
    },
  }
  apply({ get: key => services[key], effect: install => install() })
  await assert.rejects(
    registered.execute({ file_path: '/tmp/notes.txt' }, { signal: new AbortController().signal }),
    /unsupported extension/,
  )
  assert.equal(spawnCount, 0)
})
