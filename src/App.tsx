import React, { useState, useRef } from 'react';
import { Camera, Image as ImageIcon, Loader2, CheckCircle2, History, RotateCcw, Plus, Trash2, TrendingUp, Moon, Sun, Download, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { processLedgerImage, verifyLedgerAccuracy, LedgerResult, LedgerItem, VerificationResult } from './services/geminiService';

interface SavedScan extends LedgerResult {
  id: string;
  date: string;
  timestamp: number;
  imageUrl?: string;
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [result, setResult] = useState<LedgerResult | null>(null);
  const [verificationReport, setVerificationReport] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedScan[]>(() => {
    try {
      const saved = localStorage.getItem('history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load history', e);
      return [];
    }
  });
  const [view, setView] = useState<'home' | 'result' | 'history'>('home');
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });
  const [zoomScale, setZoomScale] = useState(1);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  // Handle shared data from URL
  React.useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      try {
        const encodedData = hash.replace('#share=', '');
        const jsonStr = decodeURIComponent(escape(atob(encodedData)));
        const sharedResult = JSON.parse(jsonStr);
        if (sharedResult && sharedResult.items) {
          setResult(sharedResult);
          setView('result');
          window.location.hash = ''; // Clear hash after loading
        }
      } catch (err) {
        console.error('Failed to load shared data', err);
      }
    }
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem('history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to save history', e);
    }
  }, [history]);

  React.useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });
      
      streamRef.current = stream;
      setIsCameraActive(true);
      setView('home'); 
      
      // Attempt to attach immediately if ref is available
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera Access Error:', err);
      setError('ক্যামেরা চালু করতে সমস্যা হয়েছে। দয়া করে পারমিশন চেক করুন।');
      triggerCamera();
    }
  };

  // Ensure stream is attached when camera modal opens
  React.useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(e => console.error("Video play error:", e));
    }
  }, [isCameraActive]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsCameraActive(false);
  };

  const captureFrame = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        processImage(base64);
        stopCamera();
      }
    }
  };

  const processImage = async (base64: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await processLedgerImage(base64);
      
      if (!data.isReadable) {
        setError(data.qualityFeedback || 'দুঃখিত, ছবিটি পরিষ্কার নয়। দয়া করে আলোতে আরও ভালো ছবি তুলুন।');
        setLoading(false);
        return;
      }

      if (data.items.length === 0) {
        setError('ছবিতে কোনো হিসাবের তথ্য পাওয়া যায়নি। দয়া করে নিশ্চিত করুন এটি একটি হিসাবের খাতা।');
        setLoading(false);
        return;
      }

      const resultWithImage = { ...data, imageUrl: base64 };
      setResult(resultWithImage);
      setZoomScale(1);
      
      // Auto save to history
      const newScan: SavedScan = {
        ...resultWithImage,
        id: Math.random().toString(36).substr(2, 9),
        date: new Date().toLocaleDateString('bn-BD'),
        timestamp: Date.now()
      };
      setHistory(prev => [newScan, ...prev]);
      setView('result');
      setLoading(false);
    } catch (err) {
      console.error('OCR Error:', err);
      setError(err instanceof Error ? err.message : 'হিসাব প্রক্রিয়া করতে সমস্যা হয়েছে।');
      setLoading(false);
    }
  };

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input value to allow the same file to be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setError('ফাইলটি পড়া সম্ভব হয়নি। দয়া করে আবার চেষ্টা করুন।');
    };

    reader.onloadend = async () => {
      const base64 = reader.result as string;
      if (base64) {
        processImage(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  const handleVerify = async () => {
    if (!result || !result.imageUrl) return;
    
    setVerificationLoading(true);
    setVerificationReport(null);
    try {
      const report = await verifyLedgerAccuracy(result.imageUrl, result);
      setVerificationReport(report);
    } catch (err) {
      console.error('Verification Error:', err);
      alert('যাচাইকরণ প্রক্রিয়া সম্পন্ন করতে সমস্যা হয়েছে।');
    } finally {
      setVerificationLoading(false);
    }
  };

  const clearHistory = () => {
    if (confirm('আপনি কি সব হিসেব মুছে ফেলতে চান?')) {
      setHistory([]);
    }
  };

  const updateItem = (idx: number, field: keyof LedgerItem, value: string | number) => {
    if (!result) return;
    const newItems = [...result.items];
    const val = field === 'amount' ? (parseInt(value.toString()) || 0) : value;
    newItems[idx] = { ...newItems[idx], [field]: val } as LedgerItem;
    const newTotal = newItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const updatedResult = { ...result, items: newItems, total: newTotal };
    setResult(updatedResult);
    
    // Update history if this exists in history
    setHistory(prev => prev.map(scan => {
      if (scan.id === (result as SavedScan).id) {
        return { ...scan, items: newItems, total: newTotal };
      }
      return scan;
    }));
  };

  const handleDownload = () => {
    if (!result) return;
    
    const textContent = `
স্মার্ট হিসাব - ফলাফল
তারিখ: ${new Date().toLocaleDateString('bn-BD')}
মোট পরিমাণ: ৳${Number(result.total || 0).toLocaleString('bn-BD')}

হিসাবের বিবরণ:
${result.items.map(item => `- ${item.description || 'বিবরণ নেই'}: ৳${Number(item.amount || 0).toLocaleString('bn-BD')}`).join('\n')}

AI সারসংক্ষেপ:
${result.summary}
    `.trim();

    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hishab-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    if (!result) return;

    // Create a shareable URL containing the data
    const shareableData = {
      items: result.items,
      total: result.total,
      summary: result.summary,
      numeralStyle: result.numeralStyle,
      confidenceScore: result.confidenceScore
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareableData))));
    const shareUrl = `${window.location.origin}${window.location.pathname}#share=${encoded}`;

    const shareText = `স্মার্ট হিসাব ফলাফল\nমোট: ৳${Number(result.total || 0).toLocaleString('bn-BD')}\nসারসংক্ষেপ: ${result.summary}\n\nহিসাবের তালিকা:\n${result.items.map(item => `- ${item.description || 'বিবরণ নেই'}: ৳${Number(item.amount || 0).toLocaleString('bn-BD')}`).join('\n')}\n\nলিঙ্ক: ${shareUrl}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'স্মার্ট হিসাব ফলাফল',
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        console.error('Sharing failed', err);
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(shareText);
        alert('হিসাবের লিঙ্ক ও তথ্য ক্লিপবোর্ডে কপি করা হয়েছে!');
      } catch (err) {
        console.error('Clipboard failed', err);
      }
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  };

  const chartData = history.reduce((acc: any[], scan) => {
    const existing = acc.find(d => d.date === scan.date);
    if (existing) {
      existing.total += scan.total;
    } else {
      acc.push({ date: scan.date, total: scan.total });
    }
    return acc;
  }, []).reverse().slice(-7); // Last 7 days

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-slate-950' : 'bg-slate-50'} font-sans text-slate-900 dark:text-slate-100 pb-20 selection:bg-indigo-100 transition-colors duration-300`}>
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4 sticky top-0 z-10 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200 dark:shadow-none">
            <Camera size={20} />
          </div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">স্মার্ট হিসাব</h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className="text-slate-500 dark:text-slate-400 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all active:scale-95"
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button 
            onClick={() => setView(view === 'history' ? 'home' : 'history')}
            className="text-slate-500 dark:text-slate-400 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all active:scale-95"
          >
            {view === 'history' ? <RotateCcw size={22} /> : <History size={22} />}
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-6">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-indigo-200 rounded-full blur-2xl opacity-50 animate-pulse"></div>
                <Loader2 className="animate-spin text-indigo-600 relative z-10" size={64} />
              </div>
              <h2 className="text-2xl font-bold mb-3 tracking-tight">AI হিসাব করছে...</h2>
              <p className="text-slate-500 max-w-[200px] mx-auto text-sm">আপনার খাতাটি নিখুঁতভাবে পড়া হচ্ছে, কিছুক্ষণ অপেক্ষা করুন।</p>
            </motion.div>
          ) : view === 'home' ? (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col gap-6"
            >
              {error && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 p-4 rounded-2xl flex items-start gap-3"
                >
                  <div className="bg-red-500 text-white p-1.5 rounded-lg mt-0.5 shrink-0">
                    <RotateCcw size={14} className="rotate-45" />
                  </div>
                  <div>
                    <h4 className="font-bold text-red-800 dark:text-red-400 text-sm">হিসাব পড়তে সমস্যা হয়েছে</h4>
                    <p className="text-red-600/80 dark:text-red-400/60 text-xs mt-1">{error}</p>
                    <button 
                      onClick={() => setError(null)}
                      className="text-red-800 dark:text-red-400 text-xs font-bold mt-2"
                    >
                      ঠিক আছে
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-[2rem] p-8 text-white shadow-2xl shadow-indigo-200 overflow-hidden relative group">
                <div className="relative z-10">
                  <h2 className="text-3xl font-bold mb-3 leading-tight tracking-tight">সহজ হিসাব<br/>পদ্ধতি</h2>
                  <p className="opacity-80 mb-8 text-sm leading-relaxed max-w-[200px]">হাতে লেখা খাতার ছবি তুলুন এবং চোখের পলকে ফলাফল পান।</p>
                  <div className="flex gap-3">
                    <button 
                      onClick={startCamera}
                      className="bg-white text-indigo-600 px-7 py-3.5 rounded-2xl font-bold flex items-center gap-2 active:scale-95 transition-all shadow-xl shadow-black/5 hover:bg-slate-50"
                    >
                      <Camera size={20} /> স্ক্যান করুন
                    </button>
                    
                    <button 
                      onClick={triggerCamera}
                      className="bg-indigo-500/30 backdrop-blur-md text-white px-5 py-3.5 rounded-2xl font-bold flex items-center justify-center active:scale-95 transition-all border border-white/20 hover:bg-indigo-500/40 shadow-xl shadow-black/5"
                      title="গ্যালারি থেকে নিন"
                    >
                      <ImageIcon size={22} />
                    </button>
                  </div>
                </div>
                {/* Decorative background elements */}
                <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-white/10 rounded-full blur-3xl group-hover:scale-110 transition-transform duration-700"></div>
                <div className="absolute top-10 right-10 w-24 h-24 bg-indigo-400 rounded-full mix-blend-overlay blur-2xl opacity-30"></div>
              </div>

              {/* Camera Preview Modal/Overlay */}
              <AnimatePresence>
                {isCameraActive && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 bg-black flex flex-col"
                  >
                    <div className="relative flex-1 flex items-center justify-center overflow-hidden">
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        muted
                        className="w-full h-full object-cover"
                      />
                      
                      {/* Focus Guide Overlay */}
                      <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none">
                        <div className="w-full h-full border-2 border-dashed border-white/40 rounded-3xl relative">
                           {/* Corner accents */}
                           <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-indigo-400 rounded-tl-xl"></div>
                           <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-indigo-400 rounded-tr-xl"></div>
                           <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-indigo-400 rounded-bl-xl"></div>
                           <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-indigo-400 rounded-br-xl"></div>
                           
                           {/* Focus Text */}
                           <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                             <div className="bg-black/20 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                               <p className="text-white text-[10px] font-bold uppercase tracking-[0.2em]">খাতাটি মাঝখানে স্থাপন করুন</p>
                             </div>
                             <p className="text-white/40 text-[9px] animate-pulse">ফোকাস করতে স্ক্রিনে ট্যাপ করুন</p>
                           </div>
                        </div>
                      </div>

                      {/* Header controls */}
                      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent">
                        <button 
                          onClick={stopCamera}
                          className="text-white p-2 hover:bg-white/10 rounded-full"
                        >
                          <RotateCcw size={24} className="-rotate-90" />
                        </button>
                        <span className="text-white text-sm font-bold tracking-tight">লেন্স ফোকাস করুন</span>
                      </div>

                      {/* Bottom Controls */}
                      <div className="absolute bottom-10 left-0 right-0 px-8 flex justify-center items-center gap-10">
                        <button 
                          onClick={captureFrame}
                          className="w-20 h-20 bg-white rounded-full flex items-center justify-center border-8 border-white/20 active:scale-90 transition-all"
                        >
                          <div className="w-14 h-14 bg-indigo-600 rounded-full"></div>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 w-12 h-12 rounded-2xl flex items-center justify-center mb-4">
                    <CheckCircle2 size={24} />
                  </div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">দ্রুত ফলাফল</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">কয়েক সেকেন্ডেই সব হিসাব বের হয়ে আসবে।</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400 w-12 h-12 rounded-2xl flex items-center justify-center mb-4">
                    <ImageIcon size={24} />
                  </div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-lg">নিখুঁত কাজ</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">অস্পষ্ট লেখা শনাক্ত করতে বিশেষ সক্ষম।</p>
                </div>
              </div>
            </motion.div>
          ) : view === 'result' && result ? (
            <motion.div 
              key="result"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 overflow-hidden translate-z-0">
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-8 text-white text-center relative overflow-hidden">
                  <h2 className="text-xs font-bold uppercase tracking-[0.2em] opacity-80 mb-2">সর্বমোট পরিমাণ</h2>
                  <div className="text-5xl font-display font-bold tabular-nums tracking-tight drop-shadow-sm flex items-center justify-center gap-1">
                    <span className="text-3xl mt-2">৳</span>
                    {Number(result.total || 0).toLocaleString('bn-BD')}
                  </div>
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <CheckCircle2 size={120} />
                  </div>
                </div>

                {result.imageUrl && (
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                       <span>স্ক্যান করা ছবি (টেনে দেখুন)</span>
                       <div className="flex gap-2">
                         <button 
                           onClick={() => setZoomScale(prev => Math.min(prev + 0.5, 4))}
                           className="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700 hover:text-indigo-600 transition-colors"
                         >
                           <Plus size={14} />
                         </button>
                         <button 
                           onClick={() => setZoomScale(prev => Math.max(prev - 0.5, 1))}
                           className="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700 hover:text-indigo-600 transition-colors"
                         >
                           <RotateCcw size={14} className="rotate-180" />
                         </button>
                         <button 
                           onClick={() => setZoomScale(1)}
                           className="bg-white dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700 hover:text-indigo-600 transition-colors"
                         >
                           <RotateCcw size={14} />
                         </button>
                       </div>
                    </div>
                    <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-black flex items-center justify-center group cursor-grab active:cursor-grabbing">
                      <motion.img 
                        src={result.imageUrl} 
                        alt="Scanned Ledger" 
                        key={`image-${zoomScale}`}
                        className="w-full h-full object-contain touch-none"
                        animate={{ scale: zoomScale }}
                        drag={zoomScale > 1}
                        dragConstraints={{ left: -200 * zoomScale, right: 200 * zoomScale, top: -200 * zoomScale, bottom: 200 * zoomScale }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                      {zoomScale === 1 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <Plus className="text-white bg-indigo-600 p-2 rounded-full shadow-lg" size={40} />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {(result.numeralStyle || result.confidenceScore !== undefined) && (
                  <div className="px-8 py-4 bg-indigo-50/50 dark:bg-indigo-900/10 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    {result.numeralStyle && (
                      <div className="flex flex-col">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-widest">সংখ্যা পদ্ধতি</span>
                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                          {result.numeralStyle === 'Bengali' ? 'বাংলা সংখ্যা' : result.numeralStyle === 'Western' ? 'ইংরেজি সংখ্যা' : 'মিশ্র পদ্ধতি'}
                        </span>
                      </div>
                    )}
                    {result.confidenceScore !== undefined && (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-widest text-right">আস্থা (Confidence)</span>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${result.confidenceScore}%` }}
                              className={`h-full ${result.confidenceScore > 80 ? 'bg-emerald-500' : result.confidenceScore > 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            />
                          </div>
                          <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{result.confidenceScore}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="p-8 text-slate-900 dark:text-slate-100">
                  <h3 className="font-bold text-slate-400 dark:text-slate-500 text-[10px] uppercase tracking-[0.15em] mb-6 border-b border-slate-100 dark:border-slate-800 pb-3 flex items-center justify-between">
                    <span>হিসাবের বিবরণ</span>
                    <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px]">{result.items.length}টি এন্ট্রি</span>
                  </h3>
                  
                  <motion.div 
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    className="space-y-4"
                  >
                    {result.items.map((item, idx) => (
                      <motion.div 
                        key={idx} 
                        variants={itemVariants}
                        className="flex justify-between items-start gap-4 group p-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-2xl transition-colors"
                      >
                        <div className="flex-1 min-w-0 pt-1">
                          <input
                            type="text"
                            value={item.description || ''}
                            onChange={(e) => updateItem(idx, 'description', e.target.value)}
                            placeholder="বিবরণ"
                            className="w-full bg-transparent border-b border-transparent focus:border-indigo-300 dark:focus:border-indigo-700 outline-none text-slate-700 dark:text-slate-300 font-medium transition-colors py-1 truncate"
                          />
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0 min-w-fit">
                          <div className="flex items-center gap-1 font-display font-bold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 px-3 py-1.5 rounded-xl">
                            <span className="text-indigo-600 dark:text-indigo-400">৳</span>
                            <input
                              type="number"
                              value={item.amount === 0 ? '0' : item.amount}
                              onChange={(e) => updateItem(idx, 'amount', e.target.value)}
                              className="bg-transparent outline-none w-20 text-right py-1 text-slate-900 dark:text-slate-100 font-bold"
                            />
                          </div>
                          <div className="text-[10px] font-bold text-slate-400 tabular-nums">
                            {Number(item.amount || 0).toLocaleString('bn-BD')} টাকা
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>

                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="mt-8 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 relative"
                  >
                    <div className="absolute top-0 left-6 -translate-y-1/2 bg-white dark:bg-slate-900 px-2 text-[10px] font-bold text-indigo-500 uppercase tracking-wider">AI সারসংক্ষেপ</div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-sm italic">"{result.summary}"</p>
                  </motion.div>
                </div>
              </div>

              {/* Smart Verify Section */}
              <AnimatePresence>
                {result && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4"
                  >
                    {!verificationReport ? (
                      <button 
                        onClick={handleVerify}
                        disabled={verificationLoading}
                        className="w-full bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 border border-indigo-100 dark:border-indigo-900/30 hover:bg-white dark:hover:bg-slate-700 transition-all disabled:opacity-50"
                      >
                        {verificationLoading ? (
                          <><Loader2 className="animate-spin" size={20} /> যাচাই করা হচ্ছে...</>
                        ) : (
                          <><TrendingUp size={20} /> স্মার্ট যাচাই (স্মার্ট ভেরিফাই)</>
                        )}
                      </button>
                    ) : (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800 overflow-hidden shadow-lg shadow-indigo-100/20 dark:shadow-none"
                      >
                        <div className={`p-6 ${verificationReport.isConsistent ? 'bg-emerald-50 dark:bg-emerald-900/10' : 'bg-amber-50 dark:bg-amber-900/10'}`}>
                          <div className="flex items-center gap-3 mb-4">
                            {verificationReport.isConsistent ? (
                              <CheckCircle2 className="text-emerald-500" size={24} />
                            ) : (
                              <TrendingUp className="text-amber-500" size={24} />
                            )}
                            <div>
                              <h4 className={`font-bold ${verificationReport.isConsistent ? 'text-emerald-800 dark:text-emerald-400' : 'text-amber-800 dark:text-amber-400'}`}>
                                {verificationReport.isConsistent ? 'হিসাব সঠিক পাওয়া গেছে' : `${verificationReport.mismatchCount}টি সম্ভাব্য অমিল পাওয়া গেছে`}
                              </h4>
                              <p className="text-xs opacity-60">সেকেন্ডারি AI অডিট রিপোর্ট</p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            {verificationReport.detections.map((det, i) => (
                              <div key={i} className="bg-white/60 dark:bg-slate-800/40 p-4 rounded-xl border border-black/5">
                                <div className="flex justify-between items-center mb-2">
                                  <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">সনাক্তকরণ {i+1}</span>
                                  <span className="text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900 text-indigo-600 px-2 py-0.5 rounded-full">{det.confidence}% আস্থা</span>
                                </div>
                                <div className="flex items-center gap-4 mb-2">
                                  <div className="flex-1 line-through opacity-40 text-sm">৳{det.originalValue}</div>
                                  <RotateCcw size={14} className="opacity-20" />
                                  <div className="flex-1 font-bold text-indigo-600 dark:text-indigo-400">৳{det.suggestedValue}</div>
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{det.explanation}</p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-6 pt-4 border-t border-black/5">
                            <h5 className="text-[10px] uppercase font-bold tracking-widest opacity-40 mb-2">হাতের লেখার স্টাইল বিশ্লেষণ</h5>
                            <p className="text-xs text-slate-500 italic">{verificationReport.styleAnalysis}</p>
                          </div>

                          <button 
                            onClick={() => setVerificationReport(null)}
                            className="mt-6 w-full py-3 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            রিপোর্ট বন্ধ করুন
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-3">
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setView('home')}
                  className="flex-1 bg-slate-900 dark:bg-indigo-600 text-white py-4.5 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl shadow-slate-200 dark:shadow-none transition-shadow active:bg-slate-800 dark:active:bg-indigo-700"
                >
                   নতুন স্ক্যান
                </motion.button>
                <button 
                  onClick={handleDownload}
                  className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-600 dark:text-slate-300 shadow-sm active:scale-95 transition-all"
                  title="সেভ করুন"
                >
                  <Download size={24} />
                </button>
                <button 
                  onClick={handleShare}
                  className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-600 dark:text-slate-300 shadow-sm active:scale-95 transition-all"
                  title="শেয়ার করুন"
                >
                  <Share2 size={24} />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-6"
            >
              <div className="flex justify-between items-end mb-2">
                <div>
                  <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">ইতিহাস</h2>
                  <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">আপনার করা আগের সব হিসাব।</p>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={triggerCamera}
                    className="bg-indigo-600 text-white p-2.5 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all active:scale-95"
                    title="নতুন স্ক্যান"
                  >
                    <Plus size={20} />
                  </button>
                  {history.length > 0 && (
                    <button 
                      onClick={clearHistory} 
                      className="text-slate-400 p-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 rounded-xl transition-all"
                      title="মুছে ফেলুন"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              </div>

              {history.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm mb-2"
                >
                  <div className="flex items-center gap-2 mb-6">
                    <TrendingUp size={18} className="text-indigo-500" />
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">খরচের ট্রেন্ড (দৈনিক)</h3>
                  </div>
                  <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis 
                          dataKey="date" 
                          hide 
                        />
                        <Tooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-slate-900 dark:bg-slate-800 text-white p-3 rounded-xl shadow-xl text-[10px] font-bold border border-slate-700">
                                  <div className="opacity-60 mb-1">{payload[0].payload.date}</div>
                                  <div>৳{Number(payload[0].value || 0).toLocaleString('bn-BD')}</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                          cursor={{ fill: 'transparent' }}
                        />
                        <Bar 
                          dataKey="total" 
                          radius={[6, 6, 6, 6]}
                          barSize={30}
                        >
                          {chartData.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={index === chartData.length - 1 ? '#4f46e5' : darkMode ? '#1e293b' : '#e2e8f0'} 
                              className="transition-all duration-300"
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>
              )}

              {history.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-16 text-center text-slate-300">
                  <div className="bg-slate-50 dark:bg-slate-800/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <History size={40} className="opacity-20 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="font-medium text-slate-400 dark:text-slate-500">খালি! এখনো কোনো হিসাব পাওয়া যায়নি।</p>
                </div>
              ) : (
                <motion.div 
                  variants={containerVariants}
                  initial="hidden"
                  animate="show"
                  className="space-y-4"
                >
                  {history.map((item) => (
                    <motion.div 
                      key={item.id} 
                      variants={itemVariants}
                      className="group bg-white dark:bg-slate-900 p-6 rounded-[1.75rem] border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl dark:hover:shadow-none hover:shadow-indigo-100 hover:border-indigo-100 dark:hover:border-indigo-900 transition-all cursor-pointer active:scale-[0.99]"
                      onClick={() => {
                        setResult(item);
                        setZoomScale(1);
                        setView('result');
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1">{item.date}</div>
                          <div className="font-bold text-slate-700 dark:text-slate-200 text-base truncate pr-2">{item.summary}</div>
                        </div>
                        <div className="text-indigo-600 dark:text-indigo-400 font-display font-bold text-xl whitespace-nowrap">৳{Number(item.total || 0).toLocaleString('bn-BD')}</div>
                      </div>
                      
                      <div className="mt-4 flex items-center gap-2 text-xs font-bold text-indigo-400 group-hover:text-indigo-600 transition-colors">
                        বিস্তারিত দেখুন <Plus size={14} className="rotate-45" />
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Hidden File Input */}
      <input 
        type="file" 
        accept="image/*" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleCapture}
      />

      {/* Floating Action Button for Home */}
      {view !== 'home' && !loading && (
        <motion.button 
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          onClick={() => setView('home')}
          className="fixed bottom-8 right-8 bg-indigo-600 text-white p-4 rounded-full shadow-lg shadow-indigo-300 z-20"
        >
          <Plus size={24} />
        </motion.button>
      )}
    </div>
  );
}
