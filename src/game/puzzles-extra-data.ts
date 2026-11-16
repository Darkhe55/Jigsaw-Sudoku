/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const EXTRA_PUZZLES: RawPuzzle[] = [
  { id: "jigsaw-4x4-kmhq0x", name: "四宫异形", width: 4, height: 4, difficulty: 'easy', series: "尺寸", board: "1234000220030320|2211221133003300", solution: "1234341221434321" },
  { id: "jigsaw-4x4-kmhq0y", name: "四方错位", width: 4, height: 4, difficulty: 'easy', series: "尺寸", board: "1200002020010402|2220233013301110", solution: "1234412323413412" },
  { id: "jigsaw-6x6-kmhqf5", name: "六宫异形", width: 6, height: 6, difficulty: 'easy', series: "尺寸", board: "023400006003002060560001640132201040|221100234110234110234400234455335555", solution: "123456456213312564564321645132231645" },
  { id: "jigsaw-6x6-kmhqf6", name: "六宫回廊", width: 6, height: 6, difficulty: 'medium', series: "尺寸", board: "003450056103040065365204000030030540|555000555000444311444311333311222222", solution: "123456456123241365365214514632632541" },
]
