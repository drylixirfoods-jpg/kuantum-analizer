
// Fix: Import React to make JSX and React types available.
import React from 'react';
import { Chat } from '@google/genai';

export interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

// Fix: Updated `GroundingSource` to make `uri` and `title` optional to match the API response and fix type errors.
export interface GroundingSource {
  web?: {
    uri?: string;
    title?: string;
  };
}

// Extend the global Window interface for aistudio and webkitAudioContext
declare global {
  // FIX: Moved the AIStudio interface into the `declare global` block to ensure it has a
  // single, globally-scoped definition, which resolves the "Subsequent property declarations"
  // error when augmenting the global `Window` object from within a module.
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
    webkitAudioContext: typeof AudioContext;
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}
