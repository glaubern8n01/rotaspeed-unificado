
// /// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
// /// <reference lib="deno.ns" />
/// <reference lib="dom" />
/// <reference lib="esnext" />

declare const Deno: any;

import { GoogleGenAI, GenerateContentResponse } from "https://esm.sh/@google/genai@1.1.0"; // Updated version
// Make sure to import or define these types if they are complex
// For simplicity, using 'any' for AddressInfo/UserCoordinates from frontend if not sharing types directly
// import type { AddressInfo, ParsedAddressFromAI, UserCoordinates } from './types'; // If you have a shared types file

// Define simple interfaces for expected payload types for clarity within the function
interface ParsedAddressFromAI {
  fullAddress?: string;
  street?: string;
  number?: string;
  bairro?: string;
  complemento?: string;
  cep?: string;
  city?: string;
  state?: string;
  recipientName?: string;
  telefone?: string;
}

interface AddressInfo {
  id: string;
  fullAddress: string;
  recipientName?: string;
  telefone?: string;
  // other fields from your frontend AddressInfo type
}

interface UserCoordinates {
  latitude: number;
  longitude: number;
}


const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL_TEXT = 'gemini-2.5-flash-preview-04-17';

let ai: GoogleGenAI | null = null;

if (GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
} else {
  console.error("CRITICAL: GEMINI_API_KEY environment variable is not set in Supabase Function.");
}

