/**
 * 数独 / 异形数独 —— 位掩码回溯求解器
 *
 * 每个未定格维护 9 位候选掩码；落子后从 peers（同行/列/宫）中消去该位。
 */

import type { Puzzle, SolveResult } from '../core/types'
import { solveByRules } from './rules.ts'
import type { SudokuPuzzle, SudokuState } from './types.ts'

export interface CountOutcome {
  count: number
  nodes: number
  timedOut: boolean
}

function buildPeers(regions: ArrayLike<number>): number[][] {
  const peers: Array<Set<number>> = Array.from({ length: 81 }, () => new Set<number>())
  const units: number[][] = []
  for (let y = 0; y < 9; y++) {
    const row: number[] = []
    for (let x = 0; x < 9; x++) row.push(y * 9 + x)
    units.push(row)
  }
  for (let x = 0; x < 9; x++) {
    const col: number[] = []
    for (let y = 0; y < 9; y++) col.push(y * 9 + x)
    units.push(col)
  }
  for (let r = 0; r < 9; r++) {
    const cells: number[] = []
    for (let i = 0; i < 81; i++) if (regions[i] === r) cells.push(i)
    units.push(cells)
  }
  for (const unit of units) {
    for (const a of unit) for (const b of unit) if (a !== b) peers[a]!.add(b)
  }
  return peers.map((s) => Array.from(s))
}

function popcount(x: number): number {
  let n = 0
  while (x) {
    x &= x - 1
    n++
  }
  return n
}

function search(
  givens: ArrayLike<number>,
  regions: ArrayLike<number>,
  limit: number,
  maxNodes: number,
): { solutions: number[][]; nodes: number; timedOut: boolean } {
  const grid = new Array<number>(81).fill(0)
  const masks = new Int16Array(81)
  for (let i = 0; i < 81; i++) {
    const v = givens[i] ?? 0
    grid[i] = v >= 1 && v <= 9 ? v : 0
    masks[i] = grid[i] === 0 ? 0x1ff : 0
  }

  const peers = buildPeers(regions)
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false
  let impossible = false

  for (let i = 0; i < 81 && !impossible; i++) {
    const v = grid[i]!
    if (v === 0) continue
    const bit = 1 << (v - 1)
    for (const p of peers[i]!) {
      const pv = grid[p]!
      if (pv !== 0) {
        if (pv === v) {
          impossible = true
          break
        }
        continue
      }
      masks[p] = masks[p]! & ~bit
      if (masks[p] === 0) {
        impossible = true
        break
      }
    }
  }

  const propagateFrom = (start: number): boolean => {
    const queue = [start]
    while (queue.length) {
      const i = queue.pop()!
      const bit = 1 << (grid[i]! - 1)
      for (const p of peers[i]!) {
        if (grid[p] !== 0) {
          if (grid[p] === grid[i]) return false
          continue
        }
        if ((masks[p]! & bit) === 0) continue
        masks[p] = masks[p]! & ~bit
        const m = masks[p]!
        if (m === 0) return false
        if ((m & (m - 1)) === 0) {
          grid[p] = 31 - Math.clz32(m) + 1
          masks[p] = 0
          queue.push(p)
        }
      }
    }
    return true
  }

  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    let choice = -1
    let bestCount = 10
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue
      const c = popcount(masks[i]!)
      if (c === 0) return
      if (c < bestCount) {
        bestCount = c
        choice = i
        if (c === 1) break
      }
    }
    if (choice < 0) {
      solutions.push(Array.from(grid))
      return
    }

    const gsave = grid.slice()
    const msave = masks.slice()
    let bits = masks[choice]!
    while (bits) {
      const bit = bits & -bits
      bits ^= bit
      for (let i = 0; i < 81; i++) {
        grid[i] = gsave[i]!
        masks[i] = msave[i]!
      }
      const v = 31 - Math.clz32(bit) + 1
      grid[choice] = v
      masks[choice] = 0
      if (propagateFrom(choice)) dfs()
      if (solutions.length >= limit || timedOut) break
    }
    for (let i = 0; i < 81; i++) {
      grid[i] = gsave[i]!
      masks[i] = msave[i]!
    }
  }

  if (!impossible) dfs()
  return { solutions, nodes, timedOut }
}

export function countSolutions(
  givens: number[],
  regions: number[],
  limit = 2,
  maxNodes = 300_000,
): CountOutcome {
  const out = search(givens, regions, limit, maxNodes)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}

export function findSolution(
  givens: number[],
  regions: number[],
  maxNodes = 2_000_000,
): number[] | null {
  const out = search(givens, regions, 1, maxNodes)
  return out.solutions[0] ?? null
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = puzzle as SudokuPuzzle
  if (!p.givens || !p.regions || p.givens.length !== 81) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const byRules = solveByRules(p.givens, p.regions, true, 120)
  if (byRules.ok && byRules.solution) {
    return { solved: true, solution: makeState(p, byRules.solution), nodes: 0, timedOut: false }
  }
  if (byRules.contradiction) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const out = search(p.givens, p.regions, 1, maxNodes)
  const solution = out.solutions[0]
  return {
    solved: !!solution,
    solution: solution ? makeState(p, solution) : null,
    nodes: out.nodes,
    timedOut: out.timedOut,
  }
}

export function makeState(puzzle: SudokuPuzzle, cells: number[]): SudokuState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: cells.slice(),
    givens: puzzle.givens.slice(),
  }
}
