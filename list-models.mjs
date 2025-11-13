// This is your new list-models.mjs file

import "dotenv/config";

const API_KEY = process.env.GEMINI_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

async function listModels() {
  if (!API_KEY) {
    console.error("ERROR: GEMINI_API_KEY not found in .env file.");
    return;
  }

  try {
    const response = await fetch(URL);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching models (${response.status}): ${errorText}`);
      return;
    }
    
    const data = await response.json();
    
    if (!data.models || data.models.length === 0) {
      console.log("No models found for your API key.");
      return;
    }

    console.log("--- Aapke Account Ke Liye Available Models ---");
    for (const model of data.models) {
      // Hum sirf woh model dekhenge jo chat kar sakte hain ('generateContent')
      if (model.supportedGenerationMethods.includes("generateContent")) {
        console.log(model.name); // Jaise: "models/gemini-1.0-pro"
      }
    }
    console.log("----------------------------------------------");

  } catch (error) {
    console.error("Failed to run list-models script:", error);
  }
}

listModels();