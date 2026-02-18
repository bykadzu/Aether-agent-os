import React from 'react';

interface GitHubCloneModalProps {
  githubRepoUrl: string;
  setGithubRepoUrl: (url: string) => void;
  githubCloneStatus: 'idle' | 'cloning' | 'done' | 'error';
  onClone: () => void;
  onClose: () => void;
}

export const GitHubCloneModal: React.FC<GitHubCloneModalProps> = ({
  githubRepoUrl,
  setGithubRepoUrl,
  githubCloneStatus,
  onClone,
  onClose,
}) => (
  <div
    className="absolute inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center"
    onClick={onClose}
  >
    <div
      className="bg-[#1a1d26] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-scale-in"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-lg font-light text-white mb-1">GitHub Sync</h2>
      <p className="text-xs text-gray-500 mb-6">Clone a repository into the agent's workspace</p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">
            Repository URL
          </label>
          <input
            type="text"
            value={githubRepoUrl}
            onChange={(e) => setGithubRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-all"
            disabled={githubCloneStatus === 'cloning'}
          />
        </div>

        {githubCloneStatus === 'cloning' && (
          <div className="flex items-center gap-2 text-xs text-indigo-400">
            <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            Cloning repository...
          </div>
        )}
        {githubCloneStatus === 'done' && (
          <div className="text-xs text-green-400">Repository cloned successfully.</div>
        )}
        {githubCloneStatus === 'error' && (
          <div className="text-xs text-red-400">
            Failed to clone repository. Check the URL and try again.
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onClone}
          disabled={!githubRepoUrl.trim() || githubCloneStatus === 'cloning'}
          className="bg-white text-black hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed px-6 py-2 rounded-xl text-sm font-bold transition-colors"
        >
          Clone
        </button>
      </div>
    </div>
  </div>
);
