import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownPreview, inlinePreview } from '../scripts/markdown-preview.mjs';
import { ContextManager, stringDisplayWidth } from '../scripts/context-manager.mjs';

test('MK20 Markdown preview renders headings, prose, links, lists and tables', () => {
  const preview = markdownPreview('# 제목\n**강조** 및 [문서](https://example.com/a(b))\n- [x] 완료\n> 인용\n---\n| 항목 | 결과 |\n| --- | --- |\n| 한글 | 정상 |');
  assert.deepEqual(preview.lines, ['제목', '강조 및 문서', '- (x) 완료', '  인용', '', '항목: 한글', '결과: 정상']);
  assert.equal(preview.styles.join(''), 'htlqrtt');
  assert.equal(inlinePreview('snake_case a_b_c **굵게** `a ** b` \\*literal\\*'), 'snake_case a_b_c 굵게 a ** b *literal*');
});

test('MK20 Markdown preview preserves code and fence state through wrapping and viewport slicing', () => {
  const preview = markdownPreview('~~~js\nconst v = "**literal** [x](url)";\n' + '한'.repeat(70) + '\n~~~\n끝', '[AGENT] ', '  ');
  assert.equal(preview.lines[1], '  const v = "**literal** [x](url)";');
  assert.equal(preview.styles.slice(1, -1).every(s => s === 'c'), true);
  assert.equal(preview.lines.every(l => stringDisplayWidth(l) <= 50), true);
  assert.equal(preview.lines.slice(2, -1).join('').replaceAll(' ', ''), '한'.repeat(70));
  assert.equal(markdownPreview('```\n# unfinished streaming code').styles.join(''), 'c');
});

test('MK20 conversation uses preview for all harnesses; raw workspace and process text remain literal', () => {
  for (const harness of ['snowball.codex', 'snowball.antigravity', 'snowball.opencode']) {
    const context = new ContextManager();
    context.harnesses = [{ id: harness, name: harness, isEnabled: true }];
    context.selectedHarnessIdx = 0;
    context.currentTurns = [{ userPrompt: '읽어줘', agentResponse: '# 제목\n- **한글** 목록\n```\na ** b\n```', processDetails: ['raw **command**'] }];
    context.updateReaderForCurrentSession();
    const original = context.currentTurns[0].agentResponse;
    assert.ok(context.readerLines.some(l => l.includes('제목') && !l.includes('#')));
    assert.ok(context.readerLines.some(l => l.includes('a ** b')));
    context.readerScrollLine = 2;
    const payload = context.toPreviewPayload();
    assert.equal(payload.styles, context.readerStyles.slice(2, 6).join(''));
    assert.equal(context.currentTurns[0].agentResponse, original);
    context.readerLines = ['raw # file ** text'];
    assert.equal(context.toPreviewPayload().styles, undefined, 'stale formatting must not follow a replaced reader');
    context.showDetails = true;
    context.updateReaderForCurrentSession();
    assert.ok(context.readerLines.some(l => l.includes('raw **command**')));
  }
});
