
// Placeholder for pdfjs-dist and xlsx types if not globally available
// You might need to install these types: @types/pdfjs-dist, @types/xlsx
// For now, using 'any' to avoid compilation issues if types are not present.
// import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'; (Example)

declare global {
  interface Window {
    pdfjsLib: any; 
    XLSX: any;
  }
}


export const loadPdfJs = async (): Promise<boolean> => {
  if (window.pdfjsLib) return true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js'; // Use a stable version
    script.onload = () => {
      // The workerSrc path is crucial for pdf.js to work correctly.
      // It usually points to pdf.worker.min.js from the same CDN/version.
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export const loadXlsx = async (): Promise<boolean> => {
  if (window.XLSX) return true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};


export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as base64 string.'));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

export const extractTextFromPdf = async (file: File): Promise<string> => {
  const pdfJsLoaded = await loadPdfJs();
  if (!pdfJsLoaded || !window.pdfjsLib) {
    throw new Error('PDF.js library could not be loaded.');
  }

  const arrayBuffer = await file.arrayBuffer();
  // pdfjs-dist type for PDFDocumentProxy
  const pdf: any = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    // pdfjs-dist type for PDFPageProxy
    const page: any = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return fullText;
};


export const extractTextFromSheet = async (file: File): Promise<string> => {
  const xlsxLoaded = await loadXlsx();
  if (!xlsxLoaded || !window.XLSX) {
    throw new Error('XLSX library (SheetJS) could not be loaded.');
  }
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) {
          reject(new Error("No data read from file."));
          return;
        }
        const workbook = window.XLSX.read(data, { type: 'binary' });
        let fullText = '';
        workbook.SheetNames.forEach(sheetName => {
          const worksheet = workbook.Sheets[sheetName];
          // Convert sheet to CSV, then join lines. A more robust approach might parse specific columns.
          const csvData: string = window.XLSX.utils.sheet_to_csv(worksheet);
          fullText += csvData + '\n\n'; 
        });
        resolve(fullText.trim());
      } catch (e) {
        console.error("Error processing XLSX file:", e);
        reject(new Error("Failed to parse spreadsheet file."));
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsBinaryString(file); // sheet_to_csv works well with binary strings
  });
};
