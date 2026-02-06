export interface FileSystemItem {
  id: string;
  parentId: string | null;
  name: string;
  type: 'folder' | 'file';
  kind: 'folder' | 'text' | 'image' | 'audio' | 'video' | 'app' | 'code' | 'archive';
  size?: string;
  date: string;
  starred?: boolean;
  content?: string; // Mock content for text files
  url?: string; // Mock URL for images
}

export const mockFileSystem: FileSystemItem[] = [
  // Root Folders
  { id: 'desktop', parentId: 'root', name: 'Desktop', type: 'folder', kind: 'folder', date: 'Today' },
  { id: 'documents', parentId: 'root', name: 'Documents', type: 'folder', kind: 'folder', date: 'Yesterday' },
  { id: 'downloads', parentId: 'root', name: 'Downloads', type: 'folder', kind: 'folder', date: 'Today' },
  { id: 'pictures', parentId: 'root', name: 'Pictures', type: 'folder', kind: 'folder', date: 'Last Week' },
  { id: 'music', parentId: 'root', name: 'Music', type: 'folder', kind: 'folder', date: 'Oct 20' },
  { id: 'developer', parentId: 'root', name: 'Developer', type: 'folder', kind: 'folder', date: 'Oct 15' },

  // Documents
  { id: 'resume', parentId: 'documents', name: 'Resume_2025.txt', type: 'file', kind: 'text', size: '2.4 MB', date: 'Oct 24', starred: true, content: "John Doe\nSoftware Engineer\n\nExperience:\n- Senior Dev at Aether Inc.\n- Built an AI OS in React." },
  { id: 'budget', parentId: 'documents', name: 'Project_Budget.txt', type: 'file', kind: 'text', size: '1.1 MB', date: 'Oct 22', content: "Budget Breakdown:\n- Servers: $500\n- API Credits: $200\n- Coffee: $1000" },
  { id: 'notes', parentId: 'documents', name: 'Meeting_Notes.txt', type: 'file', kind: 'text', size: '12 KB', date: 'Today', content: "Meeting Agenda:\n1. Launch MVP\n2. Fix bugs\n3. Celebration" },
  
  // Downloads
  { id: 'installer', parentId: 'downloads', name: 'Chrome_Installer.dmg', type: 'file', kind: 'app', size: '120 MB', date: 'Today' },
  { id: 'movie', parentId: 'downloads', name: 'Holiday_Footage.mp4', type: 'file', kind: 'video', size: '1.2 GB', date: 'Yesterday' },
  
  // Pictures
  { id: 'vacation', parentId: 'pictures', name: 'Japan_Trip_01.jpg', type: 'file', kind: 'image', size: '4.2 MB', date: 'Sep 15', url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&auto=format&fit=crop' },
  { id: 'design', parentId: 'pictures', name: 'Mockup_v2.png', type: 'file', kind: 'image', size: '2.1 MB', date: 'Yesterday', url: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&auto=format&fit=crop' },
  
  // Music
  { id: 'song1', parentId: 'music', name: 'Midnight_City.mp3', type: 'file', kind: 'audio', size: '8.4 MB', date: 'Oct 10' },

  // Developer
  { id: 'project1', parentId: 'developer', name: 'website-v1', type: 'folder', kind: 'folder', date: 'Oct 05' },
  { id: 'code1', parentId: 'project1', name: 'index.tsx', type: 'file', kind: 'code', size: '14 KB', date: 'Oct 06', content: "console.log('Hello World');" },
  { id: 'readme', parentId: 'developer', name: 'README.md', type: 'file', kind: 'text', size: '2 KB', date: 'Oct 05', content: "# Project V1\nThis is the best project ever." },
];
