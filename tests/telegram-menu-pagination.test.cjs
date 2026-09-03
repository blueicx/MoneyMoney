const assert = require('node:assert/strict');
const test = require('node:test');

const menu = require('../dist/web/telegram-menu');

test('builds three four-row menu pages with bounded navigation', () => {
  const chatId = `pagination-${Date.now()}`;
  assert.equal(menu.getTelegramMenuPage(chatId), 1);

  const first = menu.buildTelegramBottomMenu(chatId);
  assert.equal(first.keyboard.length, 3);
  assert.ok(first.keyboard.slice(0, -1).length <= 4);
  assert.deepEqual(first.keyboard.at(-1).map((button) => button.text), ['菜单 1/3', '下一页 ➡']);

  menu.setTelegramMenuPage(chatId, 2);
  const second = menu.buildTelegramBottomMenu(chatId);
  assert.equal(second.keyboard.length, 5);
  assert.ok(second.keyboard.slice(0, -1).length <= 4);
  assert.deepEqual(second.keyboard.at(-1).map((button) => button.text), ['⬅ 上一页', '菜单 2/3', '下一页 ➡']);

  menu.setTelegramMenuPage(chatId, 3);
  const third = menu.buildTelegramBottomMenu(chatId);
  assert.equal(third.keyboard.length, 5);
  assert.ok(third.keyboard.slice(0, -1).length <= 4);
  assert.deepEqual(third.keyboard.at(-1).map((button) => button.text), ['⬅ 上一页', '菜单 3/3']);
});

test('clamps page changes and keeps chat page state isolated', () => {
  const firstChat = `pagination-a-${Date.now()}`;
  const secondChat = `pagination-b-${Date.now()}`;

  assert.equal(menu.moveTelegramMenuPage(firstChat, -1), 1);
  assert.equal(menu.moveTelegramMenuPage(firstChat, 99), 3);
  assert.equal(menu.getTelegramMenuPage(secondChat), 1);
  assert.equal(menu.setTelegramMenuPage(secondChat, 2), 2);
  assert.equal(menu.getTelegramMenuPage(firstChat), 3);
  assert.equal(menu.moveTelegramMenuPage(secondChat, -99), 1);
});
