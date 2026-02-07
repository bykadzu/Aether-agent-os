// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock Monaco Editor before importing the component
vi.mock('@monaco-editor/react', () => ({
  default: (props: any) => (
    <div data-testid="monaco-editor" data-language={props.language} data-theme={props.theme}>
      {props.value}
    </div>
  ),
  __esModule: true,
}));

// Mock the kernel client
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDir: vi.fn(),
  }),
}));

// Mock lucide-react icons to simple spans
vi.mock('lucide-react', () => ({
  Save: (props: any) => <span data-testid="icon-save" {...props} />,
  X: (props: any) => <span data-testid="icon-x" {...props} />,
  FileCode: (props: any) => <span data-testid="icon-file-code" {...props} />,
  FolderOpen: (props: any) => <span data-testid="icon-folder-open" {...props} />,
  ChevronRight: (props: any) => <span data-testid="icon-chevron-right" {...props} />,
  ChevronDown: (props: any) => <span data-testid="icon-chevron-down" {...props} />,
  File: (props: any) => <span data-testid="icon-file" {...props} />,
  Search: (props: any) => <span data-testid="icon-search" {...props} />,
  GitBranch: (props: any) => <span data-testid="icon-git-branch" {...props} />,
  Settings: (props: any) => <span data-testid="icon-settings" {...props} />,
  Play: (props: any) => <span data-testid="icon-play" {...props} />,
}));

import { CodeEditorApp } from '../CodeEditorApp';

