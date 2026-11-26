// Browser implementation of the exported popularity model. Mirrors
// pipeline/tracklens/modeling.py (validate_input, predict_exported).
import type { ModelSpec, ValidationRule } from './types'

export type ModelInput = Record<string, unknown>

export function validateInput(spec: Pick<ModelSpec, 'features' | 'validation'>, input: ModelInput): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const f of spec.features) {
    const rule: ValidationRule = spec.validation[f]
    const v = input[f]
    if (v === null || v === undefined) {
      problems[f] = 'Required'
      continue
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      problems[f] = 'Enter a finite number'
    } else if (v < rule.min || v > rule.max) {
      problems[f] = `Must be between ${rule.min} and ${rule.max}`
    } else if (rule.integer && v !== Math.round(v)) {
      problems[f] = 'Must be a whole number'
    }
  }
  return problems
}

export function toVector(spec: Pick<ModelSpec, 'features'>, input: ModelInput): number[] {
  return spec.features.map((f) => Number(input[f]))
}

export function predictRaw(spec: ModelSpec, x: number[]): number {
  switch (spec.kind) {
    case 'constant':
      return spec.value
    case 'linear': {
      const pos = new Map(spec.features.map((f, i) => [f, i]))
      let out = spec.intercept
      for (const n of spec.numeric) out += ((x[pos.get(n.feature)!] - n.mean) / n.scale) * n.coef
      for (const c of spec.categorical) {
        const idx = c.levels.indexOf(Math.trunc(x[pos.get(c.feature)!]))
        if (idx >= 0) out += c.coefs[idx]
      }
      return out
    }
    case 'trees': {
      let out = spec.baseline
      for (const t of spec.trees) {
        let i = 0
        while (t.f[i] !== -1) i = x[t.f[i]] <= t.t[i] ? t.l[i] : t.r[i]
        out += t.v[i]
      }
      return out
    }
  }
}

export function clip(spec: Pick<ModelSpec, 'clip'>, v: number): number {
  return Math.min(spec.clip[1], Math.max(spec.clip[0], v))
}

/** Validated, clipped prediction. Throws if the input fails validation. */
export function predict(spec: ModelSpec, input: ModelInput): number {
  const problems = validateInput(spec, input)
  const keys = Object.keys(problems)
  if (keys.length) throw new Error(`Invalid input: ${keys.map((k) => `${k} (${problems[k]})`).join(', ')}`)
  return clip(spec, predictRaw(spec, toVector(spec, input)))
}
