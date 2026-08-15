import assert from 'node:assert/strict';
import test from 'node:test';
import { localizePveStatus, resourceTypeLabels } from '../locale';

test('resource type labels use Traditional Chinese', () => {
  assert.deepEqual(resourceTypeLabels, {
    node: '節點',
    qemu: 'QEMU 虛擬機',
    lxc: 'LXC 容器',
  });
});

test('PVE status values are localized without leaking unknown English values', () => {
  assert.equal(localizePveStatus('online'), '線上');
  assert.equal(localizePveStatus('running'), '運行中');
  assert.equal(localizePveStatus('stopped'), '已停止');
  assert.equal(localizePveStatus('vendor-specific-status'), '未知');
  assert.equal(localizePveStatus(undefined), undefined);
});
