import { NextRequest, NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "model";
  content: string;
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const { messages } = (await request.json()) as { messages: ChatMessage[] };

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "Request must include a non-empty `messages` array." },
      { status: 400 }
    );
  }

  const contents = messages.map((message) => ({
    role: message.role,
    parts: [{ text: message.content }],
  }));

  const geminiResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  if (!geminiResponse.ok) {
    const errorText = await geminiResponse.text();
    return NextResponse.json(
      { error: `Gemini API error: ${errorText}` },
      { status: geminiResponse.status }
    );
  }

  const data = await geminiResponse.json();
  const reply: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    "No response generated.";

  return NextResponse.json({ reply });
}
