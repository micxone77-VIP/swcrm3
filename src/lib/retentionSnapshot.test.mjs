import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMonth, resolveSnapshotWindow } from './retentionSnapshot.mjs'

test('falls back to latest available snapshot when selected month has no snapshot', () => {
  assert.deepEqual(
    resolveSnapshotWindow(['2026-06', '2026-07', '2026-08'], '2026-09'),
    { selectedMonth: '2026-09', currentMonth: '2026-08', previousMonth: '2026-07', usedFallback: true }
  )
})

test('uses selected month when its snapshot exists and finds the prior available month', () => {
  assert.deepEqual(
    resolveSnapshotWindow(['2026-06', '2026-07', '2026-08'], '2026-08'),
    { selectedMonth: '2026-08', currentMonth: '2026-08', previousMonth: '2026-07', usedFallback: false }
  )
})

test('handles a missing earlier month and normalizes date-like values', () => {
  assert.equal(normalizeMonth('2026-08-31'), '2026-08')
  assert.deepEqual(
    resolveSnapshotWindow(['2026-06-01', '2026-08-15'], '2026-08'),
    { selectedMonth: '2026-08', currentMonth: '2026-08', previousMonth: '2026-06', usedFallback: false }
  )
})
