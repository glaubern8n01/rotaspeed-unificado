
// Ensure UserCoordinates is imported if it's defined in types.ts, or define it locally
import type { AddressInfo, ParsedAddressFromAI, UserCoordinates } from './types';
import { supabase } from './supabaseClient'; // Import supabase client

// Use the user's provided Supabase project ID to construct the proxy URL
const SUPABASE_GEMINI_PROXY_URL = 'https://zhjzqrddmigczdfxvfhp.supabase.co/functions/v1/gemini-proxy';

const MAX_CHUNK_CHAR_LENGTH = 50000; // Max characters per chunk to send to Gemini

// Generic function to call the backend proxy
async function callProxy<T>(task: string, payload: any): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  } else {
    console.warn(`callProxy: No active session token found for task ${task}. Proceeding without Authorization header.`);
  }

  try {
    const response = await fetch(SUPABASE_GEMINI_PROXY_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ task, payload }),
    });

    if (!response.ok) {
      let errorData: any; // Use 'any' to simplify handling various error structures from proxy/Gemini
      let rawResponseText = ''; 
      try {
        rawResponseText = await response.text(); 
        errorData = JSON.parse(rawResponseText); 
      } catch (e) {
        errorData = { messageFromProxyClient: `Proxy request failed for task ${task} (status ${response.status}) and response was not valid JSON. Raw response: ${rawResponseText.substring(0, 500)}` };
      }
      console.error(`Error from proxy for task ${task}:`, response.status, JSON.stringify(errorData, null, 2));
      
      let displayErrorMessage = `Proxy request failed for task ${task} (status ${response.status}).`;

      // Check for specific API key error message as requested by user
      if (errorData && errorData.error && typeof errorData.error === 'string') {
        const geminiErrorText = errorData.error.toLowerCase();
        // User requested specific message for API key issues
        if (geminiErrorText.includes("chave da api") || geminiErrorText.includes("api key")) {
          displayErrorMessage = "Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.";
        } else if (geminiErrorText.includes("prompt ausente")) { // Keep specific handling for missing prompt if needed
           displayErrorMessage = `Gemini API Error (task: ${task}): Prompt ausente. Verifique os dados enviados.`;
        }
         else {
          displayErrorMessage = `Gemini API Error (task: ${task}): ${errorData.error}`;
        }
      } else if (errorData && errorData.message && typeof errorData.message === 'string') {
         // Fallback to other error message structures from proxy/Gemini
        const generalErrorText = errorData.message.toLowerCase();
        if (generalErrorText.includes("chave da api") || generalErrorText.includes("api key")) {
          displayErrorMessage = "Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.";
        } else {
          displayErrorMessage = `Error details (task: ${task}): ${errorData.message}`;
        }
      } else if (errorData && errorData.messageFromProxyClient) {
          displayErrorMessage = errorData.messageFromProxyClient;
      } else if (rawResponseText) {
          displayErrorMessage = `Proxy request failed for task ${task} (status ${response.status}). Details: ${rawResponseText.substring(0, 200)}`;
      }
      
      if (response.status === 401) {
          throw new Error(`Authorization error (401): ${displayErrorMessage}. Ensure you are logged in and the proxy function allows access.`);
      }
      throw new Error(displayErrorMessage);
    }
    return await response.json() as T;
  } catch (error) {
    console.error(`Network or other error calling proxy for task ${task}:`, error);
    if (error instanceof TypeError && (error.message.toLowerCase().includes('failed to construct \'url\'') || error.message.toLowerCase().includes('invalid url'))) {
        const detailedErrorMsg = `CRITICAL NETWORK ERROR: Failed to construct URL for proxy call. The configured SUPABASE_GEMINI_PROXY_URL ('${SUPABASE_GEMINI_PROXY_URL}') might be invalid. Please verify the URL.`;
        console.error(detailedErrorMsg);
        throw new Error("RotaSpeed backend AI proxy URL is invalid. Please check configuration or contact support.");
    }
    if (error instanceof Error) {
        // If the error message is already the specific one, don't re-wrap
        if (error.message === "Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.") {
            throw error;
        }
        // Check if the error message from a deeper throw already contains the specific key phrase
        if (error.message.toLowerCase().includes("chave da api") || error.message.toLowerCase().includes("api key")) {
             throw new Error("Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.");
        }
        throw error; // Re-throw other errors
    } else {
        throw new Error(String(error));
    }
  }
}


