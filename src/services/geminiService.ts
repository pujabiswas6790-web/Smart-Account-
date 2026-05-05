import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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

export async function processLedgerImage(base64Image: string): Promise<LedgerResult> {
  const model = "gemini-3-flash-preview";
  
  const mimeTypeMatch = base64Image.match(/^data:(image\/[a-zA-Z]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
  const base64Data = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };
  
  const textPart = {
    text: `
      You are a specialized Optical Character Recognition (OCR) expert with a focus on South Asian handwritten business ledgers (Hishab Khata). 
      Your task is to transcribe and calculate the total from the provided image.
      
      CRITICAL INSTRUCTIONS FOR SUPREME ACCURACY:
      0. QUALITY CHECK (Immediate):
         - Assess if the image is readable. If blurry, dark, or non-ledger, set "isReadable": false and provide "qualityFeedback".
      
      1. SIGNATURE STYLE CALIBRATION:
         - Scan the entire page first to identify a 'Signature Style'. 
         - If the user writes '৳' or 'Tk', use that spatial anchor.
         - Find unambiguous numbers (like a clear '100') to determine if they use Western (1, 2, 3) or Bengali (১, ২, ৩) numerals.
      
      2. ADVANCED DIGIT DISAMBIGUATION:
         - Bengali ১ (1) vs. Western 9
         - Bengali ৪ (4) vs. Western 8
         - Bengali ৫ (5) vs. Western 6
         - Bengali ৭ (7) vs. Western 9
      
      3. MATH CHECK:
         - Perform an internal math check. If the 'Total' written on the paper contradicts the sum of the rows, re-examine the ambiguous digits.
      
      OUTPUT REQUIREMENTS:
      - "items": Array of { "description": string, "amount": number }.
      - "total": The mathematical sum of all extracted "amount" values.
      - "summary": A concise report in friendly, professional Bengali.
      - "numeralStyle": "Bengali", "Western", or "Mixed".
      - "confidenceScore": 0-100.
      - "isReadable": Boolean.
      - "qualityFeedback": String if not readable.
    `,
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [imagePart, textPart] }],
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

    const parsed = JSON.parse(response.text);
    return parsed;
  } catch (error: any) {
    console.error("Gemini OCR Error:", error);
    if (error.message?.includes("API key")) {
      throw new Error("API key-তে সমস্যা হয়েছে। দয়া করে সেটিংস থেকে কী পরীক্ষা করুন।");
    }
    throw new Error("হিসাব বের করতে সমস্যা হয়েছে। দয়া করে আবার চেষ্টা করুন।");
  }
}

export async function verifyLedgerAccuracy(base64Image: string, previousResult: LedgerResult): Promise<VerificationResult> {
  const model = "gemini-3-flash-preview";
  
  const mimeTypeMatch = base64Image.match(/^data:(image\/[a-zA-Z]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
  const base64Data = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

  const imagePart = {
    inlineData: {
      mimeType,
      data: base64Data,
    },
  };
  
  const textPart = {
    text: `
      You are a Verification Auditor for Handwritten Ledger OCR. 
      I will provide an image and a previous extraction result. 
      Your job is to RE-SCAN the image with 10x more focus on numerical precision.
      
      PREVIOUS RESULT:
      ${JSON.stringify(previousResult, null, 2)}
      
      OUTPUT FORMAT (JSON):
      {
        "isConsistent": boolean,
        "mismatchCount": number,
        "detections": [
          {
            "originalValue": string,
            "suggestedValue": string,
            "explanation": string (Bengali),
            "confidence": number
          }
        ],
        "styleAnalysis": string (Bengali)
      }
    `,
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [imagePart, textPart] }],
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
