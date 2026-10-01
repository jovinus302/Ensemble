import { expect, it } from 'vitest';
import { attachmentAction } from '../components/format';

it.each([['prototype.html', '다운로드'], ['prototype.htm', '다운로드'], ['notes.txt', '열기']])('X4 %s action matches secure attachment behavior', (name, label) => {
  expect(attachmentAction(name!)).toBe(label);
});
