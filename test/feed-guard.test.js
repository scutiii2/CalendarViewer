const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress, assertPublicUrl } = require('../src/server/feed-guard.js');

test('private, loopback and link-local addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fd12::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700::1111', '::ffff:808:808']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('assertPublicUrl refuses private literals and other schemes', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1:3000/x.ics'), /private network/);
  await assert.rejects(assertPublicUrl('http://[::ffff:127.0.0.1]/x.ics'), /private network/);
  await assert.rejects(assertPublicUrl('ftp://8.8.8.8/x.ics'), /http or https/);
  await assertPublicUrl('https://8.8.8.8/x.ics');
});
