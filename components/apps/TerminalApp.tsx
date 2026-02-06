import React, { useState, useRef, useEffect } from 'react';
import { generateText, GeminiModel } from '../../services/geminiService';
import { FileSystemItem } from '../../data/mockFileSystem';
import { getKernelClient } from '../../services/kernelClient';
import { XTerminal } from '../os/XTerminal';

interface TerminalAppProps {
    files: FileSystemItem[];
    setFiles: React.Dispatch<React.SetStateAction<FileSystemItem[]>>;
}

export const TerminalApp: React.FC<TerminalAppProps> = ({ files, setFiles }) => {
  const [kernelConnected, setKernelConnected] = useState(false);
  const [kernelTtyId, setKernelTtyId] = useState<string | null>(null);

  // Check kernel connection and open a terminal session
  useEffect(() => {
    const client = getKernelClient();

    const checkConnection = () => {
      setKernelConnected(client.connected);
    };

    const unsub = client.on('connection', (data: any) => {
      setKernelConnected(data.connected);
      if (!data.connected) {
        setKernelTtyId(null);
      }
    });

    checkConnection();

    // If connected, open a user terminal
    if (client.connected && !kernelTtyId) {
      client.openTerminal(1, 80, 24).then(({ ttyId }) => {
        setKernelTtyId(ttyId);
      }).catch(() => {
        // Fall back to mock terminal
      });
    }

    return unsub;
  }, [kernelConnected]);

  // -- MOCK TERMINAL (when kernel not connected) --
  const [history, setHistory] = useState<string[]>(['Welcome to Aether Terminal v1.1.0', 'Type "help" for available commands.']);
  const [input, setInput] = useState('');
  const [currentDirId, setCurrentDirId] = useState('root');
  const [currentDirPath, setCurrentDirPath] = useState('~/');
  const [isProcessing, setIsProcessing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    inputRef.current?.focus();
  }, [history, isProcessing]);

  // Keep focus on input
  useEffect(() => {
      const focusInput = () => inputRef.current?.focus();
      document.addEventListener('click', focusInput);
      return () => document.removeEventListener('click', focusInput);
  }, []);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const cmdLine = input.trim();
    setHistory(prev => [...prev, `${currentDirPath} $ ${cmdLine}`]);
    setInput('');
    setIsProcessing(true);

    const parts = cmdLine.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    let output = '';

    switch (command) {
      case 'help':
        output = `Available commands:
  ls           List directory contents
  cd <dir>     Change directory
  cat <file>   Read file content
  touch <name> Create a new text file
  mkdir <name> Create a new directory
  rm <name>    Remove a file or directory
  whoami       Display current user
  clear        Clear terminal history
  ai <prompt>  Ask Gemini AI directly`;
        break;

      case 'ls':
        const dirFiles = files.filter(f => f.parentId === currentDirId);
        output = dirFiles.map(f => f.type === 'folder' ? f.name + '/' : f.name).join('  ');
        if (!output) output = '(empty)';
        break;

      case 'cd':
        if (!args || args === '~' || args === '/') {
            setCurrentDirId('root');
            setCurrentDirPath('~/');
        } else if (args === '..') {
            const currentDir = files.find(f => f.id === currentDirId);
            if (currentDir && currentDir.parentId && currentDir.parentId !== 'root') {
                 const parent = files.find(f => f.id === currentDir.parentId);
                 if (parent) {
                    setCurrentDirId(parent.id);
                    setCurrentDirPath(prev => {
                        const s = prev.split('/');
                        s.pop(); s.pop();
                        return s.join('/') + '/';
                    });
                 } else {
                     setCurrentDirId('root');
                     setCurrentDirPath('~/');
                 }
            } else {
                setCurrentDirId('root');
                setCurrentDirPath('~/');
            }
        } else {
            const target = files.find(f => f.parentId === currentDirId && f.name === args && f.type === 'folder');
            if (target) {
                setCurrentDirId(target.id);
                setCurrentDirPath(prev => prev + args + '/');
            } else {
                output = `cd: ${args}: No such directory`;
            }
        }
        break;

      case 'cat':
        if (!args) {
            output = "Usage: cat <filename>";
        } else {
            const file = files.find(f => f.parentId === currentDirId && f.name === args);
            if (file) {
                if (file.type === 'folder') {
                    output = `cat: ${args}: Is a directory`;
                } else if (file.content) {
                    output = file.content;
                } else {
                    output = `[Binary or empty file]`;
                }
            } else {
                output = `cat: ${args}: No such file or directory`;
            }
        }
        break;

      case 'touch':
        if (!args) {
            output = "Usage: touch <filename>";
        } else {
            if (files.some(f => f.parentId === currentDirId && f.name === args)) {
                output = `touch: ${args}: File exists`;
            } else {
                const newFile: FileSystemItem = {
                    id: `file_${Date.now()}`,
                    parentId: currentDirId,
                    name: args,
                    type: 'file',
                    kind: 'text',
                    date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
                    size: '0 KB',
                    content: ''
                };
                setFiles(prev => [...prev, newFile]);
                output = `Created file '${args}'`;
            }
        }
        break;

      case 'mkdir':
          if (!args) {
              output = "Usage: mkdir <dirname>";
          } else {
              if (files.some(f => f.parentId === currentDirId && f.name === args)) {
                  output = `mkdir: ${args}: Directory exists`;
              } else {
                  const newDir: FileSystemItem = {
                      id: `dir_${Date.now()}`,
                      parentId: currentDirId,
                      name: args,
                      type: 'folder',
                      kind: 'folder',
                      date: new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
                  };
                  setFiles(prev => [...prev, newDir]);
                  output = `Created directory '${args}'`;
              }
          }
          break;

      case 'rm':
          if (!args) {
              output = "Usage: rm <name>";
          } else {
              const targetIndex = files.findIndex(f => f.parentId === currentDirId && f.name === args);
              if (targetIndex !== -1) {
                  const target = files[targetIndex];
                  setFiles(prev => prev.filter(f => f.id !== target.id));
                  output = `Removed '${args}'`;
              } else {
                  output = `rm: ${args}: No such file or directory`;
              }
          }
          break;

      case 'whoami':
        output = 'dev_user';
        break;

      case 'clear':
        setHistory([]);
        setIsProcessing(false);
        return;

      case 'ai':
        if (!args) {
            output = "Usage: ai <prompt>";
        } else {
            try {
                setHistory(prev => [...prev, 'Gemini is thinking...']);
                const response = await generateText(args, GeminiModel.FLASH);
                setHistory(prev => {
                    const newHist = [...prev];
                    newHist.pop();
                    return [...newHist, response];
                });
                setIsProcessing(false);
                return;
            } catch (err) {
                output = "Error connecting to AI.";
            }
        }
        break;

      default:
        output = `command not found: ${command}`;
    }

    setHistory(prev => [...prev, output]);
    setIsProcessing(false);
  };

  // If kernel is connected and we have a tty, render real terminal
  if (kernelConnected && kernelTtyId) {
    return (
      <div className="h-full relative">
        <XTerminal ttyId={kernelTtyId} className="h-full" />
        <div className="absolute top-2 right-2 bg-green-500/20 text-green-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 backdrop-blur-sm">
          KERNEL
        </div>
      </div>
    );
  }

  // Mock terminal fallback
  return (
    <div className="h-full bg-[#1a1b26] text-[#a9b1d6] font-mono p-4 text-sm overflow-y-auto flex flex-col" onClick={() => inputRef.current?.focus()}>
      <div className="flex-1">
        {history.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap mb-1 leading-relaxed break-words">
            {line}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2">
            <span className="text-[#7aa2f7] shrink-0">{currentDirPath} $</span>
            <form onSubmit={handleCommand} className="flex-1 min-w-0">
                <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-[#c0caf5] caret-[#c0caf5] p-0"
                autoFocus
                disabled={isProcessing}
                spellCheck={false}
                autoComplete="off"
                />
            </form>
        </div>
      </div>
      <div ref={bottomRef} />
    </div>
  );
};
