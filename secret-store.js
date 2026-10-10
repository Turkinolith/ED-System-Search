import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './scripts/atomic-file.js';

// Stores small secrets (LLM API keys) in the operating system's credential
// store: Windows Credential Manager, the macOS Keychain, or the Linux Secret
// Service (GNOME Keyring, KWallet). Secrets always reach the helper tools on
// stdin, never as command-line arguments, which other processes can read.
// When no store is usable the secrets fall back to a plain-text JSON file.

export const secretService = 'ed-system-search';

// Runs a command, feeding `input` on stdin. Resolves with the exit code and
// output rather than throwing on a non-zero exit, so callers can tell
// "not found" apart from a failure. Rejects only when the command is missing.
export function runCommand(command, args, input = '', { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Windows: P/Invoke into advapi32 from Windows PowerShell, which ships with
// every supported Windows. The script travels as -EncodedCommand (it holds no
// secret); the operations, secrets included, are read from stdin as JSON.
const windowsScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class EdssCredentials {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Credential {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref Credential credential, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr buffer);
  const int Generic = 1;
  const int PersistLocalMachine = 2;
  const int NotFound = 1168;
  public static string Read(string target) {
    IntPtr pointer;
    if (!CredReadW(target, Generic, 0, out pointer)) {
      int error = Marshal.GetLastWin32Error();
      if (error == NotFound) return null;
      throw new Win32Exception(error);
    }
    try {
      Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
      if (credential.CredentialBlobSize == 0) return "";
      byte[] blob = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
      return Encoding.UTF8.GetString(blob);
    } finally {
      CredFree(pointer);
    }
  }
  public static void Write(string target, string user, string secret) {
    byte[] blob = Encoding.UTF8.GetBytes(secret);
    if (blob.Length > 2560) throw new ArgumentException("The secret is longer than Credential Manager allows.");
    Credential credential = new Credential();
    credential.Type = Generic;
    credential.TargetName = target;
    credential.UserName = user;
    credential.Persist = PersistLocalMachine;
    credential.CredentialBlobSize = blob.Length;
    credential.CredentialBlob = Marshal.AllocHGlobal(blob.Length);
    try {
      Marshal.Copy(blob, 0, credential.CredentialBlob, blob.Length);
      if (!CredWriteW(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(credential.CredentialBlob);
    }
  }
  public static bool Delete(string target) {
    if (CredDeleteW(target, Generic, 0)) return true;
    int error = Marshal.GetLastWin32Error();
    if (error == NotFound) return false;
    throw new Win32Exception(error);
  }
}
'@
# Windows PowerShell 5.1 returns a JSON array as one object; foreach unrolls it.
$operations = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$results = @()
foreach ($operation in $operations) {
  try {
    switch ($operation.op) {
      'get' { $results += @{ ok = $true; value = [EdssCredentials]::Read($operation.target) } }
      'set' { [EdssCredentials]::Write($operation.target, $operation.user, $operation.secret); $results += @{ ok = $true } }
      'delete' { $results += @{ ok = $true; deleted = [EdssCredentials]::Delete($operation.target) } }
      default { $results += @{ ok = $false; error = 'Unknown operation.' } }
    }
  } catch {
    $results += @{ ok = $false; error = $_.Exception.Message }
  }
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($results) -Compress -Depth 4))
`;

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function windowsBackend(run) {
  const target = (name) => `${secretService}/${name}`;
  const batch = async (operations) => {
    const result = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(windowsScript),
    ], JSON.stringify(operations), { timeoutMs: 60000 });
    if (result.code !== 0) throw new Error(`Credential Manager helper failed: ${result.stderr.trim() || `exit ${result.code}`}`);
    const parsed = JSON.parse(result.stdout.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  };
  const one = async (operation) => {
    const [result] = await batch([operation]);
    if (!result?.ok) throw new Error(result?.error ?? 'Credential Manager request failed.');
    return result;
  };
  return {
    name: 'windows-credential-manager',
    label: 'Windows Credential Manager',
    secure: true,
    async probe() {
      await one({ op: 'get', target: target('probe') });
    },
    async getMany(names) {
      const results = await batch(names.map((name) => ({ op: 'get', target: target(name) })));
      return names.map((name, index) => {
        const result = results[index];
        if (!result?.ok) throw new Error(result?.error ?? `Could not read ${name}.`);
        return result.value ?? null;
      });
    },
    async set(name, value) {
      await one({ op: 'set', target: target(name), user: name, secret: value });
    },
    async delete(name) {
      await one({ op: 'delete', target: target(name) });
    },
  };
}

// macOS: the built-in security tool. Reads and deletes pass only names as
// arguments. Writes go through "security -i", which reads its command from
// stdin, and the secret is base64 encoded so it needs no quoting there.
function macBackend(run) {
  const notFound = 44;
  return {
    name: 'macos-keychain',
    label: 'macOS Keychain',
    secure: true,
    async probe() {
      const result = await run('security', ['find-generic-password', '-a', 'probe', '-s', secretService]);
      if (result.code !== 0 && result.code !== notFound) throw new Error(result.stderr.trim() || `security exited ${result.code}`);
    },
    async getMany(names) {
      return Promise.all(names.map(async (name) => {
        const result = await run('security', ['find-generic-password', '-a', name, '-s', secretService, '-w']);
        if (result.code === notFound) return null;
        if (result.code !== 0) throw new Error(result.stderr.trim() || `security exited ${result.code}`);
        return Buffer.from(result.stdout.trim(), 'base64').toString('utf8');
      }));
    },
    async set(name, value) {
      const encoded = Buffer.from(value, 'utf8').toString('base64');
      const result = await run('security', ['-i'], `add-generic-password -U -a ${name} -s ${secretService} -w ${encoded}\n`);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `security exited ${result.code}`);
      // Interactive mode does not always report a failed command in its exit
      // code, so read the item back to confirm it was stored.
      const [stored] = await this.getMany([name]);
      if (stored !== value) throw new Error('The Keychain did not store the key.');
    },
    async delete(name) {
      const result = await run('security', ['delete-generic-password', '-a', name, '-s', secretService]);
      if (result.code !== 0 && result.code !== notFound) throw new Error(result.stderr.trim() || `security exited ${result.code}`);
    },
  };
}

// Linux: secret-tool (package libsecret-tools) talks to whichever Secret
// Service is running. It reads the secret to store from stdin. Without a
// desktop keyring (servers, WSL, minimal installs) the probe fails and the
// fallback file is used.
function linuxBackend(run) {
  const attributes = (name) => ['service', secretService, 'account', name];
  return {
    name: 'linux-secret-service',
    label: 'Secret Service (GNOME Keyring / KWallet)',
    secure: true,
    async probe() {
      const result = await run('secret-tool', ['lookup', ...attributes('probe')], '', { timeoutMs: 10000 });
      // A missing item exits 1 with no output; anything on stderr means the
      // Secret Service itself is unreachable.
      if (result.stderr.trim() || (result.code !== 0 && result.code !== 1)) {
        throw new Error(result.stderr.trim() || `secret-tool exited ${result.code}`);
      }
    },
    async getMany(names) {
      return Promise.all(names.map(async (name) => {
        const result = await run('secret-tool', ['lookup', ...attributes(name)]);
        if (result.code !== 0) {
          if (result.stderr.trim()) throw new Error(result.stderr.trim());
          return null;
        }
        return result.stdout;
      }));
    },
    async set(name, value) {
      const result = await run('secret-tool', ['store', `--label=ED System Search (${name})`, ...attributes(name)], value);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `secret-tool exited ${result.code}`);
    },
    async delete(name) {
      const result = await run('secret-tool', ['clear', ...attributes(name)]);
      if (result.code !== 0 && result.stderr.trim()) throw new Error(result.stderr.trim());
    },
  };
}

function fileBackend(file) {
  const read = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  };
  const write = async (values) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  };
  return {
    name: 'plain-file',
    label: `plain-text file (${file})`,
    secure: false,
    async probe() {},
    async getMany(names) {
      const values = await read();
      return names.map((name) => (typeof values[name] === 'string' ? values[name] : null));
    },
    async set(name, value) {
      const values = await read();
      values[name] = value;
      await write(values);
    },
    async delete(name) {
      const values = await read();
      if (!(name in values)) return;
      delete values[name];
      if (Object.keys(values).length) await write(values);
      else if (existsSync(file)) await fs.rm(file, { force: true });
    },
  };
}

// Picks the platform's store, checking it actually works before relying on
// it, and falls back to the plain-text file otherwise.
export function createSecretStore({ platform = process.platform, fallbackFile, run = runCommand } = {}) {
  const candidates = {
    win32: windowsBackend,
    darwin: macBackend,
    linux: linuxBackend,
  };
  const fallback = fileBackend(fallbackFile);
  let selected = null;
  const backend = async () => {
    selected ??= (async () => {
      const make = candidates[platform];
      if (!make) return { backend: fallback, reason: `No credential store support for ${platform}.` };
      const native = make(run);
      try {
        await native.probe();
        return { backend: native, reason: null };
      } catch (error) {
        return { backend: fallback, reason: `${native.label} is unavailable: ${error.message}` };
      }
    })();
    return selected;
  };
  return {
    async info() {
      const { backend: active, reason } = await backend();
      return { name: active.name, label: active.label, secure: active.secure, reason };
    },
    async getMany(names) {
      return (await backend()).backend.getMany(names);
    },
    async get(name) {
      const [value] = await this.getMany([name]);
      return value;
    },
    async set(name, value) {
      return (await backend()).backend.set(name, value);
    },
    async delete(name) {
      return (await backend()).backend.delete(name);
    },
  };
}
