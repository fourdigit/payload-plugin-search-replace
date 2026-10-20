// Packs the package the way it is published and checks the tarball:
// - every path in `exports` / `main` / `types` (after `publishConfig`) is in it
// - no test files, sources or dev app ship
//
//   pnpm build && node scripts/check-pack.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'check-pack-'))
const problems = []

try {
  execFileSync('pnpm', ['pack', '--pack-destination', dir], { stdio: ['ignore', 'ignore', 'inherit'] })
  const tarball = readdirSync(dir).find((name) => name.endsWith('.tgz'))
  if (!tarball) {
    throw new Error('pnpm pack wrote no tarball')
  }
  const tarPath = path.join(dir, tarball)

  const files = new Set(
    execFileSync('tar', ['-tzf', tarPath], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, '')),
  )
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', tarPath, 'package/package.json'], { encoding: 'utf8' }))

  // Paths the published package.json points at.
  const targets = new Set([manifest.main, manifest.types].filter(Boolean))
  const collect = (value) => {
    if (typeof value === 'string') {
      targets.add(value)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect)
    }
  }
  collect(manifest.exports)

  for (const target of targets) {
    const file = target.replace(/^\.\//, '')
    if (!file.startsWith('dist/')) {
      problems.push(`package.json points outside dist: ${target}`)
    }
    if (!files.has(file)) {
      problems.push(`missing from the tarball: ${file}`)
    }
  }

  for (const file of files) {
    if (/\.(test|spec)\.[cm]?[jt]sx?(\.map)?$|\.test\.d\.ts$/.test(file)) {
      problems.push(`test file in the tarball: ${file}`)
    }
    if (file.startsWith('src/') || file.startsWith('dev/')) {
      problems.push(`source or dev file in the tarball: ${file}`)
    }
  }

  if (problems.length) {
    console.error(`${tarball}:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(`${tarball}: ${files.size} files, ${targets.size} export targets present, no tests or sources`)
  }
} finally {
  rmSync(dir, { force: true, recursive: true })
}
