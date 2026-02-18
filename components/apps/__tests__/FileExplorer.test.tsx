// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock the kernel client before importing the component
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    on: vi.fn(() => vi.fn()),
    send: vi.fn(),
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => (props: any) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    Folder: createIcon('folder'),
    FileText: createIcon('file-text'),
    Image: createIcon('image'),
    Music: createIcon('music'),
    Video: createIcon('video'),
    ChevronLeft: createIcon('chevron-left'),
    ChevronRight: createIcon('chevron-right'),
    Home: createIcon('home'),
    Search: createIcon('search'),
    Download: createIcon('download'),
    HardDrive: createIcon('hard-drive'),
    Grid: createIcon('grid'),
    List: createIcon('list'),
    Monitor: createIcon('monitor'),
    Code: createIcon('code'),
    Archive: createIcon('archive'),
    ArrowUpDown: createIcon('arrow-up-down'),
    Star: createIcon('star'),
    RefreshCw: createIcon('refresh-cw'),
    Upload: createIcon('upload'),
    Share2: createIcon('share2'),
  };
});

import { FileExplorer } from '../FileExplorer';

const mockFiles = [
  {
    id: 'root',
    parentId: null,
    name: 'Root',
    type: 'folder' as const,
    kind: 'folder',
    date: '2024',
    size: '--',
  },
  {
    id: 'f1',
    parentId: 'root',
    name: 'readme.md',
    type: 'file' as const,
    kind: 'text',
    date: '2024',
    size: '1 KB',
    content: 'Hello',
  },
  {
    id: 'f2',
    parentId: 'root',
    name: 'app.ts',
    type: 'file' as const,
    kind: 'code',
    date: '2024',
    size: '2 KB',
    content: 'code',
  },
];

describe('FileExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<FileExplorer files={mockFiles} onOpenFile={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it('shows file names', () => {
    render(<FileExplorer files={mockFiles} onOpenFile={vi.fn()} />);
    expect(screen.getByText('readme.md')).toBeTruthy();
    expect(screen.getByText('app.ts')).toBeTruthy();
  });

  it('shows search input', () => {
    render(<FileExplorer files={mockFiles} onOpenFile={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeTruthy();
  });

  it('calls onOpenFile when double-clicking a file', () => {
    const onOpenFile = vi.fn();
    render(<FileExplorer files={mockFiles} onOpenFile={onOpenFile} />);
    const fileElement = screen.getByText('readme.md');
    fireEvent.doubleClick(fileElement.closest('[class*="group"]')!);
    expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'readme.md' }));
  });
});
