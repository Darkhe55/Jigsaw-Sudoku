/**
 * 通用自定义题板编辑器
 *
 * 支持四种模式（adapter.custom.mode）：
 *   cell    = 单元格填值（默认）
 *   region  = 单元格填区域号（外观同 cell，游戏自行解释）
 *   picture = 单元格画图案（外观同 cell）
 *   edge    = 编辑格子之间的边（水平/竖直边，索引顺序见 core/board.ts）
 *   none    = 不支持自定义题板
 *
 * 额外支持「区域层」（adapter.custom.regionLayer，异形数独用）：
 *   编辑器提供「画宫 / 填数」两个图层，同一个网格既能画不规则宫、又能填预填数字。
 *
 * 键盘录入约定（cell/region/picture）：
 *   数字键 0-9 由 adapter.custom.keyForDigit 决定含义；
 *   . / Backspace / Delete 清空；方向键移动；Enter/Tab 下一格；
 *   Home/End 行首/行尾；Esc 关闭。
 */

import type { GameAdapter, Puzzle } from './types'
import { edgeCount, horizontalEdgeIndex, regionFill, verticalEdgeIndex } from './board'

export interface CustomHost {
  setStatus(text: string, tone?: 'ok' | 'bad' | 'solving' | ''): void
  message(text: string, tone?: string): void
  loadPuzzle(p: Puzzle): void
  savePuzzle(p: Puzzle): void
  solveCurrent(): void
  runLogic(): void
}

export class CustomEditor {
  private w = 5
  private h = 5
  private grid: Array<number | null> = []
  private edges: Array<number | null> = []
  /** 区域层：每格宫号（0 基；null = 未分配） */
  private regions: Array<number | null> = []
  private layer: 'value' | 'region' = 'value'
  private cursor = 0
  private adapter: GameAdapter
  private editingId: string | null = null
  private editingName: string | null = null

  constructor(adapter: GameAdapter, private host: CustomHost) {
    this.adapter = adapter
  }

  private mode(): 'cell' | 'region' | 'picture' | 'edge' | 'none' {
    return this.adapter.custom.mode ?? 'cell'
  }

  private regionLayer() {
    return this.adapter.custom.regionLayer
  }

  private maxRegion(): number {
    const spec = this.regionLayer()
    if (!spec) return 0
    const max = spec.maxRegion(this.w, this.h)
    return Math.max(1, Math.min(36, Math.floor(max) || 36))
  }

  private regionLabel(v: number | null): string {
    if (v == null) return ''
    const spec = this.regionLayer()
    if (spec?.labelFor) return spec.labelFor(v)
    return v <= 9 ? String(v) : String.fromCharCode(65 + (v - 10))
  }

  isOpen(): boolean {
    const panel = document.getElementById('custom-editor')
    return !!panel && !panel.hidden
  }

  close(): void {
    const panel = document.getElementById('custom-editor')
    if (panel) panel.hidden = true
  }

  // —— 单元格 / 区域图层 ——

  private cellClassOf(value: number | null): string {
    const cls = this.adapter.custom.cellClass?.(value) ?? ''
    return `custom-cell${cls ? ` ${cls}` : ''}${value === null ? ' empty' : ''}`
  }

  private cellInner(value: number | null, region: number | null): string {
    const valueText = this.adapter.custom.cellLabel(value)
    if (!this.regionLayer()) return valueText
    return (
      `<span class="cv">${valueText}</span>` +
      `<span class="cr">${this.regionLabel(region)}</span>`
    )
  }

  /** 只重绘一格（保留选中态） */
  private paintCell(i: number): void {
    const btn = document.querySelector<HTMLButtonElement>(`.custom-cell[data-i="${i}"]`)
    if (!btn) return
    const value = this.grid[i] ?? null
    const region = this.regionLayer() ? (this.regions[i] ?? null) : null
    btn.innerHTML = this.cellInner(value, region)
    btn.className = `${this.cellClassOf(value)}${i === this.cursor ? ' selected' : ''}`
    if (this.regionLayer()) {
      if (region === null) btn.style.background = ''
      else btn.style.background = regionFill(region)
    }
  }

