import { PveResourceType } from './types';

export const resourceTypeLabels: Record<PveResourceType, string> = {
  node: '節點',
  qemu: 'QEMU 虛擬機',
  lxc: 'LXC 容器',
};

export function localizePveStatus(status?: string): string | undefined {
  if (!status) return undefined;
  const labels: Record<string, string> = {
    running: '運行中',
    stopped: '已停止',
    paused: '已暫停',
    online: '線上',
    offline: '離線',
    unknown: '未知',
  };
  return labels[status.toLocaleLowerCase()] ?? '未知';
}
