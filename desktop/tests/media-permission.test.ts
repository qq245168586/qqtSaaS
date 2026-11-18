import test from 'node:test';
import assert from 'node:assert/strict';
import { trustedMediaUrl } from '../electron/media-permission';
test('Windows microphone policy handles drive letters, backslashes and encoded application paths', () => {
  const target = 'C:\\Users\\Test\\App Data\\天美意\\resources\\app.asar\\dist\\index.html';
  assert.equal(
    trustedMediaUrl(
      'file:///C:/Users/Test/App%20Data/天美意/resources/app.asar/dist/index.html',
      target,
      false,
      true,
    ),
    true,
  );
  assert.equal(trustedMediaUrl('file:///C:/other/index.html', target, false, true), false);
  assert.equal(trustedMediaUrl('https://example.com', target, false, true), false);
});
test('Mac app page and explicit development origin only', () => {
  assert.equal(
    trustedMediaUrl(
      'file:///Applications/Test%20App/dist/index.html',
      '/Applications/Test App/dist/index.html',
      false,
      false,
    ),
    true,
  );
  assert.equal(
    trustedMediaUrl('http://127.0.0.1:5176', '/app/dist/index.html', false, false),
    false,
  );
  assert.equal(trustedMediaUrl('http://127.0.0.1:5176', '/app/dist/index.html', true, false), true);
  assert.equal(
    trustedMediaUrl('file://remote-host/app/dist/index.html', '/app/dist/index.html', false, false),
    false,
  );
});