const callGeminiForTextChunk = async (textChunk: string): Promise<ParsedAddressFromAI[]> => {
  try {
    const result = await callProxy<ParsedAddressFromAI[] | { error: string }>('parseTextChunk', { textChunk });
    if (result && typeof result === 'object' && !Array.isArray(result) && (result as { error: string }).error) {
        console.error(`Error from Gemini (via proxy) for text chunk: ${(result as { error: string }).error}. Chunk: ${textChunk.substring(0,200)}...`);
        // Check if this error is the specific API key error and re-throw with the user-friendly message
        const errorText = (result as { error: string }).error.toLowerCase();
        if (errorText.includes("chave da api") || errorText.includes("api key")) {
            throw new Error("Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.");
        }
        throw new Error(`Gemini processing error: ${(result as { error: string }).error}`);
    }
    return Array.isArray(result) ? result as ParsedAddressFromAI[] : (result ? [result as unknown as ParsedAddressFromAI] : []);
  } catch (error) {
    console.error(`Error processing text chunk via proxy: ${error}. Chunk: ${textChunk.substring(0,200)}...`);
    throw error; 
  }
}


export const parseAddressFromTextWithGemini = async (text: string): Promise<ParsedAddressFromAI[]> => {
  if (!text.trim()) {
    return [];
  }

  if (text.length <= MAX_CHUNK_CHAR_LENGTH) {
    return callGeminiForTextChunk(text);
  }

  console.log(`Text length (${text.length}) exceeds max chunk length (${MAX_CHUNK_CHAR_LENGTH}). Splitting into chunks.`);
  const allParsedAddresses: ParsedAddressFromAI[] = [];
  const lines = text.split('\n');
  let currentChunk = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (currentChunk.length + line.length + 1 > MAX_CHUNK_CHAR_LENGTH && currentChunk.length > 0) {
      console.log(`Processing chunk of length ${currentChunk.length}`);
      const parsedFromChunk = await callGeminiForTextChunk(currentChunk);
      allParsedAddresses.push(...parsedFromChunk);
      currentChunk = "";
    }

    if (currentChunk.length > 0) {
      currentChunk += "\n";
    }
    currentChunk += line;

     if (line.length > MAX_CHUNK_CHAR_LENGTH) {
        console.warn(`A single line of length ${line.length} exceeds MAX_CHUNK_CHAR_LENGTH. Processing it as a separate chunk.`);
        if(currentChunk.length > line.length) { 
            const chunkBeforeLongLine = currentChunk.substring(0, currentChunk.length - line.length -1);
             if(chunkBeforeLongLine.trim().length > 0) {
                console.log(`Processing chunk before very long line, length ${chunkBeforeLongLine.length}`);
                const parsedFromChunk = await callGeminiForTextChunk(chunkBeforeLongLine);
                allParsedAddresses.push(...parsedFromChunk);
             }
        }
        console.log(`Processing very long line as a chunk, length ${line.length}`);
        const parsedFromLongLine = await callGeminiForTextChunk(line);
        allParsedAddresses.push(...parsedFromLongLine);
        currentChunk = ""; 
        continue; 
    }
  }

  if (currentChunk.length > 0) {
    console.log(`Processing final chunk of length ${currentChunk.length}`);
    const parsedFromChunk = await callGeminiForTextChunk(currentChunk);
    allParsedAddresses.push(...parsedFromChunk);
  }

  console.log(`Total parsed addresses after chunking: ${allParsedAddresses.length}`);
  return allParsedAddresses;
};


