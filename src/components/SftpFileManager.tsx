import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Download, Edit3, File, Folder, FolderPlus, Info, Loader2, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { api, SftpEntry } from '../lib/api';

interface SftpFileManagerProps {
  sessionId: string;
  hostId: string;
}

type Progress = { label: string; value: number | null } | null;

function dirname(remotePath: string) {
  const parts = remotePath.split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}`.replace(/\/$/, '') || '/';
}

function joinPath(base: string, name: string) {
  return `${base === '/' ? '' : base}/${name}`.replace(/\/+/g, '/');
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read local file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

function downloadBase64(name: string, data: string) {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function SftpFileManager({ sessionId, hostId }: SftpFileManagerProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selected, setSelected] = useState<SftpEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorPath, setEditorPath] = useState('');
  const [editorValue, setEditorValue] = useState('');
  const [progress, setProgress] = useState<Progress>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const parentPath = useMemo(() => dirname(currentPath), [currentPath]);

  const runSftp = async <T,>(operation: string, payload: Record<string, any>): Promise<T> => {
    if (window.ipcRenderer) {
      return window.ipcRenderer.invoke<T>('sftp-operation', { sessionId, operation, payload });
    }
    return api.sftpOperation<T>(hostId, operation, payload);
  };

  const refresh = async (path = currentPath) => {
    setLoading(true);
    setError('');
    try {
      const result = await runSftp<{ entries?: SftpEntry[] } | SftpEntry[]>('list', { path });
      const nextEntries = Array.isArray(result) ? result : (result.entries || []);
      setEntries(nextEntries);
      setCurrentPath(path);
      setSelected(null);
    } catch (err: any) {
      setError(err.message || 'Unable to list directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh('/');
  }, [sessionId, hostId]);

  const operate = async (label: string, operation: string, payload: Record<string, any>, reload = true) => {
    setError('');
    setNotice('');
    try {
      await runSftp(operation, payload);
      setNotice(label);
      if (reload) await refresh();
    } catch (err: any) {
      setError(err.message || 'SFTP operation failed');
    }
  };

  const openEntry = (entry: SftpEntry) => {
    setSelected(entry);
    if (entry.isDirectory) refresh(entry.path);
  };

  const createFolder = () => {
    const name = prompt('Folder name');
    if (name) operate('Folder created', 'mkdir', { path: joinPath(currentPath, name) });
  };

  const createFile = () => {
    const name = prompt('File name');
    if (name) operate('File created', 'write', { path: joinPath(currentPath, name), content: '' });
  };

  const renameSelected = () => {
    if (!selected) return;
    const name = prompt('New name', selected.name);
    if (name) operate('Renamed', 'rename', { from: selected.path, to: joinPath(dirname(selected.path), name) });
  };

  const chmodSelected = () => {
    if (!selected) return;
    const mode = prompt('Permission mode', selected.permissions);
    if (mode) operate('Permissions updated', 'chmod', { path: selected.path, mode });
  };

  const copyOrMoveSelected = (operation: 'copy' | 'move') => {
    if (!selected) return;
    const to = prompt(operation === 'copy' ? 'Copy to path' : 'Move to path', selected.path);
    if (to) operate(operation === 'copy' ? 'Copied' : 'Moved', operation, { from: selected.path, to });
  };

  const deleteSelected = () => {
    if (!selected || !confirm(`Delete ${selected.name}?`)) return;
    operate('Deleted', 'delete', { path: selected.path });
  };

  const editSelected = async () => {
    if (!selected) return;
    setError('');
    try {
      const result = await runSftp<{ content: string }>('read', { path: selected.path });
      setEditorPath(selected.path);
      setEditorValue(result.content);
    } catch (err: any) {
      setError(err.message || 'Unable to read file');
    }
  };

  const saveEditor = async () => {
    await operate('File saved', 'write', { path: editorPath, content: editorValue });
    setEditorPath('');
    setEditorValue('');
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setProgress({ label: 'Uploading', value: 0 });
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const relativePath = (file as any).webkitRelativePath || file.name;
        await runSftp('upload', { path: joinPath(currentPath, relativePath), data: await fileToBase64(file) });
        setProgress({ label: `Uploading ${file.name}`, value: Math.round(((index + 1) / files.length) * 100) });
      }
      setNotice('Upload complete');
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadSelected = async () => {
    if (!selected) return;
    setProgress({ label: `Downloading ${selected.name}`, value: null });
    try {
      const result = await runSftp<{ name: string; data: string }>('download', { path: selected.path });
      downloadBase64(result.name, result.data);
    } catch (err: any) {
      setError(err.message || 'Download failed');
    } finally {
      setProgress(null);
    }
  };

  const archiveSelected = () => {
    if (!selected) return;
    const destination = prompt('Archive path', `${selected.path}.zip`);
    if (destination) operate('Archive created', 'archive', { paths: [selected.path], destination });
  };

  const extractSelected = () => {
    if (!selected) return;
    const destination = prompt('Extract to directory', dirname(selected.path));
    if (destination) operate('Archive extracted', 'extract', { archive: selected.path, destination });
  };

  return (
    <aside className="relative border-l border-border bg-[#161b22] min-w-0 flex flex-col">
      <div className="h-12 border-b border-border px-3 flex items-center gap-2 shrink-0">
        <Folder size={16} className="text-primary" />
        <div className="text-sm font-medium text-white truncate">Files</div>
        <button onClick={() => refresh()} title="Refresh" className="ml-auto p-1.5 rounded hover:bg-white/10 text-textMuted hover:text-white">
          <RefreshCw size={15} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border flex items-center gap-1 text-xs">
        <button onClick={() => refresh(parentPath)} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-textMuted">Up</button>
        <div className="truncate text-textMuted">{currentPath}</div>
      </div>

      <div className="px-3 py-2 border-b border-border grid grid-cols-7 gap-1">
        <button onClick={() => fileInputRef.current?.click()} title="Upload files" className="p-2 rounded bg-white/5 hover:bg-white/10 text-textMuted"><Upload size={15} /></button>
        <button onClick={downloadSelected} disabled={!selected} title="Download" className="p-2 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-textMuted"><Download size={15} /></button>
        <button onClick={() => folderInputRef.current?.click()} title="Upload folder" className="p-2 rounded bg-white/5 hover:bg-white/10 text-textMuted"><FolderPlus size={15} /></button>
        <button onClick={createFolder} title="New folder" className="p-2 rounded bg-white/5 hover:bg-white/10 text-textMuted"><FolderPlus size={15} /></button>
        <button onClick={createFile} title="New file" className="p-2 rounded bg-white/5 hover:bg-white/10 text-textMuted"><File size={15} /></button>
        <button onClick={editSelected} disabled={!selected || selected.isDirectory} title="Edit" className="p-2 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-textMuted"><Edit3 size={15} /></button>
        <button onClick={deleteSelected} disabled={!selected} title="Delete" className="p-2 rounded bg-white/5 hover:bg-red-500/20 disabled:opacity-40 text-textMuted"><Trash2 size={15} /></button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={event => uploadFiles(event.target.files)} />
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={event => uploadFiles(event.target.files)} {...{ webkitdirectory: '' }} />
      </div>

      {(error || notice || progress) && (
        <div className="px-3 py-2 border-b border-border text-xs">
          {error && <div className="text-red-300">{error}</div>}
          {notice && <div className="text-green-300">{notice}</div>}
          {progress && <div className="text-primary">{progress.label}{progress.value === null ? '...' : ` ${progress.value}%`}</div>}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-textMuted gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading files...
          </div>
        ) : (
          entries.map(entry => (
            <button
              key={entry.path}
              onClick={() => setSelected(entry)}
              onDoubleClick={() => openEntry(entry)}
              className={`w-full px-3 py-2 grid grid-cols-[18px_minmax(0,1fr)_56px] gap-2 text-left text-xs border-b border-border/60 ${selected?.path === entry.path ? 'bg-primary/10 text-white' : 'text-textMuted hover:bg-white/5'}`}
            >
              {entry.isDirectory ? <Folder size={15} className="text-primary" /> : <File size={15} />}
              <span className="truncate">{entry.name}</span>
              <span className="text-right">{entry.isDirectory ? '--' : entry.size}</span>
            </button>
          ))
        )}
      </div>

      {selected && (
        <div className="border-t border-border p-3 text-xs text-textMuted space-y-2">
          <div className="flex items-center gap-2 text-white">
            <Info size={14} />
            <span className="truncate">{selected.name}</span>
          </div>
          <div>Mode: {selected.permissions}</div>
          <div>Size: {selected.size} bytes</div>
          <div className="grid grid-cols-3 gap-1">
            <button onClick={renameSelected} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10">Rename</button>
            <button onClick={chmodSelected} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10">Chmod</button>
            <button onClick={() => copyOrMoveSelected('copy')} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10">Copy</button>
            <button onClick={() => copyOrMoveSelected('move')} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10">Move</button>
            <button onClick={archiveSelected} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10 flex items-center justify-center gap-1"><Archive size={12} />Zip</button>
            <button onClick={extractSelected} disabled={!selected.name.endsWith('.zip')} className="px-2 py-1 bg-white/5 rounded hover:bg-white/10 disabled:opacity-40">Extract</button>
          </div>
        </div>
      )}

      {editorPath && (
        <div className="absolute inset-8 z-50 bg-surface border border-border rounded-lg shadow-2xl flex flex-col">
          <div className="h-10 border-b border-border px-3 flex items-center gap-2">
            <span className="text-xs text-white truncate">{editorPath}</span>
            <button onClick={() => setEditorPath('')} className="ml-auto text-textMuted hover:text-white">Close</button>
            <button onClick={saveEditor} className="px-2 py-1 bg-primary text-background rounded text-xs flex items-center gap-1"><Save size={13} />Save</button>
          </div>
          <textarea value={editorValue} onChange={event => setEditorValue(event.target.value)} className="flex-1 bg-background text-white text-xs font-mono p-3 outline-none resize-none" />
        </div>
      )}
    </aside>
  );
}
