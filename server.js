// This is your server.js file

// 1. Import required packages
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Loads the .env file

// 2. Setup the Express server
const app = express();
const port = 3000;
app.use(express.json()); // Middleware to read JSON from requests
app.use(express.static('.')); // Serves all static files (index.html, style.css) from the current folder

// 3. Setup the Google AI Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    // This system prompt is CRITICAL. It tells the AI how to behave.
    systemInstruction: "You are 'YashFitness Coach,' a friendly, motivating, and knowledgeable fitness expert. Your goal is to help users of the YashFitness website. You are not a medical doctor and should refuse to give medical advice, instead suggesting they see a professional. Keep your answers concise and encouraging. The user is interacting with you through a chat window on the YashFitness gym website.",
});

// 4. Create the API endpoint for your chat
app.post('/ask-ai', async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({ error: 'No message provided.' });
        }

        // Start a chat session (history is blank for this simple example)
        const chat = model.startChat({
            history: [],
            generationConfig: {
                maxOutputTokens: 500,
            },
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        const aiMessage = response.text();

        // Send the AI's plain text response back to the frontend
        res.json({ aiMessage: aiMessage });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: 'Failed to get response from AI.' });
    }
});

// 5. Start the server
app.listen(port, () => {
    console.log(`YashFitness website server running!`);
    console.log(`Open http://localhost:${port} in your browser.`);
});