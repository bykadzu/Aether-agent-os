import React from 'react';

interface VideoPlayerAppProps {
  url?: string;
  title?: string;
}

export const VideoPlayerApp: React.FC<VideoPlayerAppProps> = ({ url, title = 'Media Player' }) => {
  if (!url) {
      return (
          <div className="flex items-center justify-center h-full bg-black text-white">
              <p>No media source loaded.</p>
          </div>
      );
  }

  return (
    <div className="flex flex-col h-full bg-black">
        <div className="flex-1 flex items-center justify-center overflow-hidden">
            <video 
                src={url} 
                controls 
                autoPlay 
                className="max-w-full max-h-full outline-none shadow-2xl"
                style={{ borderRadius: '4px' }}
            >
                Your browser does not support the video tag.
            </video>
        </div>
        <div className="h-12 bg-gray-900 flex items-center px-4 justify-between border-t border-gray-800">
             <div className="text-white font-medium text-sm truncate">{title}</div>
             <div className="text-gray-500 text-xs">HD • 60FPS</div>
        </div>
    </div>
  );
};