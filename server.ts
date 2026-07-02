import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON requests with generous payload sizes
  app.use(express.json({ limit: "50mb" }));

  // Helper lazy-getter for GoogleGenAI
  let aiClient: GoogleGenAI | null = null;
  function getAi(): GoogleGenAI {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not defined in the environment variables.");
      }
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return aiClient;
  }

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // AI Finance Advisor API endpoint
  app.post("/api/gemini/advisor", async (req, res) => {
    try {
      const { message, history, context } = req.body;

      if (!message) {
        res.status(400).json({ error: "Missing 'message' field in user request." });
        return;
      }

      // Check if API key is configured
      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: "Gemini API Key is missing. Please add GEMINI_API_KEY in the Secrets panel of Google AI Studio.",
        });
        return;
      }

      const ai = getAi();

      // Compile financial context text to guide the model's personalized response
      let contextText = "No financial data uploaded yet.";
      if (context) {
        contextText = `
User Financial Summary Context:
- Currency Symbol: ₹ (INR) or of user choice
- Total Income: ₹${context.totalIncome ?? 0}
- Total Expenses: ₹${context.totalExpenses ?? 0}
- Saved Amount: ₹${context.savings ?? 0}
- Savings Rate: ${context.savingsRate ?? 0}%
- Financial Health Score: ${context.healthScore ?? 0}/100
- Category Spends: ${JSON.stringify(context.categorySpends ?? {})}
- Top Spends List Description: ${JSON.stringify(context.topTransactions ?? [])}
`;
      }

      // We form a prompt with the specific user system instruction to behave as an elite Wealth Advisor and Financial Analyst.
      const systemInstruction = `You are "FinSight AI", an elite, professional Personal Wealth Manager & Technical Financial Analyst.
Your goal is to provide deeply practical, custom-tailored financial coaching, savings tips, and budget advice.
The user has provided their parsed bank transaction metadata below. Use it to speak with high precision, referencing specifically their Swiggy payments, salary levels, categories, health scores, and investment rates when relevant.

=== TRANSACTION PROFILE & HEALTH ===
${contextText}
===================================

IMPORTANT ADVISOR OUTPUT FORMATTING RULES:
1. Speak in the voice of a seasoned financial analyst writing a clean professional business report, not a chatbot generating markdown. Keep the tone clinical, objective, analytical, and highly professional.
2. NO decorative separator lines (do NOT use "---", "===", or "***").
3. NO excessive bold formatting or repeated emojis. Do not use emojis at all, except occasionally a single symbol (like "•" for bullets) if strictly necessary.
4. NO markdown headers of level 4 or below (do NOT use "####"). Avoid standard bold headings (such as "***Financial Health Analysis***" or "**Top Recommendations**"). Instead, use simple text headings on their own separate line without surrounding asterisks, e.g.:
   Financial Health Analysis
   Top Recommendations
5. Use plain text and short paragraphs (2-3 sentences max).
6. Format responses using clean structured layout: plain text, simple bullet points, and plain tables for comparative metrics (e.g. category expenditure comparisons) if relevant.
7. Recommend specific savings Reductions using exact currency values and realistic math. Propose concrete percentage allocations rather than vague ideas.

Example response template:
Financial Health Score: 41/100

Assessment:
Your current spending exceeds your income, resulting in a negative savings rate. Food and discretionary purchases account for a significant portion of monthly expenses.

Key Findings:
• Food spending represents 31% of total expenses.
• Shopping expenses increased by 18% this month.
• Savings rate is below the recommended 20%.

Recommendations:
• Reduce discretionary spending by 10-15%.
• Allocate a fixed percentage of income toward savings.
• Establish a 6-month emergency fund.`;

      const contents: any[] = [];
      
      // Map historical chat turns correctly if present
      if (Array.isArray(history)) {
        history.forEach((turn: { role: string; text: string }) => {
          if (turn.role === 'user' || turn.role === 'model') {
            contents.push({
              role: turn.role,
              parts: [{ text: turn.text }]
            });
          }
        });
      }

      // Append current message
      contents.push({
        role: "user",
        parts: [{ text: message }]
      });

      // Call Gemini 3.5 Flash model
      const modelName = "gemini-3.5-flash";
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini Advisor Server Error:", error);
      res.status(500).json({
        error: error.message || "An internal error occurred while communicating with the AI model.",
      });
    }
  });

  // Serve static UI assets or initialize Vite Middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Finance Analyzer full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
