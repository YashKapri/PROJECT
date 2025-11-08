// This is your ai-chat.js file

// Wait for the page to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    
    // Get all the important HTML elements
    const sendButton = document.getElementById('send-button');
    const userInput = document.getElementById('user-input');
    const chatMessages = document.getElementById('chat-messages');

    // Add a click listener to the send button
    sendButton.addEventListener('click', sendMessage);

    // Add a listener for the "Enter" key
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Stop the default "Enter" behavior (like adding a new line)
            sendMessage();
        }
    });

    async function sendMessage() {
        const messageText = userInput.value;
        if (!messageText.trim()) {
            return; // Don't send empty messages
        }

        // 1. Display the user's message in the chat
        addMessage(messageText, 'user');
        userInput.value = ''; // Clear the input box

        try {
            // 2. Send the message to your backend server
            const response = await fetch('/ask-ai', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: messageText }),
            });

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json();
            const aiResponse = data.aiMessage;

            // 3. Display the AI's response in the chat
            addMessage(aiResponse, 'ai');

        } catch (error) {
            console.error('Error sending message:', error);
            addMessage('Sorry, I seem to be having trouble connecting. Please try again later.', 'ai');
        }
    }

    function addMessage(text, sender) {
        // Create a new message element
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.classList.add(sender + '-message'); // 'user-message' or 'ai-message'
        messageElement.textContent = text;

        // Add it to the chat window
        chatMessages.appendChild(messageElement);

        // Auto-scroll to the bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});