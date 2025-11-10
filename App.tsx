
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI, Chat, Type, Part } from '@google/genai';
import { ChatMessage } from './types';

// FIX: Define SpeechRecognition type as `any` to handle non-standard browser API
// without full type declarations, resolving the "Cannot find name 'SpeechRecognition'" error.
type SpeechRecognition = any;

// --- TYPE DEFINITIONS ---
interface ScheduledPost {
    // FIX: Changed `content` from `any` to a more specific `Record<string, string>` type.
    // This resolves downstream TypeScript errors where `ScheduledPost` objects were being
    // inferred as `unknown`, preventing access to properties like `scheduledAt`.
    content: Record<string, string>; 
    scheduledAt: Date | null;
}

interface ActivityLogItem {
    message: string;
    timestamp: Date;
    icon: React.ReactElement;
}


// --- UTILITY & HELPER FUNCTIONS ---

const fileToGenerativePart = async (file: File): Promise<Part> => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = (error) => reject(error);
    });
};


// --- REACT COMPONENT ---

const App: React.FC = () => {
  // General State
  const [mode, setMode] = useState<'chat' | 'video' | 'reporting'>('chat');
  const [ai, setAi] = useState<GoogleGenAI | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chat State
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingResponse, setStreamingResponse] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isTtsEnabled, setIsTtsEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  
  // Video State
  const [videoPrompt, setVideoPrompt] = useState('');
  const [startImage, setStartImage] = useState<File | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoLoadingMessage, setVideoLoadingMessage] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [hasSelectedApiKey, setHasSelectedApiKey] = useState(false);

  // Social Media Content State
  const [socialPosts, setSocialPosts] = useState<Record<string, ScheduledPost> | null>(null);
  const [isGeneratingPosts, setIsGeneratingPosts] = useState(false);
  const [socialPostError, setSocialPostError] = useState<string | null>(null);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [schedulingPost, setSchedulingPost] = useState<string | null>(null);

  // Reporting State
  const [activityLog, setActivityLog] = useState<ActivityLogItem[]>([]);
  const [videosGeneratedCount, setVideosGeneratedCount] = useState(0);


  const assistantAvatar = "data:image/png;base64,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";

  const getAssistantMessage = () => {
    return (
      <div key="assistant-greeting" className="flex gap-3 items-start text-sm">
        <img className="w-8 h-8 rounded-full filter drop-shadow-[0_0_3px_#14b8a6]" src={assistantAvatar} alt="Assistant Avatar" />
        <div className="flex-1 bg-gray-800 rounded-lg p-3">
          <p className="font-semibold text-teal-400">Angela Jolie</p>
          <p className="text-gray-300">Merhaba! Size nasıl yardımcı olabilirim? Video oluşturma, sosyal medya içeriği hazırlama veya raporlama konularında size destek olabilirim.</p>
        </div>
      </div>
    );
  };
  
  // --- LIFECYCLE & INITIALIZATION ---

  useEffect(() => {
    const initRecognition = () => {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        const recognitionInstance = new SpeechRecognitionAPI();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'tr-TR';
        
        recognitionInstance.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          setUserInput(finalTranscript + interimTranscript);
        };

        recognitionInstance.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsListening(false);
        };
        
        recognitionInstance.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognitionInstance;
      }
    };
    initRecognition();
    
    // Initialize GoogleGenAI
    if (process.env.API_KEY) {
        setAi(new GoogleGenAI({ apiKey: process.env.API_KEY }));
    } else {
        setError("API anahtarı bulunamadı. Lütfen ortam değişkenlerini kontrol edin.");
    }
    
    // Load TTS voices
    const loadVoices = () => {
        const synth = window.speechSynthesis;
        const availableVoices = synth.getVoices();
        setVoices(availableVoices);
        if (synth.onvoiceschanged !== undefined) {
            synth.onvoiceschanged = () => setVoices(synth.getVoices());
        }
    };
    loadVoices();

  }, []);

  useEffect(() => {
    if (ai) {
        const newChat = ai.chats.create({ 
            model: 'gemini-2.5-flash',
            config: {
                 systemInstruction: "Senin adın Angela Jolie, yardımsever ve ikna edici bir yapay zeka asistanısın. İnsanların video oluşturmasına, sosyal medya içerikleri hazırlamasına ve raporlar oluşturmasına yardımcı oluyorsun. Cevapların kısa, net ve her zaman yardımcı olmalı. Sadece Türkçe cevap ver."
            }
        });
        setChat(newChat);
    }
  }, [ai]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingResponse]);

  // --- API KEY HANDLING ---
  const checkApiKey = useCallback(async () => {
    if (window.aistudio) {
        const keySelected = await window.aistudio.hasSelectedApiKey();
        setHasSelectedApiKey(keySelected);
        return keySelected;
    }
    return false; // Fallback if aistudio is not available
  }, []);

  useEffect(() => {
      if (mode === 'video') {
        checkApiKey();
      }
  }, [mode, checkApiKey]);

  const handleSelectKey = async () => {
      if(window.aistudio) {
        await window.aistudio.openSelectKey();
        // Assume key selection is successful to avoid race conditions.
        setHasSelectedApiKey(true);
      }
  };


  // --- CORE FUNCTIONALITY HANDLERS ---
  
  const speak = (text: string) => {
      if (!isTtsEnabled || !text) return;
      
      const synth = window.speechSynthesis;
      // Stop any currently speaking utterance
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const turkishVoice = voices.find(voice => voice.lang.startsWith('tr') && voice.name.includes('Female')) || voices.find(voice => voice.lang.startsWith('tr'));

      if (turkishVoice) {
          utterance.voice = turkishVoice;
      } else {
          console.warn("Türkçe kadın sesi bulunamadı. Varsayılan ses kullanılıyor.");
      }
      
      utterance.onerror = (event) => {
          console.error("SpeechSynthesisUtterance.onerror", event);
          setError("Seslendirme sırasında bir hata oluştu.");
      };
      
      synth.speak(utterance);
  };


  const handleSendMessage = useCallback(async () => {
    if (!userInput.trim() && imageFiles.length === 0) return;
    setIsChatLoading(true);
    setError(null);

    const userMessage: ChatMessage = { role: 'user', parts: [{ text: userInput }] };
    setMessages(prev => [...prev, userMessage]);

    try {
      if (chat) {
        setStreamingResponse('');
        const parts: Part[] = [];
        if(userInput.trim()) {
            parts.push({text: userInput});
        }
        for (const file of imageFiles) {
            parts.push(await fileToGenerativePart(file));
        }

        const result = await chat.sendMessageStream({ parts });
        let accumulatedText = '';

        for await (const chunk of result) {
          const chunkText = chunk.text;
          accumulatedText += chunkText;
          setStreamingResponse(prev => prev + chunkText);
        }
        
        const modelMessage: ChatMessage = { role: 'model', parts: [{ text: accumulatedText }]};
        setMessages(prev => [...prev, modelMessage]);
        speak(accumulatedText);

      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Mesaj gönderilirken bir hata oluştu.');
    } finally {
      setUserInput('');
      setImageFiles([]);
      setIsChatLoading(false);
      setStreamingResponse('');
    }
  }, [userInput, imageFiles, chat, isTtsEnabled, voices]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };
  
    const generateSocialMediaPosts = async () => {
        if (!ai) return;
        setIsGeneratingPosts(true);
        setSocialPostError(null);
        setSocialPosts(null);
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: "Generate a week's worth of social media posts for a fictional tech company called 'Innovatech'. The posts should be for Twitter, Instagram, and LinkedIn. Provide varied content: a product announcement, a behind-the-scenes look, a tech tip, an industry news commentary, and a team spotlight. Ensure the tone is professional yet engaging.",
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            twitter: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            },
                            instagram: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            },
                            linkedin: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING }
                            }
                        }
                    }
                }
            });

            const parsedPosts = JSON.parse(response.text);
            const initialSchedule: Record<string, ScheduledPost> = {};
            Object.keys(parsedPosts).forEach(platform => {
                parsedPosts[platform].forEach((content: string, index: number) => {
                    initialSchedule[`${platform}-${index}`] = {
                        content: { platform, text: content },
                        scheduledAt: null
                    };
                });
            });
            setSocialPosts(initialSchedule);
            logActivity("Sosyal medya gönderileri oluşturuldu", <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 12.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" /></svg>);
        } catch (err) {
            console.error(err);
            setSocialPostError(err instanceof Error ? err.message : 'Gönderi oluşturulurken bir hata oluştu.');
        } finally {
            setIsGeneratingPosts(false);
        }
    };

    const handleGenerateVideo = async () => {
        if (!videoPrompt.trim()) {
            setVideoError('Lütfen bir video istemi girin.');
            return;
        }

        const keySelected = await checkApiKey();
        if (!keySelected) {
            setVideoError('Video oluşturmak için lütfen bir API anahtarı seçin.');
            return;
        }
        
        // Always create a new instance to ensure the latest key is used.
        const currentAi = new GoogleGenAI({ apiKey: process.env.API_KEY! });

        setIsVideoLoading(true);
        setVideoError(null);
        setGeneratedVideoUrl(null);
        
        const loadingMessages = [
            "Video sihirbazlarımız iş başında...",
            "Yaratıcı pikseller bir araya getiriliyor...",
            "Neredeyse bitti, son dokunuşlar yapılıyor...",
            "Harika bir şey geliyor..."
        ];
        let messageIndex = 0;
        const intervalId = setInterval(() => {
            messageIndex = (messageIndex + 1) % loadingMessages.length;
            setVideoLoadingMessage(loadingMessages[messageIndex]);
        }, 3000);
        setVideoLoadingMessage(loadingMessages[0]);

        try {
            let startImagePart: { imageBytes: string; mimeType: string } | undefined = undefined;
            if (startImage) {
                const base64Data = await fileToBase64(startImage);
                startImagePart = { imageBytes: base64Data, mimeType: startImage.type };
            }

            let operation = await currentAi.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt: videoPrompt,
                image: startImagePart,
                config: {
                    numberOfVideos: 1,
                    resolution,
                    aspectRatio,
                }
            });

            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await currentAi.operations.getVideosOperation({ operation });
            }

            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (downloadLink) {
                 const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
                 const videoBlob = await videoResponse.blob();
                 setGeneratedVideoUrl(URL.createObjectURL(videoBlob));
                 setVideosGeneratedCount(prev => prev + 1);
                 logActivity(`'${videoPrompt.substring(0, 20)}...' için video oluşturuldu`, <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8H5v-2h10v2z" clipRule="evenodd" /></svg>);
            } else {
                 throw new Error("Video URI'si oluşturulamadı.");
            }

        } catch (err: any) {
            console.error(err);
            let errorMessage = err instanceof Error ? err.message : 'Video oluşturulurken bilinmeyen bir hata oluştu.';
            if (errorMessage.includes("Requested entity was not found.")) {
                errorMessage = "API anahtarı geçersiz veya bulunamadı. Lütfen yeni bir anahtar seçin.";
                setHasSelectedApiKey(false); // Reset key state
            }
            setVideoError(errorMessage);
        } finally {
            setIsVideoLoading(false);
            clearInterval(intervalId);
            setVideoLoadingMessage('');
        }
    };


    // --- UI HELPER & EVENT HANDLERS ---
    const logActivity = (message: string, icon: React.ReactElement) => {
        setActivityLog(prev => [{ message, timestamp: new Date(), icon }, ...prev]);
    };

    const handleCopyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedStates(prev => ({...prev, [id]: true}));
        setTimeout(() => setCopiedStates(prev => ({...prev, [id]: false})), 2000);
    };

    const openScheduler = (postId: string) => {
        setSchedulingPost(postId);
        setIsSchedulerOpen(true);
    };

    const handleSchedulePost = (e: React.FormEvent) => {
        e.preventDefault();
        const target = e.target as typeof e.target & { datetime: { value: string } };
        const date = new Date(target.datetime.value);
        if (schedulingPost && socialPosts) {
            setSocialPosts(prev => ({
                ...prev!,
                [schedulingPost]: { ...prev![schedulingPost], scheduledAt: date }
            }));
            logActivity(`'${socialPosts[schedulingPost].content.platform}' için gönderi planlandı`, <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>);
        }
        setIsSchedulerOpen(false);
        setSchedulingPost(null);
    };

  // --- RENDER METHODS ---
  const renderSidebar = () => (
    <div className="w-1/4 bg-gray-900 p-6 flex flex-col justify-between border-r border-gray-700">
      <div>
        <div className="flex items-center gap-4 mb-8">
          <div className="relative">
            <img className="w-20 h-20 rounded-full object-cover filter drop-shadow-[0_0_8px_#14b8a6]" src={assistantAvatar} alt="Angela Jolie" />
            <span className="absolute bottom-1 right-1 block h-4 w-4 rounded-full bg-green-400 border-2 border-gray-900"></span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Angela Jolie</h1>
            <p className="text-sm text-gray-400">AI Asistanı</p>
          </div>
        </div>
        <nav className="flex flex-col gap-2">
          <button onClick={() => setMode('chat')} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${mode === 'chat' ? 'bg-teal-500/20 text-teal-400' : 'text-gray-400 hover:bg-gray-700/50'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            Sohbet Asistanı
          </button>
          <button onClick={() => setMode('video')} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${mode === 'video' ? 'bg-teal-500/20 text-teal-400' : 'text-gray-400 hover:bg-gray-700/50'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            Video Oluşturucu
          </button>
          <button onClick={() => setMode('reporting')} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${mode === 'reporting' ? 'bg-teal-500/20 text-teal-400' : 'text-gray-400 hover:bg-gray-700/50'}`}>
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V7a2 2 0 012-2h2l2-3h4l2 3h2a2 2 0 012 2v10a2 2 0 01-2 2z" /></svg>
            Raporlama & Otomasyon
          </button>
        </nav>
      </div>
      <div className="text-xs text-center text-gray-500">
        &copy; {new Date().getFullYear()} Gemini Gelişmiş Araç Seti
      </div>
    </div>
  );

  const renderChat = () => (
    <div className="flex-1 flex flex-col bg-gray-800">
      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {messages.length === 0 ? getAssistantMessage() : messages.map((msg, index) => (
          <div key={index} className={`flex gap-3 items-start text-sm ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'model' && <img className="w-8 h-8 rounded-full filter drop-shadow-[0_0_3px_#14b8a6]" src={assistantAvatar} alt="Assistant Avatar" />}
            <div className={`flex-1 max-w-xl rounded-lg p-3 ${msg.role === 'user' ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
              {msg.role === 'model' && <p className="font-semibold text-teal-400 mb-1">Angela Jolie</p>}
              <p className="whitespace-pre-wrap">{msg.parts.map(p => p.text).join('')}</p>
            </div>
          </div>
        ))}
        {streamingResponse && (
          <div className="flex gap-3 items-start text-sm">
            <img className="w-8 h-8 rounded-full filter drop-shadow-[0_0_3px_#14b8a6]" src={assistantAvatar} alt="Assistant Avatar" />
            <div className="flex-1 max-w-xl bg-gray-700 rounded-lg p-3">
              <p className="font-semibold text-teal-400 mb-1">Angela Jolie</p>
              <p className="whitespace-pre-wrap text-gray-300">{streamingResponse}<span className="animate-pulse">▍</span></p>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      {error && <div className="p-4 text-red-400 bg-red-900/50">{error}</div>}
      <div className="p-4 bg-gray-900 border-t border-gray-700">
        <div className="flex items-center bg-gray-700 rounded-lg p-2">
          <input
            type="text"
            className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none px-2"
            placeholder="Angela Jolie'ye bir şey sorun..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isChatLoading && handleSendMessage()}
            disabled={isChatLoading}
          />
          <button onClick={toggleListening} className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:bg-gray-600'}`} title="Sesli Giriş">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
          </button>
           <button onClick={() => setIsTtsEnabled(!isTtsEnabled)} className={`p-2 rounded-full transition-colors ${isTtsEnabled ? 'text-teal-400' : 'text-gray-500'} hover:bg-gray-600`} title="Sesli Yanıtları Aç/Kapat">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isTtsEnabled ? "M15.536 8.464a5 5 0 010 7.072M20 4a9 9 0 010 16M3 9a3 3 0 013-3h3a3 3 0 013 3v6a3 3 0 01-3 3H6a3 3 0 01-3-3V9z" : "M5.586 15.586a5 5 0 007.07-7.07l-7.07 7.07zM19 12a9 9 0 01-9 9m-4-4l12-12"} /></svg>
          </button>
          <button onClick={handleSendMessage} disabled={isChatLoading} className="p-2 bg-teal-600 text-white rounded-full hover:bg-teal-500 disabled:bg-gray-500 transition-colors ml-2">
            {isChatLoading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
          </button>
        </div>
      </div>
    </div>
  );

  const renderVideo = () => (
     <div className="flex-1 flex flex-col bg-gray-800 p-8 overflow-y-auto">
        <h2 className="text-3xl font-bold text-white mb-6">Video Oluşturucu</h2>
        {!hasSelectedApiKey ? (
            <div className="bg-gray-700 p-6 rounded-lg text-center">
                <h3 className="text-xl text-white font-semibold mb-2">Başlamadan Önce</h3>
                <p className="text-gray-300 mb-4">Video oluşturma özellikleri, Gemini API'sini kullanır ve faturalandırma gerektirebilir. Lütfen devam etmek için bir API anahtarı seçin.</p>
                <p className="text-xs text-gray-400 mb-4">Daha fazla bilgi için <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-teal-400 underline">faturalandırma belgelerine</a> göz atın.</p>
                <button onClick={handleSelectKey} className="bg-teal-600 text-white px-6 py-2 rounded-lg hover:bg-teal-500 transition-colors">API Anahtarı Seç</button>
            </div>
        ) : (
        <div className="space-y-6">
            <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Video İstemi</label>
                <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    className="w-full bg-gray-700 text-white p-3 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-none"
                    rows={3}
                    placeholder="Örn: Hızlı bir şekilde araba kullanan bir kedinin neon hologramı"
                />
            </div>
             <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Başlangıç Görüntüsü (İsteğe bağlı)</label>
                <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setStartImage(e.target.files ? e.target.files[0] : null)}
                    className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-500/20 file:text-teal-400 hover:file:bg-teal-500/30"
                />
            </div>
            <div className="grid grid-cols-2 gap-6">
                 <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">En Boy Oranı</label>
                    <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as any)} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-none">
                        <option value="16:9">16:9 (Manzara)</option>
                        <option value="9:16">9:16 (Portre)</option>
                        <option value="1:1">1:1 (Kare)</option>
                    </select>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Çözünürlük</label>
                    <select value={resolution} onChange={(e) => setResolution(e.target.value as any)} className="w-full bg-gray-700 text-white p-3 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-none">
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                    </select>
                </div>
            </div>
            <button onClick={handleGenerateVideo} disabled={isVideoLoading} className="w-full bg-teal-600 text-white p-3 rounded-lg hover:bg-teal-500 disabled:bg-gray-600 transition-colors font-semibold flex items-center justify-center gap-2">
                 {isVideoLoading && <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                {isVideoLoading ? 'Oluşturuluyor...' : 'Video Oluştur'}
            </button>
            {videoError && <p className="text-red-400 text-center">{videoError}</p>}

            {(isVideoLoading || generatedVideoUrl) && (
                <div className="mt-8">
                    {isVideoLoading ? (
                         <div className="text-center p-6 bg-gray-700/50 rounded-lg">
                            <p className="text-teal-400 animate-pulse">{videoLoadingMessage}</p>
                            <p className="text-xs text-gray-400 mt-2">Bu işlem birkaç dakika sürebilir.</p>
                         </div>
                    ) : (
                        generatedVideoUrl && (
                            <div>
                                <h3 className="text-xl font-semibold text-white mb-4">Oluşturulan Video</h3>
                                <video src={generatedVideoUrl} controls autoPlay loop className="w-full rounded-lg shadow-lg"></video>
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
        )}
    </div>
  );
  
    const renderReporting = () => (
        <div className="flex-1 flex bg-gray-800 p-8 overflow-y-auto">
            <div className="w-2/3 pr-8 border-r border-gray-700">
                <h2 className="text-3xl font-bold text-white mb-6">İçerik Otomasyonu</h2>
                <div className="bg-gray-700/50 p-6 rounded-lg">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl text-white font-semibold">Sosyal Medya Gönderileri</h3>
                        <button onClick={generateSocialMediaPosts} disabled={isGeneratingPosts} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-teal-500 disabled:bg-gray-600 flex items-center gap-2">
                           {isGeneratingPosts && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                           {isGeneratingPosts ? "Oluşturuluyor..." : "Haftalık İçerik Oluştur"}
                        </button>
                    </div>

                    {socialPostError && <p className="text-red-400 mb-4">{socialPostError}</p>}
                    
                    {isGeneratingPosts && !socialPosts && (
                        <div className="text-center py-8">
                            <p className="text-gray-300">Yaratıcı içerik motorları çalışıyor...</p>
                        </div>
                    )}

                    {socialPosts && (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                            {/* FIX: Replaced Object.entries with Object.keys to ensure correct type inference for postData, resolving multiple "property does not exist on type 'unknown'" errors. */}
                            {Object.keys(socialPosts).map(id => {
                                const postData = socialPosts[id];
                                return (
                                <div key={id} className="bg-gray-800 p-4 rounded-lg">
                                    <div className="flex justify-between items-start">
                                        <div>
                                          <p className="text-sm font-bold text-teal-400 capitalize">{postData.content.platform}</p>
                                          <p className="text-gray-300 mt-1">{postData.content.text}</p>
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                            <button onClick={() => handleCopyToClipboard(postData.content.text, id)} className="text-gray-400 hover:text-white transition-colors" title="Kopyala">
                                                {copiedStates[id] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m-6 4h.01M9 16h.01" /></svg>}
                                            </button>
                                            <button onClick={() => openScheduler(id)} className="text-gray-400 hover:text-white transition-colors" title="Planla">
                                               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                    {postData.scheduledAt && (
                                        <p className="text-xs text-teal-400 mt-2 text-right">Planlandı: {postData.scheduledAt.toLocaleString()}</p>
                                    )}
                                </div>
                            )})}
                        </div>
                    )}
                </div>
            </div>
            <div className="w-1/3 pl-8">
                <h2 className="text-3xl font-bold text-white mb-6">Genel Bakış</h2>
                <div className="bg-gray-900/50 p-4 rounded-lg mb-6">
                    <h3 className="text-lg text-white font-semibold mb-2">İstatistikler</h3>
                    <div className="flex justify-between items-center text-gray-300">
                        <p>Oluşturulan Video Sayısı:</p>
                        <p className="font-bold text-teal-400 text-2xl">{videosGeneratedCount}</p>
                    </div>
                     <div className="flex justify-between items-center text-gray-300 mt-2">
                        <p>Planlanmış Gönderiler:</p>
                        <p className="font-bold text-teal-400 text-2xl">{socialPosts ? (Object.values(socialPosts) as ScheduledPost[]).filter(p => p.scheduledAt).length : 0}</p>
                    </div>
                </div>
                 <h3 className="text-lg text-white font-semibold mb-2">Aktivite Geçmişi</h3>
                 <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-2">
                    {activityLog.length > 0 ? activityLog.map((item, index) => (
                        <div key={index} className="flex items-start gap-3 text-sm">
                            <span className="text-teal-400 mt-1">{item.icon}</span>
                            <div>
                               <p className="text-gray-300">{item.message}</p>
                               <p className="text-xs text-gray-500">{item.timestamp.toLocaleTimeString()}</p>
                            </div>
                        </div>
                    )) : <p className="text-sm text-gray-500">Henüz aktivite yok.</p>}
                 </div>
            </div>
            {isSchedulerOpen && (
                 <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm">
                       <h3 className="text-lg font-semibold text-white mb-4">Gönderiyi Planla</h3>
                       <form onSubmit={handleSchedulePost}>
                          <input type="datetime-local" name="datetime" className="w-full bg-gray-700 text-white p-2 rounded-lg mb-4" required />
                          <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => setIsSchedulerOpen(false)} className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500">İptal</button>
                            <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-500">Planla</button>
                          </div>
                       </form>
                    </div>
                 </div>
            )}
        </div>
    );
  

  return (
    <div className="h-screen w-screen flex font-sans text-white bg-gray-800">
      {renderSidebar()}
      <main className="flex-1 flex flex-col">
        {mode === 'chat' && renderChat()}
        {mode === 'video' && renderVideo()}
        {mode === 'reporting' && renderReporting()}
      </main>
    </div>
  );
};
export default App;
