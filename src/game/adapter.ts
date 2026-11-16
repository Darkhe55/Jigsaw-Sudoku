/**
 * ════════════════════════════════════════════════════════════════════
 *  异形数独（Jigsaw Sudoku）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 尺寸：任意 N×N（内置 9×9；识图导入支持 14×14 等）。
 * 宫形：任意数量 / 任意形状（regions 数组逐格给宫号），不要求是 box×box。
 * 状态：0 = 未填，1..N = 数字/字母（N>9 时 10..36 用 A..Z 显示）。
 *
 * 自定义题板：因为不规则宫无法在「填数字」编辑器里画出来，本游戏保持关闭；
 * 但题库编解码仍完整支持任意 N / 任意宫（供进度、参考解、导入题使用）。
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
  rightClickValue,
  serializeState,
  valueAt,
} from './state.ts'
import { statusBits, validate } from './validate.ts'
import {
  decodeBoard,
  encodeBoard,
  puzzleSize,
  standardRegionsOf,
  valueOfSymbol,
  type SudokuPuzzle,
} from './types.ts'

const meta = {
  title: '异形数独',
  tagline: 'N×N 填数 —— 每行、每列、每个不规则宫都必须是 1..N（内置 9×9，识图支持 14×14）',
  footerNote:
    '规则：在 N×N 格中填入 1..N（9×9 用 1..9，14×14 用 1..9 与 A..E），每行、每列、以及每个由粗线围成的不规则宫内的数字都不能重复。题面预填数字不能修改。',
  storageKeyPrefix: 'jigsaw-sudoku',
  customIdPrefix: 'jigsaw-sudoku-custom-',
  customMinW: 9,
  customMinH: 9,
  customMaxW: 16,
  customMaxH: 16,
  targetKind: 'cell' as const,
}

const VALUE_CYCLE: Array<number | null> = [null, ...Array.from({ length: 16 }, (_, i) => i + 1)]

const custom: CustomSupport = {
  // 不规则宫无法用「填数字」编辑器画出，保持关闭
  mode: 'none',
  valueCycle: VALUE_CYCLE,
  valueCycleFor: (w, h) => {
    const n = Math.max(4, Math.min(36, Math.max(w, h)))
    return [null, ...Array.from({ length: n }, (_, i) => i + 1)]
  },
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
  cellLabel: (v) => (v == null ? '' : String(v)),
  cellClass: (v) => (v == null ? '' : `n${v}`),
  hint: '异形数独暂不支持自定义题板（不规则宫需要在图片里画好粗线后识图导入）。',
  makePuzzle: (_w, _h, _grid, existingId) => {
    const n = 9
    return {
      id: existingId ?? `${meta.customIdPrefix}${Date.now()}`,
      name: '自定义 · 异形数独',
      width: n,
      height: n,
      difficulty: 'custom',
      regions: standardRegionsOf(n),
      givens: new Array<number>(n * n).fill(0),
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
    if (!n || n < 4 || n > 36) return null
    const size = n * n
    const decoded = decodeBoard(record.board, size, n, n)
    if (!decoded) return null
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
