import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  if (typeof process !== "undefined" && process.env) {
    return process.env.GEMINI_API_KEY || "";
  }
  return "";
};

const ai = new GoogleGenAI({ apiKey: getApiKey() });

export interface LedgerItem {
  description: string;
  amount: number;
}

export interface LedgerResult {
  items: LedgerItem[];
  total: number;
  summary: string;
  numeralStyle?: 'Bengali' | 'Western' | 'Mixed';
  confidenceScore?: number;
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
  const model = "gemini-1.5-flash";
  
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
         - Once a system is identified, stick to it for consistency unless a mix is explicitly detected.
      
      2. ADVANCED DIGIT DISAMBIGUATION (Visual Confusion Matrix):
         - Bengali ১ (1) vs. Western 9: Bengali 1 is often a single stroke with a loop at the top; 9 is two strokes.
         - Bengali ৪ (4) vs. Western 8: Bengali 4 is a figure-eight loop (infinity symbol) often sideways; Western 8 is vertical.
         - Bengali ৫ (5) vs. Western 6/y: Bengali 5 has a sharp downward hook.
         - Bengali ৭ (7) vs. Western 9: Bengali 7 is often a simple curve; 9 has a closed loop.
         - Bengali ৮ (8) vs. Western 4: Bengali 8 looks like an upside-down 'V' or 'U' with a tail.
         - Bengali ৯ (9) vs. Western 7: Bengali 9 has a large circular loop at the top.
         - STROKE WEIGHT: Handwritten Bengali numerals often have variable stroke thickness; Western ones are more uniform. Use context of surrounding numbers.
      
      3. VIRTUAL GRID RECONSTRUCTION:
         - Even if lines are absent or faint, use Y-coordinate clustering to group text into "Rows".
         - Use X-coordinate alignment to identify "Columns". Items aligned on the far right are strictly "Amounts".
         - Identify "Sub-totals" or "Carry-forwards" which might be offset from the main list.
      
      4. LINGUISTIC & DOMAIN HEURISTICS:
         - Use context for common business terms: 'দেনা' (debt), 'পাওনা' (receivable), 'বাকি' (due), 'উসুল' (collected).
         - If a word is 80% illegible but looks like 'ত...ল' near a set of numbers, it is likely 'টোটাল' (Total) or 'তহবিল' (Fund).
      
      5. ERROR CORRECTION & MATH CHECK:
         - Perform an internal math check. If the 'Total' written on the paper contradicts the sum of the rows, re-examine the ambiguous digits.
         - Overwritten or scratched-out lines MUST be ignored.
      
      7. MULTI-PASS VISION LOGIC:
         - Pass 1: Scan for the general document layout and identify the language/numeral system.
         - Pass 2: Identify structural anchors (headers, totals, currency symbols).
         - Pass 3: Transcribe each row. If a digit is ambiguous, look at other instances of that digit on the same page for a signature style.
         - Pass 4: Mathematically verify the internal consistency.
      
      8. SPECIFIC BENGALI HANDWRITING QUIRKS:
         - Watch for 'হ' vs 'ল' vs 'ন' in smudged ink.
         - Note that 'বাকি' (credit) and 'নগদ' (cash) are the most frequent keywords; use them to orient the row logic.
         - Small dots or ticks (like the dot in 'ড়' or 'ঢ়') can be easily missed or mistaken for ink splatter; verify if the word makes sense without it.
      
      OUTPUT REQUIREMENTS:
      - "items": Array of { "description": string, "amount": number }.
      - "total": The mathematical sum of all extracted "amount" values.
      - "summary": A concise report in friendly, professional Bengali summarizing the activity and mentioning any handwriting ambiguities encountered.
      - "numeralStyle": The primary numeral system detected ('Bengali', 'Western', or 'Mixed').
      - "confidenceScore": A number between 0 and 100 indicating your confidence in the transcription accuracy.
      - "isReadable": Boolean.
      - "qualityFeedback": String if not readable.
    `,
  };

  const response = await ai.models.generateContent({
    model,
    contents: { parts: [imagePart, textPart] },
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
                description: { type: Type.STRING, description: "Description of the transaction" },
                amount: { type: Type.NUMBER, description: "The amount as a number" }
              },
              required: ["description", "amount"]
            }
          },
          total: { type: Type.NUMBER, description: "Sum of all amounts" },
          summary: { type: Type.STRING, description: "A brief summary of the records in Bengali" },
          numeralStyle: { type: Type.STRING, description: "Detected numeral system style", enum: ["Bengali", "Western", "Mixed"] },
          confidenceScore: { type: Type.NUMBER, description: "Confidence score from 0-100" },
          isReadable: { type: Type.BOOLEAN, description: "Whether the image was clear enough to read" },
          qualityFeedback: { type: Type.STRING, description: "Feedback on image quality in Bengali if not readable" }
        },
        required: ["items", "total", "summary", "numeralStyle", "confidenceScore", "isReadable"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Failed to parse AI response", error);
    throw new Error("হিসাব বের করতে সমস্যা হয়েছে। দয়া করে আবার চেষ্টা করুন।");
  }
}

export async function verifyLedgerAccuracy(base64Image: string, previousResult: LedgerResult): Promise<VerificationResult> {
  const model = "gemini-1.5-flash";
  
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
      Your job is to RE-SCAN the image with 10x more focus on numerical precision and handwriting style nuances.
      
      PREVIOUS RESULT:
      ${JSON.stringify(previousResult, null, 2)}
      
      AUDIT TASKS:
      1. STYLE CHECK: Confirm if the numeral system (Bengali vs Western) was correctly identified in ALL rows.
      2. CORRECTION: Look for common "Visual Illusions" (e.g., Bengali 4 vs Western 8, Bengali 1 vs Western 9).
      3. MATH AUDIT: Recalculate everything.
      4. DISCREPANCY DETECTION: List any items where your re-scan suggests a different value or description than the previous result.
      
      OUTPUT FORMAT (JSON):
      {
        "isConsistent": boolean (true if previous result matches your high-res scan exactly),
        "mismatchCount": number,
        "detections": [
          {
            "originalValue": "The value from the previous result",
            "suggestedValue": "Your new suggested value",
            "explanation": "Why you think this correction is needed (in Bengali)",
            "confidence": number (0-100)
          }
        ],
        "styleAnalysis": "Brief report on the subscriber's handwriting style and any consistent quirks (in Bengali)"
      }
    `,
  };

  const response = await ai.models.generateContent({
    model,
    contents: { parts: [imagePart, textPart] },
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

  try {
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Failed to parse verification response", error);
    throw new Error("যাচাইকরণ প্রক্রিয়া সম্পন্ন করতে সমস্যা হয়েছে।");
  }
}
