import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Download, Edit3, File, Folder, FolderPlus, Info, Loader2, RefreshCw, Save, Trash2, Upload, Pin, PinOff, X, ChevronUp, ChevronDown } from 'lucide-react';
import { api, SftpEntry } from '../lib/api';

interface SftpFileManagerProps {
  sessionId: string;
  hostId: string;
  authType?: string | null;
  credentialId?: string | null;
  initialPath?: string;
  isVisible: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  onToggleVisible: () => void;
  scrollPosition: number;
  onScrollPositionChange: (value: number) => void;
  onCurrentPathChange?: (value: string) => void;
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

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(mtimeSeconds: number) {
  if (!mtimeSeconds) return '--';
  const date = new Date(mtimeSeconds * (mtimeSeconds < 10000000000 ? 1000 : 1));
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function SftpFileManager({
  sessionId,
  hostId,
  authType = null,
  credentialId = null,
  initialPath = '/',
  isVisible,
  isPinned,
  onTogglePin,
  onToggleVisible,
  scrollPosition,
  onScrollPositionChange,
  onCurrentPathChange,
}: SftpFileManagerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/');
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

  const [sortBy, setSortBy] = useState<'name' | 'size' | 'mtime' | 'permissions'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  const parentPath = useMemo(() => dirname(currentPath), [currentPath]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSftp = async <T,>(operation: string, payload: Record<string, any>): Promise<T> => {
    const runtime = window.ipcRenderer ? 'electron' : 'browser';
    const { token } = await api.requestConnectToken({
      hostId,
      runtime,
      purpose: 'sftp',
      authType,
      credentialId,
    });
    const requestPayload = {
      ...payload,
      authType,
      credentialId,
      connectToken: token,
    };
    if (window.ipcRenderer) {
      return window.ipcRenderer.invoke<T>('sftp-operation', { sessionId, operation, payload: requestPayload });
    }
    return api.sftpOperation<T>(hostId, operation, requestPayload);
  };

  const refresh = async (path = currentPath) => {
    setLoading(true);
    setError('');
    try {
      if (path !== currentPath) {
        onScrollPositionChange(0);
      }
      const result = await runSftp<{ entries?: SftpEntry[] } | SftpEntry[]>('list', { path });
      if (!mountedRef.current) return;
      const nextEntries = Array.isArray(result) ? result : (result.entries || []);
      setEntries(nextEntries);
      setCurrentPath(path);
      onCurrentPathChange?.(path);
      setSelected(null);
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = path === currentPath ? scrollPosition : 0;
        }
      });
    } catch (err: any) {
      setError(err.message || 'Unable to list directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPath(initialPath || '/');
    refresh(initialPath || '/');
  }, [sessionId, hostId, initialPath]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollPosition;
    }
  }, [scrollPosition, currentPath, entries.length]);

  const operate = async (label: string, operation: string, payload: Record<string, any>, reload = true) => {
    setError('');
    setNotice('');
    try {
      await runSftp(operation, payload);
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        setProgress({ label: `Uploading ${file.name}`, value: Math.round(((index + 1) / files.length) * 100) });
      }
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;
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

  const sortedEntries = useMemo(() => {
    const items = [...entries];
    items.sort((a, b) => {
      // Directories always come first
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      let valA: any = a[sortBy];
      let valB: any = b[sortBy];

      if (sortBy === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  }, [entries, sortBy, sortOrder]);

  return (
    <aside
      aria-hidden={!isVisible}
      data-mode={isPinned ? 'pinned' : 'overlay'}
      className="h-full min-h-0 flex flex-col min-w-0 bg-[#161b22] text-textMain relative select-none overflow-hidden pb-4"
    >
      {/* 1. Sticky Header */}
      <div className="h-12 border-b border-border px-3 flex items-center gap-2 shrink-0 bg-surface">
        <Folder size={16} className="text-primary" />
        <div className="text-sm font-semibold text-white truncate">Files</div>
        
        {loading && <Loader2 size={13} className="animate-spin text-primary shrink-0" />}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => refresh()}
            title="Refresh"
            className="p-1.5 rounded hover:bg-white/10 text-textMuted hover:text-white transition cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onTogglePin}
            title={isPinned ? 'Floating Mode (Overlay)' : 'Split Mode (Pinned)'}
            className="p-1.5 rounded hover:bg-white/10 text-textMuted hover:text-white transition cursor-pointer"
          >
            {isPinned ? <Pin size={14} className="text-primary" /> : <PinOff size={14} />}
          </button>
          <button
            onClick={onToggleVisible}
            title="Collapse FTP Panel"
            className="p-1.5 rounded hover:bg-white/10 text-textMuted hover:text-white transition cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 2. Breadcrumb Path and Toolbar */}
      <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs bg-surface/50 shrink-0 select-none">
        <button
          onClick={() => refresh(parentPath)}
          disabled={currentPath === '/'}
          className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-textMuted hover:text-white cursor-pointer shrink-0 transition text-[10px]"
        >
          Up
        </button>
        <div className="truncate text-[10px] text-textMuted font-mono bg-black/30 px-2 py-0.5 rounded flex-1">
          {currentPath}
        </div>
      </div>

      {/* Actions Toolbar */}
      <div className="px-3 py-1.5 border-b border-border grid grid-cols-4 sm:grid-cols-7 gap-1 bg-surface/50 shrink-0">
        <button onClick={() => fileInputRef.current?.click()} title="Upload files" className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-textMuted hover:text-white flex items-center justify-center cursor-pointer transition"><Upload size={14} /></button>
        <button onClick={downloadSelected} disabled={!selected} title="Download" className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-textMuted hover:text-white flex items-center justify-center cursor-pointer transition"><Download size={14} /></button>
        <button onClick={() => folderInputRef.current?.click()} title="Upload folder" className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-textMuted hover:text-white flex items-center justify-center cursor-pointer transition"><FolderPlus size={14} /></button>
        <button onClick={createFolder} title="New folder" className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-textMuted hover:text-white flex items-center justify-center cursor-pointer transition"><FolderPlus size={14} /></button>
        <button onClick={createFile} title="New file" className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-textMuted hover:text-white flex items-center justify-center cursor-pointer transition"><File size={14} /></button>
        <button onClick={editSelected} disabled={!selected || selected.isDirectory} title="Edit file content" className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40 text-textMuted hover:text-white flex items-center justify-center cursor-pointer transition"><Edit3 size={14} /></button>
        <button onClick={deleteSelected} disabled={!selected} title="Delete" className="p-1.5 rounded bg-white/5 hover:bg-red-500/20 disabled:opacity-40 text-textMuted hover:text-red-400 flex items-center justify-center cursor-pointer transition"><Trash2 size={14} /></button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={event => uploadFiles(event.target.files)} />
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={event => uploadFiles(event.target.files)} {...{ webkitdirectory: '' }} />
      </div>

      {/* Notifications/Progress */}
      {(error || notice || progress) && (
        <div className="px-3 py-1.5 border-b border-border text-xs shrink-0 bg-background/50">
          {error && <div className="text-red-300 truncate" title={error}>{error}</div>}
          {notice && <div className="text-green-300 truncate" title={notice}>{notice}</div>}
          {progress && <div className="text-primary truncate">{progress.label}{progress.value === null ? '...' : ` ${progress.value}%`}</div>}
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-[minmax(0,2fr)_1fr_1.2fr_1fr] px-3 py-1.5 border-b border-border text-[10px] text-textMuted bg-surface select-none font-semibold shrink-0">
        <button
          onClick={() => {
            if (sortBy === 'name') setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
            else { setSortBy('name'); setSortOrder('asc'); }
          }}
          className="flex items-center gap-1 hover:text-white transition text-left cursor-pointer focus:outline-none"
        >
          <span>Name</span>
          {sortBy === 'name' && (sortOrder === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </button>
        <button
          onClick={() => {
            if (sortBy === 'size') setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
            else { setSortBy('size'); setSortOrder('asc'); }
          }}
          className="flex items-center gap-1 hover:text-white transition text-left cursor-pointer focus:outline-none justify-end pr-2"
        >
          <span>Size</span>
          {sortBy === 'size' && (sortOrder === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </button>
        <button
          onClick={() => {
            if (sortBy === 'mtime') setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
            else { setSortBy('mtime'); setSortOrder('asc'); }
          }}
          className="flex items-center gap-1 hover:text-white transition text-left cursor-pointer focus:outline-none"
        >
          <span>Modified</span>
          {sortBy === 'mtime' && (sortOrder === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </button>
        <button
          onClick={() => {
            if (sortBy === 'permissions') setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
            else { setSortBy('permissions'); setSortOrder('asc'); }
          }}
          className="flex items-center gap-1 hover:text-white transition text-left cursor-pointer focus:outline-none"
        >
          <span>Mode</span>
          {sortBy === 'permissions' && (sortOrder === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </button>
      </div>

      {/* 3. Scrollable File List Container */}
      <div
        ref={scrollContainerRef}
        onScroll={(event) => onScrollPositionChange(event.currentTarget.scrollTop)}
        className="flex-1 overflow-y-auto min-h-0 bg-background/20 select-none"
      >
        {loading && entries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-textMuted gap-2 text-xs">
            <Loader2 size={14} className="animate-spin text-primary" />
            Loading files...
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-textMuted text-xs">
            Empty Directory
          </div>
        ) : (
          sortedEntries.map(entry => (
            <div
              key={entry.path}
              onClick={() => setSelected(entry)}
              onDoubleClick={() => openEntry(entry)}
              className={`grid grid-cols-[minmax(0,2fr)_1fr_1.2fr_1fr] px-3 py-1.5 items-center gap-1.5 border-b border-border/40 text-xs cursor-pointer transition select-none ${
                selected?.path === entry.path
                  ? 'bg-primary/10 text-white font-medium border-l-2 border-primary'
                  : 'text-textMuted hover:bg-white/5 hover:text-textMain border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0 pr-1">
                {entry.isDirectory ? (
                  <Folder size={14} className="text-primary shrink-0" />
                ) : (
                  <File size={14} className="text-textMuted shrink-0" />
                )}
                <span className="truncate text-white" title={entry.name}>{entry.name}</span>
              </div>
              <div className="text-right text-[10px] pr-2 font-mono truncate">
                {entry.isDirectory ? '--' : formatSize(entry.size)}
              </div>
              <div className="text-[10px] font-mono truncate">
                {formatDate(entry.mtime)}
              </div>
              <div className="text-[10px] font-mono truncate text-textMuted">
                {entry.permissions || '--'}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 4. Details Footer */}
      {selected && (
        <div className="border-t border-border p-3 text-xs bg-surface shrink-0 space-y-2 select-none">
          <div className="flex items-center gap-2 text-white">
            <Info size={14} className="text-primary" />
            <span className="truncate font-semibold flex-1 text-white">{selected.name}</span>
            <span className="text-[10px] font-mono bg-black/40 px-1.5 py-0.5 rounded text-textMuted">
              {selected.isDirectory ? 'Directory' : 'File'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-textMuted border-b border-border/40 pb-2">
            <div>Permissions: <span className="text-white font-mono">{selected.permissions}</span></div>
            <div>Size: <span className="text-white font-mono">{selected.isDirectory ? '--' : formatSize(selected.size)}</span></div>
          </div>
          <div className="grid grid-cols-3 gap-1 pt-1">
            <button onClick={renameSelected} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-border/50 text-[11px] text-white rounded transition cursor-pointer text-center">Rename</button>
            <button onClick={chmodSelected} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-border/50 text-[11px] text-white rounded transition cursor-pointer text-center">Chmod</button>
            <button onClick={() => copyOrMoveSelected('copy')} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-border/50 text-[11px] text-white rounded transition cursor-pointer text-center">Copy</button>
            <button onClick={() => copyOrMoveSelected('move')} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-border/50 text-[11px] text-white rounded transition cursor-pointer text-center">Move</button>
            <button onClick={archiveSelected} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-border/50 text-[11px] text-white rounded transition cursor-pointer flex items-center justify-center gap-1"><Archive size={11} />Zip</button>
            <button onClick={extractSelected} disabled={!selected.name.endsWith('.zip')} className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-border/50 text-[11px] text-white rounded transition disabled:opacity-40 cursor-pointer text-center">Extract</button>
          </div>
        </div>
      )}

      {/* Editor Modal Overlay */}
      {editorPath && (
        <div className="absolute inset-8 z-50 bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <div className="h-10 border-b border-border px-3 flex items-center gap-2 bg-[#1c2128]">
            <span className="text-xs text-white truncate font-mono">{editorPath}</span>
            <button onClick={() => setEditorPath('')} className="ml-auto text-xs text-textMuted hover:text-white border border-border/60 px-2 py-0.5 rounded transition cursor-pointer">Close</button>
            <button onClick={saveEditor} className="px-2.5 py-1 bg-primary text-background rounded text-xs font-semibold flex items-center gap-1 hover:bg-primary/90 transition cursor-pointer"><Save size={13} />Save</button>
          </div>
          <textarea value={editorValue} onChange={event => setEditorValue(event.target.value)} className="flex-1 bg-background text-white text-xs font-mono p-3 outline-none resize-none" />
        </div>
      )}
    </aside>
  );
}
