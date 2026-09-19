import { NextRequest, NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "model";
  content: string;
};

const GEMINI_MODEL = "gemini-2.5-flash";
const VERTEX_LOCATION = "us-central1";

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  const accessToken = process.env.GCP_ACCESS_TOKEN;
  const projectId = process.env.GCP_PROJECT_ID;

  if (!apiKey && !accessToken) {
    return NextResponse.json(
      { error: "No Gemini credentials configured. Set GEMINI_API_KEY or GCP_ACCESS_TOKEN." },
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

  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (apiKey) {
    // Gemini Developer API — stable API key auth
    url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  } else {
    // Vertex AI endpoint — works with standard cloud-platform scoped GCP tokens
    if (!projectId) {
      return NextResponse.json(
        { error: "GCP_PROJECT_ID is required when using GCP_ACCESS_TOKEN." },
        { status: 500 }
      );
    }
    url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const geminiResponse = await fetch(url, {
    method: "POST",
    headers,
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

