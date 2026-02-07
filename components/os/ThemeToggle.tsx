import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme, ThemeMode } from '../../services/themeManager';

const modes: { value: ThemeMode; icon: typeof Moon; label: string }[] = [
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'system', icon: Monitor, label: 'System' },
];

/**
 * Compact three-way theme toggle for the menu bar.
 * Cycles through Dark -> Light -> System, or can be used as a segmented control.
 */
export const ThemeToggle: React.FC = () => {
  const { mode, setMode } = useTheme();

  return (
    <div className="flex items-center bg-white/10 rounded-md overflow-hidden">
      {modes.map(({ value, icon: Icon, label }) => {
        const isActive = mode === value;
        return (
          <button
            key={value}
            onClick={() => setMode(value)}
            title={label}
            className={`
              flex items-center justify-center px-1.5 py-0.5 transition-colors
              ${
                isActive
                  ? 'bg-white/20 text-white'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }
            `}
          >
            <Icon size={12} />
          </button>
        );
      })}
    </div>
  );
};
