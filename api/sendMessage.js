const { GoogleGenerativeAI } = require("@google/generative-ai");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore(app);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, conversationId, userId } = req.body;

    if (!message || !conversationId || !userId) {
      return res.status(400).json({ error: "message, conversationId and userId are required" 
});
    }

    const messagesRef = db
      .collection("users").doc(userId)
      .collection("conversations").doc(conversationId)
      .collection("messages");

    const historySnap = await messagesRef
      .orderBy("timestamp", "asc")
      .limitToLast(15)
      .get();

    const history = historySnap.docs.map((doc) => ({
      role: doc.data().role,
      parts: [{ text: doc.data().content }],
    }));

    await messagesRef.add({
      role: "user",
      content: message,
      timestamp: new Date(),
    });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: `
        You are Vitalé, a friendly health assistant.
        Only answer health-related questions about symptoms, medications,
        nutrition, mental wellness and general medical information.
        If asked about unrelated topics, politely redirect to health topics.
        Always remind users to consult a doctor for serious concerns.
        Never provide a definitive diagnosis. Keep responses clear and concise.
      `,
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const aiReply = result.response.text();

    await messagesRef.add({
      role: "model",
      content: aiReply,
      timestamp: new Date(),
    });

    await db
      .collection("users").doc(userId)
      .collection("conversations").doc(conversationId)
      .update({
        lastMessage: aiReply.substring(0, 80),
        updatedAt: new Date(),
      });

    return res.status(200).json({ reply: aiReply });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
