
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shuffle, Play, Pause, AlertTriangle, Music, History, Zap, RefreshCw, Timer, Volume2, Info, Key } from 'lucide-react';
import { MEME_LIST, ROULETTE_INTERVAL } from './constants';
import { Meme } from './types';
import { generateMemeSound, generateNewMemeDeck } from './services/geminiService';
import { decode, decodeAudioData } from './utils/audioUtils';

const DECK_REFRESH_INTERVAL = 180; 

const App: React.FC = () => {
  const [memes, setMemes] = useState<Meme[]>(MEME_LIST);
  const [activeMemeId, setActiveMemeId] = useState<string | null>(null);
  const [loadingMemeId, setLoadingMemeId] = useState<string | null>(null);
  const [isRefreshingDeck, setIsRefreshingDeck] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  
  const [rouletteActive, setRouletteActive] = useState(false);
  const [rouletteTimeLeft, setRouletteTimeLeft] = useState(ROULETTE_INTERVAL);
  const [deckTimeLeft, setDeckTimeLeft] = useState(DECK_REFRESH_INTERVAL);
  
  const [history, setHistory] = useState<{label: string, time: string}[]>([]);
  const [cachedIds, setCachedIds] = useState<Set<string>>(new Set());

  const audioCache = useRef<Map<string, string>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const gainNodeRef = useRef<GainNode | null>(null);

  // Check for API Key selection on mount
  useEffect(() => {
    const checkKey = async () => {
      const selected = await (window as any).aistudio.hasSelectedApiKey();
      setHasKey(selected);
    };
    checkKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    await (window as any).aistudio.openSelectKey();
    setHasKey(true); // Assume success after dialog trigger to avoid race condition
  };

  const initAudio = () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const gainNode = ctx.createGain();
      gainNode.connect(ctx.destination);
      gainNode.gain.value = volume;
      
      audioContextRef.current = ctx;
      gainNodeRef.current = gainNode;
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(volume, audioContextRef.current!.currentTime, 0.1);
    }
  }, [volume]);

  const preFetchSounds = useCallback(async (memeBatch: Meme[]) => {
    const toFetch = memeBatch.slice(0, 4);
    for (const meme of toFetch) {
      if (!audioCache.current.has(meme.id)) {
        try {
          const base64 = await generateMemeSound(meme.prompt);
          if (base64) {
            audioCache.current.set(meme.id, base64);
            setCachedIds(prev => new Set(prev).add(meme.id));
          }
        } catch (e) {
          console.warn(`Pre-fetch failed for ${meme.label}`, e);
        }
      }
    }
  }, []);

  const fetchNewDeck = useCallback(async () => {
    if (isRefreshingDeck) return;
    setIsRefreshingDeck(true);
    try {
      const newMemes = await generateNewMemeDeck();
      if (newMemes && newMemes.length > 0) {
        setMemes(newMemes);
        audioCache.current.clear();
        setCachedIds(new Set());
        preFetchSounds(newMemes);
      }
    } catch (e: any) {
      console.error("Deck refresh failed", e);
      if (e?.message?.includes("Requested entity was not found")) {
        setHasKey(false);
      }
    } finally {
      setIsRefreshingDeck(false);
      setDeckTimeLeft(DECK_REFRESH_INTERVAL);
    }
  }, [isRefreshingDeck, preFetchSounds]);

  const playSound = useCallback(async (meme: Meme) => {
    initAudio();
    const ctx = audioContextRef.current;
    if (!ctx || !gainNodeRef.current) return;

    let base64Audio = audioCache.current.get(meme.id);
    
    if (!base64Audio) {
      setLoadingMemeId(meme.id);
      try {
        base64Audio = await generateMemeSound(meme.prompt);
        if (base64Audio) {
          audioCache.current.set(meme.id, base64Audio);
          setCachedIds(prev => new Set(prev).add(meme.id));
        }
      } catch (e: any) {
        console.error("Fetch failed", e);
        if (e?.message?.includes("Requested entity was not found")) {
          setHasKey(false);
        }
      } finally {
        setLoadingMemeId(null);
      }
    }

    if (base64Audio) {
      try {
        setActiveMemeId(meme.id);
        const now = new Date();
        setHistory(prev => [{label: meme.label, time: now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}, ...prev].slice(0, 20));

        const audioData = decode(base64Audio);
        const buffer = await decodeAudioData(audioData, ctx, 24000, 1);
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNodeRef.current);
        
        activeSources.current.add(source);
        source.onended = () => {
          activeSources.current.delete(source);
          setActiveMemeId(currentId => currentId === meme.id ? null : currentId);
        };
        
        source.start();
      } catch (err) {
        console.error("Audio engine crash", err);
        setActiveMemeId(null);
      }
    }
  }, [volume]);

  const triggerRandom = useCallback(() => {
    const randomMeme = memes[Math.floor(Math.random() * memes.length)];
    playSound(randomMeme);
  }, [memes, playSound]);

  useEffect(() => {
    let rouletteInterval: number;
    if (rouletteActive) {
      rouletteInterval = window.setInterval(() => {
        setRouletteTimeLeft(prev => {
          if (prev <= 1) {
            triggerRandom();
            return ROULETTE_INTERVAL;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(rouletteInterval);
  }, [rouletteActive, triggerRandom]);

  useEffect(() => {
    const deckInterval = window.setInterval(() => {
      setDeckTimeLeft(prev => {
        if (prev <= 1) {
          fetchNewDeck();
          return DECK_REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(deckInterval);
  }, [fetchNewDeck]);

  const stopAll = () => {
    setRouletteActive(false);
    setActiveMemeId(null);
    setLoadingMemeId(null);
    activeSources.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSources.current.clear();
  };

  if (hasKey === false) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-slate-900 p-10 rounded-[3rem] border border-white/10 shadow-2xl max-w-lg">
          <Key className="w-16 h-16 text-indigo-400 mx-auto mb-6 animate-pulse" />
          <h2 className="text-3xl font-bungee text-white mb-4 tracking-wider">Project Key Required</h2>
          <p className="text-slate-400 mb-8 leading-relaxed">
            To use high-quality Gemini TTS and the Evolution engine, you must select an API key from a paid GCP project.
          </p>
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="block text-xs text-indigo-400 font-bold mb-6 hover:underline uppercase tracking-widest">
            Learn about API Billing
          </a>
          <button 
            onClick={handleOpenKeyDialog}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-bungee text-xl transition-all shadow-xl hover:-translate-y-1 active:scale-95"
          >
            Select API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-1000 p-4 md:p-8 flex flex-col items-center ${rouletteActive ? 'bg-slate-950 ring-inset ring-8 ring-pink-950/20' : 'bg-slate-950'}`}>
      
      <header className="w-full max-w-5xl flex flex-col items-center mb-8">
        <div className="flex items-center gap-4 mb-4">
          <div className={`p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 shadow-lg ${rouletteActive ? 'animate-bounce' : 'animate-float'}`}>
            <Shuffle className={`w-8 h-8 text-indigo-400 ${rouletteActive ? 'animate-spin' : ''}`} />
          </div>
          <h1 className={`text-4xl md:text-6xl font-bungee tracking-tighter text-center bg-gradient-to-br from-white via-indigo-300 to-indigo-500 bg-clip-text text-transparent drop-shadow-2xl ${rouletteActive ? 'glitch' : ''}`}>
            MEME ROULETTE
          </h1>
        </div>
        
        <div className="flex items-center gap-4 text-xs font-bold text-slate-500 tracking-[0.2em] uppercase">
          <span className="flex items-center gap-1"><Info className="w-3 h-3"/> AI-GENERATED SOUNDBOARD</span>
          <span className="text-slate-700">•</span>
          <span className="flex items-center gap-1 text-yellow-500/80"><Zap className="w-3 h-3 fill-current"/> PRE-FETCHED FOR SPEED</span>
        </div>
      </header>

      <main className="w-full max-w-5xl space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-[2rem] p-6 flex flex-col gap-4 shadow-2xl overflow-hidden relative group">
            <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity ${rouletteActive ? 'animate-spin-slow' : ''}`}>
               <Timer className="w-20 h-20" />
            </div>
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Chaos Engine</h3>
            <button
              onClick={() => { initAudio(); setRouletteActive(!rouletteActive); }}
              className={`w-full py-4 rounded-2xl font-bungee text-xl transition-all flex items-center justify-center gap-3 ${
                rouletteActive 
                  ? 'bg-pink-600 shadow-[0_0_30px_rgba(219,39,119,0.4)] text-white scale-95' 
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl hover:-translate-y-1'
              }`}
            >
              {rouletteActive ? <Pause /> : <Play />}
              {rouletteActive ? `ACTIVE: ${rouletteTimeLeft}S` : 'ROULETTE MODE'}
            </button>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-[2rem] p-6 flex flex-col justify-between gap-4 shadow-2xl">
            <div className="flex justify-between items-start">
               <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Deck Management</h3>
               <span className="text-[10px] font-mono text-slate-500">{Math.floor(deckTimeLeft/60)}:{(deckTimeLeft%60).toString().padStart(2,'0')} UNTIL EVOLUTION</span>
            </div>
            <button
              onClick={fetchNewDeck}
              disabled={isRefreshingDeck}
              className="w-full py-3 rounded-2xl font-bold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 border border-white/5"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshingDeck ? 'animate-spin' : ''}`} />
              RE-EVOLVE BOARD
            </button>
            <div className="flex items-center gap-3 px-2">
              <Volume2 className="w-4 h-4 text-slate-500" />
              <input 
                type="range" min="0" max="1" step="0.01" value={volume} 
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-full cursor-pointer"
              />
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-[2rem] p-6 flex flex-col items-center justify-center gap-2 shadow-2xl">
             <button
              onClick={stopAll}
              className="w-20 h-20 bg-red-600/10 text-red-500 rounded-full hover:bg-red-600 hover:text-white transition-all border border-red-500/30 flex items-center justify-center group shadow-inner"
              title="Emergency Stop"
            >
              <AlertTriangle className="w-8 h-8 group-active:scale-125 transition-transform" />
            </button>
            <span className="text-[10px] font-bold text-red-500/50 uppercase tracking-tighter mt-1">Panic Button</span>
          </div>
        </div>

        <div className="relative">
          {isRefreshingDeck && (
            <div className="absolute inset-0 z-50 bg-slate-950/60 backdrop-blur-md flex items-center justify-center rounded-[2.5rem] border border-white/10">
              <div className="flex flex-col items-center gap-6">
                 <div className="relative">
                   <div className="w-24 h-24 border-t-4 border-indigo-500 rounded-full animate-spin"></div>
                   <div className="absolute inset-0 flex items-center justify-center">
                      <Shuffle className="w-8 h-8 text-indigo-500 animate-pulse" />
                   </div>
                 </div>
                 <div className="text-center">
                   <p className="font-bungee text-2xl text-white tracking-widest mb-1">EVOLVING DECK</p>
                   <p className="text-indigo-400 text-xs font-bold animate-pulse uppercase tracking-[0.3em]">Querying Viral Trends...</p>
                 </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {memes.map((meme) => {
              const isCached = cachedIds.has(meme.id);
              const isActive = activeMemeId === meme.id;
              const isLoading = loadingMemeId === meme.id;

              return (
                <button
                  key={meme.id}
                  onClick={() => playSound(meme)}
                  disabled={loadingMemeId !== null && !isCached}
                  className={`group relative flex flex-col items-center justify-center p-5 min-h-[140px] rounded-3xl border transition-all duration-300 transform active:scale-90 ${
                    isActive 
                      ? `${meme.color} border-white shadow-[0_0_40px_-5px_white] z-10 -translate-y-2` 
                      : `bg-slate-900/60 border-white/5 hover:border-white/20 hover:bg-slate-800/80`
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl" />

                  {isCached && !isActive && (
                    <div className="absolute top-3 right-3 flex gap-1">
                       <Zap className="w-3 h-3 text-yellow-500 fill-yellow-500 drop-shadow-md" />
                    </div>
                  )}

                  <div className={`text-4xl mb-3 transition-all duration-500 ${isActive ? 'scale-125 rotate-[15deg]' : 'group-hover:scale-110 group-hover:-rotate-6'}`}>
                    {meme.emoji}
                  </div>
                  
                  <span className={`text-[10px] font-bungee tracking-wider uppercase text-center leading-none ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>
                    {meme.label}
                  </span>
                  
                  {isActive && (
                    <div className="mt-3 flex items-end gap-0.5 h-3">
                      {[...Array(5)].map((_, i) => (
                        <div 
                          key={i} 
                          className="w-1 bg-white rounded-full animate-bounce" 
                          style={{ animationDelay: `${i * 0.1}s`, height: `${30 + Math.random() * 70}%` }}
                        />
                      ))}
                    </div>
                  )}

                  {isLoading && (
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center rounded-3xl overflow-hidden">
                       <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                       <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500/20">
                          <div className="h-full bg-indigo-500 animate-[loading_1.5s_infinite_linear]" style={{width: '30%'}}></div>
                       </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <section className="bg-slate-900/20 backdrop-blur-md rounded-[2.5rem] border border-white/5 p-8">
           <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-slate-800 rounded-lg">
                    <History className="w-4 h-4 text-slate-400" />
                 </div>
                 <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-slate-300">Live Chaos Feed</h2>
              </div>
              <button onClick={() => setHistory([])} className="text-[10px] font-bold text-slate-600 hover:text-red-400 transition-colors uppercase">Flush History</button>
           </div>
           
           <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {history.length === 0 ? (
                <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-700 gap-2">
                   <Music className="w-8 h-8 opacity-20" />
                   <p className="text-xs font-medium uppercase tracking-widest italic">Awkward silence detected...</p>
                </div>
              ) : (
                history.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-2xl border border-white/5 animate-in slide-in-from-bottom-2 fade-in">
                     <span className="text-xs font-bold text-slate-300">{item.label}</span>
                     <span className="text-[10px] font-mono text-slate-600">{item.time}</span>
                  </div>
                ))
              )}
           </div>
        </section>
      </main>

      <footer className="mt-12 py-8 text-slate-700 text-[10px] font-bold uppercase tracking-[0.4em] flex flex-col items-center gap-4 opacity-40 hover:opacity-100 transition-opacity">
        <div className="h-px w-24 bg-slate-800" />
        <p>Gemini 2.5 Evolution Engine • Neural TTS Puck • Buffer Caching v4.0</p>
      </footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .animate-spin-slow {
          animation: spin 8s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
};

export default App;