export const parseAddressFromImageWithGemini = async (base64ImageData: string, mimeType: string): Promise<ParsedAddressFromAI[]> => {
  try {
    const result = await callProxy<ParsedAddressFromAI[] | { error: string }>('parseImage', { base64ImageData, mimeType });
    if (result && typeof result === 'object' && !Array.isArray(result) && (result as { error: string }).error) {
        console.error(`Error from Gemini (via proxy) for image parsing: ${(result as { error: string }).error}.`);
        const errorText = (result as { error: string }).error.toLowerCase();
        if (errorText.includes("chave da api") || errorText.includes("api key")) {
            throw new Error("Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.");
        }
        throw new Error(`Gemini processing error: ${(result as { error: string }).error}`);
    }
    return Array.isArray(result) ? result as ParsedAddressFromAI[] : (result ? [result as unknown as ParsedAddressFromAI] : []);
  } catch (error) {
    console.error("Error calling proxy for address parsing from image:", error);
    throw error; 
  }
};

export const optimizeRouteWithGemini = async (
    addresses: AddressInfo[],
    currentLocation: UserCoordinates | null,
    manualOriginAddress: string | null
): Promise<(AddressInfo & { order: number })[]> => {
  if (addresses.length === 0) return [];
  if (addresses.length === 1) return [{ ...addresses[0], order: 1 }];

  try {
    const optimizedOrderResult = await callProxy<{ id: string; order: number }[] | { error: string }>('optimizeRoute', {
      addresses,
      currentLocation,
      manualOriginAddress,
    });

    if (optimizedOrderResult && typeof optimizedOrderResult === 'object' && !Array.isArray(optimizedOrderResult) && (optimizedOrderResult as { error: string }).error) {
        console.error(`Error from Gemini (via proxy) for route optimization: ${(optimizedOrderResult as { error: string }).error}.`);
        const errorText = (optimizedOrderResult as { error: string }).error.toLowerCase();
        if (errorText.includes("chave da api") || errorText.includes("api key")) {
            throw new Error("Erro: Chave da API do Gemini ausente ou inválida. Verifique a variável GEMINI_API_KEY no Supabase.");
        }
        throw new Error(`Gemini processing error: ${(optimizedOrderResult as { error: string }).error}`);
    }
    
    const typedOptimizedOrderResult = optimizedOrderResult as { id: string; order: number }[];

    if (!typedOptimizedOrderResult || !Array.isArray(typedOptimizedOrderResult) || typedOptimizedOrderResult.some(item => typeof item.id === 'undefined' || typeof item.order === 'undefined')) {
      console.error("Failed to parse optimized route from proxy or invalid format:", typedOptimizedOrderResult);
      // Fallback: return original order if AI response is malformed
      return addresses.map((addr, index) => ({ ...addr, order: index + 1 })); 
    }

    const addressMap = new Map(addresses.map(addr => [addr.id, addr]));
    const sortedAddresses: (AddressInfo & { order: number })[] = [];

    typedOptimizedOrderResult.sort((a, b) => a.order - b.order); // Ensure sorted by AI order

    for (const item of typedOptimizedOrderResult) {
        const originalAddress = addressMap.get(item.id);
        if (originalAddress) {
            sortedAddresses.push({ ...originalAddress, order: item.order });
        } else {
            console.warn(`Address with ID ${item.id} from proxy's optimized route not found in original list.`);
        }
    }

    // If AI returns fewer addresses than sent, append missing ones to the end (maintains original data integrity)
     if (sortedAddresses.length !== addresses.length) {
        console.warn("Mismatch in address count after optimization via proxy. Some addresses might be missing or duplicated. Appending missing ones.");
        const presentIds = new Set(sortedAddresses.map(sa => sa.id));
        let maxOrder = sortedAddresses.reduce((max, curr) => Math.max(max, curr.order || 0), 0);

        addresses.forEach(addr => {
            if (!presentIds.has(addr.id)) {
                maxOrder++; // Increment order for appended items
                sortedAddresses.push({...addr, order: maxOrder});
            }
        });
    }
    return sortedAddresses;

  } catch (error) {
    console.error("Error calling proxy for route optimization:", error);
    // If error is already the specific API key message or known proxy/auth error, re-throw it directly
    if (error instanceof Error && (error.message.includes("RotaSpeed backend AI proxy") || error.message.includes("Authorization error (401)") || error.message.startsWith("Gemini processing error:") || error.message.startsWith("Erro: Chave da API"))) {
        throw error;
    }
    // Fallback for other errors during optimization call: return original order
    return addresses.map((addr, index) => ({ ...addr, order: index + 1 }));
  }
};
