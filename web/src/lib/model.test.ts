import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clip, predict, predictRaw, validateInput } from './model'
import type { ModelSpec } from './types'

const root = resolve(__dirname, '../..')
const spec = JSON.parse(readFileSync(resolve(root, 'public/data/model.json'), 'utf8')) as ModelSpec
const fixtures = JSON.parse(readFileSync(resolve(__dirname, '__fixtures__/parity.json'), 'utf8')) as {
  tolerance: number
  dataSha256: string
  buildId: string
  schemaVersion: number
  valid: { name: string; input: Record<string, number>; expected: number; expectedRaw: number }[]
  invalid: { name: string; base: Record<string, number>; patch: Record<string, unknown>; field: string }[]
}

describe('exported model parity with scikit-learn', () => {
  it('uses fixtures generated from the same training run', () => {
    expect(fixtures.dataSha256).toBe(spec.dataSha256)
    expect(fixtures.buildId).toBe(spec.buildId)
    expect(fixtures.schemaVersion).toBe(spec.schemaVersion)
    expect(fixtures.valid.length).toBeGreaterThan(50)
  })

  it.each(fixtures.valid.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const raw = predictRaw(spec, spec.features.map((feature) => c.input[feature]))
    expect(Math.abs(raw - c.expectedRaw)).toBeLessThanOrEqual(fixtures.tolerance)
    const got = predict(spec, c.input)
    expect(Math.abs(got - c.expected)).toBeLessThanOrEqual(fixtures.tolerance)
    expect(got).toBeGreaterThanOrEqual(0)
    expect(got).toBeLessThanOrEqual(100)
  })
})

describe('input validation mirrors the pipeline', () => {
  it.each(fixtures.invalid.map((c) => [c.name, c] as const))('rejects %s', (_name, c) => {
    const input = { ...c.base, ...c.patch }
    const problems = validateInput(spec, input)
    expect(Object.keys(problems)).toContain(c.field)
    expect(() => predict(spec, input)).toThrow(/Invalid input/)
  })

  it('rejects NaN and Infinity', () => {
    const base = fixtures.valid[0].input
    expect(validateInput(spec, { ...base, tempo: Number.NaN })).toHaveProperty('tempo')
    expect(validateInput(spec, { ...base, energy: Number.POSITIVE_INFINITY })).toHaveProperty('energy')
  })

  it('accepts every bound edge', () => {
    for (const f of spec.features) {
      const r = spec.validation[f]
      expect(validateInput(spec, { ...fixtures.valid[0].input, [f]: r.min })).toEqual({})
      expect(validateInput(spec, { ...fixtures.valid[0].input, [f]: r.max })).toEqual({})
    }
  })
})

describe('clipping and the other export formats', () => {
  const base = { features: ['a', 'k'], validation: {}, clip: [0, 100] as [number, number] }
  it('clips to 0-100', () => {
    expect(clip(spec, -4)).toBe(0)
    expect(clip(spec, 140)).toBe(100)
    expect(clip(spec, 42.5)).toBe(42.5)
  })
  it('evaluates linear and constant specs', () => {
    const linear = {
      ...base,
      kind: 'linear',
      intercept: 10,
      numeric: [{ feature: 'a', mean: 1, scale: 2, coef: 4 }],
      categorical: [{ feature: 'k', levels: [0, 3], coefs: [1, -1] }],
    } as unknown as ModelSpec
    expect(predictRaw(linear, [5, 3])).toBe(10 + 8 - 1)
    expect(predictRaw(linear, [5, 7])).toBe(18) // unseen level contributes nothing
    const constant = { ...base, kind: 'constant', value: 33 } as unknown as ModelSpec
    expect(predictRaw(constant, [0, 0])).toBe(33)
  })
})