// Helper to parse JSON from Gemini response, handling markdown fences
const parseJsonFromGeminiResponse = <T,>(responseText: string, taskName: string): T | null => {
  let jsonStr = responseText.trim();
  const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
  const match = jsonStr.match(fenceRegex);
  if (match && match[2]) {
    jsonStr = match[2].trim();
  }
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    console.error(`Failed to parse JSON response from Gemini for task '${taskName}':`, e, "Attempted to parse (after fence removal):", jsonStr, "Original raw response was logged separately.");
     try {
        const fixedJsonStr = jsonStr
            .replace(/,\s*\]/g, ']') // trailing comma in array
            .replace(/,\s*\}/g, '}'); // trailing comma in object
        return JSON.parse(fixedJsonStr) as T;
    } catch (e2) {
        console.error(`Failed to parse JSON response for task '${taskName}' even after attempting to fix common issues:`, e2);
        return null;
    }
  }
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*', // Adjust for your frontend URL in production
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      status: 204,
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };


  if (!ai) {
    return new Response(JSON.stringify({ message: "Gemini AI service not initialized on server (API key missing)." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: "Method not allowed. Please use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let requestBody;
  try {
    requestBody = await req.json();
  } catch (error) {
    return new Response(JSON.stringify({ message: "Invalid JSON payload." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { task, payload } = requestBody;

  if (!task || !payload) {
    return new Response(JSON.stringify({ message: "Missing 'task' or 'payload' in request body." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let geminiResponse: GenerateContentResponse;
    let prompt: string; 

    switch (task) {
      case 'parseTextChunk':
        let { textChunk } = payload as { textChunk: string };
        if (!textChunk || !textChunk.trim()) { 
            console.warn("parseTextChunk task received empty or whitespace-only textChunk.");
            return new Response(JSON.stringify([]), { 
                 headers: { ...corsHeaders, "Content-Type": "application/json" },
                 status: 200, 
            });
        }
        textChunk = textChunk.replace(/\t/g, ' ');

        prompt = `
          Sua tarefa é extrair informações de endereço do texto fornecido.
          Sua saída DEVE SER EXCLUSIVAMENTE um array JSON válido de objetos.
          NÃO inclua nenhum texto explicativo, comentários, ou qualquer caractere fora do array JSON.
          NÃO use blocos de código markdown (como \`\`\`json ... \`\`\`) em sua resposta. Apenas o JSON puro.

          Cada objeto no array deve representar um endereço distinto encontrado no texto.
          Se nenhum endereço for encontrado, você DEVE retornar um array JSON vazio: [].

          Para cada endereço, inclua os seguintes campos no objeto JSON:
          - "recipientName": (string, opcional) O nome do destinatário ou cliente.
          - "street": (string, opcional) Nome da rua e tipo (ex: "Rua das Palmeiras", "Avenida Paulista").
          - "number": (string, opcional) Número do prédio ou casa. Diferencie de números de telefone.
          - "bairro": (string, opcional) Bairro.
          - "complemento": (string, opcional) Detalhes adicionais (ex: "Apto 101", "Bloco B", "Próximo ao mercado").
          - "cep": (string, opcional) Código Postal (CEP).
          - "city": (string, opcional) Nome da cidade.
          - "state": (string, opcional) Sigla do estado (ex: "SP", "RJ").
          - "fullAddress": (string) O endereço principal completo (rua, número, bairro, cidade, estado, CEP). NÃO inclua nome do destinatário, telefone ou complemento neste campo. Se algumas partes estiverem faltando, construa o endereço mais completo possível. Se nenhum endereço puder ser formado, pode ser um fallback como "Endereço incompleto".
          - "telefone": (string, opcional) Número de telefone do destinatário (ex: (XX) XXXXX-XXXX).

          Se uma informação específica não estiver presente para um endereço, omita o campo do objeto JSON ou defina seu valor como null, mas garanta que o JSON final seja válido.

          Analise o seguinte texto:
          ---
          ${textChunk}
          ---
        `;
        geminiResponse = await ai.models.generateContent({
          model: GEMINI_MODEL_TEXT,
          contents: prompt,
          config: { responseMimeType: "application/json", temperature: 0.1 }
        });
        console.log(`[gemini-proxy] Raw Gemini response for task 'parseTextChunk':\n${geminiResponse.text}`);
        const parsedTextData = parseJsonFromGeminiResponse<ParsedAddressFromAI[]>(geminiResponse.text, 'parseTextChunk');
        
        // Check if the parsed data itself indicates an error from Gemini (e.g. Gemini returned a JSON error object but with 200 OK from SDK perspective)
        // This is a defensive check, as usually the SDK would throw for API errors.
        if (parsedTextData && typeof parsedTextData === 'object' && !Array.isArray(parsedTextData) && (parsedTextData as any).error) {
            console.warn(`[gemini-proxy] Task 'parseTextChunk' received an error structure from Gemini despite a successful SDK call: ${JSON.stringify(parsedTextData)}`);
            return new Response(JSON.stringify(parsedTextData), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400, // Treat as a client error if Gemini returns an error structure
            });
        }
        
        return new Response(JSON.stringify(parsedTextData || []), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });

      case 'parseImage':
        const { base64ImageData, mimeType } = payload as { base64ImageData: string; mimeType: string };
        if (!base64ImageData || !mimeType) throw new Error("Missing base64ImageData or mimeType for parseImage task.");

        const imagePart = { inlineData: { mimeType, data: base64ImageData.split(',')[1] } };
        const imageTextPrompt = `
          Extraia todos os endereços distintos da imagem.
          Sua saída DEVE SER EXCLUSIVAMENTE um array JSON válido de objetos.
          NÃO inclua nenhum texto explicativo ou markdown. Apenas o JSON puro.
          Se nenhum endereço for encontrado, retorne um array JSON vazio: [].

          Para cada endereço, identifique:
          - "recipientName": (string, opcional) O nome do destinatário.
          - "street": (string, opcional) A rua/avenida.
          - "number": (string, opcional) O número.
          - "bairro": (string, opcional) O bairro.
          - "complemento": (string, opcional) Informações adicionais.
          - "cep": (string, opcional) O CEP.
          - "city": (string, opcional) A cidade.
          - "state": (string, opcional) O estado (sigla).
          - "fullAddress": (string) O endereço principal completo.
          - "telefone": (string, opcional) O número de telefone.
        `;
        geminiResponse = await ai.models.generateContent({
          model: GEMINI_MODEL_TEXT,
          contents: { parts: [imagePart, { text: imageTextPrompt }] },
          config: { responseMimeType: "application/json", temperature: 0.1 }
        });
        console.log(`[gemini-proxy] Raw Gemini response for task 'parseImage':\n${geminiResponse.text}`);
        const parsedImageData = parseJsonFromGeminiResponse<ParsedAddressFromAI[]>(geminiResponse.text, 'parseImage');
         if (parsedImageData && typeof parsedImageData === 'object' && !Array.isArray(parsedImageData) && (parsedImageData as any).error) {
            console.warn(`[gemini-proxy] Task 'parseImage' received an error structure from Gemini despite a successful SDK call: ${JSON.stringify(parsedImageData)}`);
            return new Response(JSON.stringify(parsedImageData), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
            });
        }
        return new Response(JSON.stringify(parsedImageData || []), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });

      case 'optimizeRoute':
        const { addresses, currentLocation, manualOriginAddress } = payload as {
          addresses: AddressInfo[];
          currentLocation: UserCoordinates | null;
          manualOriginAddress: string | null;
        };
        if (!addresses) throw new Error("Missing addresses for optimizeRoute task.");

        const addressListText = addresses.map((addr, index) =>
          `${index + 1}. ${addr.fullAddress} (ID original: ${addr.id}${addr.recipientName ? `, Dest: ${addr.recipientName}` : ''}${addr.telefone ? `, Tel: ${addr.telefone}` : ''})`
        ).join('\n');

        let startingPointInstruction = 'Não tenho um ponto de partida específico, então comece pela que fizer mais sentido para iniciar a rota.';
        if (currentLocation) {
          startingPointInstruction = `Comece a rota a partir da localização atual do entregador: Latitude ${currentLocation.latitude.toFixed(6)}, Longitude ${currentLocation.longitude.toFixed(6)}.`;
        } else if (manualOriginAddress) {
          startingPointInstruction = `Comece a rota a partir do seguinte endereço de origem fornecido pelo entregador: ${manualOriginAddress}.`;
        }

        prompt = `
          Você é um assistente de otimização de rotas para entregadores.
          A tarefa é ordenar a seguinte lista de endereços para criar uma rota de entrega eficiente, minimizando o tempo total de viagem.
          ${startingPointInstruction}
          Considere a proximidade geográfica e uma sequência lógica de paradas.
          
          Sua resposta DEVE ser EXCLUSIVAMENTE um array JSON válido de objetos.
          NÃO inclua nenhum texto explicativo ou markdown. Apenas o JSON puro.
          Cada objeto no array deve conter APENAS o "id" original do endereço (extraído da lista de entrada) e a "order" (a nova posição na rota otimizada, começando em 1).
          Se a lista de endereços estiver vazia ou não for possível otimizar, retorne um array JSON vazio: [].

          Lista de endereços para otimizar:
          ---
          ${addressListText}
          ---
        `;
        geminiResponse = await ai.models.generateContent({
          model: GEMINI_MODEL_TEXT,
          contents: prompt,
          config: { responseMimeType: "application/json", temperature: 0.3 }
        });
        console.log(`[gemini-proxy] Raw Gemini response for task 'optimizeRoute':\n${geminiResponse.text}`);
        const optimizedOrderResult = parseJsonFromGeminiResponse<{ id: string; order: number }[]>(geminiResponse.text, 'optimizeRoute');
        if (optimizedOrderResult && typeof optimizedOrderResult === 'object' && !Array.isArray(optimizedOrderResult) && (optimizedOrderResult as any).error) {
            console.warn(`[gemini-proxy] Task 'optimizeRoute' received an error structure from Gemini despite a successful SDK call: ${JSON.stringify(optimizedOrderResult)}`);
            return new Response(JSON.stringify(optimizedOrderResult), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
            });
        }
        return new Response(JSON.stringify(optimizedOrderResult || []), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });

      default:
        return new Response(JSON.stringify({ message: `Unknown task: ${task}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    // Default error details
    let errorPayload: any = { message: `An unexpected error occurred processing task '${task}'.` };
    let statusCode = 500;
    let logMessage = `[gemini-proxy] Task: ${task}. Original Error: ${error.toString()}`;

    if (error.response && typeof error.response.json === 'function') {
      // Attempt to parse error from Gemini SDK's response property
      try {
        const errData = await error.response.json();
        statusCode = error.response.status || 500;
        if (typeof errData === 'object' && errData !== null) {
          // If Gemini returns a structured error (e.g., { error: "message" } or { code: ..., message: ...}), pass it through.
          errorPayload = errData;
        } else {
          errorPayload = { message: `Gemini API Error (Task: ${task}, Status: ${statusCode}): Non-object error data received: ${JSON.stringify(errData)}` };
        }
        logMessage = `[gemini-proxy] Task: ${task}. Gemini SDK Error. Status: ${statusCode}. Payload: ${JSON.stringify(errorPayload)}. Original Error: ${error.toString()}`;
      } catch (parseError) {
        // If parsing .json() fails, try to get raw text
        const rawErrorText = error.response.text ? await error.response.text() : "Unknown error structure from Gemini response.";
        statusCode = error.response.status || 500;
        errorPayload = { message: `Gemini API Error (Task: ${task}, Status: ${statusCode}): Failed to parse error response. Raw: ${rawErrorText.substring(0, 250)}` };
        logMessage = `[gemini-proxy] Task: ${task}. Gemini SDK Error (JSON parse failed). Status: ${statusCode}. Raw Text: ${rawErrorText.substring(0,250)}. Original Error: ${error.toString()}`;
      }
    } else if (error.status && error.message) {
      // Handle errors that might have .status and .message (more generic)
      statusCode = error.status;
      errorPayload = { message: error.message }; 
      logMessage = `[gemini-proxy] Task: ${task}. Generic Error with status. Status: ${statusCode}. Message: ${error.message}. Original Error: ${error.toString()}`;
    } else if (error.message) {
      // Generic errors with just a message
      if (error.message.includes("Chave da API ou prompt ausente") || error.message.includes("API key or prompt missing")) {
        statusCode = 400; // Specific known error string
      }
      errorPayload = { message: error.message };
      logMessage = `[gemini-proxy] Task: ${task}. Generic Error. Message: ${error.message}. Original Error: ${error.toString()}`;
    }

    console.error(logMessage, error); // Log the detailed message and the original error object

    return new Response(JSON.stringify(errorPayload), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
