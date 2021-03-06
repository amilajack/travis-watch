#!/usr/bin/env node
'use strict'

const fs = require('fs')
const getRepo = require('get-pkg-repo')
const assert = require('assert')
const Travis = require('travis-ci')
const exec = require('child_process').execSync
const ora = require('ora')
const chalk = require('chalk')
const resolve = require('path').resolve
const ms = require('ms')
const spinners = require('cli-spinners')
const differ = require('ansi-diff-stream')
const semver = require('semver')

const dir = resolve(process.argv[2] || '.')

const repo = getRepo(require(`${dir}/package.json`))
assert(repo.user)
assert(repo.project)

const sha = exec('git log --format="%H" -n1', {
  cwd: dir
}).toString().trim()

const travis = new Travis({ version: '2.0.0' })

const getBuilds = cb => {
  travis
  .repos(repo.user, repo.project)
  .builds
  .get(cb)
}

const findCommit = commits => commits.find(c => c.sha === sha)
const findBuild = (builds, commitId) => builds.find(b => b.commit_id === commitId)

const getBuild = cb => {
  getBuilds((err, res) => {
    if (err) return cb(err)
    const commit = findCommit(res.commits)
    if (!commit) return getBuild(cb)
    const build = findBuild(res.builds, commit.id)
    if (build) cb(null, build)
    else getBuild(cb)
  })
}

const getJob = (id, cb) => {
  travis
  .jobs(id)
  .get((err, res) => {
    if (err) return cb(err)
    cb(null, res.job)
  })
}

let diff = differ()
diff.pipe(process.stdout)
let frameIdx = 0

const render = () => {
  let out = ''

  Object.keys(results).forEach(os => {
    const versions = Object.keys(results[os]).sort((a, b) => {
      return semver.compare(fixSemver(a), fixSemver(b))
    })
    if (!versions.length) return
    spinner.stop()

    out += '\n'
    out += chalk.gray(os)
    out += '\n'

    versions.forEach(version => {
      const job = results[os][version]
      out += `  ${check(job.state, spinners.dots.frames[frameIdx])} node ${version}`
      if (job.state === 'started') {
        out += ` ${chalk.white(`(${ms(new Date() - new Date(job.started_at))})`)}`
      }
      out += '\n'
    })

    out += '\n'
  })

  frameIdx = (frameIdx + 1) % spinners.dots.frames.length

  diff.write(out)
}

const fixSemver = s => {
  const segs = String(s).split('.')
  segs[0] = segs[0] || '0'
  segs[1] = segs[1] || '0'
  segs[2] = segs[2] || '0'
  return segs.join('.')
}

const results = {
  osx: {},
  linux: {}
}

setInterval(render, 100)

const check = (state, frame) => {
  const out = state === 'failed' ? chalk.red('×')
  : state === 'passed' ? chalk.green('✓')
  : state === 'started' ? chalk.yellow(frame)
  : chalk.gray(frame)
  return out
}

const spinner = ora('Loading build').start()

getBuild((err, build) => {
  if (err) throw err

  spinner.text = 'Loading jobs'
  let todo = build.job_ids.length
  let exitCode = 0

  build.job_ids.forEach(jobId => {
    const check = (err, job) => {
      if (err) throw err
      results[job.config.os][job.config.node_js] = job
      if (job.state === 'failed') exitCode = 1
      if (job.state === 'started' || job.state === 'created') {
        getJob(jobId, check)
      } else {
        if (!--todo) {
          render()
          process.exit(exitCode)
        }
      }
    }
    getJob(jobId, check)
  })
})
