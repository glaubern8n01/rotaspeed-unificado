
import { useState, useEffect, useCallback } from 'react';

// FIX: Add type definitions for Web Speech API to resolve errors like "Cannot find name 'SpeechRecognition'"
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [Symbol.iterator](): IterableIterator<SpeechRecognitionAlternative>;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [Symbol.iterator](): IterableIterator<SpeechRecognitionResult>;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
  readonly interpretation?: any; 
  readonly emma?: Document; 
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string; 
  readonly message: string; 
}

interface SpeechRecognitionStatic {
  new(): SpeechRecognition;
  prototype: SpeechRecognition;
}

interface SpeechRecognition extends EventTarget {
  grammars: any; 
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  serviceURI?: string; 

  start(): void;
  stop(): void;
  abort(): void;

  onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onsoundstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onsoundend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
}
// End of added type definitions

interface SpeechRecognitionHook {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  error: string | null;
  isSupported: boolean;
  isMicrophoneAvailable: boolean;
  resetTranscript: () => void;
}

const useSpeechRecognition = (): SpeechRecognitionHook => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  // FIX: Use the defined SpeechRecognition interface for the state type
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isMicrophoneAvailable, setIsMicrophoneAvailable] = useState(false);

  useEffect(() => {
    // FIX: Cast to SpeechRecognitionStatic to use 'new'
    const SpeechRecognitionAPI = ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as SpeechRecognitionStatic | undefined;

    if (SpeechRecognitionAPI) {
      setIsSupported(true);
      const recogInstance = new SpeechRecognitionAPI();
      recogInstance.continuous = false; // Process single utterances
      recogInstance.interimResults = false; // Only final results
      recogInstance.lang = 'pt-BR'; // Set to Brazilian Portuguese

      // FIX: Ensure event types match defined interfaces
      recogInstance.onresult = (event: SpeechRecognitionEvent) => {
        const currentTranscript = Array.from(event.results)
          .map(result => result.item(0)) // Access the first alternative
          .map(result => result.transcript)
          .join('');
        setTranscript(currentTranscript);
        setError(null);
      };

      // FIX: Ensure event types match defined interfaces
      recogInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'no-speech') {
          setError('Nenhuma fala detectada. Tente novamente.');
        } else if (event.error === 'audio-capture') {
          setError('Falha na captura de áudio. Verifique seu microfone.');
          setIsMicrophoneAvailable(false);
        } else if (event.error === 'not-allowed') {
          setError('Permissão para microfone negada.');
          setIsMicrophoneAvailable(false);
        } else {
          setError(`Erro no reconhecimento de voz: ${event.error}`);
        }
        setIsListening(false);
      };
      
      recogInstance.onend = () => {
        setIsListening(false);
      };

      setRecognition(recogInstance);
    } else {
      setIsSupported(false);
      setError("Reconhecimento de voz não é suportado neste navegador.");
    }

    // Check microphone permission status
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' as PermissionName }).then((permissionStatus) => {
            setIsMicrophoneAvailable(permissionStatus.state === 'granted');
            permissionStatus.onchange = () => {
                setIsMicrophoneAvailable(permissionStatus.state === 'granted');
            };
        }).catch(() => {
            // If query fails, assume not available or restricted.
            // Actual permission request will happen when startListening is called.
            setIsMicrophoneAvailable(false); 
        });
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // Fallback for browsers not supporting navigator.permissions.query
        // This doesn't tell us current status without prompting, so we'll handle on start.
    }


    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  const startListening = useCallback(async () => {
    if (!recognition) {
      setError("Reconhecimento de voz não inicializado.");
      return;
    }
    if (isListening) return;

    try {
        // Attempt to access microphone to ensure permission is granted or prompt user
        await navigator.mediaDevices.getUserMedia({ audio: true });
        setIsMicrophoneAvailable(true); // If this doesn't throw, permission is granted
        setTranscript('');
        setError(null);
        recognition.start();
        setIsListening(true);
    } catch (err) {
        console.error("Error accessing microphone:", err);
        setError("Acesso ao microfone negado ou não disponível. Por favor, habilite o microfone nas configurações do navegador.");
        setIsMicrophoneAvailable(false);
        setIsListening(false);
    }
  }, [recognition, isListening]);

  const stopListening = useCallback(() => {
    if (recognition && isListening) {
      recognition.stop();
      setIsListening(false);
    }
  }, [recognition, isListening]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  return { isListening, transcript, startListening, stopListening, error, isSupported, isMicrophoneAvailable, resetTranscript };
};

export default useSpeechRecognition;