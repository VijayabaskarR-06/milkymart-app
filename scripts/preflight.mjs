// Fails fast, with an actionable message, when the toolchain cannot produce a
// release build. Both checks exist because both have silently broken a build
// before: the Capacitor 8 CLI hard-requires Node 22, and Android Gradle Plugin
// 8.7 cannot run on a JDK newer than 21.
import { spawnSync } from 'node:child_process'

const problems = []

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  problems.push(
    `Node ${process.versions.node} is too old — the Capacitor CLI requires Node >= 22.\n` +
      '  Install it (e.g. `brew install node`) and put it first on PATH:\n' +
      '    export PATH="/opt/homebrew/opt/node/bin:$PATH"',
  )
}

// AGP 8.7 supports JDK 17-21. JDK 22+ fails with an opaque Gradle/Kotlin error,
// so name the real cause here instead. `java -version` prints to stderr, so both
// streams are captured and concatenated before parsing.
const javaBin = process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : 'java'
const java = spawnSync(javaBin, ['-version'], { encoding: 'utf8' })
const javaOutput = `${java.stdout || ''}${java.stderr || ''}`
const javaVersion = /version "([^"]+)"/.exec(javaOutput)?.[1] ?? null

if (java.error || !javaVersion) {
  problems.push(
    'Could not determine the Java version. Install a JDK 21 (e.g. Temurin 21) and set JAVA_HOME:\n' +
      '    export JAVA_HOME=$(/usr/libexec/java_home -v 21)',
  )
} else {
  const major = Number(javaVersion.split('.')[0])
  if (major < 17 || major > 21) {
    problems.push(
      `JDK ${major} is not supported by Android Gradle Plugin 8.7 (needs 17-21).\n` +
        '  Point the build at a JDK 21, for example:\n' +
        '    export JAVA_HOME=$(/usr/libexec/java_home -v 21)',
    )
  }
}

if (problems.length) {
  console.error('\nRelease preflight failed:\n')
  for (const problem of problems) console.error(`- ${problem}\n`)
  process.exit(1)
}

console.log(`Preflight OK — Node ${process.versions.node}, JDK ${javaVersion}`)