  private setCell(i: number, value: number | null): void {
    if (i < 0 || i >= this.grid.length) return
    this.grid[i] = value
    this.paintCell(i)
  }

  private setRegion(i: number, value: number | null): void {
    if (i < 0 || i >= this.regions.length) return
    this.regions[i] = value
    this.paintCell(i)
  }

  private selectCell(i: number): void {
    const max = this.w * this.h
    if (max <= 0) return
    this.cursor = Math.max(0, Math.min(max - 1, i))
    document.querySelectorAll('.custom-cell').forEach((el) => {
      const idx = Number((el as HTMLElement).dataset.i)
      el.classList.toggle('selected', idx === this.cursor)
    })
    const btn = document.querySelector<HTMLButtonElement>(`.custom-cell[data-i="${this.cursor}"]`)
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private moveCursor(dx: number, dy: number): void {
    const w = this.w
    const row = Math.floor(this.cursor / w)
    const col = this.cursor % w
    this.selectCell((row + dy) * w + (col + dx))
  }

  private readSize(): { w: number; h: number } {
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    const meta = this.adapter.meta
    const w = Math.max(
      meta.customMinW,
      Math.min(meta.customMaxW, Number(wEl?.value) || meta.customMinW),
    )
    const h = Math.max(
      meta.customMinH,
      Math.min(meta.customMaxH, Number(hEl?.value) || meta.customMinH),
    )
    if (wEl) wEl.value = String(w)
    if (hEl) hEl.value = String(h)
    return { w, h }
  }

  /** 当前尺寸是否被游戏接受（未实现 validSize 时一律接受） */
  private sizeOk(w: number, h: number): boolean {
    const valid = this.adapter.custom.validSize
    return !valid || valid(w, h)
  }

  /** 当前尺寸对应的点击循环值序列 */
  private cycleFor(w: number, h: number): Array<number | null> {
    const custom = this.adapter.custom
    return custom.valueCycleFor?.(w, h) ?? custom.valueCycle
  }

  /** 初始化/重置区域层 */
  private resetRegions(w: number, h: number): void {
    const spec = this.regionLayer()
    if (!spec) {
      this.regions = []
      return
    }
    this.regions = spec.initial(w, h).slice()
    if (this.regions.length !== w * h) {
      this.regions = Array.from({ length: w * h }, (_, i) => i % Math.max(1, Math.min(w, h)))
    }
  }

  /** 「画宫 / 填数」图层切换按钮 */
  private renderLayers(): void {
    const el = document.getElementById('custom-layers')
    if (!el) return
    if (!this.regionLayer()) {
      el.hidden = true
      el.innerHTML = ''
      return
    }
    el.hidden = false
    el.innerHTML = [
      `<button type="button" class="btn small${this.layer === 'region' ? ' primary' : ''}" data-layer="region">画宫</button>`,
      `<button type="button" class="btn small${this.layer === 'value' ? ' primary' : ''}" data-layer="value">填数</button>`,
    ].join('')
    el.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.layer = btn.dataset.layer === 'region' ? 'region' : 'value'
        this.renderLayers()
        this.renderGrid()
        const spec = this.regionLayer()
        this.host.message(
          this.layer === 'region'
            ? `画宫模式：点击/键盘设置宫号（0..${this.maxRegion() - 1}，字母键 A..Z 表示 10 以上）。${spec?.hint ?? ''}`
            : `填数模式：${this.adapter.custom.hint}`,
        )
        document.getElementById('custom-grid')?.focus()
      })
    })
  }

  // —— 边模式 ——

  private setEdge(e: number, value: number | null): void {
    if (e < 0 || e >= this.edges.length) return
    this.edges[e] = value
    const btn = document.querySelector<HTMLButtonElement>(`.custom-edge[data-edge="${e}"]`)
    if (!btn) return
    btn.textContent = this.adapter.custom.edgeLabel?.(value) ?? (value == null ? '' : String(value))
    btn.classList.toggle('empty', value === null)
    const cls = this.adapter.custom.edgeClass?.(value) ?? ''
    const dir = btn.dataset.dir === 'v' ? ' v' : ' h'
    btn.className = `custom-edge${dir}${cls ? ` ${cls}` : ''}${value === null ? ' empty' : ''}`
  }

  private renderEdgeGrid(): void {
    const grid = document.getElementById('custom-grid')
    if (!grid) return
    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    const count = edgeCount(w, h)
    if (this.edges.length !== count) this.edges = new Array<number | null>(count).fill(null)

    const cycle = this.adapter.custom.edgeValueCycle ?? [null, 1]
    const label = (v: number | null) =>
      this.adapter.custom.edgeLabel?.(v) ?? (v == null ? '' : String(v))
    const cls = (v: number | null) => this.adapter.custom.edgeClass?.(v) ?? ''
    const edgeButton = (e: number, dir: 'h' | 'v'): string => {
      const v = this.edges[e] ?? null
      return `<button type="button" class="custom-edge ${dir}${cls(v) ? ` ${cls(v)}` : ''}${v == null ? ' empty' : ''}" data-edge="${e}" data-dir="${dir}">${label(v)}</button>`
    }

    const items: string[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        items.push(`<div class="custom-node"></div>`)
        if (x + 1 < w) items.push(edgeButton(horizontalEdgeIndex(w, x, y), 'h'))
      }
      if (y + 1 < h) {
        for (let x = 0; x < w; x++) {
          items.push(edgeButton(verticalEdgeIndex(w, h, x, y), 'v'))
          if (x + 1 < w) items.push(`<div class="custom-edge-space"></div>`)
        }
      }
    }

    grid.className = 'custom-grid custom-edge-grid'
    grid.style.gridTemplateColumns = `repeat(${2 * w - 1}, 28px)`
    grid.innerHTML = items.join('')
    grid.querySelectorAll<HTMLButtonElement>('.custom-edge').forEach((btn) => {
      btn.addEventListener('click', () => {
        const e = Number(btn.dataset.edge)
        const cur = this.edges[e] ?? null
        const pos = cycle.indexOf(cur)
        const next = cycle[(pos + 1) % cycle.length] ?? null
        this.setEdge(e, next)
      })
    })
    grid.tabIndex = 0
  }

  // —— 渲染 ——

  renderGrid(): void {
    const grid = document.getElementById('custom-grid')
    if (!grid) return
    if (this.mode() === 'edge') {
      this.renderEdgeGrid()
      return
    }

    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    if (this.grid.length !== w * h) {
      this.grid = new Array<number | null>(w * h).fill(null)
    }
    if (this.regionLayer() && this.regions.length !== w * h) {
      this.resetRegions(w, h)
    }
    // 大尺寸题板（如 16..25）自动缩小格子，保证在侧栏里可点
    const cellPx = w <= 9 ? 36 : w <= 12 ? 32 : w <= 16 ? 28 : 24
    grid.className = 'custom-grid'
    grid.style.gridTemplateColumns = `repeat(${w}, ${cellPx}px)`
    const hasRegion = !!this.regionLayer()
    grid.innerHTML = this.grid
      .map((v, i) => {
        const region = hasRegion ? (this.regions[i] ?? null) : null
        const sel = i === this.cursor ? ' selected' : ''
        const style =
          hasRegion && region !== null ? ` style="background:${regionFill(region)}"` : ''
        return `<button type="button" class="${this.cellClassOf(v)}${sel}" data-i="${i}"${style}>${this.cellInner(v, region)}</button>`
      })
      .join('')
    grid.querySelectorAll<HTMLButtonElement>('.custom-cell').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i)
        this.selectCell(i)
        if (this.layer === 'region' && hasRegion) {
          const max = this.maxRegion()
          const cur = this.regions[i] ?? -1
          this.setRegion(i, (cur + 1) % max)
          return
        }
        const cur = this.grid[i] ?? null
        const cycle = this.cycleFor(w, h)
        const pos = cycle.indexOf(cur)
        const next = cycle[(pos + 1) % cycle.length] ?? null
        this.setCell(i, next)
      })
      btn.addEventListener('focus', () => {
        this.selectCell(Number(btn.dataset.i))
      })
    })
    grid.tabIndex = 0
    this.renderLayers()
  }

  open(): void {
    const panel = document.getElementById('custom-editor')
    if (!panel) return
    if (this.mode() === 'none') {
      this.host.message('本游戏暂不支持自定义题板。', 'bad')
      return
    }
    if (this.mode() === 'edge' && !this.adapter.custom.makePuzzleFromEdges) {
      this.host.message('本游戏的边模式缺少 makePuzzleFromEdges 实现。', 'bad')
      return
    }
    panel.hidden = false
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    if (wEl) wEl.value = String(this.w)
    if (hEl) hEl.value = String(this.h)
    if (this.cursor >= this.w * this.h) this.cursor = 0
    if (this.regionLayer() && this.regions.length !== this.w * this.h) {
      this.resetRegions(this.w, this.h)
    }
    this.renderGrid()
    const editing = this.editingId ? `正在编辑「${this.editingName ?? this.editingId}」。` : ''
    this.host.message(`${editing}键盘：方向键移动 · ${this.adapter.custom.hint}`)
    document.getElementById('custom-grid')?.focus()
  }

  /** 把已保存的自定义题读回编辑器；保存时覆盖原 id */
  edit(p: Puzzle): void {
    const toGrid = this.adapter.custom.toGrid
    if (!toGrid) {
      this.host.message('本游戏不支持编辑自定义题。', 'bad')
      return
    }
    const restored = toGrid(p)
    if (!restored) {
      this.host.message('无法还原这道题的题面。', 'bad')
      return
    }
    const meta = this.adapter.meta
    if (restored.width > meta.customMaxW || restored.height > meta.customMaxH) {
      this.host.message(`题面超过最大尺寸 ${meta.customMaxW}×${meta.customMaxH}。`, 'bad')
      return
    }
    this.w = restored.width
    this.h = restored.height
    this.grid = restored.grid.slice()
    if (this.regionLayer()) {
      this.regions =
        restored.regions && restored.regions.length === this.w * this.h
          ? restored.regions.slice()
          : this.regionLayer()!.initial(this.w, this.h).slice()
    }
    this.cursor = 0
    this.layer = this.regionLayer() ? 'region' : 'value'
    this.editingId = p.id
    this.editingName = p.name
    const panel = document.getElementById('custom-editor')
    if (panel) panel.hidden = false
    const wEl = document.getElementById('custom-w') as HTMLInputElement | null
    const hEl = document.getElementById('custom-h') as HTMLInputElement | null
    if (wEl) wEl.value = String(this.w)
    if (hEl) hEl.value = String(this.h)
    this.renderGrid()
    this.host.message(`正在编辑「${p.name}」。保存会覆盖原题。`, 'ok')
    panel?.scrollIntoView({ block: 'nearest' })
    document.getElementById('custom-grid')?.focus()
  }

  /** 删除题库条目时清掉编辑态 */
  clearEditing(id?: string): void {
    if (id && this.editingId !== id) return
    this.editingId = null
    this.editingName = null
  }

  regen(): void {
    this.editingId = null
    this.editingName = null
    if (this.mode() === 'edge') {
      this.edges = new Array<number | null>(edgeCount(this.w, this.h)).fill(null)
      this.renderEdgeGrid()
    } else {
      const { w, h } = this.readSize()
      this.w = w
      this.h = h
      this.grid = new Array<number | null>(w * h).fill(null)
      if (this.regionLayer()) this.resetRegions(w, h)
      this.cursor = 0
      this.renderGrid()
    }
    this.host.message(`已生成 ${this.w}×${this.h} 网格。${this.adapter.custom.hint}`)
    document.getElementById('custom-grid')?.focus()
  }

  // —— 键盘 ——

  /** 返回 true 表示已消费该按键（编辑器打开时优先处理） */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen()) return false
    const mode = this.mode()
    if (mode === 'edge') {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
        return true
      }
      return false
    }

    const k = e.key

    // 区域图层：数字/字母直接设置宫号，退格清空
    if (this.regionLayer() && this.layer === 'region') {
      if (k === 'Escape') {
        e.preventDefault()
        this.close()
        return true
      }
      if (k.length === 1 && /^[0-9a-zA-Z]$/.test(k)) {
        const v = /[0-9]/.test(k) ? Number(k) : 10 + k.toUpperCase().charCodeAt(0) - 65
        if (v < this.maxRegion()) {
          e.preventDefault()
          this.setRegion(this.cursor, v)
          this.moveCursor(1, 0)
          return true
        }
      }
      if (k === '.' || k === 'Backspace' || k === 'Delete' || k === ' ') {
        e.preventDefault()
        this.setRegion(this.cursor, null)
        if (k === 'Backspace') this.moveCursor(-1, 0)
        else this.moveCursor(1, 0)
        return true
      }
      if (k.startsWith('Arrow')) {
        e.preventDefault()
        if (k === 'ArrowLeft') this.moveCursor(-1, 0)
        else if (k === 'ArrowRight') this.moveCursor(1, 0)
        else if (k === 'ArrowUp') this.moveCursor(0, -1)
        else this.moveCursor(0, 1)
        return true
      }
      if (k === 'Enter' || k === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) this.moveCursor(-1, 0)
        else this.moveCursor(1, 0)
        return true
      }
      return false
    }

    if (k >= '0' && k <= '9') {
      const value = this.adapter.custom.keyForDigit(Number(k))
      if (value !== undefined) {
        e.preventDefault()
        this.setCell(this.cursor, value)
        this.moveCursor(1, 0)
        return true
      }
    }
    // 大尺寸（如 16×16）用字母键输入 10 以上的值
    if (k.length === 1 && this.adapter.custom.keyForChar) {
      const value = this.adapter.custom.keyForChar(k.toUpperCase(), Math.max(this.w, this.h))
      if (value !== undefined) {
        e.preventDefault()
        this.setCell(this.cursor, value ?? null)
        this.moveCursor(1, 0)
        return true
      }
    }
    if (k === '.' || k === 'Backspace' || k === 'Delete' || k === ' ') {
      e.preventDefault()
      this.setCell(this.cursor, null)
      if (k === 'Backspace') this.moveCursor(-1, 0)
      else this.moveCursor(1, 0)
      return true
    }
    if (k === 'ArrowLeft') {
      e.preventDefault()
      this.moveCursor(-1, 0)
      return true
    }
    if (k === 'ArrowRight') {
      e.preventDefault()
      this.moveCursor(1, 0)
      return true
    }
    if (k === 'ArrowUp') {
      e.preventDefault()
      this.moveCursor(0, -1)
      return true
    }
    if (k === 'ArrowDown') {
      e.preventDefault()
      this.moveCursor(0, 1)
      return true
    }
    if (k === 'Enter' || k === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) this.moveCursor(-1, 0)
      else this.moveCursor(1, 0)
      return true
    }
    if (k === 'Home') {
      e.preventDefault()
      this.selectCell(Math.floor(this.cursor / this.w) * this.w)
      return true
    }
    if (k === 'End') {
      e.preventDefault()
      this.selectCell(Math.floor(this.cursor / this.w) * this.w + this.w - 1)
      return true
    }
    if (k === 'Escape') {
      e.preventDefault()
      this.close()
      return true
    }
    return false
  }

  // —— 动作 ——

  private makePuzzle(existingId?: string): Puzzle | null {
    if (this.mode() === 'edge') {
      if (!this.adapter.custom.makePuzzleFromEdges) return null
      return this.adapter.custom.makePuzzleFromEdges(
        this.w,
        this.h,
        this.edges.slice(),
        existingId,
      )
    }
    return this.adapter.custom.makePuzzle(
      this.w,
      this.h,
      this.grid.slice(),
      existingId,
      this.regionLayer() ? this.regions.slice() : undefined,
    )
  }

  load(): void {
    const { w, h } = this.readSize()
    this.w = w
    this.h = h
    if (!this.sizeOk(w, h)) {
      this.host.message(`本游戏暂不支持 ${w}×${h} 自定义题板，请换一个尺寸。`, 'bad')
      return
    }
    if (this.mode() === 'edge') {
      if (this.edges.length !== edgeCount(w, h)) {
        this.edges = new Array<number | null>(edgeCount(w, h)).fill(null)
        this.renderEdgeGrid()
        this.host.message('网格已重置，请先填好边。', 'bad')
        return
      }
    } else if (this.grid.length !== w * h) {
      this.grid = new Array<number | null>(w * h).fill(null)
      this.renderGrid()
      this.host.message('网格已重置，请先填好内容。', 'bad')
      return
    }
    if (this.regionLayer()) {
      if (this.regions.length !== w * h) {
        this.resetRegions(w, h)
        this.renderGrid()
      }
      if (this.regions.some((r) => r === null)) {
        this.host.message('还有格子没有分配宫号，请先在「画宫」模式补全。', 'bad')
        return
      }
    }
    const stableId =
      this.editingId ?? `${this.adapter.meta.customIdPrefix}${w}x${h}`
    const puzzle = this.makePuzzle(stableId)
    if (!puzzle) {
      this.host.message('无法从当前题板构造题目。', 'bad')
      return
    }
    if (this.editingName) puzzle.name = this.editingName
    this.editingId = puzzle.id
    this.editingName = puzzle.name
    this.host.loadPuzzle(puzzle)
  }

  save(): void {
    const { w, h } = this.readSize()
    if (!this.sizeOk(w, h)) {
      this.host.message(`本游戏暂不支持 ${w}×${h} 自定义题板，请换一个尺寸。`, 'bad')
      return
    }
    if (this.mode() === 'edge') {
      if (this.edges.length !== edgeCount(w, h)) {
        this.host.message('请先生成网格并填好边。', 'bad')
        return
      }
    } else if (this.grid.length !== w * h) {
      this.host.message('请先生成网格并填好内容。', 'bad')
      return
    }
    if (this.regionLayer() && this.regions.some((r) => r === null)) {
      this.host.message('还有格子没有分配宫号，请先在「画宫」模式补全。', 'bad')
      return
    }
    const isEditing = !!this.editingId
    const stamp = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const name = `自定义 · ${w}×${h} · ${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
    const puzzle = this.makePuzzle(this.editingId ?? undefined)
    if (!puzzle) {
      this.host.message('无法从当前题板构造题目。', 'bad')
      return
    }
    puzzle.name = this.editingName ?? name
    this.host.savePuzzle(puzzle)
    this.editingId = puzzle.id
    this.editingName = puzzle.name
    this.host.message(`已${isEditing ? '更新' : '保存'}到题库：「${puzzle.name}」，下次启动仍可选用。`, 'ok')
  }

  solve(): void {
    this.host.solveCurrent()
  }

  logic(): void {
    this.close()
    this.host.runLogic()
  }
}
