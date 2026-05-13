// HID++ analyzer for MX Creative Console captures.
// Reads a .pcap via tshark, extracts host->device HID++ commands and
// device->host responses, decodes headers, and reconstructs the
// feature-index ↔ feature-ID table from Root (0x0000) queries.
//
// Usage:  node decode-hidpp.mjs <path-to-pcap>

import { execFileSync } from 'node:child_process'

const TSHARK = 'C:/Program Files/Wireshark/tshark.exe'
const pcap = process.argv[2] || '../captures/03-options-plus-startup.pcap'

// Standard HID++ 2.0 feature IDs (subset relevant to peripherals + displays).
// Source: Logitech HID++ 2.0 spec & community reverse-engineering.
const FEATURE_NAMES = {
  0x0000: 'IRoot',
  0x0001: 'IFeatureSet',
  0x0002: 'IFeatureInfo',
  0x0003: 'DeviceFwVersion',
  0x0005: 'DeviceName',
  0x0007: 'DeviceFriendlyName',
  0x0011: 'DeviceReset',
  0x0020: 'ConfigChange',
  0x0021: 'DeviceUniqueId',
  0x00c2: 'DfuControlSigned',
  0x1000: 'BatteryUnifiedLevelStatus',
  0x1004: 'UnifiedBattery',
  0x18a1: 'LedControl',
  0x1802: 'LedSwControl',
  0x1803: 'ForceSensingButtonCfg',
  0x1830: 'PowerModes',
  0x1850: 'ChangeHost',
  0x1861: 'BatteryVoltage',
  0x1890: 'DeviceConnectionDisconnection',
  0x1981: 'BacklightControl',
  0x1982: 'Backlight2',
  0x1a20: 'EncryptionAndAuthentication',
  0x1b00: 'ReprogramControls',
  0x1b04: 'ReprogramControlsV4',
  0x1bc0: 'RawKeyboard',
  0x1d4b: 'WirelessDeviceStatus',
  0x1df3: 'EQuad / VirtualPairing',
  0x1e00: 'EnableHiddenFeatures',
  0x1e02: 'EnableHiddenFeaturesV1',
  0x4000: 'KeyboardLayout',
  0x4010: 'TouchpadFwItems',
  0x4030: 'DisableKeys',
  0x4220: 'LockKeyState',
  0x4321: 'CrownStatus / Crown',
  0x4540: 'KeyboardLayoutV2',
  0x6010: 'TouchMouseRawXY',
  0x6100: 'TouchpadRawXY',
  0x9001: 'PMSession',
  0xff03: 'BatteryUnknown / Test',
}

function featureName(id) {
  return FEATURE_NAMES[id] || `unknown_0x${id.toString(16).padStart(4, '0')}`
}

// Find the MX device address in the capture.
function findMxAddress() {
  const out = execFileSync(TSHARK, [
    '-r', pcap, '-Y', 'usb.idProduct == 0xc354',
    '-T', 'fields', '-e', 'usb.device_address',
  ], { encoding: 'utf8' })
  const addrs = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))]
  if (addrs.length !== 1) throw new Error(`expected 1 device address, found: ${addrs}`)
  return Number(addrs[0])
}

// Pull every HID++ packet (host or device direction) for the MX.
function readHidppPackets(deviceAddress) {
  const filter =
    `usb.device_address == ${deviceAddress} && ` +
    `(usbhid.data[0] == 0x11 || usbhid.data[0] == 0x13 || usbhid.data[0] == 0x14)`
  const out = execFileSync(TSHARK, [
    '-r', pcap, '-Y', filter,
    '-T', 'fields',
    '-e', 'frame.number', '-e', 'frame.time_relative',
    '-e', 'usb.src', '-e', 'usbhid.data',
  ], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean).map((line) => {
    const [num, t, src, hex] = line.split('\t')
    const buf = Buffer.from(hex, 'hex')
    return {
      num: Number(num),
      t: Number(t),
      direction: src === 'host' ? 'out' : 'in',
      hex,
      reportId: buf[0],
      deviceIndex: buf[1],
      featureIndex: buf[2],
      funcSw: buf[3],
      function: (buf[3] >> 4) & 0xf,
      softwareId: buf[3] & 0xf,
      params: buf.slice(4),
    }
  })
}

function decode() {
  const addr = findMxAddress()
  console.log(`MX device address in capture: ${addr}`)
  const pkts = readHidppPackets(addr)
  console.log(`HID++ packets: ${pkts.length} (${pkts.filter((p) => p.direction === 'out').length} out, ${pkts.filter((p) => p.direction === 'in').length} in)\n`)

  // Pair each request (host out) with its next matching response (device in).
  // HID++ responses match request on (deviceIndex, featureIndex, funcSw).
  const featureTable = new Map() // index → { id, name } once Root resolves it
  const pendingRequests = []

  for (const pkt of pkts) {
    if (pkt.reportId === 0x14) continue // LCD writes, not HID++ control
    if (pkt.direction === 'out') {
      pendingRequests.push(pkt)
      continue
    }
    // Match an outstanding request
    const reqIdx = pendingRequests.findIndex((r) =>
      r.deviceIndex === pkt.deviceIndex &&
      r.featureIndex === pkt.featureIndex &&
      r.funcSw === pkt.funcSw,
    )
    if (reqIdx < 0) continue
    const req = pendingRequests.splice(reqIdx, 1)[0]

    // If the request was Root.getFeature (feature 0x00, function 0),
    // the response carries the assigned index for the queried feature ID.
    if (req.featureIndex === 0x00 && req.function === 0x0) {
      const queriedFeatureId = (req.params[0] << 8) | req.params[1]
      const assignedIndex = pkt.params[0]
      const featureType = pkt.params[1] // bit flags: hidden/engineering/manufacturing
      if (assignedIndex !== 0) {
        featureTable.set(assignedIndex, {
          id: queriedFeatureId,
          name: featureName(queriedFeatureId),
          flags: featureType,
        })
      }
    }
  }

  console.log('=== Feature table (index → ID, name) ===')
  const sorted = [...featureTable.entries()].sort((a, b) => a[0] - b[0])
  for (const [idx, info] of sorted) {
    console.log(`  index 0x${idx.toString(16).padStart(2, '0')}  →  ` +
      `0x${info.id.toString(16).padStart(4, '0')}  ${info.name}` +
      (info.flags ? `  (flags=0x${info.flags.toString(16)})` : ''))
  }

  console.log('\n=== Host calls by feature (after Root resolved) ===')
  const callsByFeature = new Map()
  for (const pkt of pkts) {
    if (pkt.direction !== 'out') continue
    if (pkt.reportId === 0x14) continue
    if (pkt.featureIndex === 0x00) continue // Root queries already shown
    const feat = featureTable.get(pkt.featureIndex)
    const tag = feat
      ? `${feat.name} (idx 0x${pkt.featureIndex.toString(16)}, id 0x${feat.id.toString(16).padStart(4, '0')})`
      : `UNKNOWN idx 0x${pkt.featureIndex.toString(16)}`
    const key = `${tag}  fn=${pkt.function}`
    const entry = callsByFeature.get(key) ?? { count: 0, samples: [] }
    entry.count++
    if (entry.samples.length < 2) entry.samples.push(pkt.hex)
    callsByFeature.set(key, entry)
  }
  const callRows = [...callsByFeature.entries()].sort((a, b) => b[1].count - a[1].count)
  for (const [key, val] of callRows) {
    console.log(`  ${key.padEnd(70)}  ×${val.count}`)
    for (const s of val.samples) console.log(`     ${s}`)
  }
}

decode()
