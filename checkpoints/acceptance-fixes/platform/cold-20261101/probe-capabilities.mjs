import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
const root = process.env.QA_CAPABILITY_ROOT;
const decode = data => { const b=Buffer.from(data??[]);return b.includes(0)?b.toString('utf16le'):b.toString('utf8'); };
const rows=[];
function run(label,command,args) {
  const started=Date.now(), result=spawnSync(command,args,{timeout:30000,windowsHide:true,maxBuffer:1024*1024});
  rows.push({label,command,args,startedUtc:new Date(started).toISOString(),elapsedMs:Date.now()-started,code:result.status,signal:result.signal,error:result.error?.message,stdout:decode(result.stdout),stderr:decode(result.stderr)});
}
run('windows-discovery','powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-Command docker,wsl,java,terraform,python,uv,cargo,rustc,kafka-server-start,rabbitmq-server,redis-server,qdrant,airflow,flink,spark-submit -ErrorAction SilentlyContinue | Select-Object Name,Source) | ConvertTo-Json -Compress"]);
run('existing-wsl-status','wsl.exe',['--status']);
run('existing-wsl-distros','wsl.exe',['--list','--verbose']);
run('linux-capabilities','wsl.exe',['-d','IEMS-Lab','--exec','/bin/sh','-lc',`printf 'SYSTEM\n'; uname -srmo; printf 'OS_RELEASE\n'; cat /etc/os-release; printf 'DOCKER\n'; timeout 10s docker version; printf 'DOCKER_EXIT=%s\n' "$?"; printf 'ENGINES\n'; for tool in kafka-server-start.sh kafka-topics.sh rabbitmq-server rabbitmqctl redis-server redis-cli qdrant airflow flink spark-submit terraform java; do if command -v "$tool" >/dev/null 2>&1; then command -v "$tool"; else printf '%s MISSING\n' "$tool"; fi; done; printf 'PYTHON\n'; python3 --version; printf 'SERVICES\n'; systemctl is-active docker containerd; printf 'RAM\n'; free -b; printf 'DISK\n'; df -B1 /; printf 'PROCESS_RSS_KIB\n'; ps -eo pid,comm,rss --sort=-rss | head -18; printf 'OPT_CACHE_LOCATIONS\n'; ls /opt; printf 'LOCAL_BIN\n'; ls /usr/local/bin`]);
run('cached-windows-python','C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-c','import sys,importlib.util,json;print(json.dumps({"python":sys.version,"exe":sys.executable,"modules":{k:importlib.util.find_spec(k) is not None for k in ["airflow","pyspark","pyflink","redis","qdrant_client","duckdb","pyarrow","fastapi","uvicorn"]}}))']);
run('cached-windows-java','C:/Program Files/Eclipse Adoptium/jdk-17.0.17.10-hotspot/bin/java.exe',['-version']);
run('host-resource-identities','powershell.exe',['-NoProfile','-NonInteractive','-Command',"@{os=Get-CimInstance Win32_OperatingSystem|Select-Object FreePhysicalMemory,TotalVisibleMemorySize;processes=@(Get-Process -Name vmmemWSL,vmmem -ErrorAction SilentlyContinue|Select-Object Id,ProcessName,WorkingSet64,PeakWorkingSet64)}|ConvertTo-Json -Depth 4 -Compress"]);
writeFileSync(join(root,'capability-commands.json'),JSON.stringify({recordedUtc:new Date().toISOString(),host:{platform:process.platform,release:os.release(),logicalCpuCount:os.cpus().length,totalRamBytes:os.totalmem(),freeRamBytes:os.freemem(),probeNodeRssBytes:process.memoryUsage().rss},scope:'Read-only existing CLI/runtime discovery. No daemon start, feature/permission change, global installation, container run/pull, service mutation, engine workload or cloud call.',rows},null,2));
console.log(JSON.stringify(rows.map(({label,code,error,elapsedMs})=>({label,code,error,elapsedMs}))));