describe('CodeEditorApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<CodeEditorApp />);
    expect(container).toBeTruthy();
  });

  it('renders with initial content and file name', () => {
    render(<CodeEditorApp initialContent="console.log('hello');" fileName="test.ts" />);

    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toBeTruthy();
    expect(editor.textContent).toContain("console.log('hello');");
  });

  it('shows the activity bar', () => {
    render(<CodeEditorApp />);

    const activityBar = screen.getByTestId('activity-bar');
    expect(activityBar).toBeTruthy();
  });

  it('shows the activity bar with all icon buttons', () => {
    render(<CodeEditorApp />);

    const activityBar = screen.getByTestId('activity-bar');
    expect(activityBar).toBeTruthy();

    // Check that activity bar icons are present via their titles
    expect(screen.getByTitle('Explorer')).toBeTruthy();
    expect(screen.getByTitle('Search')).toBeTruthy();
    expect(screen.getByTitle('Source Control')).toBeTruthy();
    expect(screen.getByTitle('Run and Debug')).toBeTruthy();
    expect(screen.getByTitle('Settings')).toBeTruthy();
  });

  it('shows the file explorer sidebar', () => {
    render(<CodeEditorApp />);

    const fileExplorer = screen.getByTestId('file-explorer');
    expect(fileExplorer).toBeTruthy();

    // Explorer header text is present
    expect(screen.getByText('Explorer')).toBeTruthy();

    // Project label is present
    expect(screen.getByText('Project')).toBeTruthy();
  });

  it('shows the mock file tree when kernel is not connected', () => {
    render(<CodeEditorApp />);

    // Mock file tree should contain some default entries (src appears in breadcrumbs too, so use getAllByText)
    const fileExplorer = screen.getByTestId('file-explorer');
    expect(fileExplorer.textContent).toContain('src');
    expect(screen.getByText('package.json')).toBeTruthy();
    expect(screen.getByText('tsconfig.json')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();
  });

  it('can toggle sidebar visibility', () => {
    render(<CodeEditorApp />);

    // Sidebar should be visible by default
    expect(screen.getByTestId('file-explorer')).toBeTruthy();

    // Click the Explorer icon to toggle sidebar
    const explorerButton = screen.getByTitle('Explorer');
    fireEvent.click(explorerButton);

    // Sidebar should be hidden
    expect(screen.queryByTestId('file-explorer')).toBeNull();

    // Click again to show
    fireEvent.click(explorerButton);
    expect(screen.getByTestId('file-explorer')).toBeTruthy();
  });

  it('handles tab management - shows initial tab', () => {
    render(<CodeEditorApp fileName="app.tsx" />);

    const tabBar = screen.getByTestId('editor-tabs');
    expect(tabBar).toBeTruthy();

    // The initial tab should be present
    const tab = screen.getByTestId('tab-app.tsx');
    expect(tab).toBeTruthy();
    expect(tab.textContent).toContain('app.tsx');
  });

  it('opens a new tab when clicking a file in the tree', async () => {
    render(<CodeEditorApp fileName="initial.ts" />);

    // The initial tab should exist
    expect(screen.getByTestId('tab-initial.ts')).toBeTruthy();

    // Click on a file in the file tree (e.g., package.json)
    const packageJsonFile = screen.getByText('package.json');
    fireEvent.click(packageJsonFile);

    // A new tab should appear
    await waitFor(() => {
      expect(screen.getByTestId('tab-package.json')).toBeTruthy();
    });

    // Both tabs should be visible
    expect(screen.getByTestId('tab-initial.ts')).toBeTruthy();
    expect(screen.getByTestId('tab-package.json')).toBeTruthy();
  });

  it('switches between tabs when clicked', async () => {
    render(<CodeEditorApp initialContent="initial content" fileName="first.ts" />);

    // Open another file via tree
    const readmeFile = screen.getByText('README.md');
    fireEvent.click(readmeFile);

    await waitFor(() => {
      expect(screen.getByTestId('tab-README.md')).toBeTruthy();
    });

    // Click back to the first tab
    const firstTab = screen.getByTestId('tab-first.ts');
    fireEvent.click(firstTab);

    // Editor should now show first tab content
    const editor = screen.getByTestId('monaco-editor');
    expect(editor.textContent).toContain('initial content');
  });

  it('shows the Monaco editor with vs-dark theme', () => {
    render(<CodeEditorApp />);

    const editor = screen.getByTestId('monaco-editor');
    expect(editor.getAttribute('data-theme')).toBe('vs-dark');
  });

  it('detects language from file extension', () => {
    render(<CodeEditorApp fileName="script.py" />);

    const editor = screen.getByTestId('monaco-editor');
    expect(editor.getAttribute('data-language')).toBe('python');
  });

  it('detects TypeScript for .tsx files', () => {
    render(<CodeEditorApp fileName="Component.tsx" />);

    const editor = screen.getByTestId('monaco-editor');
    expect(editor.getAttribute('data-language')).toBe('typescript');
  });

  it('detects JavaScript for .js files', () => {
    render(<CodeEditorApp fileName="index.js" />);

    const editor = screen.getByTestId('monaco-editor');
    expect(editor.getAttribute('data-language')).toBe('javascript');
  });

  it('falls back to plaintext for unknown extensions', () => {
    render(<CodeEditorApp fileName="data.xyz" />);

    const editor = screen.getByTestId('monaco-editor');
    expect(editor.getAttribute('data-language')).toBe('plaintext');
  });

  it('shows the status bar with cursor position and language', () => {
    render(<CodeEditorApp fileName="test.rs" />);

    // Status bar should show cursor position
    expect(screen.getByText(/Ln 1, Col 1/)).toBeTruthy();

    // Status bar should show encoding
    expect(screen.getByText('UTF-8')).toBeTruthy();

    // Status bar should show language
    expect(screen.getByText('rust')).toBeTruthy();
  });

  it('shows file path in status bar when provided', () => {
    render(<CodeEditorApp fileName="main.go" filePath="/home/user/project/main.go" />);

    // File path appears in both breadcrumbs and status bar
    const matches = screen.getAllByText('/home/user/project/main.go');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows breadcrumbs with file path', () => {
    render(<CodeEditorApp fileName="app.tsx" filePath="/src/components/app.tsx" />);

    // Breadcrumb and status bar both show the file path
    const matches = screen.getAllByText('/src/components/app.tsx');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Save button in the status bar', () => {
    render(<CodeEditorApp />);

    const saveButton = screen.getByTitle('Save (Cmd+S)');
    expect(saveButton).toBeTruthy();
    expect(saveButton.textContent).toContain('Save');
  });

  it('expands and collapses folders in file tree', () => {
    render(<CodeEditorApp />);

    // The src folder should be expanded by default (depth 0)
    expect(screen.getByText('components')).toBeTruthy();

    // Click on src folder item in the file tree (src also appears in breadcrumbs, so use the tree role)
    const treeItems = screen.getAllByRole('treeitem');
    const srcItem = treeItems.find((item) => item.textContent?.trim().startsWith('src'));
    expect(srcItem).toBeTruthy();
    fireEvent.click(srcItem!);

    // Children should be hidden
    expect(screen.queryByText('components')).toBeNull();

    // Click again to expand
    fireEvent.click(srcItem!);
    expect(screen.getByText('components')).toBeTruthy();
  });

  it('does not open duplicate tabs for the same file', async () => {
    render(<CodeEditorApp fileName="initial.ts" />);

    // Open package.json twice
    const packageJsonFile = screen.getByText('package.json');
    fireEvent.click(packageJsonFile);

    await waitFor(() => {
      expect(screen.getByTestId('tab-package.json')).toBeTruthy();
    });

    // Click package.json again
    fireEvent.click(packageJsonFile);

    // Should still have only one package.json tab (plus the initial tab)
    const allTabs = screen.getByTestId('editor-tabs');
    const tabElements = allTabs.querySelectorAll('[role="tab"]');
    expect(tabElements.length).toBe(2); // initial.ts + package.json
  });

  it('displays the git branch indicator in status bar', () => {
    render(<CodeEditorApp />);

    expect(screen.getByText('main*')).toBeTruthy();
  });
});
