/**
 * 异形数独题库生成器
 *
 * 1. 用随机哈密顿路径把 81 格切成 9 段，每段 9 格且四连通；
 * 2. 用回溯求解器为不规则宫找完整终盘（无解则换路径重试）；
 * 3. 随机挖空并保持唯一解。
 */

import type { Difficulty } from '../core/types'
import { standardRegions } from './types.ts'
import { countSolutions, findSolution } from './solver.ts'

interface GenSpec {
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  maxRemove: number
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRegions(rng: () => number): number[] | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const visited = new Uint8Array(81)
    const path: number[] = []
    const start = Math.floor(rng() * 81)
    let steps = 0
    const dfs = (i: number): boolean => {
      if (++steps > 30_000) return false
      visited[i] = 1
      path.push(i)
      if (path.length === 81) return true
      const x = i % 9
      const y = (i / 9) | 0
      const next: Array<[number, number]> = []
      for (const n of [x > 0 ? i - 1 : -1, x < 8 ? i + 1 : -1, y > 0 ? i - 9 : -1, y < 8 ? i + 9 : -1]) {
        if (n < 0 || visited[n]) continue
        const nx = n % 9
        const ny = (n / 9) | 0
        let degree = 0
        for (const q of [
          nx > 0 ? n - 1 : -1,
          nx < 8 ? n + 1 : -1,
          ny > 0 ? n - 9 : -1,
          ny < 8 ? n + 9 : -1,
        ]) {
          if (q >= 0 && !visited[q]) degree++
        }
        next.push([degree + rng() * 0.9, n])
      }
      next.sort((a, b) => a[0] - b[0])
      for (const [, n] of next) if (dfs(n)) return true
      path.pop()
      visited[i] = 0
      return false
    }
    if (!dfs(start)) continue
    const regions = new Array<number>(81).fill(0)
    for (let p = 0; p < 81; p++) regions[path[p]!] = Math.floor(p / 9)
    return regions
  }
  return null
}

function irregularity(regions: number[]): number {
  const base = standardRegions()
  let diff = 0
  for (let i = 0; i < 81; i++) if (regions[i] !== base[i]) diff++
  return diff
}

const SPECS: GenSpec[] = [
  { seed: 0x4a534401, difficulty: 'easy', name: '初识异形', series: '入门', maxRemove: 40 },
  { seed: 0x4a534402, difficulty: 'easy', name: '宫墙初变', series: '入门', maxRemove: 42 },
  { seed: 0x4a534403, difficulty: 'medium', name: '不规则回廊', series: '进阶', maxRemove: 48 },
  { seed: 0x4a534404, difficulty: 'medium', name: '错位九宫', series: '进阶', maxRemove: 50 },
  { seed: 0x4a534405, difficulty: 'hard', name: '异形之壁', series: '挑战', maxRemove: 54 },
  { seed: 0x4a534406, difficulty: 'hard', name: '终局异形', series: '挑战', maxRemove: 56 },
]

export interface GeneratedPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

function attempt(spec: GenSpec, rng: () => number): GeneratedPuzzle | null {
  const regions = makeRegions(rng)
  if (!regions) return null
  if (irregularity(regions) < 30) return null
  const empty = new Array<number>(81).fill(0)
  const solution = findSolution(empty, regions, 500_000)
  if (!solution) return null

  const givens = solution.slice()
  let removed = 0
  const order = Array.from({ length: 81 }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  for (const i of order) {
    if (removed >= spec.maxRemove) break
    const backup = givens[i]!
    givens[i] = 0
    const out = countSolutions(givens, regions, 2, 300_000)
    if (out.count === 1 && !out.timedOut) removed++
    else givens[i] = backup
  }

  return {
    id: `jigsaw-${spec.seed.toString(36)}`,
    name: spec.name,
    width: 9,
    height: 9,
    difficulty: spec.difficulty,
    series: spec.series,
    board: `${givens.join('')}|${regions.join('')}`,
    solution: solution.join(''),
  }
}

export function generatePuzzles(): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = []
  for (const spec of SPECS) {
    const t0 = Date.now()
    const rng = mulberry32(spec.seed)
    let made: GeneratedPuzzle | null = null
    for (let tries = 0; tries < 80 && !made; tries++) made = attempt(spec, rng)
    if (!made) throw new Error(`[异形数独 gen] ${spec.name} 生成失败`)
    const clues = made.board.split('|')[0]!.split('').filter((c) => c !== '0').length
    console.log(`[异形数独 gen] ${spec.name}：预填 ${clues}，${Date.now() - t0}ms`)
    out.push(made)
  }
  return out
}
