import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { fetchMachineTracking, fetchMachineDetail } from '../services/machineTrackingService';

dayjs.extend(duration);

const MACHINE_COMPARE_FIELDS = [
  'idrow',
  'machineid',
  'workcenternew',
  'workcenterot',
  'workcenterold',
  'workcenter_description',
  'groupname',
  'condition',
  'operator_name',
  'serialnumber',
  'order_no',
  'part_name',
  'operation_text',
  'longdate_checkin',
  'is_running',
];

function formatDuration(seconds = 0) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const dur = dayjs.duration(safeSeconds, 'seconds');
  const hours = Math.floor(dur.asHours());
  const minutes = String(dur.minutes()).padStart(2, '0');
  const secs = String(dur.seconds()).padStart(2, '0');

  return `${String(hours).padStart(2, '0')}:${minutes}:${secs}`;
}

function normalizeMachine(row) {
  return {
    ...row,
    is_running: Boolean(row.is_running),
    elapsed_seconds: Number(row.elapsed_seconds || 0),
  };
}

function machineSignature(machine) {
  return MACHINE_COMPARE_FIELDS.map((field) => `${field}:${machine[field] ?? ''}`).join('|');
}

function mergeMachines(prevMachines, nextRows) {
  const prevByMachineId = new Map(prevMachines.map((machine) => [machine.machineid, machine]));
  let changed = prevMachines.length !== nextRows.length;

  const nextMachines = nextRows.map((row) => {
    const nextMachine = normalizeMachine(row);
    const prevMachine = prevByMachineId.get(nextMachine.machineid);

    if (prevMachine && machineSignature(prevMachine) === machineSignature(nextMachine)) {
      return prevMachine;
    }

    changed = true;
    return nextMachine;
  });

  return changed ? nextMachines : prevMachines;
}

function stableStringify(value) {
  return JSON.stringify(value ?? null);
}

export function useMachineTracking({ refreshMs = 5000 } = {}) {
  const [machines, setMachines] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const detailSignatureRef = useRef('');

  const loadMachines = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const rows = await fetchMachineTracking();
      setMachines((prevMachines) => mergeMachines(prevMachines, rows));
    } catch (err) {
      setError(err.message || 'Gagal memuat machine tracking');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (machineId, { silent = false } = {}) => {
    if (!silent) {
      setDetail(null);
      setDetailLoading(true);
      detailSignatureRef.current = '';
    }

    try {
      const payload = await fetchMachineDetail(machineId);
      const nextSignature = stableStringify(payload);

      if (detailSignatureRef.current !== nextSignature) {
        detailSignatureRef.current = nextSignature;
        setDetail(payload);
      }
    } catch (err) {
      const errorPayload = { error: err.message || 'Gagal memuat detail mesin' };
      detailSignatureRef.current = stableStringify(errorPayload);
      setDetail(errorPayload);
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  const openMachine = useCallback(
    async (machine) => {
      setSelectedMachine(machine);
      await loadDetail(machine.machineid);
    },
    [loadDetail]
  );

  const closeMachine = useCallback(() => {
    setSelectedMachine(null);
    setDetail(null);
    detailSignatureRef.current = '';
  }, []);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  useEffect(() => {
    const timer = window.setInterval(() => loadMachines({ silent: true }), refreshMs);
    return () => window.clearInterval(timer);
  }, [loadMachines, refreshMs]);

  useEffect(() => {
    if (!selectedMachine?.machineid) return undefined;

    const timer = window.setInterval(() => {
      loadDetail(selectedMachine.machineid, { silent: true });
    }, refreshMs);

    return () => window.clearInterval(timer);
  }, [loadDetail, refreshMs, selectedMachine?.machineid]);

  const stats = useMemo(() => {
    const running = machines.filter((machine) => machine.is_running).length;
    const idle = machines.length - running;

    return {
      total: machines.length,
      running,
      idle,
      operators: new Set(machines.map((machine) => machine.operator_name).filter(Boolean)).size,
    };
  }, [machines]);

  const liveSelectedMachine = useMemo(() => {
    if (!selectedMachine?.machineid) return null;
    return (
      machines.find((machine) => machine.machineid === selectedMachine.machineid) || selectedMachine
    );
  }, [machines, selectedMachine]);

  return {
    machines,
    stats,
    selectedMachine: liveSelectedMachine,
    detail,
    loading,
    detailLoading,
    error,
    reload: loadMachines,
    openMachine,
    closeMachine,
    formatDuration,
  };
}

export default useMachineTracking;
