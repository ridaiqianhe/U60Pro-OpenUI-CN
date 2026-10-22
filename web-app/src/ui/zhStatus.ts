/** Translate display values only; device/API enum values remain unchanged. */
const STATUS: Record<string, string> = {
  Excellent: '极好', Good: '良好', Fair: '一般', Poor: '较差', Weak: '较弱',
  Unavailable: '暂无数据', Today: '今日', 'This month': '本月', Total: '累计',
  'Device lifetime': '设备累计', 'Current cycle': '当前周期',
  'China Telecom': '中国电信', 'China Mobile': '中国移动', 'China Unicom': '中国联通',
}
export function zhStatus(value: string): string { return STATUS[value] ?? value }
