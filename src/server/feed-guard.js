// Keeps the feed fetcher away from private networks when the page is reachable by other machines.
const net = require('net');
const dns = require('dns').promises;

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(.+)$/); // IPv4 in IPv6, written either 1.2.3.4 or as two hex groups
  if (mapped) {
    if (net.isIPv4(mapped[1])) return isPrivateIPv4(mapped[1]);
    const [hi, lo] = mapped[1].split(':').map(h => parseInt(h, 16));
    return isPrivateIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  const first = parseInt(v6.split(':')[0] || '0', 16);
  return v6 === '::' || v6 === '::1' || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

// shortcut: the name is resolved here and again by fetch, so a DNS answer that changes in between slips through; pin the address if that matters.
async function assertPublicUrl(href) {
  const url = new URL(href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Feed link must be http or https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address);
  if (addresses.some(isPrivateAddress)) throw new Error('Feed address is on a private network');
}

module.exports = { isPrivateAddress, assertPublicUrl };
