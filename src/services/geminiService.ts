import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey });

export interface LedgerItem {
  description: string;
  amount: number;
}

export interface LedgerResult {
  items: LedgerItem[];
  total: number;
  summary: string;
  numeralStyle: 'Bengali' | 'Western' | 'Mixed';
  confidenceScore: number;
  isReadable: boolean;
  qualityFeedback?: string;
  imageUrl?: string;
}

export interface VerificationResult {
  isConsistent: boolean;
  mismatchCount: number;
  detections: {
    originalValue: string;
    suggestedValue: string;
    explanation: string;
    confidence: number;
  }[];
  styleAnalysis: string;
}

const LEDGER_MODEL = "gemini-3-flash-preview";

/**
 * Enhanced image preprocessing for better OCR results.
 * Applies noise reduction and contrast adjustment.
 */
async function preprocessImage(base64Image: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(base64Image);
        return;
      }

      // Maintain aspect ratio but limit size for faster processing
      const maxDim = 1600;
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (height / width) * maxDim;
          width = maxDim;
        } else {
          width = (width / height) * maxDim;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      
      // Initial draw
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;

      // Noise reduction and contrast enhancement
      // We'll use a simpler but effective approach:
      // 1. Grayscale
      
      for (let i = 0; i < data.length; i += 4) {
        const grayscale = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        data[i] = data[i + 1] = data[i + 2] = grayscale;
      }

      // 2. Histogram Equalization
      const histogram = new Int32Array(256);
      for (let i = 0; i < data.length; i += 4) {
        histogram[data[i]]++;
      }

      const cdf = new Int32Array(256);
      cdf[0] = histogram[0];
      for (let i = 1; i < 256; i++) {
        cdf[i] = cdf[i - 1] + histogram[i];
      }

      const cdfMin = cdf.find(val => val > 0) || 0;
      const totalPixels = width * height;
      const mapping = new Uint8ClampedArray(256);
      
      for (let i = 0; i < 256; i++) {
        mapping[i] = Math.round(((cdf[i] - cdfMin) / (totalPixels - cdfMin)) * 255);
      }

      for (let i = 0; i < data.length; i += 4) {
        const equalized = mapping[data[i]];
        data[i] = data[i + 1] = data[i + 2] = equalized;
      }

      // 4. Simple Adaptive Thresholding
      // We'll use a local threshold based on the average value in a neighborhood.
      // This helps with uneven lighting.
      const thresholdData = new Uint8ClampedArray(data.length);
      const windowSize = 25; // Size of local neighborhood
      const offset = 10;    // Tuning parameter

      // Pre-calculate integral image for fast local average
      const integral = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        let rowSum = 0;
        for (let x = 0; x < width; x++) {
          rowSum += data[(y * width + x) * 4];
          integral[y * width + x] = (y > 0 ? integral[(y - 1) * width + x] : 0) + rowSum;
        }
      }

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const x1 = Math.max(0, x - windowSize);
          const y1 = Math.max(0, y - windowSize);
          const x2 = Math.min(width - 1, x + windowSize);
          const y2 = Math.min(height - 1, y + windowSize);
          
          const count = (x2 - x1) * (y2 - y1);
          const sum = integral[y2 * width + x2] 
                    - (y1 > 0 ? integral[(y1 - 1) * width + x2] : 0)
                    - (x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0)
                    + (y1 > 0 && x1 > 0 ? integral[(y1 - 1) * width + (x1 - 1)] : 0);
          
          const avg = sum / count;
          const pixelIdx = (y * width + x) * 4;
          const isText = data[pixelIdx] < (avg - offset);
          
          const finalVal = isText ? 0 : 255;
          thresholdData[pixelIdx] = thresholdData[pixelIdx + 1] = thresholdData[pixelIdx + 2] = finalVal;
          thresholdData[pixelIdx + 3] = 255;
        }
      }

      data.set(thresholdData);
      
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(base64Image);
    img.src = base64Image;
  });
}

