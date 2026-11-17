/**
 * ════════════════════════════════════════════════════════════════════
 *  异形数独（Jigsaw Sudoku）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 尺寸：任意 N×N（内置 4/6/9/12/16 异形；自定义 4..25；识图可导入 4..25 等）。
 * 宫形：任意数量 / 任意形状（regions 数组逐格给宫号），不要求是 box×box，
 *       宫数量也不要求等于 N（只要每个宫不超过 N 格就有解的可能）。
 * 状态：0 = 未填，1..N = 数字/字母（N>9 时 10..36 用 A..Z 显示）。
 *
 * 自定义题板：提供「画宫 / 填数」两个图层 —— 先画不规则宫，再填预填数字；
 * 题库编解码完整支持任意 N / 任意宫（供进度、参考解、导入题使用）。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic.ts'
import { builtinPuzzles, getReferenceSolution } from './puzzles.ts'
import { hitTest, metricsFor, renderBoard } from './render.ts'
import { solvePuzzle } from './solver.ts'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  noteMaskAt,
  rightClickValue,
  serializeState,
  valueAt,
} from './state.ts'
import { statusBits, validate } from './validate.ts'
import {
  decodeBoard,
  encodeBoard,
  isValidSudokuSize,
  MAX_SUDOKU_SIZE,
  MIN_SUDOKU_SIZE,
  puzzleSize,
  standardRegionsOf,
  valueOfSymbol,
  type SudokuPuzzle,
} from './types.ts'

const meta = {
  title: '异形数独',
  tagline:
    'N×N 填数 —— 每行、每列、每个不规则宫都必须是 1..N（内置 4/6/9/12/16 异形，自定义 4..25）',
  footerNote:
    '规则：在 N×N 格中填入 1..N（9×9 用 1..9，14×14 用 1..9 与 A..E），每行、每列、以及每个由粗线围成的不规则宫内的数字都不能重复。宫的数量和形状都不要求等于 N 个 / N 格。题面预填数字不能修改。',
  storageKeyPrefix: 'jigsaw-sudoku',
  customIdPrefix: 'jigsaw-sudoku-custom-',
  customMinW: MIN_SUDOKU_SIZE,
  customMinH: MIN_SUDOKU_SIZE,
  customMaxW: MAX_SUDOKU_SIZE,
  customMaxH: MAX_SUDOKU_SIZE,
  targetKind: 'cell' as const,
}

const VALUE_CYCLE: Array<number | null> = [null, ...Array.from({ length: 25 }, (_, i) => i + 1)]

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: VALUE_CYCLE,
  valueCycleFor: (w, h) => {
    const n = Math.max(MIN_SUDOKU_SIZE, Math.min(MAX_SUDOKU_SIZE, Math.max(w, h)))
    return [null, ...Array.from({ length: n }, (_, i) => i + 1)]
  },
  validSize: (w, h) => w === h && isValidSudokuSize(w),
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit >= 1 && digit <= 9) return digit
    return undefined
  },
  keyForChar: (ch, maxValue) => {
    const v = valueOfSymbol(ch)
    if (v >= 10 && v <= Math.min(36, Math.max(9, maxValue))) return v
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : v <= 9 ? String(v) : String.fromCharCode(55 + v)),
  cellClass: (v) => (v == null ? '' : `n${v}`),
  hint:
    '先切到「画宫」画出不规则宫（点击或键盘 0-9 / A-Z 设置宫号，退格清空），再切到「填数」录入预填数字；最后「载入题板」。',
  regionLayer: {
    label: '画宫',
    maxRegion: () => 36,
    initial: (w, h) => {
      const n = Math.max(1, Math.max(w, h))
      return standardRegionsOf(n).slice(0, w * h)
    },
    labelFor: (v) => {
      if (v == null) return ''
      return v <= 9 ? String(v) : String.fromCharCode(65 + (v - 10))
    },
    hint: '宫号 0 起；宫数不必等于 N，但每个宫最多 N 格才可能填满 1..N。',
  },
  makePuzzle: (w, h, grid, existingId, regions) => {
    const n = Math.max(MIN_SUDOKU_SIZE, Math.min(MAX_SUDOKU_SIZE, Math.max(w, h)))
    const size = n * n
    const givens = new Array<number>(size).fill(0)
    for (let i = 0; i < size; i++) {
      const v = grid[i]
      givens[i] = typeof v === 'number' && v >= 1 && v <= n ? v : 0
    }
    const layout = new Array<number>(size)
    for (let i = 0; i < size; i++) {
      const r = regions?.[i]
      layout[i] = typeof r === 'number' && r >= 0 && r < 36 ? Math.floor(r) : 0
    }
    return {
      id: existingId ?? `${meta.customIdPrefix}${Date.now()}`,
      name: `自定义 · 异形数独 ${n}×${n}`,
      width: n,
      height: n,
      difficulty: 'custom',
      regions: layout,
      givens,
    } satisfies SudokuPuzzle
  },
  encodePuzzle: (p) => {
    const sp = p as SudokuPuzzle
    const n = puzzleSize(sp) || 9
    return {
      board: encodeBoard(sp.givens ?? [], sp.regions ?? standardRegionsOf(n)),
    }
  },
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string' || typeof record.board !== 'string') return null
    const n = puzzleSize({ width: Number(record.width), height: Number(record.height) })
    if (!isValidSudokuSize(n)) return null
    const size = n * n
    const decoded = decodeBoard(record.board, size, n, 36)
    if (!decoded) return null
    const used = new Set(decoded.regions).size
    if (used < 1 || used > 36) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · 异形数独 ${n}×${n}`,
      width: n,
      height: n,
      difficulty: 'custom',
      regions: decoded.regions,
      givens: decoded.givens,
    } satisfies SudokuPuzzle
  },
  toGrid: (p) => {
    const sp = p as SudokuPuzzle
    const n = puzzleSize(sp)
    if (!n || !Array.isArray(sp.givens) || sp.givens.length !== n * n) return null
    const regions = Array.isArray(sp.regions) && sp.regions.length === n * n ? sp.regions : null
    return {
      width: n,
      height: n,
      grid: sp.givens.map((v) => (v >= 1 && v <= n ? v : null)),
      ...(regions ? { regions: regions.map((r) => (r >= 0 ? r : null)) } : {}),
    }
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.from === 0) playPluck(streak, 1)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  noteMaskAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
