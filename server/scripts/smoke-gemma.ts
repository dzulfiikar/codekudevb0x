import { GoogleGenAI } from "@google/genai";
import { findGemmaSettings } from "../src/settings.js";

const gemma = await findGemmaSettings();
if (!gemma.apiKey) {
  console.error("No Gemini API key stored. Add one on the Settings page first.");
  process.exit(1);
}
const model = gemma.primaryModel;
const ai = new GoogleGenAI({ apiKey: gemma.apiKey });

try {
  const response = await ai.models.generateContent({
    model,
    contents: "List the files in the current directory.",
    config: {
      systemInstruction: "You operate a Linux shell. Use the run_command tool.",
      tools: [
        {
          functionDeclarations: [
            {
              name: "run_command",
              description: "Run a bash command and return its output.",
              parametersJsonSchema: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"],
              },
            },
          ],
        },
      ],
    },
  });
  console.log(`model: ${model}`);
  console.log("functionCalls:", JSON.stringify(response.functionCalls ?? [], null, 2));
  console.log("parts:", JSON.stringify(response.candidates?.[0]?.content?.parts ?? [], null, 2));
  if (!response.functionCalls?.length) {
    console.log("No function calls returned. The agent loop needs the JSON output fallback.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Gemma call failed for model ${model}:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

process.exit();
