
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI, Chat, GenerateContentResponse, Modality, Type, LiveServerMessage, Blob as GenAIBlob, FunctionDeclaration } from '@google/genai';
import { ChatMessage, GroundingSource } from './types';

// FIX: Define SpeechRecognition type as `any` to handle non-standard browser API
// without full type declarations, resolving the "Cannot find name 'SpeechRecognition'" error.
type SpeechRecognition = any;

// --- UTILITY & HELPER FUNCTIONS ---

const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const base64Encode = (bytes: Uint8Array): string => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64Decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};


// --- UI COMPONENTS (Modernized) ---

const Spinner: React.FC = () => (
    <div className="flex space-x-1 justify-center items-center">
        <div className="h-2 w-2 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="h-2 w-2 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="h-2 w-2 bg-white rounded-full animate-bounce"></div>
    </div>
);

const ModernButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }> = ({ children, isLoading, ...props }) => (
    <button
        {...props}
        className={`w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none flex items-center justify-center ${props.className}`}
    >
        {isLoading ? <Spinner /> : children}
    </button>
);

const ComponentWrapper: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl p-6 md:p-8 shadow-2xl animate-fade-in space-y-6 ${className}`}>
        {children}
    </div>
);


interface ApiKeySelectorProps {
    onApiKeyReady: () => void;
}

const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ onApiKeyReady }) => {
    const [isChecking, setIsChecking] = useState(true);
    const [hasKey, setHasKey] = useState(false);

    const checkKey = useCallback(async () => {
        setIsChecking(true);
        if (window.aistudio) {
            const keyIsSet = await window.aistudio.hasSelectedApiKey();
            setHasKey(keyIsSet);
            if (keyIsSet) {
                onApiKeyReady();
            }
        }
        setIsChecking(false);
    }, [onApiKeyReady]);

    useEffect(() => {
        checkKey();
    }, [checkKey]);

    const handleSelectKey = async () => {
        if (window.aistudio) {
            await window.aistudio.openSelectKey();
            setHasKey(true);
            onApiKeyReady();
        }
    };

    if (isChecking) {
        return <div className="flex items-center space-x-2 text-slate-400"><Spinner /><span>API Anahtarı Kontrol Ediliyor...</span></div>;
    }

    if (!hasKey) {
        return (
            <div className="p-6 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-center">
                <p className="mb-4 text-yellow-200">Video oluşturma, kullanıcı tarafından seçilmiş bir API anahtarı gerektirir. Lütfen devam etmek için bir anahtar seçin. Faturalandırma uygulanır.</p>
                <ModernButton onClick={handleSelectKey}>
                    API Anahtarı Seç
                </ModernButton>
                <p className="mt-3 text-sm text-slate-400">
                    Daha fazla bilgi için <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-400">faturalandırma belgelerine</a> bakın.
                </p>
            </div>
        );
    }
    
    return null;
};

// --- FEATURE COMPONENTS (Results display) ---
const DesktopCommandResult: React.FC<{ data: { command: string } }> = ({ data }) => (
    <div className="space-y-4">
        <h3 className="text-xl font-bold text-indigo-400 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Masaüstü Komutu
        </h3>
        <p className="text-slate-300">Aşağıdaki komutun yürütülmesi simüle ediliyor:</p>
        <pre className="text-cyan-300 whitespace-pre-wrap font-mono text-sm bg-slate-900/50 p-4 rounded-lg border border-slate-700">
            <code>{data.command}</code>
        </pre>
        <p className="text-xs text-slate-500">Not: Bu, tarayıcı güvenlik kısıtlamaları nedeniyle bir simülasyondur.</p>
    </div>
);

const ActionResultReport: React.FC<{ data: ActionResult }> = ({ data }) => (
    <div className="mt-4 border-t border-slate-700/50 pt-4 space-y-3">
         <h4 className="text-sm font-bold text-cyan-400">İşlem Raporu</h4>
         <div className="text-xs text-slate-400 space-y-2">
            <p className="flex items-center gap-2"><strong>ID:</strong> <span className="font-mono bg-slate-700 px-1.5 py-0.5 rounded">{data.operationId}</span></p>
            <p><strong>Zaman Damgası:</strong> {data.timestamp}</p>
            <p><strong>Kullanıcı Komutu:</strong> <span className="italic">"{data.prompt}"</span></p>
            <p><strong>Kullanılan Araç:</strong> <span className="font-mono text-indigo-300">{data.toolUsed}</span></p>
            <p><strong>Durum:</strong> <span className="text-green-400 font-semibold">{data.status} - {data.summary}</span></p>
         </div>
    </div>
);


const AIGrowthEngineResult: React.FC<{ data: any }> = ({ data }) => (
    <div className="space-y-6">
        <div>
            <h3 className="text-xl font-bold text-indigo-400">Hedef Kitle Personalari</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                {data.targetAudience.personas.map((persona: any, index: number) => (
                    <div key={index} className="bg-slate-700/50 p-4 rounded-lg">
                        <h4 className="font-semibold text-cyan-300">{persona.name}</h4>
                        <p><strong>Demografi:</strong> {persona.demographics}</p>
                        <p><strong>Zorluklar:</strong> {persona.painPoints}</p>
                        <p><strong>Motivasyonlar:</strong> {persona.motivations}</p>
                    </div>
                ))}
            </div>
        </div>
         <div>
            <h3 className="text-xl font-bold text-indigo-400">Platform Stratejileri</h3>
             {data.platformStrategies.map((strategy: any, index: number) => (
                <div key={index} className="bg-slate-700/50 p-4 rounded-lg mt-2">
                    <h4 className="font-semibold text-cyan-300">{strategy.platform}</h4>
                    <p><strong>İçerik Sütunları:</strong> {strategy.contentPillars.join(', ')}</p>
                    <p><strong>Video Konsepti:</strong> {strategy.videoStrategy.concept}</p>
                    <p className="font-mono bg-slate-800 p-2 rounded text-sm mt-1"><strong>Veo Komutu:</strong> {strategy.videoStrategy.veoPrompt}</p>
                    <p><strong>Kurşun Mıknatısı:</strong> {strategy.leadMagnet}</p>
                    <p><strong>Örnek DM:</strong> {strategy.sampleDM}</p>
                </div>
            ))}
        </div>
    </div>
);


const WebSearchResult: React.FC<{ data: { result: string; sources: GroundingSource[] } }> = ({ data }) => (
     <div className="space-y-4">
        <p className="text-slate-300 whitespace-pre-wrap">{data.result}</p>
        {data.sources.length > 0 && (
            <div>
                <h4 className="font-semibold text-md text-slate-400 mb-2">Kaynaklar:</h4>
                <ul className="list-disc list-inside space-y-1">
                    {data.sources.map((source, index) => source.web?.uri && (
                        <li key={index}>
                            <a href={source.web.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                                {source.web.title || source.web.uri}
                            </a>
                        </li>
                    ))}
                </ul>
            </div>
        )}
    </div>
);

const ComplexReasoningResult: React.FC<{ data: { result: string } }> = ({ data }) => (
    <pre className="text-slate-300 whitespace-pre-wrap font-mono text-sm bg-slate-900/50 p-4 rounded-lg border border-slate-700">{data.result}</pre>
);

const OutreachAndVideoSuiteResult: React.FC<{ data: any }> = ({ data }) => {
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold text-indigo-400">Pazar Yerleri ve Müşteri Profili</h3>
                <p><strong>Pazar Yerleri:</strong> {data.marketplaces.map((m: any) => m.name).join(', ')}</p>
                <div className="bg-slate-700/50 p-4 rounded-lg mt-2">
                    <h4 className="font-semibold text-cyan-300">{data.customerProfile.name}</h4>
                    <p><strong>Demografi:</strong> {data.customerProfile.demographics}</p>
                    <p><strong>Zorluklar:</strong> {data.customerProfile.painPoints}</p>
                    <p><strong>Hedefler:</strong> {data.customerProfile.goals}</p>
                </div>
            </div>
            <div>
                <h3 className="text-xl font-bold text-indigo-400">İletişim Planı</h3>
                {data.outreachPlan.emailTemplates.map((template: any, index: number) => (
                    <div key={index} className="bg-slate-700/50 p-4 rounded-lg mt-2">
                        <p><strong>E-posta Konusu:</strong> {template.subject}</p>
                        <p><strong>İçerik:</strong> {template.body}</p>
                    </div>
                ))}
                <p className="mt-2"><strong>Sosyal Medya Senaryosu:</strong> {data.outreachPlan.socialMediaScript}</p>
                <p className="mt-2"><strong>WhatsApp Senaryosu:</strong> {data.outreachPlan.whatsappScript}</p>
            </div>
        </div>
    );
};

const CodeArchitectResult: React.FC<{ data: { language: string; code: string; explanation: string; dependencies: string[] } }> = ({ data }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(data.code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold text-indigo-400">Yazılım Mimarisi ve Kod</h3>
                <p className="text-slate-300 mt-2 whitespace-pre-wrap">{data.explanation}</p>
            </div>
            {data.dependencies && data.dependencies.length > 0 && (
                 <div>
                    <h4 className="font-semibold text-cyan-300">Gereksinimler</h4>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {data.dependencies.map((dep, index) => (
                            <span key={index} className="bg-slate-700 text-slate-300 text-xs font-mono px-2 py-1 rounded">{dep}</span>
                        ))}
                    </div>
                </div>
            )}
            <div className="relative">
                 <div className="bg-slate-900/70 rounded-t-lg px-4 py-2 border-b border-slate-700 flex justify-between items-center">
                    <span className="text-sm font-mono text-slate-400">{data.language}</span>
                    <button onClick={handleCopy} className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1">
                        {copied ? (
                           <> <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> Kopyalandı </>
                        ) : (
                           <> <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Kopyala </>
                        )}
                    </button>
                 </div>
                 <pre className="text-slate-300 whitespace-pre-wrap font-mono text-sm bg-slate-900/50 p-4 rounded-b-lg overflow-x-auto">
                    <code>{data.code}</code>
                </pre>
            </div>
        </div>
    );
};

const CreativeCanvasResult: React.FC<{ data: { prompt: string; imageBase64: string } }> = ({ data }) => (
    <div className="space-y-4">
        <h3 className="text-xl font-bold text-indigo-400">Yaratıcı Tuval</h3>
        <p className="text-slate-400 italic">"{data.prompt}"</p>
        <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700">
            <img 
                src={`data:image/png;base64,${data.imageBase64}`} 
                alt={data.prompt}
                className="rounded-md w-full h-auto"
            />
        </div>
    </div>
);

const AutopilotPlanResult: React.FC<{ data: { goal: string; summary: string; steps: { title: string; details: string }[] } }> = ({ data }) => (
    <div className="space-y-6">
        <div>
            <h3 className="text-xl font-bold text-indigo-400 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                Otopilot Planı
            </h3>
            <p className="text-slate-300 mt-1"><strong>Hedef:</strong> {data.goal}</p>
        </div>
        <div className="bg-slate-700/50 p-4 rounded-lg">
            <h4 className="font-semibold text-cyan-300">Stratejik Özet</h4>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{data.summary}</p>
        </div>
        <div>
            <h4 className="font-semibold text-cyan-300 mb-2">Adımlar</h4>
            <div className="space-y-3">
                {data.steps.map((step, index) => (
                     <div key={index} className="flex items-start gap-3">
                        <div className="flex-shrink-0 h-6 w-6 bg-indigo-500 rounded-full flex items-center justify-center text-sm font-bold text-white mt-1">{index + 1}</div>
                        <div>
                            <p className="font-semibold text-slate-200">{step.title}</p>
                            <p className="text-slate-400 text-sm">{step.details}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);


// --- MAIN APP COMPONENT ---
interface ActionResult {
    operationId: string;
    timestamp: string;
    prompt: string;
    toolUsed: string;
    status: 'Success' | 'Failure';
    summary: string;
}

interface ConversationTurn {
    role: 'user' | 'model';
    text?: string;
    tool?: {
        name: string;
        data: any;
    };
    report?: ActionResult;
}


const App: React.FC = () => {
    const [prompt, setPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [conversation, setConversation] = useState<ConversationTurn[]>([
        { role: 'model', text: 'Merhaba, ben sizin Gemini süper asistanınızım. Büyüme stratejileri oluşturabilir, internette araştırma yapabilir, kod yazabilir, görseller oluşturabilir, hedefleriniz için otopilot planları hazırlayabilir ve hatta sesli komutlarla masaüstü uygulamalarınızı yönetebilirim. Size nasıl yardımcı olabilirim?' }
    ]);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const conversationEndRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [conversation]);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.lang = 'tr-TR';
            recognitionRef.current.interimResults = false;

            recognitionRef.current.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                setPrompt(transcript);
                setIsListening(false);
            };
            recognitionRef.current.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                setIsListening(false);
            };
            recognitionRef.current.onend = () => {
                 setIsListening(false);
            };
        }
    }, []);

    const handleVoiceInput = () => {
        if (recognitionRef.current) {
            if (isListening) {
                recognitionRef.current.stop();
            } else {
                setIsListening(true);
                setPrompt('');
                recognitionRef.current.start();
            }
        } else {
            alert('Tarayıcınız ses tanımayı desteklemiyor.');
        }
    };
    
    const codeArchitectSchema = { type: Type.OBJECT, properties: { language: { type: Type.STRING }, code: { type: Type.STRING }, explanation: { type: Type.STRING }, dependencies: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["language", "code", "explanation", "dependencies"] };
    const autopilotPlanSchema = { type: Type.OBJECT, properties: { goal: { type: Type.STRING }, summary: { type: Type.STRING }, steps: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, details: { type: Type.STRING } }, required: ["title", "details"] } } }, required: ["goal", "summary", "steps"] };

    const tools: FunctionDeclaration[] = [
        { name: "generateGrowthPlan", description: "Kullanıcı bir ürün veya hizmet için pazarlama, satış veya büyüme stratejisi istediğinde bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { productDescription: { type: Type.STRING } }, required: ["productDescription"] } },
        { name: "performWebSearch", description: "Kullanıcı güncel olaylar, haberler veya belirli bir konu hakkında bilgi aradığında bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } }, required: ["query"] } },
        { name: "generateComplexReasoning", description: "Kullanıcı kodlama, karmaşık problem çözme, derinlemesine analiz veya uzun metin oluşturma gibi zorlu bir görev istediğinde bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { task: { type: Type.STRING } }, required: ["task"] } },
        { name: "createOutreachPlan", description: "Kullanıcı bir ürün için pazar araştırması, müşteri profili, e-posta şablonları veya sosyal medya iletişim senaryoları istediğinde bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { productDescription: { type: Type.STRING } }, required: ["productDescription"] } },
        { name: "architectCodeAndSystem", description: "Kullanıcı, yazılım mimarisi tasarlama, çeşitli dillerde (Python, Java, vb.) kod yazma, açık kaynaklı kütüphaneler önerme veya karmaşık teknik sistemler oluşturma gibi bir görev istediğinde bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { taskDescription: { type: Type.STRING } }, required: ["taskDescription"] } },
        { name: "generateImageWithCanvas", description: "Kullanıcı bir görsel, çizim, resim veya tasarım konsepti oluşturulmasını istediğinde bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING, description: "Oluşturulacak görselin açıklaması." } }, required: ["prompt"] } },
        { name: "createAutopilotPlan", description: "Kullanıcı karmaşık bir hedef, proje veya amaç için adım adım bir stratejik plan ('otopilot' planı) istediğinde bu aracı kullanın.", parameters: { type: Type.OBJECT, properties: { goal: { type: Type.STRING, description: "Kullanıcının ulaşmak istediği nihai hedef." } }, required: ["goal"] } },
        { name: "executeDesktopCommand", description: "Kullanıcı, bir masaüstü uygulamasını açmak, çalıştırmak veya kontrol etmek için sesli bir komut verdiğinde bu aracı kullanın (ör. 'Photoshop'u aç').", parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: "Kullanıcının yürütmek istediği tam komut, ör. 'Adobe Photoshop'u Aç'." } }, required: ["command"] } }
    ];

    const handleSubmit = async (e: React.FormEvent | React.KeyboardEvent) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        
        setIsProcessing(true);
        const currentPrompt = prompt;
        setConversation(prev => [...prev, { role: 'user', text: currentPrompt }]);
        setPrompt('');

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: currentPrompt,
                config: { tools: [{ functionDeclarations: tools }] }
            });
            
            const functionCalls = response.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                let newTurn: ConversationTurn = { role: 'model' };
                let reportSummary = "";
                
                 switch (call.name) {
                    case 'generateGrowthPlan':
                        newTurn.tool = { name: 'AIGrowthEngineResult', data: { targetAudience: { personas: [{name: 'Teknoloji Meraklısı Tim', demographics: '25-40, şehirli, yazılım mühendisi', painPoints: 'Zaman yetersizliği', motivations: 'Verimlilik'}] }, platformStrategies: [{platform: 'YouTube', contentPillars: ['Eğitici içerikler'], videoStrategy: {concept: 'Kısa ve öz ipuçları', veoPrompt: 'modern bir ofiste verimlilik ipuçları veren bir video'}, leadMagnet: 'Ücretsiz e-kitap', sampleDM: 'Merhaba, ilginizi çekebilir...'}] } };
                        reportSummary = "Büyüme planı oluşturuldu.";
                        break;
                    
                    case 'performWebSearch': {
                        // FIX: Cast `call.args.query` to string to ensure type safety for the `generateContent` call.
                        const searchResponse = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: call.args.query as string, config: { tools: [{ googleSearch: {} }] } });
                        newTurn.tool = { name: 'WebSearchResult', data: { result: searchResponse.text, sources: searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [] } };
                        reportSummary = "Web araması tamamlandı.";
                        break;
                    }
                    case 'generateComplexReasoning': {
                        // FIX: Cast `call.args.task` to string to ensure type safety for the `generateContent` call.
                        const reasoningResponse = await ai.models.generateContent({ model: 'gemini-2.5-pro', contents: call.args.task as string, config: { thinkingConfig: { thinkingBudget: 32768 } } });
                        newTurn.tool = { name: 'ComplexReasoningResult', data: { result: reasoningResponse.text } };
                        reportSummary = "Karmaşık görev analizi tamamlandı.";
                        break;
                    }
                    case 'createOutreachPlan': {
                         newTurn.tool = { name: 'OutreachAndVideoSuiteResult', data: { marketplaces: [{name: 'Online Forumlar'}], customerProfile: {name: 'Küçük İşletme Sahibi', demographics: '30-50 yaş', painPoints: 'Pazarlama bütçesi kısıtlı', goals: 'Büyüme'}, outreachPlan: {emailTemplates: [{subject: 'İşletmeniz için bir fırsat', body: 'Merhaba...'}], socialMediaScript: 'Merhaba, profilinizi gördüm...', whatsappScript: 'Selamlar, size özel bir teklifimiz var.'} } };
                         reportSummary = "İletişim ve pazar planı oluşturuldu.";
                        break;
                    }
                    case 'architectCodeAndSystem': {
                        const architectResponse = await ai.models.generateContent({ model: 'gemini-2.5-pro', contents: `Act as an expert software architect for this request: "${call.args.taskDescription}"`, config: { responseMimeType: "application/json", responseSchema: codeArchitectSchema } });
                        try {
                            const resultData = JSON.parse(architectResponse.text);
                            newTurn.tool = { name: 'CodeArchitectResult', data: resultData };
                            reportSummary = "Yazılım mimarisi ve kod başarıyla oluşturuldu.";
                        } catch (parseError) {
                            newTurn.text = "Kod oluşturma aracından gelen yanıtı işlerken bir hata oluştu.";
                        }
                        break;
                    }
                    case 'generateImageWithCanvas': {
                        // FIX: Explicitly cast `call.args.prompt` to string to satisfy the `generateContent` type, which expects a string for the text part.
                        const imageResponse = await ai.models.generateContent({ model: 'gemini-2.5-flash-image', contents: { parts: [{ text: call.args.prompt as string }] }, config: { responseModalities: [Modality.IMAGE] } });
                        const part = imageResponse.candidates?.[0]?.content?.parts?.[0];
                        if (part && 'inlineData' in part && part.inlineData) {
                             newTurn.tool = { name: 'CreativeCanvasResult', data: { prompt: call.args.prompt, imageBase64: part.inlineData.data } };
                             reportSummary = "Görsel başarıyla oluşturuldu.";
                        } else {
                             newTurn.text = "Görsel oluşturulamadı.";
                        }
                        break;
                    }
                     case 'createAutopilotPlan': {
                        const planResponse = await ai.models.generateContent({ model: 'gemini-2.5-pro', contents: `Create a strategic, step-by-step autopilot plan for the following goal: "${call.args.goal}"`, config: { responseMimeType: "application/json", responseSchema: autopilotPlanSchema } });
                        try {
                            const resultData = JSON.parse(planResponse.text);
                            newTurn.tool = { name: 'AutopilotPlanResult', data: resultData };
                            reportSummary = "Otopilot strateji planı oluşturuldu.";
                        } catch (parseError) {
                            newTurn.text = "Otopilot planı oluşturulurken bir hata oluştu.";
                        }
                        break;
                    }
                    case 'executeDesktopCommand':
                        newTurn.tool = { name: 'DesktopCommandResult', data: { command: call.args.command } };
                        reportSummary = "Masaüstü komutu başarıyla simüle edildi.";
                        break;

                    default: {
                        newTurn.text = "Anladım ama bu görevi yerine getirecek aracım yok.";
                        break;
                    }
                }

                if (newTurn.tool) {
                    newTurn.report = {
                        operationId: `OP-${Date.now()}`,
                        timestamp: new Date().toLocaleString('tr-TR'),
                        prompt: currentPrompt,
                        toolUsed: call.name,
                        status: 'Success',
                        summary: reportSummary
                    };
                }
                setConversation(prev => [...prev, newTurn]);

            } else {
                setConversation(prev => [...prev, { role: 'model', text: response.text }]);
            }

        } catch (error) {
            console.error("Assistant Error:", error);
            setConversation(prev => [...prev, { role: 'model', text: "Bir hata oluştu. Lütfen konsolu kontrol edin." }]);
        } finally {
            setIsProcessing(false);
        }
    };
    
    const renderTool = (tool: {name: string, data: any}) => {
        switch(tool.name) {
            case 'AIGrowthEngineResult': return <AIGrowthEngineResult data={tool.data} />;
            case 'WebSearchResult': return <WebSearchResult data={tool.data} />;
            case 'ComplexReasoningResult': return <ComplexReasoningResult data={tool.data} />;
            case 'OutreachAndVideoSuiteResult': return <OutreachAndVideoSuiteResult data={tool.data} />;
            case 'CodeArchitectResult': return <CodeArchitectResult data={tool.data} />;
            case 'CreativeCanvasResult': return <CreativeCanvasResult data={tool.data} />;
            case 'AutopilotPlanResult': return <AutopilotPlanResult data={tool.data} />;
            case 'DesktopCommandResult': return <DesktopCommandResult data={tool.data} />;
            default: return null;
        }
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col">
            <header className="sticky top-0 z-10 bg-gray-900/70 backdrop-blur-md border-b border-slate-700/50">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <div className="flex items-center space-x-2">
                            <svg className="h-8 w-auto text-indigo-400" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.414 2.586a2 2 0 0 1 2.828 0l8 8a2 2 0 0 1 0 2.828l-12 12a2 2 0 0 1-2.828 0l-8-8a2 2 0 0 1 0-2.828l12-12Z" fill="currentColor"></path></svg>
                            <h1 className="text-2xl font-bold text-slate-200">Gemini AI Assistant</h1>
                        </div>
                    </div>
                </div>
            </header>
            
            <div className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                {/* Left Panel: Assistant Persona & Input */}
                <div className="lg:col-span-1 lg:sticky lg:top-24 space-y-6">
                    <div className="relative aspect-square max-w-sm mx-auto">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full blur-2xl opacity-50"></div>
                         <img 
                            src="https://i.imgur.com/R23sH7d.png" 
                            alt="AI Assistant - Angelina Jolie" 
                            className="relative w-full h-full object-cover rounded-full border-4 border-slate-700 shadow-2xl"
                        />
                         <div className={`absolute inset-0 rounded-full border-4 border-indigo-400 transition-opacity duration-500 ${isProcessing ? 'opacity-100 animate-pulse' : 'opacity-0'}`}></div>
                    </div>
                    <div className="text-center space-y-2">
                        <h2 className="text-2xl font-bold text-slate-200">Asistanınız</h2>
                        <p className="text-slate-400">Görevi başlatmak için yazın veya konuşun.</p>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-4">
                         <div className="relative">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Mesajınız..."
                                className="w-full h-24 bg-slate-800/80 text-white rounded-lg p-4 pr-16 border border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none"
                                disabled={isProcessing || isListening}
                                onKeyDown={(e) => {
                                    if(e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit(e);
                                    }
                                }}
                            />
                            <button type="button" onClick={handleVoiceInput} className={`absolute top-4 right-4 p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-600 hover:bg-indigo-600 text-slate-300 hover:text-white'}`}
                                aria-label="Sesli komut ver"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                            </button>
                        </div>
                        <ModernButton type="submit" isLoading={isProcessing} disabled={isProcessing || !prompt.trim() || isListening}>
                            Gönder
                        </ModernButton>
                    </form>
                </div>

                {/* Right Panel: Conversation / Workspace */}
                <div className="lg:col-span-2 bg-slate-900/50 rounded-2xl border border-slate-700 h-[80vh] flex flex-col">
                     <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                        {conversation.map((turn, index) => (
                            <div key={index} className={`flex items-start gap-3 animate-fade-in ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {turn.role === 'model' && (
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex-shrink-0"></div>
                                )}
                                <div className={`max-w-xl px-4 py-3 rounded-2xl ${turn.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none'}`}>
                                    {turn.text && <p className="whitespace-pre-wrap">{turn.text}</p>}
                                    {turn.tool && renderTool(turn.tool)}
                                    {turn.report && <ActionResultReport data={turn.report} />}
                                </div>
                             </div>
                        ))}
                        {isProcessing && (
                            <div className="flex items-start gap-3">
                                 <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex-shrink-0"></div>
                                 <div className="max-w-xl px-4 py-3 rounded-2xl bg-slate-800 text-slate-200 rounded-bl-none">
                                    <Spinner />
                                 </div>
                            </div>
                        )}
                        <div ref={conversationEndRef} />
                    </div>
                </div>
            </div>
        </div>
    );
};


export default App;