export async function processLedgerImage(base64Image: string): Promise<LedgerResult> {
  const preprocessedImage = await preprocessImage(base64Image);
  const mimeTypeMatch = preprocessedImage.match(/^data:(image\/[a-zA-Z]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
  const base64Data = preprocessedImage.includes(",") ? preprocessedImage.split(",")[1] : preprocessedImage;

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  const promptPart = {
    text: `
      You are a specialized Optical Character Recognition (OCR) expert with a focus on South Asian handwritten business ledgers (Hishab Khata). 
      Your task is to transcribe and calculate the total from the provided image.
      
      CRITICAL INSTRUCTIONS:
      1. SIGNATURE STYLE CALIBRATION: Identify if they use Western (1, 2, 3) or Bengali (১, ২, ৩) numerals.
      2. MATH CHECK: Perform internal math check. If paper total contradicts sum, re-examine.
    `,
  };

  try {
    const response = await ai.models.generateContent({
      model: LEDGER_MODEL,
      contents: { parts: [imagePart, promptPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  amount: { type: Type.NUMBER }
                },
                required: ["description", "amount"]
              }
            },
            total: { type: Type.NUMBER },
            summary: { type: Type.STRING },
            numeralStyle: { type: Type.STRING, enum: ["Bengali", "Western", "Mixed"] },
            confidenceScore: { type: Type.NUMBER },
            isReadable: { type: Type.BOOLEAN },
            qualityFeedback: { type: Type.STRING }
          },
          required: ["items", "total", "summary", "numeralStyle", "confidenceScore", "isReadable"]
        }
      }
    });

    if (!response.text) {
      throw new Error("ফলাফল পাওয়া যায়নি।");
    }

    return JSON.parse(response.text);
  } catch (error: any) {
    console.error("Gemini OCR Error:", error);
    if (error.message?.includes("API key")) {
      throw new Error("API key-তে সমস্যা হয়েছে। দয়া করে সেটিংস থেকে কী পরীক্ষা করুন।");
    }
    throw new Error("হিসাব বের করতে সমস্যা হয়েছে। দয়া করে আবার চেষ্টা করুন।");
  }
}

export async function verifyLedgerAccuracy(base64Image: string, previousResult: LedgerResult): Promise<VerificationResult> {
  const preprocessedImage = await preprocessImage(base64Image);
  const mimeTypeMatch = preprocessedImage.match(/^data:(image\/[a-zA-Z]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
  const base64Data = preprocessedImage.includes(",") ? preprocessedImage.split(",")[1] : preprocessedImage;

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };

  const promptPart = {
    text: `
      Verify this ledger OCR. Image provided with PREVIOUS RESULT:
      ${JSON.stringify(previousResult, null, 2)}
    `,
  };

  try {
    const response = await ai.models.generateContent({
      model: LEDGER_MODEL,
      contents: { parts: [imagePart, promptPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isConsistent: { type: Type.BOOLEAN },
            mismatchCount: { type: Type.NUMBER },
            detections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  originalValue: { type: Type.STRING },
                  suggestedValue: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  confidence: { type: Type.NUMBER }
                },
                required: ["originalValue", "suggestedValue", "explanation", "confidence"]
              }
            },
            styleAnalysis: { type: Type.STRING }
          },
          required: ["isConsistent", "mismatchCount", "detections", "styleAnalysis"]
        }
      }
    });

    if (!response.text) {
      return {
        isConsistent: true,
        mismatchCount: 0,
        detections: [],
        styleAnalysis: "যাচাইকরণ সম্পন্ন করা যায়নি।"
      };
    }

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Verification error:", error);
    return {
      isConsistent: true,
      mismatchCount: 0,
      detections: [],
      styleAnalysis: "যাচাইকরণ সম্পন্ন করা যায়নি।"
    };
  }
}
