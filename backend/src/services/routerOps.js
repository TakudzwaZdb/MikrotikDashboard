/*
 * Router actions, independent of WHERE the router is.
 *
 *  - direct mode    (laptop hosts everything / router reachable): talks to RouterOS itself.
 *  - connector mode (Render): the router is behind NAT, so every action is sent
 *    to the laptop connector, which performs it on the LAN.
 *
 * All callers (API routes, poller, data cap) use `ops` and never need to know.
 */
import { config } from '../config/index.js';
import { connectorCommand } from '../connector/bridge.js';
import * as hs from './mikrotik/hotspotService.js';
import { disconnectHotspotSession } from './mikrotik/sessionService.js';

export const directOps = {
  disconnect: name => disconnectHotspotSession(name),
  disable: name => hs.disableHotspotUser(name),
  enable: name => hs.enableHotspotUser(name),
  remove: name => hs.removeHotspotUser(name),
  resetUsage: name => hs.resetUserCounters(name),
  blockMac: (mac, comment) => hs.blockMac(mac, comment),
  unblockMac: mac => hs.unblockMac(mac),
  profiles: () => hs.getHotspotProfiles()
};

export const remoteOps = {
  disconnect: name => connectorCommand('disconnect-voucher', { name }),
  disable: name => connectorCommand('disable-voucher', { name }),
  enable: name => connectorCommand('enable-voucher', { name }),
  remove: name => connectorCommand('remove-voucher', { name }),
  resetUsage: name => connectorCommand('reset-voucher-usage', { name }),
  blockMac: (mac, comment) => connectorCommand('block-mac', { mac, comment }),
  unblockMac: mac => connectorCommand('unblock-mac', { mac }),
  profiles: () => connectorCommand('profiles')
};

export const ops = config.connectorMode ? remoteOps : directOps;
