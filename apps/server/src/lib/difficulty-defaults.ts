/** 内置的六级难度默认值（不依赖数据库，供迁移与回退使用） */
export interface DifficultyDef {
  /** 数据库主键（内置默认值没有 id） */
  id?: number;
  level: number;
  name: string;
  color: string;
  colorDark: string;
}

export const DEFAULT_DIFFICULTIES: DifficultyDef[] = [
  { level: 1, name: '入门', color: '#52c41a', colorDark: '#52c41a' },
  { level: 2, name: '普及', color: '#3498db', colorDark: '#3498db' },
  { level: 3, name: '提高', color: '#9d3dcf', colorDark: '#9d3dcf' },
  { level: 4, name: 'NOIP', color: '#f39c11', colorDark: '#f39c11' },
  { level: 5, name: 'NOI', color: '#fe4c61', colorDark: '#fe4c61' },
  { level: 6, name: 'IOI', color: '#0e1d69', colorDark: '#a5b4fc' },
];
