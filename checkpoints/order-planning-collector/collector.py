"""Bounded, payload-free Windows IPv4 loopback snapshot collector."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import socket
import struct
import time
import uuid

SCHEMA = 'IEMS_LOOPBACK_V1'
MAX_NATIVE = 1024 * 1024
MAX_ROWS = 8192


def stamp():
    return {'utcNs': time.time_ns(), 'monotonicNs': time.perf_counter_ns()}


class FILETIME(C.Structure):
    _fields_ = [('low', W.DWORD), ('high', W.DWORD)]


class MEMORY(C.Structure):
    _fields_ = [('cb', W.DWORD), ('faults', W.DWORD)] + [(n, C.c_size_t) for n in ('peakWorkingSet', 'workingSet', 'peakPaged', 'paged', 'peakNonPaged', 'nonPaged', 'pagefile', 'peakPagefile', 'private')]


class IO(C.Structure):
    _fields_ = [(n, C.c_ulonglong) for n in ('readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes')]


class Windows:
    def __init__(self):
        if os.name != 'nt':
            raise OSError('UNSUPPORTED_PLATFORM')
        self.ip = C.WinDLL('iphlpapi', use_last_error=True)
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.ps = C.WinDLL('psapi', use_last_error=True)
        self.ip.GetExtendedTcpTable.argtypes = [C.c_void_p, C.POINTER(W.DWORD), W.BOOL, W.ULONG, C.c_int, W.ULONG]
        self.ip.GetExtendedTcpTable.restype = W.DWORD
        self.k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.k.OpenProcess.restype = W.HANDLE
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.k.GetProcessTimes.argtypes = [W.HANDLE] + [C.POINTER(FILETIME)] * 4
        self.k.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
        self.k.WaitForSingleObject.restype = W.DWORD
        self.k.GetExitCodeProcess.argtypes = [W.HANDLE, C.POINTER(W.DWORD)]
        self.k.GetProcessIoCounters.argtypes = [W.HANDLE, C.POINTER(IO)]
        self.ps.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(MEMORY), W.DWORD]

    def identity(self, pid):
        handle = self.k.OpenProcess(0x101000, False, pid)
        if not handle:
            return {'pid': pid, 'status': 'UNAVAILABLE', 'win32': C.get_last_error()}
        try:
            times = [FILETIME() for _ in range(4)]
            if not self.k.GetProcessTimes(handle, *[C.byref(x) for x in times]):
                return {'pid': pid, 'status': 'UNAVAILABLE', 'win32': C.get_last_error()}
            value = lambda x: (x.high << 32) | x.low
            exit_code = W.DWORD()
            if not self.k.GetExitCodeProcess(handle, C.byref(exit_code)):
                return {'pid':pid,'status':'UNAVAILABLE','win32':C.get_last_error()}
            wait_state = self.k.WaitForSingleObject(handle, 0)
            if wait_state not in (0,258):
                return {'pid':pid,'status':'UNAVAILABLE','win32':C.get_last_error()}
            result = {'active':wait_state==258, 'exitCode':exit_code.value, 'pid': pid, 'status': 'OK', 'birthFiletime': value(times[0]), 'cpu100ns': value(times[2]) + value(times[3])}
            memory = MEMORY(); memory.cb = C.sizeof(memory)
            if self.ps.GetProcessMemoryInfo(handle, C.byref(memory), memory.cb):
                result['workingSetBytes'] = memory.workingSet
            else:
                result['memoryUnavailable'] = C.get_last_error()
            io = IO()
            if self.k.GetProcessIoCounters(handle, C.byref(io)):
                result['io'] = {n: getattr(io, n) for n, _ in IO._fields_}
            else:
                result['ioUnavailable'] = C.get_last_error()
            return result
        finally:
            self.k.CloseHandle(handle)

    def tcp(self):
        size = W.DWORD(0)
        code = self.ip.GetExtendedTcpTable(None, C.byref(size), False, 2, 5, 0)
        for attempt in range(3):
            if code not in (0, 122):
                return {'status': 'UNAVAILABLE', 'win32': int(code)}
            if size.value < 4 or size.value > MAX_NATIVE:
                return {'status': 'UNAVAILABLE', 'reason': 'NATIVE_SIZE_LIMIT', 'size': size.value}
            buffer = C.create_string_buffer(size.value)
            code = self.ip.GetExtendedTcpTable(buffer, C.byref(size), False, 2, 5, 0)
            if code == 122:
                continue
            if code:
                return {'status': 'UNAVAILABLE', 'win32': int(code)}
            data = buffer.raw
            count = struct.unpack_from('<I', data)[0]
            if count > MAX_ROWS or 4 + count * 24 > len(buffer):
                return {'status': 'UNAVAILABLE', 'reason': 'ROW_SIZE_LIMIT', 'count': count}
            rows = []
            for offset in range(4, 4 + count * 24, 24):
                state, local, lp, remote, rp, pid = struct.unpack_from('<6I', data, offset)
                local = socket.inet_ntoa(struct.pack('<I', local))
                remote = socket.inet_ntoa(struct.pack('<I', remote))
                if local.startswith('127.') and (remote.startswith('127.') or remote == '0.0.0.0'):
                    rows.append({'state': state, 'local': [local, socket.ntohs(lp & 0xffff)], 'remote': [remote, socket.ntohs(rp & 0xffff)], 'pid': pid})
            states = {}
            for row in rows:
                states[str(row['state'])] = states.get(str(row['state']), 0) + 1
            ids = {pid: self.identity(pid) for pid in {r['pid'] for r in rows[:512]} if pid}
            for row in rows[:512]:
                row['identity'] = ids.get(row['pid'], {'status': 'UNKNOWN', 'reason': 'NO_QUERYABLE_PID'})
                row['identityObservation'] = 'QUERIED_AFTER_TCP_SNAPSHOT_NOT_SOCKET_LIFETIME_PROOF'
            return {'status': 'OK', 'hostRowCount': count, 'loopbackCount': len(rows), 'uniqueLocalPorts': len({r['local'][1] for r in rows}), 'stateCounts': states, 'rows': rows[:512], 'droppedRows': max(0, len(rows) - 512)}
        return {'status': 'UNAVAILABLE', 'reason': 'SIZE_RACE_LIMIT'}


def write_json(path, value, exclusive=False):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with open(temporary, 'x', encoding='utf8') as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            # Windows rename refuses an existing destination; never overwrite another owner.
            os.rename(temporary, path)
        else:
            os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()

def stop(directory, token):
    directory = Path(directory)
    owner = json.loads((directory / 'owner.json').read_text())
    if owner['sessionToken'] != token:
        raise ValueError('OWNER_TOKEN_MISMATCH')
    if not (directory / 'stop.request').exists():
        write_json(directory / 'stop.request', {'sessionToken': token}, True)


def run(args):
    directory = Path(args.directory)
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError('OWNED_DIRECTORY_REQUIRED')
    native = Windows()
    if (directory / 'owner.json').exists():
        existing = json.loads((directory / 'owner.json').read_text())
        if existing['sessionToken'] != args.token:
            raise ValueError('OWNER_TOKEN_MISMATCH')
        current = native.identity(existing['pid'])
        if current.get('birthFiletime') == existing['identity'].get('birthFiletime') and current['status'] == 'OK' and current.get('active'):
            print('ALREADY_RUNNING')
            return 0
        raise ValueError('PRIOR_ARTIFACTS_PRESERVED_USE_NEW_DIRECTORY')
    owner = {'schema': SCHEMA, 'sessionToken': args.token, 'pid': os.getpid(), 'parentPid': args.parent, 'identity': native.identity(os.getpid()), 'platform': platform.platform(), 'sourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), **stamp()}
    write_json(directory / 'owner.json', owner, True)
    reason = 'UNKNOWN'; seq = 0; dropped = 0; overruns = 0; errors = 0; written = 0
    started = time.perf_counter(); stopping = False
    def signal_stop(*_):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, signal_stop)
    signal.signal(signal.SIGINT, signal_stop)
    parent_identity = native.identity(args.parent)
    with open(directory / 'samples.ndjson', 'x', encoding='utf8', newline='\n') as stream:
        while True:
            tick = time.perf_counter()
            if stopping:
                reason = 'SIGNAL'; break
            if (directory / 'stop.request').exists():
                request = json.loads((directory / 'stop.request').read_text())
                if request.get('sessionToken') != args.token:
                    reason = 'STOP_TOKEN_MISMATCH'; errors += 1; break
                reason = 'STOP_REQUEST'; break
            if tick - started >= args.duration:
                reason = 'DURATION_LIMIT'; break
            parent_now = native.identity(args.parent)
            if parent_now.get('birthFiletime') != parent_identity.get('birthFiletime') or parent_now['status'] != 'OK' or not parent_now.get('active'):
                reason = 'PARENT_EXIT'; break
            sample = {'schema': SCHEMA, 'seq': seq, **stamp(), 'elapsedMs': (tick - started) * 1000}
            sample['tcp'] = native.tcp()
            sample['collector'] = native.identity(os.getpid())
            sample['endStamp'] = stamp()
            sample['sampleCostMs'] = (time.perf_counter() - tick) * 1000
            data = json.dumps(sample, separators=(',', ':')) + '\n'
            if written + len(data.encode()) > args.max_bytes:
                reason = 'SIZE_LIMIT'; break
            stream.write(data); stream.flush()
            written += len(data.encode()); seq += 1
            dropped += sample['tcp'].get('droppedRows', 0)
            errors += sample['tcp']['status'] != 'OK'
            if sample['sampleCostMs'] > args.interval * 1000:
                overruns += 1
            time.sleep(max(0, args.interval - (time.perf_counter() - tick)))
    stop_started = time.perf_counter()
    summary = {'schema': SCHEMA, 'sessionToken': args.token, 'reason': reason, 'samples': seq, 'bytes': written, 'droppedRows': dropped, 'overruns': overruns, 'errors': errors, 'durationMs': (time.perf_counter() - started) * 1000, 'collector': native.identity(os.getpid()), **stamp()}
    summary['summaryPreparationMs'] = (time.perf_counter() - stop_started) * 1000
    write_json(directory / 'summary.json', summary, True)
    return 0 if not errors else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['run', 'stop'])
    parser.add_argument('--directory', required=True)
    parser.add_argument('--token', required=True)
    parser.add_argument('--parent', type=int, default=os.getppid())
    parser.add_argument('--duration', type=float, default=120)
    parser.add_argument('--interval', type=float, default=.1)
    parser.add_argument('--max-bytes', type=int, default=8 * 1024 * 1024)
    args = parser.parse_args()
    if not 1 <= len(args.token) <= 64 or not all(c.isalnum() or c in '-_' for c in args.token):
        parser.error('TOKEN_BOUNDS_REJECTED')
    if not 0 < args.duration <= 120 or not .1 <= args.interval <= 1 or not 1024 <= args.max_bytes <= 8 * 1024 * 1024:
        parser.error('BOUNDS_REJECTED')
    if args.action == 'stop':
        stop(args.directory, args.token)
    else:
        raise SystemExit(run(args))
