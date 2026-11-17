const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const BotIpcProtocol = require('../src/infrastructure/process/BotIpcProtocol');
const RmsWriter = require('../src/infrastructure/storage/RmsWriter');

describe('Java Engine IPC Protocol & RMS Binary Writer Test Suite', () => {
  describe('Group 1: BotIpcProtocol Command Serialization & Telemetry Parsing', () => {
    it('IPC-001: serializes command payloads into newline-delimited Java stdin commands', () => {
      assert.equal(BotIpcProtocol.serializeCommand('START_AUTO', 'farm'), 'START_AUTO farm\n');
      assert.equal(BotIpcProtocol.serializeCommand('STOP_AUTO'), 'STOP_AUTO\n');
      assert.equal(BotIpcProtocol.serializeCommand('SETUP', { targetCoins: 10000000, upDays: 15 }), 'SETUP 10000000 15\n');
      assert.equal(BotIpcProtocol.serializeCommand('RESET_DATA'), 'RESET_DATA\n');

      const farmCmd = BotIpcProtocol.serializeCommand('FARM_SETTINGS', { autoWater: true, autoHarvest: true });
      assert.ok(farmCmd.startsWith('FARM_SETTINGS '));
      assert.ok(farmCmd.endsWith('\n'));
      const parsedPayload = JSON.parse(farmCmd.replace('FARM_SETTINGS ', '').trim());
      assert.equal(parsedPayload.autoWater, true);
    });

    it('IPC-002: filters out noisy JVM emulator bytecode and stacktraces', () => {
      const noisyLines = [
        'at java.lang.Thread.run(Thread.java:748)',
        'at javax.microedition.midlet.MIDlet.<init>',
        'Exception in thread "main" java.lang.NullPointerException',
        '[PROXY SETUP] Initializing SOCKS5 tunnel',
        'openJar: Avatar250.jar',
        '=========================================='
      ];

      for (const line of noisyLines) {
        const res = BotIpcProtocol.parseLine(line, 'stdout');
        assert.equal(res.handledSpecialPacket, true, `Line should be suppressed: ${line}`);
      }
    });

    it('IPC-003: correctly deserializes [ACCOUNT_STATUS] packet and detects target reached', () => {
      const rawLine = '[ACCOUNT_STATUS]: {"state":"target_reached","isTargetReached":true,"message":"Đã hoàn thành mục tiêu 10M xu!"}';
      const parsed = BotIpcProtocol.parseLine(rawLine, 'stdout');

      assert.equal(parsed.handledSpecialPacket, true);
      assert.ok(parsed.accountStatusUpdate);
      assert.equal(parsed.accountStatusUpdate.state, 'target_reached');
      assert.equal(parsed.isTargetReached, true);
    });

    it('IPC-004: parses [PLAYER_STATS] telemetry and normalizes coins and countdowns', () => {
      const rawLine = '[PLAYER_STATS]: {"coins":2500000,"level":42,"farmingCountdown":"02:15","isAutoRunning":true,"autoType":"farm"}';
      const parsed = BotIpcProtocol.parseLine(rawLine, 'stdout');

      assert.equal(parsed.handledSpecialPacket, true);
      assert.ok(parsed.statsUpdate);
      assert.equal(parsed.statsUpdate.coins, 2500000);
      assert.equal(parsed.statsUpdate.level, 42);
      assert.equal(parsed.statsUpdate.farmingCountdown, '02:15');
      assert.equal(parsed.statsUpdate.farmingTime, '02:15');
    });

    it('IPC-005: detects natural language farm finish signal from game stdout', () => {
      const line = '[Game] Nông trại bạn đã được chăm sóc xong!';
      const parsed = BotIpcProtocol.parseLine(line, 'stdout', { autoState: { autoType: 'farm', isRunning: true } });

      assert.ok(parsed.autoStatusUpdate);
      assert.equal(parsed.autoStatusUpdate.finished, true);
      assert.equal(parsed.autoStatusUpdate.isRunning, false);
      assert.equal(parsed.autoStatusUpdate.autoType, 'farm');
    });
  });

  describe('Group 2: MicroEmulator RecordStore (.rs) Binary Generation', () => {
    it('RMS-001: builds valid MicroEmulator binary header with correct byte offsets', () => {
      const storeName = 'avatar_farm_cfg';
      const payload = Buffer.from('TEST_PAYLOAD_BYTES_1234567890', 'utf8');

      const rsBuffer = RmsWriter.buildRecordStore(storeName, payload);

      let off = 0;
      // 1. Name length (UInt16BE)
      const nameLen = rsBuffer.readUInt16BE(off); off += 2;
      assert.equal(nameLen, storeName.length);

      // 2. Name string (UTF-8)
      const readName = rsBuffer.toString('utf8', off, off + nameLen); off += nameLen;
      assert.equal(readName, storeName);

      // 3. Version (Int32BE = 1)
      const version = rsBuffer.readInt32BE(off); off += 4;
      assert.equal(version, 1);

      // 4. Timestamp (BigInt64BE)
      const timestamp = rsBuffer.readBigInt64BE(off); off += 8;
      assert.ok(timestamp > 0n);

      // 5. nextRecordId (Int32BE = 2)
      const nextRecordId = rsBuffer.readInt32BE(off); off += 4;
      assert.equal(nextRecordId, 2);

      // 6. numRecords (Int32BE = 1)
      const numRecords = rsBuffer.readInt32BE(off); off += 4;
      assert.equal(numRecords, 1);

      // 7. Record 1 size (Int32BE = payload.length)
      const recordSize = rsBuffer.readInt32BE(off); off += 4;
      assert.equal(recordSize, payload.length);

      // 8. Payload bytes match
      const readPayload = rsBuffer.subarray(off);
      assert.deepEqual(readPayload, payload);
    });

    it('RMS-002: generates safe suite directories preventing path traversal', () => {
      const maliciousAccount = {
        id: 'acc-1',
        username: '../../etc/passwd',
        fileId: 'file_1'
      };

      const suiteDirs = RmsWriter.getSuiteDirs(maliciousAccount);
      for (const dir of suiteDirs) {
        assert.ok(!dir.includes('..'), `Directory must not contain traversal: ${dir}`);
        assert.ok(dir.includes('______etc_passwd'), `Traversal characters must be sanitized: ${dir}`);
      }
    });

    it('RMS-003: protects against accidental root deletion on blank or default usernames', () => {
      // Must not throw or touch disk when username is empty, blank, or 'main'
      assert.doesNotThrow(() => {
        RmsWriter.cleanAccountRmsDirs({ username: '' });
        RmsWriter.cleanAccountRmsDirs({ username: '   ' });
        RmsWriter.cleanAccountRmsDirs({ username: 'main' });
        RmsWriter.cleanAccountRmsDirs(null);
      });
    });
  });
});
