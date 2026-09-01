import fs from 'node:fs'

const source = fs.readFileSync('src/pages/RetentionWorkspace.jsx', 'utf8')

const previousHostAssignment = "if(row.snapshot_month===previous){current.previousDeposit=Number(row.total_deposit)||0;if(row.host_assigned)current.host=row.host_assigned}"
const currentHostOverride = "if(row.snapshot_month===dataMonth&&row.host_assigned)current.host=row.host_assigned"

if (!source.includes(previousHostAssignment)) {
  throw new Error('RetentionWorkspace must assign host from the previous snapshot')
}

if (source.includes(currentHostOverride)) {
  throw new Error('Current-month snapshot must not overwrite the historical host')
}

console.log('Retention historical host regression checks passed')
