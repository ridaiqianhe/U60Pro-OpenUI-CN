import { Button } from '../../ui/controls'
import { Card } from '../../ui/primitives'
export default function MihomoCard({ onOpen }: { onOpen: () => void }) {
  return <Card title="Clash / Mihomo"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-body text-ink2">订阅管理、节点选择与连接状态 · 内嵌面板自动连接</p><Button onClick={onOpen}>打开 Clash 面板</Button></div></Card>
}
