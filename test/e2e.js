/* 在 DSH 页面里自动跑一轮端到端自检（注入 userscript 后执行） */
window.runE2E = async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const host = document.getElementById('dsh-ref-host');
  if (!host) return [{ name: 'userscript 挂载', ok: false }];
  const sr = host.shadowRoot;
  const q = (s) => sr.querySelector(s);

  const fab = sr.getElementById('fab');
  const fr = fab.getBoundingClientRect();
  if (sr.getElementById('panel').hidden) {
    const o = { bubbles: true, cancelable: true, composed: true, pointerId: 1, button: 0, isPrimary: true, clientX: fr.left + 20, clientY: fr.top + 19 };
    fab.dispatchEvent(new PointerEvent('pointerdown', o));
    fab.dispatchEvent(new PointerEvent('pointerup', o));
  }
  await sleep(7000);

  check('面板打开', !sr.getElementById('panel').hidden);
  check('脸库加载', sr.querySelectorAll('.card').length > 0, sr.getElementById('meta').textContent);
  check('脸库条数', /共 \d+ 项/.test(sr.getElementById('meta').textContent), sr.getElementById('meta').textContent);
  check('空选择时提示词为空', sr.getElementById('ta').value === '', JSON.stringify(sr.getElementById('ta').value));
  check('空选择时按钮禁用', sr.getElementById('go').disabled);

  sr.querySelector('.card').click();
  await sleep(400);
  check('选中后托盘更新', /脸：.+/.test(sr.getElementById('tray').textContent), sr.getElementById('tray').textContent);
  check('选中后生成提示词', sr.getElementById('ta').value.includes('人像参考'));
  check('选中后按钮可用', !sr.getElementById('go').disabled);

  // 服装库
  [...sr.querySelectorAll('.tab')][1].click();
  await sleep(7000);
  check('服装库加载', sr.querySelectorAll('.card').length > 0, sr.getElementById('meta').textContent);
  const f1 = [...sr.getElementById('f1').options].map((o) => o.textContent);
  check('服装大类筛选项', f1.length > 1, f1.join(','));
  sr.querySelector('.card').click();
  await sleep(400);
  check('服装提示词', sr.getElementById('ta').value.includes('服装参考'));

  // 姿势库 + 深度图
  [...sr.querySelectorAll('.tab')][2].click();
  await sleep(8000);
  check('姿势库加载', sr.querySelectorAll('.card').length > 0, sr.getElementById('meta').textContent);
  check('多角度按钮', sr.querySelectorAll('.card .ang button').length > 0);
  sr.getElementById('btn-depth').click();
  await sleep(1200);
  sr.querySelector('.card').click();
  await sleep(500);
  check('深度图提示词', sr.getElementById('ta').value.includes('ControlNet'));
  check('深度图托盘标记', sr.getElementById('tray').textContent.includes('[深度图]'));

  // 搜索
  const search = sr.getElementById('q');
  search.value = '不存在的关键词ZZZ';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(600);
  check('搜索无结果提示', sr.getElementById('grid').textContent.includes('没有匹配'), sr.getElementById('grid').textContent.slice(0, 40));
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(600);

  // 填充
  const ed = document.querySelector('[data-composer-input]');
  if (ed) {
    ed.focus(); document.execCommand('selectAll'); await sleep(150);
    ed.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
    await sleep(200);
    document.querySelectorAll('[data-slot="conversation.input.attachments"] button[aria-label^="移除"]').forEach((b) => b.click());
    await sleep(400);
  }
  sr.getElementById('go').click();
  await sleep(16000);
  const atts = [...document.querySelectorAll('[data-slot="conversation.input.attachments"] img')].map((i) => i.alt);
  check('填充后附件数=3', atts.length === 3, atts.join(','));
  check('填充后提示词入框', (document.querySelector('[data-composer-input]')?.innerText || '').includes('人像参考'));
  check('填充成功消息', sr.getElementById('msg').textContent.includes('已填充'), sr.getElementById('msg').textContent);

  // 重复填充去重
  sr.getElementById('go').click();
  await sleep(8000);
  const atts2 = document.querySelectorAll('[data-slot="conversation.input.attachments"] img').length;
  check('重复填充不叠加', atts2 === 3, 'attachments=' + atts2);

  // 复制按钮（填充成功后面板会自动收起，先重新打开）
  if (sr.getElementById('panel').hidden) {
    const fr2 = sr.getElementById('fab').getBoundingClientRect();
    const o2 = { bubbles: true, cancelable: true, composed: true, pointerId: 3, button: 0, isPrimary: true, clientX: fr2.left + 20, clientY: fr2.top + 19 };
    sr.getElementById('fab').dispatchEvent(new PointerEvent('pointerdown', o2));
    sr.getElementById('fab').dispatchEvent(new PointerEvent('pointerup', o2));
    await sleep(700);
  }
  sr.querySelector('details').open = true;
  await sleep(200);
  sr.getElementById('copy').click();
  await sleep(300);
  check('复制提示词反馈', sr.getElementById('msg').textContent.includes('复制'), sr.getElementById('msg').textContent);

  // 清理输入框
  if (ed) {
    document.querySelectorAll('[data-slot="conversation.input.attachments"] button[aria-label^="移除"]').forEach((b) => b.click());
    ed.focus(); document.execCommand('selectAll'); await sleep(150);
    ed.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
  }
  return results;
};

