import fs from 'node:fs'

const source = fs.readFileSync('src/pages/RetentionWorkspace.jsx', 'utf8')

const disabledSave = "disabled={saving||window.usedFallback}"
const fallbackNotice = "if(window.usedFallback){setNotice(`Cannot save a snapshot"

if (!source.includes(disabledSave)) {
  throw new Error('Save to DB must be disabled while RetentionWorkspace is using a fallback snapshot')
}

if (!source.includes(fallbackNotice)) {
  throw new Error('Fallback save guard must use a non-fatal notice instead of page-level error state')
}

console.log('Retention fallback save regression checks passed')
