import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Gemini API Initialization (Server-side)
  const getApiKey = () => process.env.GEMINI_API_KEY || "";
  const genAI = new GoogleGenAI(getApiKey());

  // API Routes
  app.post("/api/process-ledger", async (req, res) => {
    try {
      const { base64Image } = req.body;
      if (!base64Image) {
        return res.status(400).json({ error: "Image is required" });
      }

      if (!getApiKey()) {
        return res.status(500).json({ error: "Gemini API key is missing on the server. Please check your secrets." });
      }

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const mimeTypeMatch = base64Image.match(/^data:(image\/[a-zA-Z]+);base64,/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
      const base64Data = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

      const prompt = `
        You are a specialized Optical Character Recognition (OCR) expert with a focus on South Asian handwritten business ledgers (Hishab Khata). 
        Your task is to transcribe and calculate the total from the provided image.
        
        CRITICAL INSTRUCTIONS:
        1. Identify if numerals are Bengali (১, ২, ৩) or Western (1, 2, 3).
        2. Disambiguate common handwriting confusions (Bengali 1 vs Western 9, Bengali 4 vs Western 8, etc).
        3. Recalculate everything and ensure internal math consistency.
        4. If not readable, set "isReadable": false and provide feedback.
        
        OUTPUT JSON FORMAT:
        {
          "items": [{"description": string, "amount": number}],
          "total": number,
          "summary": string (in Bengali),
          "numeralStyle": "Bengali" | "Western" | "Mixed",
          "confidenceScore": number (0-100),
          "isReadable": boolean,
          "qualityFeedback": string (if not readable)
        }
      `;

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        prompt,
      ]);

      // Note: In production use responseSchema for better reliability
      // For now, parsing the text response
      const text = result.response.text();
      // Clean up markdown if present
      const cleanedText = text.replace(/```json\n?|\n?```/g, '');
      res.json(JSON.parse(cleanedText));
    } catch (error: any) {
      console.error("Server Error:", error);
      res.status(500).json({ error: error.message || "Failed to process ledger" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
