// Try every way out to the network. Each entry should end in an error.
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { attempt, report } from './lib.mjs';

const tcp = (host, port) =>
  new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.on('connect', () => {
      s.destroy();
      resolve('ok');
    });
    s.on('error', reject);
  });

const get = (mod, url) =>
  new Promise((resolve, reject) => {
    const req = mod.get(url, (res) => {
      res.resume();
      resolve('ok');
    });
    req.on('error', reject);
  });

const udp = (host, port) =>
  new Promise((resolve, reject) => {
    const s = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    s.on('error', (e) => {
      s.close();
      reject(e);
    });
    // A DNS query for example.com; "ok" only if an answer comes back.
    const q = Buffer.from('abcd01000001000000000000076578616d706c6503636f6d0000010001', 'hex');
    s.on('message', () => {
      s.close();
      resolve('ok');
    });
    s.send(q, port, host, (e) => {
      if (e) {
        s.close();
        reject(e);
      }
    });
  });

const r = {};
r.interfaces = Object.keys(os.networkInterfaces()).sort();
r.dns_lookup = await attempt(() => dns.lookup('example.com').then(() => 'ok'));
r.dns_resolver_8888 = await attempt(() => {
  const res = new dns.Resolver();
  res.setServers(['8.8.8.8']);
  return res.resolve4('example.com').then(() => 'ok');
});
r.udp_8888_53 = await attempt(() => udp('8.8.8.8', 53));
r.http_by_name = await attempt(() => get(http, 'http://example.com/'));
r.https_by_ip = await attempt(() => get(https, 'https://1.1.1.1/'));
r.tcp_1111_443 = await attempt(() => tcp('1.1.1.1', 443));
r.tcp_ipv6 = await attempt(() => tcp('2606:4700:4700::1111', 443));
r.metadata_http = await attempt(() => get(http, 'http://169.254.169.254/latest/meta-data/'));
r.metadata_tcp = await attempt(() => tcp('169.254.169.254', 80));
r.docker_bridge_gateway = await attempt(() => tcp('172.17.0.1', 2375));
r.docker_host_internal = await attempt(() => tcp('host.docker.internal', 80));
// Raw sockets need CAP_NET_RAW. Node can't open one without a native
// addon, so record the capability sets and no_new_privs instead.
const status = (await import('node:fs')).readFileSync('/proc/self/status', 'utf8');
r.cap_eff = status.match(/^CapEff:\s+(\w+)/m)[1];
r.cap_bnd = status.match(/^CapBnd:\s+(\w+)/m)[1];
r.no_new_privs = status.match(/^NoNewPrivs:\s+(\d)/m)[1];
report(r);
