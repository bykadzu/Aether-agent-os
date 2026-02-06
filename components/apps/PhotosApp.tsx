import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, Sparkles, Info } from 'lucide-react';
import { analyzeImage } from '../../services/geminiService';

interface PhotosAppProps {
    initialImage?: string;
}

export const PhotosApp: React.FC<PhotosAppProps> = ({ initialImage }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
      if (initialImage) {
          setSelectedImage(initialImage);
      }
  }, [initialImage]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setAnalysis('');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedImage) return;
    
    setIsAnalyzing(true);
    setAnalysis('');
    
    // Check if it's a URL or base64. If it's a URL, we can't easily analyze it with the current service method 
    // without fetching and converting to base64, unless the API supports URL (Gemini Pro Vision does not, needs base64).
    // For this mock, we only analyze if it starts with data:image (base64)
    if (selectedImage.startsWith('data:image')) {
        const matches = selectedImage.match(/^data:(.+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const mimeType = matches[1];
            const result = await analyzeImage(
                selectedImage, 
                mimeType, 
                "Analyze this image in detail. Describe what you see, the mood, colors, and any text present."
            );
            setAnalysis(result);
        } else {
             setAnalysis("Error parsing image format.");
        }
    } else {
        setAnalysis("To analyze this image, please download it and upload it manually. (Demo Limitation: Analysis only works on uploaded files)");
    }
    
    setIsAnalyzing(false);
  };

  return (
    <div className="flex h-full bg-gray-50/80">
      {/* Sidebar / List */}
      <div className="w-48 bg-white/50 border-r border-gray-200/50 p-4 flex flex-col gap-2">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2">Library</h3>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors text-sm font-medium"
        >
          <Upload size={14} />
          Import Photo
        </button>
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="image/*" 
            className="hidden" 
        />
        
        {!selectedImage && (
             <div className="mt-4 p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
                <ImageIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No image selected</p>
             </div>
        )}
      </div>

      {/* Main View */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden relative">
        {selectedImage ? (
          <div className="flex flex-col h-full gap-4">
            <div className="flex-1 min-h-0 bg-black/5 rounded-xl border border-black/5 flex items-center justify-center overflow-hidden relative group">
                <img 
                    src={selectedImage} 
                    alt="Selected" 
                    className="max-w-full max-h-full object-contain shadow-lg"
                />
                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                        className="flex items-center gap-2 bg-white/90 backdrop-blur text-gray-800 px-4 py-2 rounded-full shadow-lg hover:bg-white font-medium transition-all"
                    >
                        {isAnalyzing ? (
                            <>
                                <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <Sparkles size={16} className="text-blue-500" />
                                Ask Gemini
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Analysis Panel */}
            {analysis && (
                <div className="h-1/3 bg-white/60 rounded-xl p-4 overflow-y-auto border border-white/40 shadow-sm animate-slide-up">
                    <div className="flex items-center gap-2 mb-2 text-gray-800 font-semibold">
                        <Info size={16} className="text-blue-500"/>
                        Gemini Analysis
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                        {analysis}
                    </p>
                </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
             <div className="w-20 h-20 bg-gray-200/50 rounded-full flex items-center justify-center mb-4">
                <ImageIcon size={32} />
             </div>
             <p>Select a photo to begin</p>
          </div>
        )}
      </div>
    </div>
  );
};