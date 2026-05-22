import { useState } from 'react';
import { Terminal, FolderGit2, Settings, Plus, Server } from 'lucide-react';

function App() {
  return (
    <div className="flex h-screen w-screen bg-background text-textMain font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-16 bg-surface border-r border-border flex flex-col items-center py-4 space-y-6">
        <div className="p-2 bg-primary/10 text-primary rounded-xl cursor-pointer hover:bg-primary/20 transition">
          <Terminal size={24} />
        </div>
        <div className="p-2 text-textMuted hover:text-textMain cursor-pointer transition">
          <FolderGit2 size={24} />
        </div>
        <div className="flex-1"></div>
        <div className="p-2 text-textMuted hover:text-textMain cursor-pointer transition">
          <Settings size={24} />
        </div>
      </div>

      {/* Hosts List Panel */}
      <div className="w-64 bg-[#161b22]/50 border-r border-border flex flex-col">
        <div className="h-14 border-b border-border flex items-center justify-between px-4">
          <span className="font-semibold text-sm">Hosts</span>
          <button className="p-1 hover:bg-white/10 rounded-md transition">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {/* Example Host Item */}
          <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-white/5 cursor-pointer transition group">
            <div className="w-8 h-8 rounded bg-primary/20 text-primary flex items-center justify-center">
              <Server size={16} />
            </div>
            <div>
              <div className="text-sm font-medium">Production Server</div>
              <div className="text-xs text-textMuted">root@192.168.1.100</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-background">
        <div className="h-14 border-b border-border flex items-center px-4">
          <span className="text-sm font-medium text-textMuted">No active session</span>
        </div>
        <div className="flex-1 flex items-center justify-center flex-col space-y-4">
          <Terminal size={48} className="text-border" />
          <h2 className="text-xl font-semibold text-textMuted">Select a host to connect</h2>
          <p className="text-sm text-textMuted/60">Or add a new server to your list</p>
        </div>
      </div>
    </div>
  );
}

export default App;
