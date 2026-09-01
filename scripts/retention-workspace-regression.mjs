import fs from 'node:fs'

const file = 'src/pages/RetentionWorkspace.jsx'
const source = fs.readFileSync(file, 'utf8')

const expectedImport = "import { resolveSnapshotWindow } from '../lib/retention'"
const historicalHostFix = "if(row.snapshot_month===previous)current.host=row.host_assigned"
const effectiveMonthFix = "const window=resolveSnapshotWindow(months,month)"
const fallbackGuard = "if(window.usedFallback)"

if (!source.includes(expectedImport)) throw new Error('RetentionWorkspace must import resolveSnapshotWindow')
if (!source.includes(historicalHostFix)) throw new Error('RetentionWorkspace must preserve historical host from previous snapshot')
if (!source.includes(effectiveMonthFix)) throw new Error('RetentionWorkspace must resolve selected month against available snapshots')
if (!source.includes(fallbackGuard)) throw new Error('RetentionWorkspace must guard fallback snapshot saves')

console.log('Retention workspace regression checks passed')
// trigger workflow
